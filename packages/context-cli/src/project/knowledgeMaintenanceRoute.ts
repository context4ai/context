import { evaluateGraph, resolveRoute } from "@c4a/agent-graph";
import { maintenanceRevision } from "./knowledgeMaintenance.js";
import { authorityCommandOptions, loadContextWorkflowProvider, projectWorkflowResourceLocation } from "./workflow/workflowProvider.js";
import type { ContextResolvedWorkflowRoute, ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

export async function knowledgeMaintenanceRoute(input: { projectRoot: string; authorities: readonly ContextWorkflowAuthority[]; managed: boolean; route?: ContextResolvedWorkflowRoute | undefined }): Promise<ContextResolvedWorkflowRoute | undefined> {
  // Workspace validation and real human gates retain priority over maintenance.
  if (input.route && !["run-indexer-lifecycle", "build-next", "close-approved-knowledge", "current-scope-complete"].includes(input.route.node)) return undefined;
  const observed = await maintenanceRevision(input.projectRoot);
  if (!observed.action) return undefined;
  const provider = await loadContextWorkflowProvider();
  const context = { workspace: input.projectRoot, authorities: [...input.authorities] };
  const evaluated = evaluateGraph(provider, "indexer", "maintenance", context);
  const primary = evaluated.evaluation.primaryRoute;
  if (!primary) throw new TypeError("Maintenance Graph route is unavailable");
  const resolved = await resolveRoute(provider, "indexer", "maintenance", primary.routeId, context, evaluated.evaluation.revision);
  return { protocol: "context.workflow.route.v1", id: resolved.routeId, node: resolved.node,
    reason_code: resolved.reasonCode, revision: observed.revision, availability: resolved.availability,
    commands: [{ command: `context${authorityCommandOptions(input.authorities, "workflow")} task advance-maintenance --revision '${observed.revision}' --format json`,
      effect: "write", availability: "immediate", managed_execution: "automatic" }],
    resources: { required: resolved.resources.required.map(location => projectWorkflowResourceLocation(location, observed.revision, input.authorities)),
      recommended: resolved.resources.recommended.map(location => projectWorkflowResourceLocation(location, observed.revision, input.authorities)) }, after_action: { evaluate: true } };
}
