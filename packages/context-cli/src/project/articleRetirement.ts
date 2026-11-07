import { readFile, readdir } from "node:fs/promises";
import { posix } from "node:path";
import { z } from "zod";
import YAML from "yaml";
import { indexerProtocolDigest, validateArticleStructureEntries, validateKnowledgeMap, updateKnowledgeMap,
  type IndexerProjectFileTarget } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedRevision, type ApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { readTaskRollback } from "./taskRollback.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { readProductionStage } from "./productionStageStore.js";
import { KNOWLEDGE_MAP_PATH } from "./knowledgeMap.js";
import { replaceMarkdownInlineLinkTargets } from "./markdownLinks.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { safeProjectTarget, recoverDurableMultiFileTransactions, runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

export const articleRetirementSchema = z.object({
  reason: z.string().trim().min(1),
  targets: z.array(z.object({ path: z.string().min(1), replacement: z.string().min(1).optional() }).strict()).min(1),
}).strict();

const next = "context status --format json";
function rebuildInput(revision: string): string {
  return JSON.stringify({ id: `retirement-${revision.slice(7)}`, operation: "rebuild", timing: "priority", targets: [] });
}
function rebuildCommand(revision: string): string {
  return `context task maintain --input '.tmp/context-runtime/retirements/${revision.slice(7)}/rebuild.json' --format json`;
}
function invalid(reason: string, message: string, details: Record<string, unknown> = {}): never {
  throw new ContextError(ExitCode.UserError, message, { category: ErrorCategory.UserInputInvalid,
    reason_code: reason, ...details, next_action: { command: next,
      message: "Keep the retirement input. Resolve the listed page/reference or finish the active revision, then preview it again; no retirement was applied." } });
}

