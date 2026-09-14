import { readFile, readdir } from "node:fs/promises";
import { posix } from "node:path";
import { z } from "zod";
import YAML from "yaml";
import { indexerProtocolDigest, validateArticleStructureEntries, updateKnowledgeMap,
  type IndexerProjectFileTarget } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { readTaskRollback } from "./taskRollback.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { readProductionStage } from "./productionStageStore.js";
import { readKnowledgeMap, KNOWLEDGE_MAP_PATH } from "./knowledgeMap.js";
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
        return { action: "already-applied" as const, revision: input.plan_digest, next_action: { command: next } };
      }
    }
    const maintenance = await readMaintenance(input.projectRoot);
    if ((await readCandidateRecords(input.projectRoot)).length || await readApprovedRevision(input.projectRoot) ||
        await readKnowledgeUpdate(input.projectRoot) || await readTaskRollback(input.projectRoot) ||
        maintenance.active) {
      invalid("article-retirement-active-review", "Finish the active candidate/revision delivery before retiring approved pages.");
    }
    const before = await text(input.projectRoot, "knowledge/structure.yaml");
    const structure = before === undefined ? {} : YAML.parse(before) as Record<string, unknown>;
    const articles = validateArticleStructureEntries(structure.articles ?? []);
    const byPath = new Map(articles.map(article => [article.path, article]));
    const selected = new Set(value.targets.map(target => target.path));
    if (selected.size !== value.targets.length) invalid("article-retirement-duplicate", "Select each approved article once.");
    if (maintenance.pending.some(request => request.targets.some(target => selected.has(target.path)))) {
      invalid("article-retirement-pending-maintenance", "Cancel or finish queued maintenance for the selected pages before retirement.");
    }
    const stage = await readProductionStage(input.projectRoot);
    if (stage?.tasks.some(task => selected.has(task.path) && !["accepted", "excluded", "replaced"].includes(task.status))) {
      invalid("article-retirement-pending-task", "A selected article still has unfinished production; finish or amend that task first.");
    }
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
      const bytes = await text(input.projectRoot, path);
      if (bytes === undefined) invalid("article-retirement-article-missing", "Approved article bytes are missing; recover the workspace before retirement.", { path });
      readDigests.push({ path, digest: durableContentDigest(bytes) });
      if (selected.has(article.path)) { change(path, bytes); continue; }
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
      const absolute = await safeProjectTarget(input.projectRoot, directory);
      const entries = await readdir(absolute, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return []; throw error;
      });
      for (const entry of entries) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) { await inspectTemplates(path); continue; }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const bytes = (await text(input.projectRoot, path))!;
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
    const map = await readKnowledgeMap(input.projectRoot);
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
      change(KNOWLEDGE_MAP_PATH, await text(input.projectRoot, KNOWLEDGE_MAP_PATH), YAML.stringify(updated));
    }
    change("knowledge/structure.yaml", before, YAML.stringify({ ...structure, articles: articles.filter(article => !selected.has(article.path)) }));
    targets.sort((a, b) => a.path.localeCompare(b.path));
    const revision = indexerProtocolDigest({ value, readDigests, targets });
    const preview = { action: "preview" as const, revision, reason: value.reason, retired: value.targets,
      changed_files: targets.map(target => ({ path: target.path, operation: target.operation })), blockers,
      next_action: { command: blockers.length ? next : `context task retire --input <same-file> --apply --plan-digest '${revision}' --format json` } };
    if (!input.apply) return preview;
    if (input.plan_digest !== revision) invalid("article-retirement-preview-stale", "Preview this retirement input again; the selected pages, links or navigation changed.");
    if (blockers.length) invalid("article-retirement-references-unresolved", "Resolve incoming fragment links before applying retirement.", { blockers });
    const directory = `.tmp/context-runtime/retirements/${revision.slice(7)}`;
    const recovery = `${directory}/restore.json`;
    const receipt = `${directory}/receipt.json`;
    change(recovery, await text(input.projectRoot, recovery), JSON.stringify({ summary: `Restore retired articles: ${value.reason}`, discard_unfinished: true, files: [...restore] }));
    change(receipt, await text(input.projectRoot, receipt), JSON.stringify({ request: indexerProtocolDigest(value),
      files: targets.map(target => ({ path: target.path, digest: target.target_digest })) }));
    await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "retire-articles", proposal_digest: revision,
      targets: targets.sort((a, b) => a.path.localeCompare(b.path)),
      ...(input.inject_failure ? { inject_failure: input.inject_failure } : {}) });
    return { action: "applied" as const, revision, retired: [...selected], recovery,
      next_action: { command: next, message: "Retired pages and references were updated together. Follow the current close/version/build Route before delivering outputs. The restore input is temporary; retain it or a Git baseline if later restoration is needed." } };
  });
}
