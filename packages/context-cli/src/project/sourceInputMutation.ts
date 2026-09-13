import { readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { readTaskRollback } from "./taskRollback.js";

/** Existing locks protect in-flight writes. Approved-page revision bindings
 * protect their captured inputs; production submissions validate current source
 * baselines directly. Retired Provider ledgers grant no mutation authority. */
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
}
