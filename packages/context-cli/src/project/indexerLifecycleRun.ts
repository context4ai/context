import { configureDeliveryCadence, readDeliveryCadence, deliveryWaveSize } from "./indexerDeliveryCadence.js";
import { indexerDeliveryGuidance } from "./indexerDeliveryGuidance.js";
import { requestIndexerEarlyDelivery } from "./indexerDelivery.js";
import { advanceCurrentIndexerLifecycle } from "./indexerCurrentLifecycle.js";
import { advanceCurrentIndexerProviderFinalizationIfReady } from
  "./indexerCurrentProviderContinuation.js";
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

/** Dispatch the current Graph-selected run action, never infer setup from absent runtime files. */
export async function runCurrentIndexerLifecycle(input: {
  projectRoot: string;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
  dryRun?: boolean;
  deliver?: boolean;
  deliverySize?: string;
}) {
  if (input.deliverySize !== undefined && input.dryRun !== true) await configureDeliveryCadence(input.projectRoot, input.deliverySize);
  if (input.deliver === true && input.dryRun !== true) await requestIndexerEarlyDelivery(input.projectRoot);
  let status = await collectProjectStatus(input.projectRoot, input);
  const route = status.workflow.current;
  let advanced = false;
  if (
    input.dryRun !== true && route !== undefined && route.configuration === undefined &&
    !status.workflow.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    // These are command implementations, not a second routing decision. All
    // other steps (including configuration, Agent input, and review) are only
    // observed. The recovery command is explicitly invoked after its Gate;
    // the managed loop remains responsible for not auto-executing that Gate.
    switch (route.node) {
      case "finalize-current-indexer-provider-selection":
        advanced = await advanceCurrentIndexerProviderFinalizationIfReady(input.projectRoot);
        status = await collectProjectStatus(input.projectRoot, input);
        break;
      case "advance-current-indexer-lifecycle":
      case "resolve-current-indexer-block":
        advanced = (await advanceCurrentIndexerLifecycle(input.projectRoot)).advanced;
        status = await collectProjectStatus(input.projectRoot, input);
        break;
    }
  }
  return {
    protocol: "context.indexer.lifecycle-advance/v1" as const,
    advanced,
    ...(input.deliverySize === undefined ? {} : { delivery_policy: { next_wave_target: deliveryWaveSize(await readDeliveryCadence(input.projectRoot)), applies_to: "next-planning-wave" } }),
    ...(input.deliver === true ? { delivery: await indexerDeliveryGuidance(input.projectRoot, input.authorities) } : {}),
    state: lifecycleState(status.workflow),
    workflow: status.workflow,
  };
}
