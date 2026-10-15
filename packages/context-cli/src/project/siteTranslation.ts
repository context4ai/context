import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { PackageDefinition } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readKnowledgeMap } from "./knowledgeMap.js";
import { canReadRepoObjects, optionalRepoGit } from "./repoContentGit.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import { listApprovedKnowledge } from "./packageBuilder.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { selectPackageKnowledge } from "./packageBuildContent.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { withProjectWriteLock } from "./writeLock.js";

export const TRANSLATIONS_ROOT = "translations";
export const TRANSLATION_MAP_FILE = "knowledge-map.yaml";
export const TRANSLATION_RUNTIME_ROOT = ".tmp/context-runtime/translation";
const RECEIPT_FILE = "receipt.json";
const TASK_FILE = "task.json";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;
const SECTION_OPEN_RE = /<!--\s*context:section\b[^>]*\bid="([^"]+)"[^>]*-->/gu;
const SECTION_CLOSE_RE = /<!--\s*\/context:section\s*-->/gu;
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)^\1\2[ \t]*$/gmu;

export type TranslationState = "current" | "stale" | "missing";
export interface TranslationArticleItem {
  kind: "article"; locale: string; approved_path: string; translation_path: string;
  artifact_ref: string | null; title: string; source_digest: string; state: TranslationState;
}
export interface TranslationMapItem {
  kind: "map-entry"; locale: string; key: string; title: string; source_digest: string; state: TranslationState;
}
export type TranslationItem = TranslationArticleItem | TranslationMapItem;
export interface SiteTranslationInspection {
  locales: string[];
  items: TranslationItem[];
  pending: number;
  orphans: string[];
  source_set_digest: string | null;
  resolved_digest: string | null;
  route_satisfied: boolean;
}
export interface TranslatedArticle { title: string; description?: string; body: string; current: boolean }

const text = z.string().trim().min(1);
export const translationSubmitSchema = z.object({
  expected_digest: text,
  articles: z.array(z.object({ locale: text, approved_path: text, file: text }).strict()).default([]),
  map_entries: z.array(z.object({ locale: text, key: text, title: text }).strict()).default([]),
}).strict();
export type TranslationSubmitInput = z.infer<typeof translationSubmitSchema>;
const mapTranslationSchema = z.object({
  locale: text,
  entries: z.record(z.string(), z.object({ title: text, source_digest: text }).strict()),
}).strict();
const receiptSchema = z.object({ source_set_digest: text, outcome: z.enum(["submitted", "skipped"]), recorded_at: text }).strict();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_RE.exec(content);
  return match ? { frontmatter: parseKnowledgeFrontmatter(content), body: content.slice(match[0].length) } : { frontmatter: {}, body: content };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function translationLocales(packages: readonly PackageDefinition[]): string[] {
  return [...new Set(packages.flatMap(pkg => pkg.kind === "package.kb" ? Object.keys(pkg.site?.locales ?? {}) : []))].sort();
}

function translatedPackages(packages: readonly PackageDefinition[]): PackageDefinition[] {
  return packages.filter(pkg => pkg.kind === "package.kb" && Object.keys(pkg.site?.locales ?? {}).length > 0);
}

/** Translation freshness follows reader-visible text only, not runtime metadata. */
export function approvedArticleDigest(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  return sha256(JSON.stringify({ title: stringField(frontmatter.title) ?? null,
    description: stringField(frontmatter.description) ?? null, body: body.trim() }));
}

function mapTitleDigest(title: string): string {
  return sha256(JSON.stringify({ title }));
}

export function translationArticlePath(locale: string, approvedRelPath: string): string {
  return `${TRANSLATIONS_ROOT}/${locale}/${approvedRelPath}`;
}

function mapTranslationPath(locale: string): string {
  return `${TRANSLATIONS_ROOT}/${locale}/${TRANSLATION_MAP_FILE}`;
}

async function optionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function readMapTranslation(projectRoot: string, locale: string): Promise<z.infer<typeof mapTranslationSchema>["entries"]> {
  const content = await optionalText(join(projectRoot, mapTranslationPath(locale)));
  if (content === undefined) return {};
  const parsed = mapTranslationSchema.safeParse(parseYaml(content));
  if (!parsed.success || parsed.data.locale !== locale) {
    throw new ContextError(ExitCode.WorkspaceStateError, `Translated navigation is invalid: ${mapTranslationPath(locale)}`, {
      category: ErrorCategory.WorkspaceStateInvalid, reason_code: "translation-map-invalid", path: mapTranslationPath(locale),
      next_action: { kind: "run", command: "context translate prepare --format json", message: "Translate the navigation titles again." },
    });
  }
  return parsed.data.entries;
}

