import { contextWorkflowAuthorities } from "./workflow/workflowFacts.js";
import type { JsonValue, Route } from "@c4a/agent-graph";
import { basename } from "node:path";
import { projectWorkflowRouteAction } from "./workflow/workflowProvider.js";
import type { ContextResolvedWorkflowRoute, ContextWorkflowAuthority } from "./workflow/workflowTypes.js";
import { productionWorkflowRoute } from "./productionWorkflowRoute.js";

const OUTER_INDEXER_NODE = "run-indexer-lifecycle";
const CURRENT_ACTION_OUTPUT_SCHEMA_FILE = "indexer-agent-step-result.schema.json";

export function projectCurrentIndexerGateResolution(input: {
  resolved: Route;
  revision: string;
  authorities: readonly ContextWorkflowAuthority[];
  value: JsonValue;
}): NonNullable<
  NonNullable<ContextResolvedWorkflowRoute["gate"]>["resolution_action"]
> {
  const source = input.resolved.gate?.resolutionAction?.action;
  if (source === undefined) {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} has no Graph-owned resolution Action`,
    );
  }
  if (source.runner !== "agent" || source.effect !== "write") {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} must resolve through an Agent write Action`,
    );
  }
  if (
    source.outputSchema === undefined ||
    !("filePath" in source.outputSchema) ||
    source.outputSchema.filePath === undefined ||
    basename(source.outputSchema.filePath) !== CURRENT_ACTION_OUTPUT_SCHEMA_FILE
  ) {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} must expose ${CURRENT_ACTION_OUTPUT_SCHEMA_FILE}`,
    );
  }
  const projected = projectWorkflowRouteAction({
    action: { ...source, input: input.value },
    revision: input.revision,
    authorities: input.authorities,
  });
  if (projected === undefined || projected.effect === "read") {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} resolution Action is unavailable`,
    );
  }
  return { ...projected, effect: source.effect };
}

export function projectCurrentIndexerGate(
  resolved: Route,
  resolutionAction: NonNullable<
    NonNullable<ContextResolvedWorkflowRoute["gate"]>["resolution_action"]
  >,
): NonNullable<ContextResolvedWorkflowRoute["gate"]> {
  if (resolved.gate === undefined) {
    throw new TypeError(`current Indexer node ${resolved.node} is not a Gate`);
  }
  return {
    id: resolved.gate.id,
    ...(resolved.gate.authority === undefined
      ? {}
      : { authority: resolved.gate.authority }),
    delegatable: resolved.gate.delegatable === true,
    resolution: resolved.gate.resolution,
    resolution_action: resolutionAction,
  };
}

/** Resolve current production without falling back to retired Provider state.
 * An ended stage returns control to the workspace's Review/close/build route. */
export async function projectCurrentIndexerWorkflowRoute(input: {
  projectRoot: string;
  route: ContextResolvedWorkflowRoute | undefined;
  authorities: readonly ContextWorkflowAuthority[];
  managed: boolean;
}): Promise<ContextResolvedWorkflowRoute | undefined> {
  input = { ...input, authorities: contextWorkflowAuthorities(input) };
  const { knowledgeMaintenanceRoute } = await import("./knowledgeMaintenanceRoute.js");
  const maintenance = await knowledgeMaintenanceRoute(input);
  if (maintenance) return maintenance;
  if (input.route?.node !== OUTER_INDEXER_NODE) return input.route;
  const { buildApprovedRevisionRoute } = await import("./approvedRevisionRoute.js");
  const revision = await buildApprovedRevisionRoute(input);
  if (revision) return revision;
  return productionWorkflowRoute(input);
}

/** A phase-local continuation does not reconstruct old registry/run state or
 * perform a full workspace scan. Undefined means the phase has ended. */
export async function resolveCurrentIndexerWorkflowRoute(input: {
  projectRoot: string;
  authorities: readonly ContextWorkflowAuthority[];
  managed: boolean;
}): Promise<ContextResolvedWorkflowRoute | undefined> {
  return productionWorkflowRoute({ ...input, authorities: contextWorkflowAuthorities(input) });
}
