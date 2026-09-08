import { readMaintenance, type MaintenanceState } from "./maintenanceStorage.js";

/** Explain observed Graph state, without inferring conversational task completion. */
export async function actionWorkflowSummary(projectRoot: string, status: string) {
  const state = await readMaintenance(projectRoot);
  const describe = (request: NonNullable<MaintenanceState["active"]> | MaintenanceState["pending"][number]) => ({
    id: request.input.id, operation: request.input.operation,
    target_count: request.targets.length,
    targets: request.targets.slice(0, 5).map(target => target.path),
    targets_omitted: Math.max(0, request.targets.length - 5),
  });
  return {
    status,
    scope: "registered-workflow" as const,
    maintenance: {
      active: state.active ? describe(state.active) : null,
      pending_count: state.pending.length,
      pending: state.pending.slice(0, 5).map(describe),
      pending_omitted: Math.max(0, state.pending.length - 5),
    },
    guidance: status === "complete"
      ? "The registered workflow is complete. Compare delivered results with the user's remaining requests; register authorized outstanding revisions through the normal Context entry. An empty maintenance queue does not prove all conversational requests were registered."
      : "Follow the current Route. Composer tasks are not maintenance requests; use the registered maintenance targets to identify queued revisions.",
  };
}