async function listTranslationFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries.filter(entry => entry.isFile() && entry.name.endsWith(".md"))
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split("\\").join("/"));
}

async function selectedArticles(projectRoot: string, packages: readonly PackageDefinition[]): Promise<ApprovedKnowledgeFile[]> {
  const approved = await listApprovedKnowledge(projectRoot);
  const selected = new Map<string, ApprovedKnowledgeFile>();
  for (const pkg of translatedPackages(packages)) {
    for (const file of selectPackageKnowledge(approved, pkg)) selected.set(file.relPath, file);
  }
  return [...selected.values()].sort((left, right) => left.relPath.localeCompare(right.relPath));
}

/** Read one stored translation; undefined means the reader sees the primary language. */
export async function readTranslatedArticle(projectRoot: string, locale: string, file: ApprovedKnowledgeFile): Promise<TranslatedArticle | undefined> {
  const content = await optionalText(join(projectRoot, translationArticlePath(locale, file.relPath)));
  if (content === undefined) return undefined;
  const { frontmatter, body } = splitFrontmatter(content);
  const title = stringField(frontmatter.title);
  if (title === undefined) return undefined;
  const translation = frontmatter.translation as Record<string, unknown> | undefined;
  const description = stringField(frontmatter.description);
  return { title, ...(description === undefined ? {} : { description }), body,
    current: translation?.source_digest === approvedArticleDigest(file.content) };
}

export async function readTranslatedMapTitles(projectRoot: string, locale: string): Promise<Map<string, string>> {
  return new Map(Object.entries(await readMapTranslation(projectRoot, locale)).map(([key, entry]) => [key, entry.title]));
}

async function readReceipt(projectRoot: string): Promise<z.infer<typeof receiptSchema> | undefined> {
  const content = await optionalText(join(projectRoot, TRANSLATION_RUNTIME_ROOT, RECEIPT_FILE));
  if (content === undefined) return undefined;
  try { return receiptSchema.parse(JSON.parse(content)); } catch { return undefined; }
}

export async function inspectSiteTranslations(projectRoot: string, packages: readonly PackageDefinition[]): Promise<SiteTranslationInspection> {
  const locales = translationLocales(packages);
  if (locales.length === 0) {
    return { locales, items: [], pending: 0, orphans: [], source_set_digest: null, resolved_digest: null, route_satisfied: true };
  }
  const articles = await selectedArticles(projectRoot, packages);
  const mapEntries = (await readKnowledgeMap(projectRoot))?.entries ?? [];
  const items: TranslationItem[] = [];
  const orphans: string[] = [];
  for (const locale of locales) {
    for (const file of articles) {
      const sourceDigest = approvedArticleDigest(file.content);
      const content = await optionalText(join(projectRoot, translationArticlePath(locale, file.relPath)));
      const stored = content === undefined ? undefined : splitFrontmatter(content).frontmatter.translation as Record<string, unknown> | undefined;
      items.push({ kind: "article", locale, approved_path: `knowledge/${file.relPath}`, translation_path: translationArticlePath(locale, file.relPath),
        artifact_ref: file.article?.article_id ?? null, title: stringField(parseKnowledgeFrontmatter(file.content).title) ?? file.relPath,
        source_digest: sourceDigest,
        state: content === undefined ? "missing" : stored?.source_digest === sourceDigest ? "current" : "stale" });
    }
    const storedMap = await readMapTranslation(projectRoot, locale);
    for (const entry of mapEntries) {
      const sourceDigest = mapTitleDigest(entry.title);
      const stored = storedMap[entry.key];
      items.push({ kind: "map-entry", locale, key: entry.key, title: entry.title, source_digest: sourceDigest,
        state: stored === undefined ? "missing" : stored.source_digest === sourceDigest ? "current" : "stale" });
    }
    const known = new Set(articles.map(file => file.relPath));
    for (const relPath of await listTranslationFiles(join(projectRoot, TRANSLATIONS_ROOT, locale))) {
      if (!known.has(relPath)) orphans.push(translationArticlePath(locale, relPath));
    }
  }
  const pending = items.filter(item => item.state !== "current").length;
  const sourceSetDigest = sha256(JSON.stringify(items.map(item =>
    [item.locale, item.kind, item.kind === "article" ? item.approved_path : item.key, item.source_digest])));
  const receipt = await readReceipt(projectRoot);
  const resolved = receipt?.source_set_digest ?? null;
  return { locales, items, pending, orphans: orphans.sort(), source_set_digest: sourceSetDigest, resolved_digest: resolved,
    route_satisfied: pending === 0 || resolved === sourceSetDigest };
}

