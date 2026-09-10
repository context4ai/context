import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest, type IndexerProjectFileTarget } from "@c4a/context";
import { readApprovedRevision, requestDigest, currentApprovedRevisionTarget } from "./approvedRevision.js";
import { prepareApprovedKnowledgeRevision } from "./approvedKnowledgeRevision.js";
import { rebindApprovedKnowledgeSupport, withApprovedKnowledgeSupportSources } from "./approvedKnowledgeRebinding.js";
import type { ApprovedKnowledgeRebinding } from "./approvedKnowledgeRevisionInput.js";
import { approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { loadCurrentIndexerRegistry } from "./currentIndexerRegistry.js";
import { revisionStoragePath } from "./maintenanceStorage.js";
import { readTaskRollback } from "./taskRollback.js";
import { CANDIDATE_LEDGER_FILE, candidateRecordsContent, readCandidateRecords } from "./candidateLedger.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

/** Reuse the current revision and its Review transaction. Selecting replacement
 * dependencies does not apply a page or create another production state. */
export async function adjustCurrentTaskKnowledge(root: string, input: {
  knowledge_dependencies: ApprovedKnowledgeRebinding; instruction: string;
}) {
  return withProjectWriteLock(root, "adjust-current-task-knowledge", async () => {
    if (await readTaskRollback(root)) throw new TypeError("Finish the current rollback before adjusting knowledge support.");
    const request = await readApprovedRevision(root);
    if (!request) throw new TypeError("Use context revise for the affected approved page first, then adjust its knowledge_dependencies.");
    if (request.refresh_sources) throw new TypeError("Finish the current source acquisition adjustment before selecting knowledge support.");
    const target = await currentApprovedRevisionTarget(root, request);
    const path = target.previous_path ?? target.path;
    const previous = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed).find(snapshot => snapshot.path === path);
    if (!previous) throw new TypeError("This page has no approved source-fact snapshot. Replan it through the existing source update workflow instead.");
    const knowledge = await prepareApprovedKnowledgeRevision(root, path, (await loadCurrentIndexerRegistry(root)).registry, input.knowledge_dependencies);
    if (!knowledge) throw new TypeError("The current primary Provider cannot authorize the replacement knowledge. Restore its explicit registry binding before retrying.");
    if (knowledge.status === "ready" && knowledge.rebinding?.sections) rebindApprovedKnowledgeSupport(previous, knowledge);
    const updatedTarget = withApprovedKnowledgeSupportSources({ ...target, markdown: request.candidate?.body ?? target.markdown }, knowledge);
    const { candidate: _candidate, review_ready: _ready, knowledge_input: _old, ...rest } = request;
    void _candidate; void _ready; void _old;
    const payload = { ...rest, target: updatedTarget,
      instruction: input.instruction, knowledge_input: knowledge };
    const storage = await revisionStoragePath(root);
    const before = await readFile(join(root, storage), "utf8");
    const content = `${JSON.stringify({ ...payload, revision: requestDigest(payload) })}\n`;
    const targets: IndexerProjectFileTarget[] = [{ path: storage, operation: "write", base_digest: durableContentDigest(before), target_digest: durableContentDigest(content), content }];
    if (request.candidate) {
      const records = await readCandidateRecords(root);
      if (records.some(record => record.candidate_id === request.candidate!.candidate_id)) {
        const raw = await readFile(join(root, CANDIDATE_LEDGER_FILE), "utf8");
        const kept = candidateRecordsContent(records.filter(record => record.candidate_id !== request.candidate!.candidate_id));
        targets.push(kept === undefined
          ? { path: CANDIDATE_LEDGER_FILE, operation: "delete", base_digest: durableContentDigest(raw), target_digest: null }
          : { path: CANDIDATE_LEDGER_FILE, operation: "write", base_digest: durableContentDigest(raw), target_digest: durableContentDigest(kept), content: kept });
      }
    }
    await runDurableMultiFileTransaction({ projectRoot: root, kind: "adjust-current-task-knowledge", proposal_digest: indexerProtocolDigest(payload), targets });
    return { action: "adjusted", status: knowledge.status, pending: knowledge.pending,
      next: "context status --format json", guidance: "Read the replacement knowledge_input. Select fact_refs and evidence_refs for each retained section through knowledge_dependencies.sections, revise the prose, then submit through the current Author and Review. Approved content remains unchanged." };
  });
}