async function text(root: string, path: string): Promise<string | undefined> {
  try { return await readFile(await safeProjectTarget(root, path), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Explicit, digest-bound removal of approved pages. No semantic inference or
 * navigation hiding: Markdown and its authoritative structure leave together.
 * The ordinary status/close/version/build flow derives all consumer outputs. */
export async function retireArticles(input: { projectRoot: string; value: unknown; apply?: boolean;
  plan_digest?: string; inject_failure?: DurableMultiFileFailureInjector }) {
  const parsed = articleRetirementSchema.safeParse(input.value);
  if (!parsed.success) invalid("article-retirement-input-invalid", "Provide reason and targets with exact approved paths and optional replacement paths.",
    { input_schema: { reason: "string", targets: [{ path: "collection/old.md", replacement: "collection/approved-successor.md (optional)" }] } });
  const value = parsed.data;
  return withProjectWriteLock(input.projectRoot, "retire-articles", async () => {
    if (input.apply) await recoverDurableMultiFileTransactions(input.projectRoot);
    // A retry after interruption verifies the exact committed result, instead
    // of interpreting a now-missing original as a new deletion request.
    if (input.apply && input.plan_digest && /^sha256:[a-f0-9]{64}$/u.test(input.plan_digest)) {
      const receipt = await text(input.projectRoot, `.tmp/context-runtime/retirements/${input.plan_digest.slice(7)}/receipt.json`);
      if (receipt) {
        const saved = JSON.parse(receipt) as { request: string; files: { path: string; digest: string | null }[] };
        if (saved.request !== indexerProtocolDigest(value)) invalid("article-retirement-input-changed", "The retirement input differs from the applied request.");
        for (const file of saved.files) {
          const current = await text(input.projectRoot, file.path);
          if ((current === undefined ? null : durableContentDigest(current)) !== file.digest) invalid("article-retirement-result-changed", "Retirement was applied but a resulting file has since changed; inspect the current workspace.", { path: file.path });
        }
        const rebuild = `.tmp/context-runtime/retirements/${input.plan_digest.slice(7)}/rebuild.json`;
        // Receipts from earlier installations may predate the prepared rebuild input.
        if (await text(input.projectRoot, rebuild) === undefined) {
          await atomicWriteFile(await safeProjectTarget(input.projectRoot, rebuild), rebuildInput(input.plan_digest));
        }
        return { action: "already-applied" as const, revision: input.plan_digest, next_action: { command: rebuildCommand(input.plan_digest) } };
      }
    }
    if (await readApprovedRevision(input.projectRoot)) {
      const { joinableRevisionBatch } = await import("./revisionBatchJoin.js");
      const batch = await joinableRevisionBatch(input.projectRoot);
      if (batch.joinable) return scheduleBatchRetirement(input.projectRoot, value, batch.request, input);
    }
    const maintenance = await readMaintenance(input.projectRoot);
    if ((await readCandidateRecords(input.projectRoot)).length || await readApprovedRevision(input.projectRoot) ||
        await readKnowledgeUpdate(input.projectRoot) || await readTaskRollback(input.projectRoot) ||
        maintenance.active) {
      invalid("article-retirement-active-review", "Finish the active candidate/revision delivery before retiring approved pages.");
    }
    const selectedPaths = new Set(value.targets.map(target => target.path));
    if (selectedPaths.size !== value.targets.length) invalid("article-retirement-duplicate", "Select each approved article once.");
    if (maintenance.pending.some(request => request.targets.some(target => selectedPaths.has(target.path)))) {
      invalid("article-retirement-pending-maintenance", "Cancel or finish queued maintenance for the selected pages before retirement.");
    }
    const stage = await readProductionStage(input.projectRoot);
    if (stage?.tasks.some(task => selectedPaths.has(task.path) && !["accepted", "excluded", "replaced"].includes(task.status))) {
      invalid("article-retirement-pending-task", "A selected article still has unfinished production; finish or amend that task first.");
    }
    const read = (path: string) => text(input.projectRoot, path);
    const plan = await planArticleRetirement(input.projectRoot, value, read);
    const { targets, restore, blockers, revision, selected } = plan;
    // Same follow-up list as a batch retirement: link text, navigation labels
    // and orphaned translations still need the Agent's attention afterwards.
    const followUp = await retirementFollowUps(input.projectRoot, value, plan, read);
    const preview = { action: "preview" as const, revision, reason: value.reason, retired: value.targets,
      changed_files: targets.map(target => ({ path: target.path, operation: target.operation })), blockers, follow_up: followUp,
      next_action: { command: blockers.length ? next : `context task retire --input <same-file> --apply --plan-digest '${revision}' --format json` } };
    if (!input.apply) return preview;
    if (input.plan_digest !== revision) invalid("article-retirement-preview-stale", "Preview this retirement input again; the selected pages, links or navigation changed.");
    if (blockers.length) invalid("article-retirement-references-unresolved", "Resolve incoming fragment links before applying retirement.", { blockers });
    const change = (path: string, old: string | undefined, content: string) => {
      if (old !== content) targets.push({ path, operation: "write", base_digest: old === undefined ? null : durableContentDigest(old),
        target_digest: durableContentDigest(content), content });
    };
    const directory = `.tmp/context-runtime/retirements/${revision.slice(7)}`;
    const recovery = `${directory}/restore.json`;
    const receipt = `${directory}/receipt.json`;
    change(recovery, await text(input.projectRoot, recovery), JSON.stringify({ summary: `Restore retired articles: ${value.reason}`, discard_unfinished: true, files: [...restore] }));
    const rebuild = `${directory}/rebuild.json`;
    change(rebuild, await text(input.projectRoot, rebuild), rebuildInput(revision));
    change(receipt, await text(input.projectRoot, receipt), JSON.stringify({ request: indexerProtocolDigest(value),
      files: targets.map(target => ({ path: target.path, digest: target.target_digest })) }));
    await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "retire-articles", proposal_digest: revision,
      targets: targets.sort((a, b) => a.path.localeCompare(b.path)),
      ...(input.inject_failure ? { inject_failure: input.inject_failure } : {}) });
    return { action: "applied" as const, revision, retired: [...selected], recovery, follow_up: followUp,
      next_action: { command: rebuildCommand(revision), message: "Retired pages and references were updated together. Register the prepared approved-output rebuild, then follow its Route. This preserves unfinished production and refreshes Close and package outputs. The restore input is temporary; retain it or a Git baseline if later restoration is needed." } };
  });
}

type RetirementInput = z.infer<typeof articleRetirementSchema>;
/** Compute every file change of a retirement from the files as given by read.
 * Standalone retirement reads the workspace; a batch reads the final drafts of
 * its pages so the report, scheduling and delivery use one calculation. */
export async function planArticleRetirement(root: string, value: RetirementInput, read: (path: string) => Promise<string | undefined>,
  options: { drafts?: ReadonlySet<string> } = {}) {
  const before = await read("knowledge/structure.yaml");
  const structure = before === undefined ? {} : YAML.parse(before) as Record<string, unknown>;
  const articles = validateArticleStructureEntries(structure.articles ?? []);
  const byPath = new Map(articles.map(article => [article.path, article]));
  const selected = new Set(value.targets.map(target => target.path));
  if (selected.size !== value.targets.length) invalid("article-retirement-duplicate", "Select each approved article once.");
  const replacements = new Map<string, string | undefined>();
  for (const target of value.targets) {
    if (!byPath.has(target.path)) invalid("article-retirement-target-missing", "Select an exact approved article path from knowledge/structure.yaml.", { path: target.path });
    if (target.replacement !== undefined && (!byPath.has(target.replacement) || selected.has(target.replacement))) {
      invalid("article-retirement-replacement-invalid", "Replacement must be an already-approved article outside the retirement set.", { path: target.path, replacement: target.replacement });
    }
    replacements.set(target.path, target.replacement);
  }
  const targets: IndexerProjectFileTarget[] = [];
  const restore: { path: string; base_digest: string | null; content: string | null }[] = [];
  function change(path: string, old: string | undefined, content?: string) {
    if (old === content) return;
    targets.push(content === undefined
      ? { path, operation: "delete", base_digest: durableContentDigest(old!), target_digest: null }
      : { path, operation: "write", base_digest: old === undefined ? null : durableContentDigest(old), target_digest: durableContentDigest(content), content });
    restore.push({ path, base_digest: content === undefined ? null : durableContentDigest(content), content: old ?? null });
  }
  const blockers: { path: string; target: string; reason: string }[] = [];
  const readDigests: { path: string; digest: string }[] = [];
  for (const article of articles) {
    const path = `knowledge/${article.path}`;
    const bytes = await read(path);
    if (bytes === undefined) invalid("article-retirement-article-missing", "Approved article bytes are missing; recover the workspace before retirement.", { path });
    readDigests.push({ path, digest: durableContentDigest(bytes) });
    if (selected.has(article.path)) { change(path, bytes); continue; }
    const draft = options.drafts?.has(article.path) === true;
    const content = replaceMarkdownInlineLinkTargets(bytes, link => {
      if (link.target.startsWith("#") || link.target.startsWith("//")) return undefined;
      const knowledge = link.target.startsWith("knowledge:");
      if (!knowledge && /^[a-z][a-z0-9+.-]*:/iu.test(link.target)) return undefined;
      const match = /^([^#?]*)(.*)$/u.exec(knowledge ? link.target.slice(10) : link.target)!;
      let target: string;
      try { target = decodeURI(match[1]!); } catch { return undefined; }
      const rooted = /^\/?knowledge\//u.test(target);
      if (target.startsWith("/") && !rooted) return undefined;
      let resolved = knowledge ? target : rooted ? target.replace(/^\/?knowledge\//u, "") : posix.normalize(posix.join(posix.dirname(article.path), target));
      if (knowledge && !resolved.endsWith(".md")) resolved += ".md";
      if (!selected.has(resolved)) return undefined;
      const replacement = replacements.get(resolved);
      // A former fragment may have moved elsewhere during a split. Do not
      // guess fragment correspondence or silently drop a meaningful anchor.
      // A draft in this batch is the Agent's text: it updates its own links.
      if (draft) {
        blockers.push({ path, target: link.target, reason: "This draft in the current batch still links to a retired page; update the link and its text in the draft." });
        return undefined;
      }
      if (!replacement || match[2]!.includes("#")) {
        blockers.push({ path, target: link.target, reason: replacement ? "Repair fragment links explicitly before retirement." : "Repair this incoming link or supply an approved replacement." });
        return undefined;
      }
      return knowledge ? `knowledge:${target.endsWith(".md") ? replacement : replacement.replace(/\.md$/u, "")}${match[2]}`
        : `${encodeURI(rooted ? `${target.startsWith("/") ? "/" : ""}knowledge/${replacement}` : posix.relative(posix.dirname(article.path), replacement))}${match[2]}`;
    });
    change(path, bytes, content);
  }
  // Custom template links can use channel-specific paths. Report recognizable
  // retired targets instead of inventing a replacement export URL.
  async function inspectTemplates(directory: string): Promise<void> {
    const absolute = await safeProjectTarget(root, directory);
    const entries = await readdir(absolute, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []; throw error;
    });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { await inspectTemplates(path); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const bytes = (await read(path))!;
      readDigests.push({ path, digest: durableContentDigest(bytes) });
      replaceMarkdownInlineLinkTargets(bytes, link => {
        if (/^(?!knowledge:)[a-z][a-z0-9+.-]*:/iu.test(link.target)) return undefined;
        let destination: string;
        try { destination = decodeURI(link.target.split(/[?#]/u)[0]!); } catch { return undefined; }
        if (destination.startsWith("knowledge:") && !destination.endsWith(".md")) destination += ".md";
        if ([...selected].some(old => destination === old || destination.endsWith(`/${old}`) || destination === `knowledge:${old}`)) {
          blockers.push({ path, target: link.target, reason: "Update this custom package-template link before retirement." });
        }
        return undefined;
      });
    }
  }
  await inspectTemplates("src/package-templates");
  const mapText = await read(KNOWLEDGE_MAP_PATH);
  const map = mapText === undefined ? undefined : validateKnowledgeMap(YAML.parse(mapText));
  if (map) {
    const retiredIds = new Map(value.targets.map(target => [byPath.get(target.path)!.article_id, target]));
    const upsert = map.entries.flatMap(entry => {
      const target = entry.target && retiredIds.get(entry.target.artifact_ref);
      if (!target) return [];
      if (target.replacement && entry.target?.section_key) {
        blockers.push({ path: KNOWLEDGE_MAP_PATH, target: entry.key, reason: "Rebind this fragment navigation entry explicitly before retirement." });
        return [];
      }
      const { target: _old, ...group } = entry; void _old;
      return [target.replacement ? { ...group, target: { artifact_ref: byPath.get(target.replacement)!.article_id } } : group];
    });
    // Preserve children and grouping; empty groups are already omitted by the
    // existing navigation projector. No dangling article identity remains.
    const updated = updateKnowledgeMap(map, { expected_revision: map.revision, upsert, remove: [] });
    change(KNOWLEDGE_MAP_PATH, mapText, YAML.stringify(updated));
  }
  change("knowledge/structure.yaml", before, YAML.stringify({ ...structure, articles: articles.filter(article => !selected.has(article.path)) }));
  targets.sort((a, b) => a.path.localeCompare(b.path));
  const revision = indexerProtocolDigest({ value, readDigests, targets });
  return { targets, restore, blockers, revision, selected };
}

/** Files as this batch's final drafts would make them; others as on disk. */
export async function batchDraftReader(root: string, request: ApprovedRevision, exclude: ReadonlySet<string> = new Set()) {
  const drafts = [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])]
    .filter(candidate => !exclude.has(candidate.path));
  const bodies = new Map(drafts.map(candidate => [`knowledge/${candidate.path}`, candidate.body]));
  const moved = new Set(drafts.flatMap(candidate => candidate.approved_revision?.previous_path ? [`knowledge/${candidate.approved_revision.previous_path}`] : []));
  const structureText = await text(root, "knowledge/structure.yaml");
  const structure = (structureText === undefined ? {} : YAML.parse(structureText)) as Record<string, unknown>;
  const articles = [...validateArticleStructureEntries(structure.articles ?? []).filter(article =>
    !drafts.some(candidate => candidate.article_id === article.article_id)),
  ...drafts.map(candidate => ({ article_id: candidate.article_id, path: candidate.path, collection: candidate.collection,
    visibility: candidate.visibility, sections: candidate.indexer_candidate.sections.map(section => ({ id: section.section_key, references: section.references })) }))];
  const planned = YAML.stringify({ ...structure, articles });
  return { drafts: new Set(drafts.map(candidate => candidate.path)),
    read: async (path: string) => path === "knowledge/structure.yaml" ? planned : moved.has(path) && !bodies.has(path) ? undefined : bodies.get(path) ?? await text(root, path) };
}

/** What a scheduled retirement asks of the batch, grouped by the existing
 * entry that handles it: pages are revised, navigation is adjusted, orphaned
 * translations are removed by the translation step. Nothing is rewritten here. */
async function retirementFollowUps(root: string, value: RetirementInput, plan: Awaited<ReturnType<typeof planArticleRetirement>>,
  read: (path: string) => Promise<string | undefined>) {
  const pages = [...new Set([...plan.targets.filter(target => target.path.startsWith("knowledge/") && target.path.endsWith(".md") && target.operation === "write"),
    ...plan.blockers.filter(blocker => blocker.path.startsWith("knowledge/") && blocker.path.endsWith(".md"))]
    .map(item => item.path.slice("knowledge/".length)))].filter(path => !plan.selected.has(path)).sort();
  const structureText = await read("knowledge/structure.yaml");
  const articles = validateArticleStructureEntries((structureText === undefined ? {} : YAML.parse(structureText) as Record<string, unknown>).articles ?? []);
  const idOf = (path: string | undefined) => articles.find(article => article.path === path)?.article_id;
  const mapText = await read(KNOWLEDGE_MAP_PATH);
  const map = mapText === undefined ? undefined : validateKnowledgeMap(YAML.parse(mapText));
  const navigation = value.targets.flatMap(target => (map?.entries ?? []).filter(entry => entry.target?.artifact_ref === idOf(target.path)).map(entry => {
    const replacementId = idOf(target.replacement);
    const duplicate = replacementId !== undefined && (map?.entries ?? []).some(other => other.key !== entry.key && other.target?.artifact_ref === replacementId);
    return { key: entry.key, title: entry.title, retired: target.path,
      result: target.replacement ? `points to ${target.replacement} and keeps this label` : "removed",
      ...(duplicate ? { duplicate_of_replacement_entry: true } : {}) };
  }));
  const translations: string[] = [];
  for (const locale of await readdir(await safeProjectTarget(root, "translations")).catch(() => [] as string[])) {
    for (const target of value.targets) {
      const path = `translations/${locale}/${target.path}`;
      if (await text(root, path) !== undefined) translations.push(path);
    }
  }
  return { pages, navigation, translations };
}

async function scheduleBatchRetirement(root: string, value: RetirementInput, request: ApprovedRevision,
  input: { apply?: boolean; plan_digest?: string }) {
  const approved = validateArticleStructureEntries((YAML.parse(await text(root, "knowledge/structure.yaml") ?? "{}") as Record<string, unknown>)?.articles ?? []);
  for (const target of value.targets) {
    if (!approved.some(article => article.path === target.path)) invalid("article-retirement-target-missing", "Select an exact approved article path from knowledge/structure.yaml.", { path: target.path });
    if (request.retirements?.some(scheduled => scheduled.targets.some(item => item.path === target.path))) {
      invalid("article-retirement-duplicate", "This page is already scheduled for retirement in the current batch.", { path: target.path });
    }
  }
  const retired = new Set(value.targets.map(target => target.path));
  const reader = await batchDraftReader(root, request, retired);
  const plan = await planArticleRetirement(root, value, reader.read, { drafts: reader.drafts });
  const follow = await retirementFollowUps(root, value, plan, reader.read);
  const summary = { retired: value.targets, follow_up: follow,
    delivery: "Takes effect with this batch's delivery, computed on its final drafts. Pages listed in follow_up.pages join the batch to update their links and link text; adjust follow_up.navigation through context task adjust when its label should change; the translation step removes follow_up.translations." };
  if (!input.apply) return { action: "batch-preview" as const, revision: plan.revision, ...summary,
    next_action: { command: `context task retire --input <same-file> --apply --plan-digest '${plan.revision}' --format json` } };
  if (input.plan_digest !== plan.revision) invalid("article-retirement-preview-stale", "Preview this retirement input again; the selected pages, links or navigation changed.");
  const { joinRevisionBatch } = await import("./revisionBatchJoin.js");
  const note = (path: string) => { const target = value.targets.find(item => item.path === path)!;
    return `${path} is retired in this batch${target.replacement ? ` and replaced by ${target.replacement}` : ""}`; };
  const result = await joinRevisionBatch(root, request, follow.pages.map(path => ({ path,
    instruction: `${value.targets.map(target => note(target.path)).join("; ")}. Update links to it and their link text in this page.` })), { retire: value });
  return { action: "scheduled" as const, revision: result.revision, ...summary, joined: result.joined,
    next_action: { command: next, message: "Continue the current batch. Its Review report shows the planned retirement." } };
}

/** Apply this batch's scheduled retirements together with its final Review
 * apply: one final content per file, computed on the files that apply writes.
 * Any blocker stops the apply before content is written. */
export async function mergeBatchRetirements(root: string, retirements: readonly RetirementInput[], targets: IndexerProjectFileTarget[],
  approvedPages: ReadonlySet<string>): Promise<IndexerProjectFileTarget[]> {
  const final = new Map(targets.map(target => [target.path, target]));
  const read = async (path: string) => {
    const target = final.get(path);
    return target === undefined ? await text(root, path) : target.operation === "delete" ? undefined : target.content;
  };
  for (const value of retirements) {
    const plan = await planArticleRetirement(root, value, read, { drafts: approvedPages });
    if (plan.blockers.length) invalid("article-retirement-references-unresolved",
      "A page in this batch still links to a page retired with it. Update that draft before approving; nothing was applied.", { blockers: plan.blockers });
    for (const change of plan.targets) {
      const existing = final.get(change.path);
      final.set(change.path, existing === undefined ? change : change.operation === "delete"
        ? { path: change.path, operation: "delete", base_digest: existing.base_digest, target_digest: null }
        : { path: change.path, operation: "write", base_digest: existing.base_digest, target_digest: change.target_digest, content: change.content! });
    }
  }
  return [...final.values()].filter(target => target.operation === "write" || target.base_digest !== null)
    .sort((left, right) => left.path.localeCompare(right.path));
}

/** Planned effect of this batch's retirements on its current drafts, for the
 * Review report. Same planner as delivery; nothing is written. */
export async function plannedBatchRetirement(root: string, request: ApprovedRevision) {
  if (!request.retirements?.length) return undefined;
  const reader = await batchDraftReader(root, request);
  const changed = new Map<string, string | undefined>();
  const read = async (path: string) => changed.has(path) ? changed.get(path) : reader.read(path);
  const blockers: Array<{ path: string; target: string; reason: string }> = [];
  for (const value of request.retirements) {
    const plan = await planArticleRetirement(root, value, read, { drafts: reader.drafts });
    blockers.push(...plan.blockers);
    for (const target of plan.targets) changed.set(target.path, target.operation === "delete" ? undefined : target.content);
  }
  const mapText = changed.has(KNOWLEDGE_MAP_PATH) ? changed.get(KNOWLEDGE_MAP_PATH) : undefined;
  return { retired: request.retirements.flatMap(value => value.targets), blockers,
    knowledge_map: mapText === undefined ? undefined : validateKnowledgeMap(YAML.parse(mapText)) };
}