const DRAFT_ROOT = ".tmp/agent-payloads/translations";
const SOURCE_HISTORY_LIMIT = 50;

/** Diff from the approved version a translation was made from. Missing or
 * partial-clone history yields undefined; never trigger a lazy fetch. */
async function sourceDiffSince(projectRoot: string, relPath: string, digest: string | undefined): Promise<string | undefined> {
  if (digest === undefined || !await canReadRepoObjects(projectRoot)) return undefined;
  const path = `knowledge/${relPath}`;
  const commits = await optionalRepoGit(projectRoot, ["log", "--format=%H", "-n", String(SOURCE_HISTORY_LIMIT), "--", path]);
  for (const commit of commits?.split("\n").filter(Boolean) ?? []) {
    const content = await optionalRepoGit(projectRoot, ["show", `${commit}:./${path}`]);
    if (content === undefined || approvedArticleDigest(content) !== digest) continue;
    return optionalRepoGit(projectRoot, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", commit, "--", path]);
  }
  return undefined;
}

export async function prepareSiteTranslation(projectRoot: string, packages: readonly PackageDefinition[]) {
  return withProjectWriteLock(projectRoot, "translate-prepare", async () => {
    const inspection = await inspectSiteTranslations(projectRoot, packages);
    const approved = new Map((await selectedArticles(projectRoot, packages)).map(file => [`knowledge/${file.relPath}`, file]));
    const items = [];
    const articles = [];
    const map_entries = [];
    for (const item of inspection.items) {
      if (item.kind === "map-entry") {
        if (item.state !== "current") { items.push(item); map_entries.push({ locale: item.locale, key: item.key, title: item.title }); }
        continue;
      }
      if (item.state === "current") continue;
      const source = approved.get(item.approved_path)!;
      const stored = await optionalText(join(projectRoot, item.translation_path));
      const file = `${DRAFT_ROOT}/${item.locale}/${source.relPath}`;
      // An existing draft is unfinished work; submission removes drafts it saved.
      // A draft whose body is still the unedited seed (for example one left by
      // an older CLI that did not remove drafts) holds no work and is reseeded.
      const seed = stored ?? source.content;
      const existing = await optionalText(join(projectRoot, file));
      const body = (content: string) => content.slice(FRONTMATTER_RE.exec(content)?.[0].length ?? 0);
      const kept = existing !== undefined && body(existing) !== body(seed);
      if (!kept) await atomicWrite(join(projectRoot, file), seed);
      const translation = stored === undefined ? undefined : splitFrontmatter(stored).frontmatter.translation as Record<string, unknown> | undefined;
      // A kept draft may contain edits for source text that later changed back;
      // the stored translation's diff does not describe it.
      const diff = kept || stored === undefined ? undefined : await sourceDiffSince(projectRoot, source.relPath, stringField(translation?.source_digest));
      const diffFile = `${file}.diff`;
      if (diff) await atomicWrite(join(projectRoot, diffFile), `${diff}\n`);
      else await rm(join(projectRoot, diffFile), { force: true });
      items.push({ ...item, file, draft: kept ? "kept" as const : "generated" as const, source_diff: diff ? diffFile : null });
      articles.push({ locale: item.locale, approved_path: item.approved_path, file });
    }
    const task = { expected_digest: inspection.source_set_digest, locales: inspection.locales, items, orphans: inspection.orphans };
    const taskPath = `${TRANSLATION_RUNTIME_ROOT}/${TASK_FILE}`;
    const submissionPath = `${TRANSLATION_RUNTIME_ROOT}/submission.yaml`;
    await atomicWrite(join(projectRoot, taskPath), JSON.stringify(task, null, 2) + "\n");
    await atomicWrite(join(projectRoot, submissionPath), stringifyYaml({ expected_digest: task.expected_digest, articles, map_entries }));
    return { ...task, task_path: taskPath, submission_path: submissionPath };
  });
}

function sectionIds(body: string): string[] {
  return [...body.matchAll(SECTION_OPEN_RE)].map(match => match[1]!);
}

function fences(body: string): Array<{ lang: string; content: string }> {
  return [...body.matchAll(FENCE_RE)].map(match => ({ lang: match[3]!.trim().split(/\s+/u)[0] ?? "", content: match[4]!.trimEnd() }));
}

function linkTargets(body: string): string[] {
  return markdownReaderLinks(body).map(link => link.target).sort();
}

/** Structural parity preserves evidence, executable examples and link targets. */
export function translationStructureIssues(source: string, translated: string): string[] {
  const sourceBody = splitFrontmatter(source).body;
  const { frontmatter, body } = splitFrontmatter(translated);
  const issues: string[] = [];
  if (stringField(frontmatter.title) === undefined) issues.push("The translation requires a non-empty frontmatter title.");
  if (JSON.stringify(sectionIds(sourceBody)) !== JSON.stringify(sectionIds(body)) ||
    [...sourceBody.matchAll(SECTION_CLOSE_RE)].length !== [...body.matchAll(SECTION_CLOSE_RE)].length) {
    issues.push("Section markers must keep the same ids and order as the approved article.");
  }
  const sourceFences = fences(sourceBody);
  const translatedFences = fences(body);
  if (sourceFences.length !== translatedFences.length) issues.push(`Expected ${sourceFences.length} code blocks, found ${translatedFences.length}.`);
  else sourceFences.forEach((fence, index) => {
    const other = translatedFences[index]!;
    if (fence.lang !== other.lang) issues.push(`Code block ${index + 1} must keep language "${fence.lang}".`);
    else if (!["mermaid", "text", "txt", "plaintext"].includes(fence.lang) && fence.content !== other.content) {
      issues.push(`Code block ${index + 1} must not change.`);
    }
  });
  if (JSON.stringify(linkTargets(sourceBody)) !== JSON.stringify(linkTargets(body))) issues.push("Link targets must match the approved article.");
  return issues;
}

function invalidSubmission(message: string, extra: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid, reason_code: "translation-submit-invalid", ...extra,
    next_action: { kind: "run", command: "context translate prepare --format json", message: "Read the current translation task and submit again." },
  });
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

