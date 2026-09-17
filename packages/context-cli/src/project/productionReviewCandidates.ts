import { indexerProtocolDigest } from "@c4a/context";
import { readProductionStage } from "./productionStageStore.js";
import { dispatchProductionStage, productionCapabilitiesSchema } from "./productionStage.js";
import { readCandidateRecords, indexerCandidateId } from "./candidateLedger.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { withProductionFeedback } from "./productionFeedback.js";

/** Review the accepted candidate content, not retired Provider compile state.
 * Both the stage and candidates are temporary and must belong to this run. */
export async function readProductionReviewCandidates(projectRoot: string) {
  return withProductionFeedback({ operation: "review" }, async () => {
  if ((await readMaintenance(projectRoot)).active) return undefined;
  const stage = await readProductionStage(projectRoot);
  if (!stage) return undefined;
  await assertProductionPlanRequirementsCurrent(projectRoot, stage);
  if (!stage.delivery && dispatchProductionStage(stage, productionCapabilitiesSchema.parse({})).state !== "ended") {
    throw new TypeError("Complete the current production stage before reviewing its candidates");
  }
  const result = await readAcceptedProductionCandidates(projectRoot);
  return result && { ...result, candidates: result.candidates.map(candidate => ({ ...candidate, status: "draft" as const })) };
  });
}

/** Validate current production receipts without requiring writing to finish.
 * Navigation may bind accepted drafts before content Review. */
export async function readAcceptedProductionCandidates(projectRoot: string) {
  const stage = await readProductionStage(projectRoot);
  if (!stage) return undefined;
  await assertProductionPlanRequirementsCurrent(projectRoot, stage);
  const candidates = await readCandidateRecords(projectRoot);
  for (const candidate of candidates) {
    const task = stage.tasks.find(task => task.status === "accepted" && task.accepted?.receipt === candidate.candidate_id);
    if (!task || task.article_id !== candidate.article_id || task.path !== candidate.path ||
        candidate.approved_revision?.request_digest !== task.input) {
      throw new TypeError(`Candidate does not belong to an accepted current production task: ${candidate.candidate_id}`);
    }
    const fingerprint = indexerProtocolDigest({ input: task.input, markdown: candidate.body, sections: candidate.indexer_candidate.sections });
    if (candidate.fingerprint !== fingerprint || candidate.candidate_id !== indexerCandidateId(fingerprint) ||
        candidate.indexer_candidate.file_digest !== fingerprint || candidate.indexer_candidate.compile_digest !== task.input) {
      throw new TypeError(`Accepted candidate content changed before Review: ${candidate.candidate_id}`);
    }
  }
  return { revision: stage.id, candidates };
}
