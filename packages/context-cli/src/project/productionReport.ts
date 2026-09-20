import YAML from "yaml";
import { z } from "zod";
import { indexerProtocolDigest } from "@c4a/context";
import { readProductionFile, type FixedProductionFile } from "./productionSubmissionFiles.js";
import { readProductionStage, saveProductionStage } from "./productionStageStore.js";
import { withProjectWriteLock } from "./writeLock.js";
import { prepareCurrentProductionStage } from "./productionStagePreparation.js";
import type { ProductionStage } from "./productionStage.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { withProductionFeedback } from "./productionFeedback.js";

export const productionReportInputSchema = z.object({ stage: z.string().min(1), decision: z.literal("approved") }).strict();

export function productionReportRevision(stage: ProductionStage): string {
  return indexerProtocolDigest({ purpose: stage.purpose, scopes: stage.scopes,
    tasks: stage.tasks.map(task => ({ id: task.id, input: task.input, batch: task.batch, after: task.after })),
    pending_scopes: stage.pending_scopes, gaps: stage.gaps });
}

/** The decision follows the presented report and an applicable explicit user
 * scope choice. The revision binds it to the shown plan, not to a file hash. */
export async function approveProductionReport(input: {
  projectRoot: string; stage: string; revision: string; path: string; multiAgent?: boolean;
  manifest?: FixedProductionFile;
}) {
  return withProductionFeedback({ operation: "report", file: input.path, schema: productionReportInputSchema },
    () => withProjectWriteLock(input.projectRoot, "production-report", async () => {
    const stage = await readProductionStage(input.projectRoot);
    if (!stage || !stage.planning_complete || stage.id !== input.stage || productionReportRevision(stage) !== input.revision) {
      throw new TypeError("The report's plan changed. Read and present the current proposal before confirming it.");
    }
    const file = input.manifest ?? await readProductionFile(input);
    const decision = productionReportInputSchema.extend({ stage: z.literal(stage.id) }).parse(YAML.parse(file.text));
    if (!stage.report_approved) await assertProductionPlanRequirementsCurrent(input.projectRoot, stage);
    if (decision.decision === "approved") await saveProductionStage(input.projectRoot, { ...stage, report_approved: true });
    // A material error after confirmation does not undo user feedback. Retry
    // directory preparation independently instead of asking the same question.
    try { return await prepareCurrentProductionStage({ projectRoot: input.projectRoot, revision: stage.id, multiAgent: input.multiAgent === true }); }
    catch (error) {
      return { stage_state: "active" as const, next_preparation: { outcome: "failed" as const,
        message: `Report approval is saved. Directory preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        command: `context action prepare-current --revision ${stage.id}${input.multiAgent ? " --multi-agent" : ""} --format json` } };
    }
  }));
}