async function writeReceipt(projectRoot: string, digest: string, outcome: "submitted" | "skipped"): Promise<void> {
  await atomicWrite(join(projectRoot, TRANSLATION_RUNTIME_ROOT, RECEIPT_FILE),
    JSON.stringify({ source_set_digest: digest, outcome, recorded_at: new Date().toISOString() }, null, 2) + "\n");
}

function assertExpectedDigest(inspection: SiteTranslationInspection, expected: string): string {
  if (inspection.source_set_digest === null) throw invalidSubmission("No knowledge package declares site locales.");
  if (inspection.source_set_digest !== expected) {
    throw invalidSubmission("The approved content changed after the translation task was prepared; nothing was saved.", {
      reason_code: "translation-stale-digest", expected_digest: expected, current_digest: inspection.source_set_digest,
    });
  }
  return inspection.source_set_digest;
}

export async function submitSiteTranslation(projectRoot: string, packages: readonly PackageDefinition[], input: TranslationSubmitInput, resolveInput: (file: string) => string) {
  return withProjectWriteLock(projectRoot, "translate-submit", async () => {
    const inspection = await inspectSiteTranslations(projectRoot, packages);
    const digest = assertExpectedDigest(inspection, input.expected_digest);
    const approved = new Map((await selectedArticles(projectRoot, packages)).map(file => [`knowledge/${file.relPath}`, file]));
    const writes: Array<{ path: string; content: string }> = [];
    const issues: Array<{ locale: string; target: string; issues: string[] }> = [];
    const translatedAt = new Date().toISOString();
    const drafts: string[] = [];
    for (const article of input.articles) {
      const file = approved.get(article.approved_path);
      if (!inspection.locales.includes(article.locale) || file === undefined) {
        issues.push({ locale: article.locale, target: article.approved_path, issues: ["Unknown locale or approved article."] });
        continue;
      }
      const draftPath = relative(resolve(projectRoot), resolve(resolveInput(article.file))).split("\\").join("/");
      if (draftPath.startsWith(`${DRAFT_ROOT}/`)) drafts.push(draftPath);
      const content = await optionalText(resolveInput(article.file));
      if (content === undefined) {
        issues.push({ locale: article.locale, target: article.approved_path, issues: [`Translation file not found: ${article.file}`] });
        continue;
      }
      const found = translationStructureIssues(file.content, content);
      if (found.length > 0) { issues.push({ locale: article.locale, target: article.approved_path, issues: found }); continue; }
      const { frontmatter, body } = splitFrontmatter(content);
      const description = stringField(frontmatter.description);
      const head = stringifyYaml({ title: stringField(frontmatter.title), ...(description === undefined ? {} : { description }),
        translation: { locale: article.locale, ...(file.article?.article_id ? { artifact_ref: file.article.article_id } : {}),
          source_digest: approvedArticleDigest(file.content), translated_at: translatedAt } }).trimEnd();
      writes.push({ path: translationArticlePath(article.locale, file.relPath), content: `---\n${head}\n---\n\n${body.trimStart()}` });
    }
    const mapEntries = new Map(((await readKnowledgeMap(projectRoot))?.entries ?? []).map(entry => [entry.key, entry]));
    const mapUpdates = new Map<string, Array<{ key: string; title: string; digest: string }>>();
    for (const entry of input.map_entries) {
      const source = mapEntries.get(entry.key);
      if (!inspection.locales.includes(entry.locale) || source === undefined) {
        issues.push({ locale: entry.locale, target: entry.key, issues: ["Unknown locale or navigation entry."] });
        continue;
      }
      mapUpdates.set(entry.locale, [...mapUpdates.get(entry.locale) ?? [], { key: entry.key, title: entry.title, digest: mapTitleDigest(source.title) }]);
    }
    if (issues.length > 0) throw invalidSubmission("Some translations do not match the approved structure; nothing was saved.", { issues });
    for (const [locale, updates] of mapUpdates) {
      const stored = await readMapTranslation(projectRoot, locale);
      for (const update of updates) stored[update.key] = { title: update.title, source_digest: update.digest };
      const entries = Object.fromEntries(Object.entries(stored).filter(([key]) => mapEntries.has(key)).sort(([left], [right]) => left.localeCompare(right)));
      writes.push({ path: mapTranslationPath(locale), content: stringifyYaml({ locale, entries }) });
    }
    for (const write of writes) await atomicWrite(join(projectRoot, write.path), write.content);
    for (const draft of drafts) for (const path of [draft, `${draft}.diff`]) await rm(join(projectRoot, path), { force: true });
    for (const orphan of inspection.orphans) await rm(join(projectRoot, orphan), { force: true });
    await writeReceipt(projectRoot, digest, "submitted");
    return { written: writes.map(write => write.path), removed: inspection.orphans };
  });
}

export async function skipSiteTranslation(projectRoot: string, packages: readonly PackageDefinition[], digest: string) {
  return withProjectWriteLock(projectRoot, "translate-skip", async () => {
    const inspection = await inspectSiteTranslations(projectRoot, packages);
    await writeReceipt(projectRoot, assertExpectedDigest(inspection, digest), "skipped");
    return { skipped: inspection.pending };
  });
}

/** Package freshness includes every stored translation for the locales a package publishes. */
export async function siteTranslationFingerprint(projectRoot: string, pkg: PackageDefinition): Promise<string | null> {
  const locales = pkg.kind === "package.kb" ? Object.keys(pkg.site?.locales ?? {}).sort() : [];
  if (locales.length === 0) return null;
  const files: Array<[string, string]> = [];
  for (const locale of locales) {
    const root = join(projectRoot, TRANSLATIONS_ROOT, locale);
    for (const relPath of [...await listTranslationFiles(root), ...existsSync(join(root, TRANSLATION_MAP_FILE)) ? [TRANSLATION_MAP_FILE] : []].sort()) {
      files.push([`${locale}/${relPath}`, sha256(await readFile(join(root, relPath), "utf8"))]);
    }
  }
  return sha256(JSON.stringify(files));
}
