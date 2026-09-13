import { relative, resolve } from "node:path";
import YAML from "yaml";
import { zodToJsonSchema } from "zod-to-json-schema";
import { productionPlanInputSchema, productionPlanningRequest, submitProductionPlan } from "./productionPlanning.js";
import { prepareCurrentProductionStage } from "./productionStagePreparation.js";
import { readProductionStage } from "./productionStageStore.js";
import { readProductionPlanningFile } from "./productionSubmissionFiles.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import { recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { withProductionFeedback } from "./productionFeedback.js";

export const productionKnownTasksSchema = productionPlanInputSchema.omit({ stage: true });

/** Agent-supplied article boundaries, not CLI-inferred topics. Combine the
 * existing preparation and task creation in one call, then stop at the same
 * human report Gate. The ordinary investigation path remains available. */
export async function prepareKnownProductionTasks(input: {
  projectRoot: string; cwd: string; revision: string; path: string;
}) {
  return withProductionFeedback({ operation: "known-tasks", file: input.path, schema: productionKnownTasksSchema },
    () => withProjectWriteLock(input.projectRoot, "production-known-tasks", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const path = relative(resolve(input.projectRoot, ".tmp/agent-work"), resolve(input.cwd, input.path));
    const fixed = await readProductionPlanningFile({ projectRoot: input.projectRoot, path });
    const invalid = (message: string) => new ContextError(ExitCode.UserError, message, {
      category: ErrorCategory.UserInputInvalid, reason_code: "invalid-known-production-tasks", file: input.path,
      input_schema: zodToJsonSchema(productionKnownTasksSchema, { $refStrategy: "none" }),
      next_action: { command: "context status --format json" },
    });
    const plan = productionKnownTasksSchema.parse(YAML.parse(fixed.text, { uniqueKeys: true }));
    const request = await productionPlanningRequest(input.projectRoot);
    let stage = await readProductionStage(input.projectRoot);
    if (!request || stage?.report_approved || (stage ? ![stage.id, request.revision].includes(input.revision) : request.revision !== input.revision)) {
      throw invalid("Use known tasks before report approval, with the current preparation revision. Approved stages use ordinary task amendments.");
    }
    if (!stage) {
      await prepareCurrentProductionStage({ projectRoot: input.projectRoot, revision: input.revision });
      stage = (await readProductionStage(input.projectRoot))!;
    }
    // Validate and accept exactly the fixed input already read. Neither this
    // step nor submission reopens the Agent file after preparation.
    const text = YAML.stringify({ ...plan, stage: stage.id });
    const result = await submitProductionPlan({ projectRoot: input.projectRoot, stage: stage.id, path: fixed.path,
      manifest: { path: fixed.path, text, bytes: Buffer.byteLength(text), digest: durableContentDigest(text) } });
    return { ...result, next_action: { command: "context status --format json" } };
  }));
}
