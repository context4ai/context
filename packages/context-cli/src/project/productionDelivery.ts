import { readProductionStage, saveProductionStage } from "./productionStageStore.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { productionDeliverableArticles } from "./productionDeliveryScope.js";
import { withProjectWriteLock } from "./writeLock.js";
import { dispatchProductionStage, productionCapabilitiesSchema } from "./productionStage.js";
import { withProductionFeedback } from "./productionFeedback.js";

/** An explicit user request pauses new writes, not their task/input identities.
 * The only added state is the selected task ids in the existing .tmp manifest. */
export async function requestProductionDelivery(root: string): Promise<boolean> {
  return withProductionFeedback({ operation: "delivery" }, () => withProjectWriteLock(root, "request-production-delivery", async () => {
    const stage = await readProductionStage(root);
    if (!stage) return false;
    await assertProductionPlanRequirementsCurrent(root, stage);
    if (!stage.report_approved) throw new TypeError("Approve the work-start report before requesting production delivery.");
    if (stage.delivery) return true;
    const candidates = await readCandidateRecords(root);
    const formal = await productionDeliverableArticles(root);
    const selected = stage.tasks.filter(task => task.status === "accepted" &&
      (candidates.some(candidate => candidate.candidate_id === task.accepted?.receipt) ||
       formal.some(article => article.article_id === task.article_id && article.path === task.path)));
    if (!selected.length) throw new TypeError("No completed articles are available. Continue the current writing task before requesting delivery.");
    await saveProductionStage(root, { ...stage, delivery: selected.map(task => task.id) });
    return true;
  }));
}

/** Also used by an explicit cancellation of the delivery pause. It never
 * reverses approvals, drops candidates or discards unfinished writing. */
export async function resumeProductionWriting(root: string): Promise<boolean> {
  return withProductionFeedback({ operation: "resume-writing" }, () => withProjectWriteLock(root, "resume-production-writing", async () => {
    const stage = await readProductionStage(root);
    if (!stage?.delivery) return false;
    const { delivery: _delivery, ...next } = stage;
    void _delivery;
    await saveProductionStage(root, next);
    return true;
  }));
}

export async function assertProductionDeliveryReady(root: string) {
  return withProductionFeedback({ operation: "delivery-readiness" }, async () => {
  const stage = await readProductionStage(root);
  if (!stage?.delivery) throw new TypeError("No production delivery was requested.");
  await assertProductionPlanRequirementsCurrent(root, stage);
  const candidates = await readCandidateRecords(root);
  if (candidates.some(candidate => candidate.status === "draft")) {
    throw new TypeError("Review the received articles before delivery. To continue writing instead, run context run --resume-writing --format json.");
  }
  const articles = await productionDeliverableArticles(root);
  if (!articles.length) throw new TypeError("No reviewed articles can be delivered. Run context run --resume-writing --format json and repair the rejected articles.");
  return articles;
  });
}

/** Called only after successful package output and version recording. */
export async function finishProductionDelivery(root: string): Promise<void> {
  await resumeProductionWriting(root);
  const stage = await readProductionStage(root);
  if (stage && dispatchProductionStage(stage, productionCapabilitiesSchema.parse({})).state === "ended" &&
      (await readCandidateRecords(root)).length === 0) {
    const { clearCompletedLifecycle } = await import("./lifecycleCleanup.js");
    await clearCompletedLifecycle(root);
  }
}
