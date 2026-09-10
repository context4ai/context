import { approvedKnowledgeMapTargets, assertKnowledgeMapCoverage, type KnowledgeMapArticleTarget } from "./knowledgeMapCoverage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  canonicalIndexerJson, indexerProtocolDigest, updateKnowledgeMap, validateKnowledgeMap,
  type IndexerProjectFileTarget, type KnowledgeMap, type KnowledgeMapUpdate,
} from "@c4a/context";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { recoverDurableMultiFileTransactions, runDurableMultiFileTransaction, type DurableMultiFileFailureInjector } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

export const KNOWLEDGE_MAP_PATH = "src/knowledge-map.yaml";
async function optionalText(root: string, path: string): Promise<string | undefined> {
  try { return await readFile(join(root, path), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function readKnowledgeMap(root: string): Promise<KnowledgeMap | undefined> {
  const content = await optionalText(root, KNOWLEDGE_MAP_PATH);
  return content === undefined ? undefined : validateKnowledgeMap(parse(content));
}

/** Called by the existing structure acceptance, never by parsing a prose report.
 * The decision and organization recover together under the workspace write lock. */
export async function acceptStructureDecision(input: {
  projectRoot: string;
  decisionPath: string;
  revision: string;
  knowledge_map?: KnowledgeMapUpdate;
  article_targets?: KnowledgeMapArticleTarget[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, "accept-knowledge-map", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readKnowledgeMap(input.projectRoot);
    const next = input.knowledge_map === undefined ? current : updateKnowledgeMap(current, input.knowledge_map);
    if (input.article_targets !== undefined) {
      const known = [...await approvedKnowledgeMapTargets(input.projectRoot), ...input.article_targets];
      assertKnowledgeMapCoverage(next, known, { known, require_update: true, has_update: input.knowledge_map !== undefined, revision: input.revision, current_revision: current?.revision ?? null });
    }
    const writes = [{ path: input.decisionPath, content: canonicalIndexerJson({ revision: input.revision, decision: "approved" }) }];
    if (input.knowledge_map !== undefined) writes.push({ path: KNOWLEDGE_MAP_PATH, content: stringify(next) });
    const targets: IndexerProjectFileTarget[] = await Promise.all(writes.sort((a, b) => a.path < b.path ? -1 : 1).map(async write => {
      const previous = await optionalText(input.projectRoot, write.path);
      return { ...write, operation: "write" as const, base_digest: previous === undefined ? null : durableContentDigest(previous), target_digest: durableContentDigest(write.content) };
    }));
    return runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "accept-knowledge-map",
      proposal_digest: indexerProtocolDigest({ revision: input.revision, knowledge_map: next ?? null }), targets,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }) });
  });
}

/** A navigation-only adjustment changes no source, Author task or approved body. */
export async function applyKnowledgeMapUpdate(projectRoot: string, update: KnowledgeMapUpdate) {
  return withProjectWriteLock(projectRoot, "adjust-knowledge-map", async () => {
    await recoverDurableMultiFileTransactions(projectRoot);
    const current = await readKnowledgeMap(projectRoot);
    const next = updateKnowledgeMap(current, update);
    const approved = await approvedKnowledgeMapTargets(projectRoot);
    const previewText = await optionalText(projectRoot, ".tmp/context-runtime/indexer/structure-review/preview.json");
    const preview = previewText === undefined ? undefined : JSON.parse(previewText) as { topics?: { article_targets?: KnowledgeMapArticleTarget[] }[] };
    const planned = preview?.topics?.flatMap(topic => topic.article_targets ?? []) ?? [];
    assertKnowledgeMapCoverage(next, approved, { known: [...approved, ...planned], current_revision: current?.revision ?? null });
    const content = stringify(next);
    const previous = await optionalText(projectRoot, KNOWLEDGE_MAP_PATH);
    await runDurableMultiFileTransaction({ projectRoot, kind: "adjust-knowledge-map", proposal_digest: next.revision,
      targets: [{ path: KNOWLEDGE_MAP_PATH, operation: "write", content,
        base_digest: previous === undefined ? null : durableContentDigest(previous), target_digest: durableContentDigest(content) }] });
    return { outcome: "knowledge-map-updated" as const, revision: next.revision,
      next_action: { command: "context status --format json", message: "Reading organization changed; rebuild affected outputs through the current workflow. Source parsing and article writing are unchanged." } };
  });
}
