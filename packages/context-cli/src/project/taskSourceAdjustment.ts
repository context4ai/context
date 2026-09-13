import { knowledgeMapUpdateSchema } from "@c4a/context";
import { applyKnowledgeMapUpdate } from "./knowledgeMap.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { readTaskRollback } from "./taskRollback.js";
import { recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readProductionStage, saveProductionStage } from "./productionStageStore.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { withProductionFeedback } from "./productionFeedback.js";

const schema = z.object({ scopes: z.array(z.object({ source_ref: z.string().min(1), requirement_ref: z.string().min(1).optional(),
  module_refs: z.array(z.string().min(1)).optional() }).strict()).min(1),
  instruction: z.string().trim().min(1), refresh: z.boolean().optional(),
}).strict();

/** Adjust current source work without restoring retired Provider ledgers.
 * Accepted candidates and unrelated source tasks stay in the same temporary run. */
export async function adjustCurrentTaskSources(projectRoot: string, value: unknown) {
  const reading = z.object({ knowledge_map: knowledgeMapUpdateSchema }).strict().safeParse(value);
  if (reading.success) return applyKnowledgeMapUpdate(projectRoot, reading.data.knowledge_map);
  return withProductionFeedback({ operation: "source-adjustment", schema }, async () => {
    const input = schema.parse(value);
    return withProjectWriteLock(projectRoot, "adjust-current-task-sources", async () => {
    await recoverDurableMultiFileTransactions(projectRoot);
    if (await readTaskRollback(projectRoot)) throw new TypeError("Finish the current rollback before adjusting inputs.");
    if (await readApprovedRevision(projectRoot) || await readKnowledgeUpdate(projectRoot)) {
      const { adjustLocalRevisionSources } = await import("./taskLocalSourceAdjustment.js");
      return adjustLocalRevisionSources(projectRoot, input);
    }
    const stage = await readProductionStage(projectRoot);
    if (stage) {
      if (stage.delivery) throw new TypeError("Finish the requested delivery or resume writing before adjusting its source inputs.");
      await assertProductionPlanRequirementsCurrent(projectRoot, stage);
      const selected = new Set(input.scopes.map(scope => scope.source_ref));
      if ([...selected].some(source => !stage.scopes.some(scope => scope.scope === source))) {
        throw new TypeError("Source adjustment must stay within the current authorized sources; change the confirmed requirements to add a source.");
      }
      let affected = 0;
      const tasks = stage.tasks.map(task => {
        if (["accepted", "excluded", "replaced"].includes(task.status) || !task.sources.some(source => selected.has(source.scope))) return task;
        affected += 1;
        return { ...task, status: "blocked" as const, reason: input.instruction };
      });
      await saveProductionStage(projectRoot, { ...stage, tasks,
        pending_scopes: [...new Set([...stage.pending_scopes, ...selected])] });
      return { action: "adjusted" as const, affected_tasks: affected,
        retained_candidates: (await readCandidateRecords(projectRoot)).length,
        next: "Acquire the selected source version, then prepare the current stage. Accepted content is retained; re-read affected material and revise only the articles that need changes. Module labels are guidance, not an independent invalidation protocol.",
        next_action: { command: `context action prepare-current --revision ${stage.id} --format json` } };
    }
    throw new ContextError(ExitCode.WorkspaceStateError, "No current production or article revision exists to adjust. Start from the current workflow; retired Indexer ledgers do not restore a task.", {
      category: ErrorCategory.WorkspaceStateInvalid, reason_code: "no-current-source-adjustment",
      next_action: { command: "context status --format json" },
      input_schema: zodToJsonSchema(schema, { $refStrategy: "none" }),
    });
    });
  });
}
