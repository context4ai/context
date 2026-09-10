import { currentLedger, currentSpec } from "./indexerMainRunStoreRecords.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { readTaskRollback } from "./taskRollback.js";

/** Existing locks protect an in-flight write; these bindings protect the input
 * between writes. Explicit task adjustment invalidates selected old worksets. */
export async function assertSourceInputMutable(projectRoot: string, sourceRef: string): Promise<void> {
  if (await readTaskRollback(projectRoot)) throw new TypeError("Finish the current rollback before replacing source material; follow context status.");
  const revision = await readApprovedRevision(projectRoot);
  const update = await readKnowledgeUpdate(projectRoot);
  if (revision?.refresh_sources?.includes(sourceRef) || update?.refresh_sources?.includes(sourceRef)) return;
  if (revision?.target.source_refs.some((ref) => ref === sourceRef || ref.startsWith(`${sourceRef}#`)) ||
      revision?.processed_scopes?.some((scope) => scope.source_ref === sourceRef) ||
      update?.scopes.some((scope) => scope.source_ref === sourceRef)) {
    throw new TypeError("This source is a fixed input of the current local revision. Finish that route before importing a different version.");
  }
  const ledger = await currentLedger(projectRoot);
  for (const entry of ledger?.entries ?? []) {
    if (entry.state === "stale") continue;
    const spec = await currentSpec({ projectRoot, request_digest: entry.execution_request_digest });
    const view = spec.validation.dependency_view as { positive_nodes?: Array<{ source_ref?: string }> } | undefined;
    if (spec.request.workset.source_ref === sourceRef || view?.positive_nodes?.some((node) => node.source_ref === sourceRef)) {
      throw new TypeError("This source is still an active Indexer input. For an explicit same-task adjustment, use context task adjust with its source/module scope before replacing material; otherwise finish the current route.");
    }
  }
}
