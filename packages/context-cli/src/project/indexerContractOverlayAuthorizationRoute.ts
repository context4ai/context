import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
} from "@c4a/agent-graph";
import { indexerProtocolDigest } from "@c4a/context";
import {
  validateIndexerContractOverlayAuthorizationInput,
  type IndexerContractOverlayAuthorizationInput,
} from "./indexerContractOverlayValidation.js";
import {
  loadContextWorkflowProvider,
  projectWorkflowResourceLocation,
  projectWorkflowRouteAction,
} from "./workflow/workflowProvider.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowAuthority,
  ContextWorkflowRouteActionSource,
} from "./workflow/workflowTypes.js";

const GRAPH_ID = "indexer";
const ENTRY = "contract-overlay-authorization";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function gateAction(input: {
  source: ContextWorkflowRouteActionSource | undefined;
  gateInput: IndexerContractOverlayAuthorizationInput;
  revision: string;
}): NonNullable<ContextResolvedWorkflowRoute["action"]> | undefined {
  if (input.source === undefined) return undefined;
  return projectWorkflowRouteAction({
    action: { ...input.source, input: input.gateInput as unknown as JsonValue },
    node: "authorize-indexer-contract-overlay",
    hasStructureBatch: false,
    revision: input.revision,
    authorities: [],
  });
}

export async function buildIndexerContractOverlayAuthorizationRoute(input: {
  projectRoot: string;
  authorization_input: unknown;
  authorizationInputRef: string;
  authorities?: readonly ContextWorkflowAuthority[];
}): Promise<{
  route: ContextResolvedWorkflowRoute;
  gate_input: IndexerContractOverlayAuthorizationInput;
}> {
  if (input.authorizationInputRef.length === 0 || input.authorizationInputRef.includes("\0")) {
    throw new TypeError("Indexer contract overlay authorization input reference is invalid");
  }
  const gateInput = validateIndexerContractOverlayAuthorizationInput(
    input.authorization_input,
  );
  const authorities = [...(input.authorities ?? [])];
  const facts = {
    indexer_contract_overlay: {
      trust_state: "authorization-required",
      conformance_report_digest: gateInput.expected_conformance_report_digest,
    },
  };
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, GRAPH_ID, ENTRY, { facts, authorities });
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    throw new TypeError("Context Indexer contract overlay authorization Gate is unavailable");
  }
  const resolved = await resolveRoute(
    provider,
    GRAPH_ID,
    ENTRY,
    primary.routeId,
    { workspace: input.projectRoot, facts, authorities },
    evaluated.evaluation.revision,
  );
  if (
    resolved.gate?.id !== "authorize-indexer-contract-overlay" ||
    resolved.gate.inspectionAction?.action.effect !== "read" ||
    resolved.gate.resolutionAction?.action.effect !== "external" ||
    resolved.gate.delegatable !== false
  ) {
    throw new TypeError("Context Indexer contract overlay authorization Gate is incomplete");
  }
  const graphDigest = provider.graphDigests.get(GRAPH_ID);
  if (graphDigest === undefined) throw new TypeError("Context Indexer graph digest is unavailable");
  const revision = indexerProtocolDigest({
    protocol: "context.indexer.contract-overlay-authorization-route-fingerprint/v1",
    graph_digest: graphDigest,
    gate_input_digest: gateInput.input_digest,
  });
  const inspection = gateAction({
    source: resolved.gate.inspectionAction?.action,
    gateInput,
    revision,
  });
  const resolution = gateAction({
    source: resolved.gate.resolutionAction?.action,
    gateInput,
    revision,
  });
  const required = resolved.resources.required.map((resource) =>
    projectWorkflowResourceLocation(resource, revision, authorities)
  );
  const recommended = resolved.resources.recommended.map((resource) =>
    projectWorkflowResourceLocation(resource, revision, authorities)
  );
  return {
    gate_input: gateInput,
    route: {
      protocol: "context.workflow.route.v1",
      id: resolved.routeId,
      revision,
      node: resolved.node,
      reason_code: resolved.reasonCode,
      availability: resolved.availability,
      commands: [{
        command: `context indexer authorize-indexer-contract-overlay --input ${shellQuote(input.authorizationInputRef)} --format json`,
        effect: "external",
        availability: "after-human-confirmation",
        managed_execution: "automatic",
      }],
      resources: { required, recommended },
      gate: {
        id: resolved.gate.id,
        ...(resolved.gate.authority === undefined ? {} : { authority: resolved.gate.authority }),
        delegatable: false,
        resolution: resolved.gate.resolution,
        ...(inspection === undefined ? {} : {
          inspection_action: inspection as NonNullable<
            NonNullable<ContextResolvedWorkflowRoute["gate"]>["inspection_action"]
          >,
        }),
        ...(resolution === undefined ? {} : {
          resolution_action: resolution as NonNullable<
            NonNullable<ContextResolvedWorkflowRoute["gate"]>["resolution_action"]
          >,
        }),
      },
      after_action: { evaluate: true },
    },
  };
}
