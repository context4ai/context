import { relative, resolve } from "node:path";
import YAML from "yaml";
import { withProjectWriteLock } from "./writeLock.js";
import { recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";
import { readProductionStage } from "./productionStageStore.js";
import { productionAgentDirectory, readProductionFile } from "./productionSubmissionFiles.js";
import { approveProductionReport } from "./productionReport.js";
import { submitProductionPlan } from "./productionPlanning.js";
import { completeProductionSubmission } from "./productionSubmission.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { withProductionFeedback } from "./productionFeedback.js";

/** Select and accept from the same bounded, fixed manifest. The command must
 * not open an arbitrary --input path through the legacy stdin reader first. */
export async function completeCurrentProductionAction(input: {
  projectRoot: string; cwd: string; revision: string; submissionPath?: string; multiAgent?: boolean; preview?: boolean;
}) {
  return withProductionFeedback({ operation: "action", file: input.submissionPath },
    () => withProjectWriteLock(input.projectRoot, "production-action", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const stage = await readProductionStage(input.projectRoot);
    const invalid = (message: string) => new ContextError(ExitCode.UserError, message, {
      category: ErrorCategory.UserInputInvalid, reason_code: "invalid-production-submission",
      next_action: { command: "context status --format json" },
    });
    if (!stage) throw invalid("The production stage expired. Read the current route; do not restore a previous process.");
    if (input.preview) throw invalid("Stage files do not use the retired Author preview. Submit the current task files.");
    if (!input.submissionPath || input.submissionPath === "-") throw invalid("Production requires a stage-local manifest file, not stdin.");
    const path = relative(resolve(input.projectRoot, productionAgentDirectory(stage.id)), resolve(input.cwd, input.submissionPath));
    const manifest = await readProductionFile({ projectRoot: input.projectRoot, stage: stage.id, path });
    const value: unknown = YAML.parse(manifest.text, { uniqueKeys: true });
    if (!value || typeof value !== "object" || !("stage" in value) || value.stage !== stage.id) {
      throw invalid("The manifest must identify the current production stage. No tasks were saved.");
    }
    const submission = { projectRoot: input.projectRoot, stage: stage.id, path, manifest, multiAgent: input.multiAgent === true };
    if ("decision" in value) return approveProductionReport({ ...submission, revision: input.revision });
    if (input.revision !== stage.id) throw invalid("Use the current stage revision; task input handles protect independent submissions.");
    if (!stage.planning_complete || "articles" in value) return submitProductionPlan(submission);
    return completeProductionSubmission(submission);
  }));
}
