import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
} from "@c4a/agent-graph";
import { indexerProtocolDigest } from "@c4a/context";
import { authorizeProjectIndexerDependencies } from "./indexerDependencyAuthorization.js";
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
const ENTRY = "dependency-authorization";

export interface IndexerDependencyAuthorizationGateInput {
  protocol: "context.indexer.dependency-authorization-input/v1";
  proposal_digest: string;
  request_intent_set_digest: string;
  intents: Array<{
    package: string;
    version: string;
    kind: "runtime" | "development";
    importers: string[];
    install_scripts: false;
  }>;
  resolutions: Array<{
    package: string;
    version: string;
    lock_integrity: string;
    resolved_digest: string;
  }>;
  authority_ref: string;
  authority_scope_digest: string;
  install_scripts: false;
  input_digest: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function dependencyGateAction(input: {
  source: ContextWorkflowRouteActionSource | undefined;
  gateInput: IndexerDependencyAuthorizationGateInput;
  revision: string;
}): NonNullable<ContextResolvedWorkflowRoute["action"]> | undefined {
  if (input.source === undefined) return undefined;
  return projectWorkflowRouteAction({
    action: {
      ...input.source,
      input: input.gateInput as unknown as JsonValue,
    },
    revision: input.revision,
    authorities: [],
  });
}

export async function buildIndexerDependencyAuthorizationRoute(input: {
  projectRoot: string;
  proposal_digest: string;
  resolution: unknown;
  resolutionInputRef: string;
  authorities?: readonly ContextWorkflowAuthority[];
}): Promise<{
  route: ContextResolvedWorkflowRoute;
  gate_input: IndexerDependencyAuthorizationGateInput;
}> {
  if (input.resolutionInputRef.length === 0 || input.resolutionInputRef.includes("\0")) {
    throw new TypeError("Indexer dependency resolution input reference is invalid");
  }
  const preview = await authorizeProjectIndexerDependencies({
    projectRoot: input.projectRoot,
    proposal_digest: input.proposal_digest,
    resolution: input.resolution,
  });
  const gatePayload = {
    protocol: "context.indexer.dependency-authorization-input/v1" as const,
    proposal_digest: preview.proposal_digest,
    request_intent_set_digest: preview.request_intent_set_digest,
    intents: preview.dependencies.intents.map((intent) => ({
      package: intent.package,
      version: intent.version,
      kind: intent.kind,
      importers: intent.importers,
      install_scripts: false as const,
    })),
    resolutions: preview.receipt.resolutions,
    authority_ref: preview.receipt.authority_ref,
    authority_scope_digest: preview.receipt.authority_scope_digest,
    install_scripts: false as const,
  };
  const gateInput: IndexerDependencyAuthorizationGateInput = {
    ...gatePayload,
    input_digest: indexerProtocolDigest(gatePayload),
  };
  const authorities = [...(input.authorities ?? [])];
  const facts = { indexer_dependencies: { authorized: false } };
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, GRAPH_ID, ENTRY, { facts, authorities });
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    throw new TypeError("Context Indexer dependency authorization Gate is unavailable");
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
    resolved.gate?.id !== "authorize-indexer-dependencies" ||
    resolved.gate.inspectionAction?.action.effect !== "read" ||
    resolved.gate.resolutionAction?.action.effect !== "external"
  ) {
    throw new TypeError("Context Indexer dependency authorization Gate contract is incomplete");
  }
  const graphDigest = provider.graphDigests.get(GRAPH_ID);
  if (graphDigest === undefined) throw new TypeError("Context Indexer graph digest is unavailable");
  const revision = indexerProtocolDigest({
    protocol: "context.indexer.dependency-authorization-route-fingerprint/v1",
    graph_digest: graphDigest,
    gate_input_digest: gateInput.input_digest,
  });
  const inspection = dependencyGateAction({
    source: resolved.gate.inspectionAction?.action,
    gateInput,
    revision,
  });
  const resolution = dependencyGateAction({
    source: resolved.gate.resolutionAction?.action,
    gateInput,
    revision,
  });
  const managed = resolved.gate.resolution === "session-authority";
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
        command: `context indexer authorize-indexer-dependencies --proposal ${shellQuote(preview.proposal_digest)} --input ${shellQuote(input.resolutionInputRef)} --format json`,
        effect: "external",
        availability: managed ? "immediate" : "after-human-confirmation",
        managed_execution: "automatic",
      }],
      resources: { required, recommended },
      gate: {
        id: resolved.gate.id,
        ...(resolved.gate.authority === undefined ? {} : { authority: resolved.gate.authority }),
        delegatable: resolved.gate.delegatable ?? false,
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
