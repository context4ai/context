import { requestRevisionDelivery } from "./revisionDelivery.js";
import { requestProductionDelivery, resumeProductionWriting } from "./productionDelivery.js";
import { readProductionStage } from "./productionStageStore.js";
import { collectProjectStatus } from "./status.js";
import type { ContextWorkflowAuthority, ContextWorkflowStatus } from
  "./workflow/workflowTypes.js";

function lifecycleState(workflow: ContextWorkflowStatus) {
  if (workflow.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "failed" as const;
  }
  if (workflow.status === "complete") return "complete" as const;
  if (workflow.current?.gate !== undefined || workflow.current?.availability === "blocked") {
    return "gate-required" as const;
  }
  return "agent-required" as const;
}

/** Observe the current route; deterministic execution belongs to run --until. */
export async function runCurrentIndexerLifecycle(input: {
  projectRoot: string;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
  dryRun?: boolean;
  deliver?: boolean;
  resumeWriting?: boolean;
}) {
  if (input.resumeWriting && input.dryRun !== true) await resumeProductionWriting(input.projectRoot);
  const production = await readProductionStage(input.projectRoot);
  if (input.deliver === true && input.dryRun !== true) {
    if (production) await requestProductionDelivery(input.projectRoot);
    else await requestRevisionDelivery(input.projectRoot);
  }
  const status = await collectProjectStatus(input.projectRoot, input);
  return {
    state: lifecycleState(status.workflow),
    workflow: status.workflow,
  };
}
