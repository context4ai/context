import { join } from "node:path";
import { evaluateGraph, resolveRoute } from "@c4a/agent-graph";
import { productionPlanningRequest, productionPlanningIsPrepared } from "./productionPlanning.js";
import { productionStageDirectory } from "./productionStageStore.js";
import { productionAgentDirectory } from "./productionSubmissionFiles.js";
import type { ProductionStage } from "./productionStage.js";
import { loadContextWorkflowProvider, projectWorkflowResourceLocation } from "./workflow/workflowProvider.js";
import type { ContextResolvedWorkflowRoute, ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

export async function productionPlanningRoute(input: { projectRoot: string; authorities: readonly ContextWorkflowAuthority[] },
  stage?: ProductionStage): Promise<ContextResolvedWorkflowRoute | undefined> {
  const request = stage ? undefined : await productionPlanningRequest(input.projectRoot);
  const present = !!stage || !!request;
  const revision = stage?.id ?? request?.revision ?? "requirements-configuration";
  const prepared = !!stage && await productionPlanningIsPrepared(input.projectRoot, stage);
  const context = { workspace: input.projectRoot, authorities: [...input.authorities], facts: {
    production: { requirements_present: present, planning_prepared: prepared, planning_complete: prepared && (stage?.planning_complete ?? false) },
  } };
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, "indexer", "production-planning", context);
  const selected = evaluated.evaluation.primaryRoute;
  if (!selected) throw new TypeError("Production planning has no current graph route");
  const route = await resolveRoute(provider, "indexer", "production-planning", selected.routeId, context, evaluated.evaluation.revision);
  const prepare = route.node === "prepare-production-planning";
  const configure = route.node === "configure-production-requirements";
  const command = configure ? "context status --format json" : prepare ? `context action prepare-current --revision ${revision} --format json`
    : `context action complete-current --revision ${revision} --input ${productionAgentDirectory(stage!.id)}/submissions/plan.yaml --format json`;
  return { protocol: "context.workflow.route.v1", id: route.routeId, node: route.node, revision,
    reason_code: route.reasonCode, availability: route.availability,
    summary: configure ? "Record the user's reader purpose and authorized sources, not Provider configuration. Ask only for missing scope or purpose decisions."
      : prepare ? "Prepare lightweight navigation. If article targets are already decided, add --input with the known-task file under .tmp/agent-work to create those tasks in the same call; report approval still follows." : "Investigate the supplied skeletons and submit article goals, source grouping and writing batches; report approval follows.",
    commands: configure ? [] : [{ command, effect: "write", availability: "immediate", managed_execution: prepare ? "automatic" : "agent-required" }],
    ...(configure ? { configuration: { file: "src/indexers.yaml" as const,
      action: "Write the confirmed long-term requirements using the supplied contract, then run context status --format json. Do not invent new source authorization or add Provider/process configuration." } } : {}),
    resources: { required: [...route.resources.required.map(resource => projectWorkflowResourceLocation(resource, revision, input.authorities)),
      ...(stage && !prepare ? [{ id: `production/${stage.id}/planning`, kind: "context-view" as const, media_type: "text/markdown",
        path: join(input.projectRoot, productionStageDirectory(stage.id), "planning.md"), read_state: "read-required" as const }] : [])],
      recommended: route.resources.recommended.map(resource => projectWorkflowResourceLocation(resource, revision, input.authorities)) },
    after_action: { evaluate: true } };
}
