import { withProjectWriteLock } from "./writeLock.js";
import { recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";
import { prepareNextProductionStage, readProductionStage } from "./productionStageStore.js";
import { dispatchProductionStage, productionCapabilitiesSchema } from "./productionStage.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { prepareInitialProductionPlanning, productionRequirementsAreCurrent } from "./productionPlanning.js";
import { refreshProductionStageSources } from "./productionStageRefresh.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { withProductionFeedback } from "./productionFeedback.js";

/** Retry directory preparation, never production acceptance. This consumes an
 * existing current plan; it does not infer sources or create a new workflow. */
export async function prepareCurrentProductionStage(input: {
  projectRoot: string; revision: string; multiAgent?: boolean; sources?: string[];
}) {
  return withProductionFeedback({ operation: "prepare" }, () => withProjectWriteLock(input.projectRoot, "production-prepare", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    if ((await readMaintenance(input.projectRoot)).active) throw new TypeError("Finish or cancel the active maintenance task before preparing production tasks.");
    let stage = await readProductionStage(input.projectRoot);
    if (stage?.delivery) throw new TypeError("Writing is paused for delivery. Finish Review and build, or run context run --resume-writing --format json before refreshing tasks.");
    if (!stage || (stage.id === input.revision && (!stage.report_approved || !await productionRequirementsAreCurrent(input.projectRoot, stage)))) return prepareInitialProductionPlanning(input);
    if (!stage || stage.id !== input.revision) throw new ContextError(ExitCode.UserError,
      "The production stage expired or changed; read the current workflow instead of restoring an old task from Git.", {
        category: ErrorCategory.UserInputInvalid, reason_code: "stale-production-stage",
        next_action: { command: "context status --format json" },
      });
    stage = await refreshProductionStageSources(input.projectRoot, stage);
    const capabilities = productionCapabilitiesSchema.parse({ multi_agent: input.multiAgent === true });
    const dispatch = dispatchProductionStage(stage, capabilities);
    const prepared = await prepareNextProductionStage({ projectRoot: input.projectRoot, stage, multiAgent: capabilities.multi_agent });
    return { stage_state: dispatch.state, mode: prepared?.mode ?? dispatch.mode,
      ...(prepared ? { next: { directory: prepared.directory, agent_directory: prepared.agent_directory, submission: prepared.submission, mode: prepared.mode } } : {}) };
  }));
}
