import { readingStructureUpdateSchema } from "@c4a/context";
import { applyReadingStructureUpdate } from "./readingStructure.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { indexerProtocolDigest, invalidateIndexerMainRunWorksets, type IndexerProjectFileTarget } from "@c4a/context";
import { currentLedger, currentSpec, acceptedCachePath, INDEXER_MAIN_RUN_CURRENT_PATH } from "./indexerMainRunStoreRecords.js";
import { readCandidateRecords, candidateRecordsContent, CANDIDATE_LEDGER_FILE } from "./candidateLedger.js";
import { readApprovedRevision, APPROVED_REVISION_PATH } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { readTaskRollback } from "./taskRollback.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import { INDEXER_CURRENT_FINALIZATION_PATH } from "./indexerCurrentFinalization.js";
import { INDEXER_CURRENT_READINESS_PATH, readProjectIndexerCandidateCompileStatus } from "./indexerCandidateCompileActions.js";
import { resetIndexerDeliveryProjection } from "./indexerDelivery.js";
import { approvedKnowledgeRebindingSchema } from "./approvedKnowledgeRevisionInput.js";

const schema = z.object({ scopes: z.array(z.object({ source_ref: z.string().min(1), requirement_ref: z.string().min(1).optional(),
  module_refs: z.array(z.string().min(1)).optional() }).strict()).min(1),
  instruction: z.string().trim().min(1), refresh: z.boolean().optional(),
}).strict();
async function maybe(root: string, path: string) {
  try { return await readFile(join(root, path), "utf8"); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}

/** Adjust the current native source task. Invalidate selected input ownership,
 * never the workspace, and keep accepted peers in the existing temporary cache. */
export async function adjustCurrentTaskSources(projectRoot: string, value: unknown) {
  const reading = z.object({ reading_structure: readingStructureUpdateSchema }).strict().safeParse(value);
  if (reading.success) return applyReadingStructureUpdate(projectRoot, reading.data.reading_structure);
  if (value && typeof value === "object" && "knowledge_dependencies" in value) {
    const knowledge = z.object({ knowledge_dependencies: approvedKnowledgeRebindingSchema, instruction: z.string().trim().min(1) }).strict().parse(value);
    const { adjustCurrentTaskKnowledge } = await import("./taskKnowledgeAdjustment.js");
    return adjustCurrentTaskKnowledge(projectRoot, knowledge);
  }
  const input = schema.parse(value);
  return withProjectWriteLock(projectRoot, "adjust-current-task-sources", async () => {
    if (await readTaskRollback(projectRoot)) throw new TypeError("Finish the current rollback before adjusting inputs.");
    if (await readApprovedRevision(projectRoot) || await readKnowledgeUpdate(projectRoot)) {
      const { adjustLocalRevisionSources } = await import("./taskLocalSourceAdjustment.js");
      return adjustLocalRevisionSources(projectRoot, input);
    }
    const ledger = await currentLedger(projectRoot);
    if (!ledger) throw new TypeError("No current Indexer work exists to adjust. Register the acquired source version and use context update for approved knowledge.");
    const selected = new Set<string>();
    const sourceMatches = (ref: string, source: string) => ref === source || ref.startsWith(`${source}#`) || ref.startsWith(`${source}/`);
    for (const entry of ledger.entries) {
      const spec = await currentSpec({ projectRoot, request_digest: entry.execution_request_digest });
      const workset = spec.request.workset;
      const direct = input.scopes.some((scope) => (!scope.requirement_ref || scope.requirement_ref === workset.requirement_ref.replace(/^requirement:/u, "")) && scope.source_ref === workset.source_ref &&
        (!scope.module_refs?.length || (workset.module_ref !== null && scope.module_refs.includes(workset.module_ref))));
      const view = spec.validation.dependency_view as { positive_nodes?: Array<{ source_ref?: string; module_ref?: string }> } | undefined;
      // Own-source spans do not prove a dependency on another module or purpose.
      const supporting = view?.positive_nodes?.some((node) => node.source_ref &&
        !(sourceMatches(node.source_ref, workset.source_ref) && node.module_ref === workset.module_ref) &&
        input.scopes.some(scope => sourceMatches(node.source_ref!, scope.source_ref) &&
          (!scope.module_refs?.length || (node.module_ref != null && scope.module_refs.includes(node.module_ref))))) === true;
      if (direct || supporting) selected.add(entry.workset_digest);
    }
    if (!selected.size) throw new TypeError("The selected source/module scopes do not affect a current workset; keep current work and register the separate requested input explicitly.");
    const next = invalidateIndexerMainRunWorksets(ledger, selected);
    const targets: IndexerProjectFileTarget[] = [];
    const put = async (path: string, content: string | null) => {
      const before = await maybe(projectRoot, path);
      if (before === undefined && content === null) return;
      targets.push(content === null ? { path, operation: "delete", base_digest: durableContentDigest(before!), target_digest: null }
        : { path, operation: "write", base_digest: before === undefined ? null : durableContentDigest(before), content, target_digest: durableContentDigest(content) });
    };
    await put(INDEXER_MAIN_RUN_CURRENT_PATH, `${JSON.stringify(next)}\n`);
    for (const entry of ledger.entries) if (selected.has(entry.workset_digest)) await put(acceptedCachePath(entry.execution_request_digest), null);
    const candidates = await readCandidateRecords(projectRoot);
    const compiled = await readProjectIndexerCandidateCompileStatus(projectRoot);
    const retained = candidates.filter((candidate) => {
      const file = compiled.compile?.files.find(item => item.file_digest === candidate.indexer_candidate.file_digest);
      const binding = file && compiled.compile?.result_bindings.find(item => item.artifact_result_digest === file.artifact_result_digest);
      if (!binding) throw new TypeError("Cannot resolve Candidate ownership for scoped adjustment. Refresh the current compile before adjusting; no work was invalidated.");
      return !selected.has(binding.workset_digest);
    });
    if (retained.length !== candidates.length) await put(CANDIDATE_LEDGER_FILE, candidateRecordsContent(retained) ?? null);
    for (const path of [APPROVED_REVISION_PATH, INDEXER_CURRENT_FINALIZATION_PATH, INDEXER_CURRENT_READINESS_PATH]) await put(path, null);
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    await runDurableMultiFileTransaction({ projectRoot, kind: "adjust-current-task-sources", proposal_digest: indexerProtocolDigest({ input, targets }), targets });
    await resetIndexerDeliveryProjection(projectRoot);
    return { action: "adjusted", invalidated_worksets: selected.size,
      retained_worksets: ledger.entries.length - selected.size, retained_candidates: retained.length,
      next: "Acquire or import the selected fixed source inputs, then refresh context status --format json. Keep approved pages and follow the new Route; do not resubmit old workset results." };
  });
}
