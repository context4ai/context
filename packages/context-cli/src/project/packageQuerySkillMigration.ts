import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { inspectPackageTemplateReview, refreshStarterTemplateDigest } from "./packageTemplateReview.js";
import { resolveContextPackageTemplatesRoot } from "./workspace.js";

export const LEGACY_QUERY_SKILL = "knowledge-query";
export const QUERY_SKILL = "context-knowledge-query";
const SEARCH_GUIDE = "others/context/search-guide.md";
const DIGEST_FILE_PREFIX = "legacy-query-skill-digests";
const LANGUAGES = ["en", "zh-CN"] as const;
type TemplateLanguage = typeof LANGUAGES[number];
type DigestSet = Record<string, Record<TemplateLanguage, Set<string>>>;

export type QuerySkillMigration =
  | { packageName: string; state: "migrated"; language: TemplateLanguage; templatePath: string }
  | { packageName: string; state: "customized"; templatePath: string };

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).split(/[/\\]+/u).join("/"));
    }
  };
  await visit(root);
  return files.sort();
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Digests of every query Skill Context has shipped, including distribution-specific lists. */
async function loadLegacyDigests(templatesParent: string): Promise<DigestSet> {
  const digests: DigestSet = {};
  for (const entry of await readdir(templatesParent)) {
    if (!entry.startsWith(DIGEST_FILE_PREFIX) || !entry.endsWith(".json")) continue;
    let parsed: { files?: Record<string, Partial<Record<TemplateLanguage, unknown>>> };
    try {
      parsed = JSON.parse(await readFile(join(templatesParent, entry), "utf8")) as typeof parsed;
    } catch {
      continue;
    }
    for (const [file, byLanguage] of Object.entries(parsed.files ?? {})) {
      const target = digests[file] ??= { en: new Set(), "zh-CN": new Set() };
      for (const language of LANGUAGES) {
        const values = byLanguage?.[language];
        if (Array.isArray(values)) for (const value of values) if (typeof value === "string") target[language].add(value);
      }
    }
  }
  return digests;
}

/**
 * Replace an unedited legacy `knowledge-query` Skill in a kb package template with
 * the shipped `context-knowledge-query` Skill. An edited legacy Skill is left in
 * place and reported, because it belongs to the package author.
 */
export async function migrateLegacyQuerySkill(projectRoot: string, pkg: PackageDefinition): Promise<QuerySkillMigration | undefined> {
  if (pkg.kind !== "package.kb") return undefined;
  const templateRoot = resolve(projectRoot, pkg.template.path);
  const legacyRoot = join(templateRoot, "skills", LEGACY_QUERY_SKILL);
  if (!existsSync(legacyRoot)) return undefined;
  const customized = { packageName: pkg.name, state: "customized" as const, templatePath: pkg.template.path };
  if (existsSync(join(templateRoot, "skills", QUERY_SKILL))) return customized;

  const shippedRoot = resolveContextPackageTemplatesRoot();
  const digests = await loadLegacyDigests(dirname(shippedRoot));
  const files = await filesUnder(legacyRoot);
  if (files.length === 0 || files.some((file) => digests[file] === undefined)) return customized;
  const fileDigests = await Promise.all(files.map(async (file) => sha256(await readFile(join(legacyRoot, file)))));
  const language = LANGUAGES.find((candidate) =>
    files.every((file, index) => digests[file]![candidate].has(fileDigests[index]!))
  );
  if (language === undefined || !files.includes("SKILL.md")) return customized;

  const reviewState = (await inspectPackageTemplateReview(projectRoot, pkg)).state;
  const starterUntouched = reviewState === "review-required" || reviewState === "starter-accepted";
  const languageRoot = language === "zh-CN" ? join(dirname(shippedRoot), "package-templates.zh-CN") : shippedRoot;
  const shippedKb = join(languageRoot, "kb");
  await rm(legacyRoot, { recursive: true, force: true });
  await cp(join(shippedKb, "skills", QUERY_SKILL), join(templateRoot, "skills", QUERY_SKILL), { recursive: true });
  const guideTarget = join(templateRoot, ...SEARCH_GUIDE.split("/"));
  if (!existsSync(guideTarget)) {
    await mkdir(dirname(guideTarget), { recursive: true });
    await cp(join(shippedKb, ...SEARCH_GUIDE.split("/")), guideTarget);
  }
  if (starterUntouched) await refreshStarterTemplateDigest(templateRoot);
  return { packageName: pkg.name, state: "migrated", language, templatePath: pkg.template.path };
}

export async function migrateLegacyQuerySkills(
  projectRoot: string,
  packages: readonly PackageDefinition[],
): Promise<QuerySkillMigration[]> {
  const results: QuerySkillMigration[] = [];
  for (const pkg of packages) {
    const result = await migrateLegacyQuerySkill(projectRoot, pkg);
    if (result !== undefined) results.push(result);
  }
  return results;
}
