import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
  type HostActionResourceLocation,
} from "@c4a/agent-graph";
import {
  buildIndexerAgentStepInput,
  indexerProtocolDigest,
  validateIndexerPostAuthorFragmentRequest,
  validateIndexerProgramRunRequest,
  type IndexerAgentStepInput,
  type IndexerPostAuthorFragmentRequest,
} from "@c4a/context";
import {
  validateIndexerInstructionMaterializationRequest,
  type IndexerInstructionMaterializationRequest,
} from "./indexerInstructionMaterialization.js";
import { indexerInstructionHostLocation } from "./indexerInstructionHost.js";
import {
  indexerWorksetViewHostLocation,
  validateIndexerWorksetViewMaterializationRequest,
  type IndexerWorksetViewMaterializationRequest,
} from "./indexerWorksetViewMaterialization.js";
import {
  authorityCommandOptions,
  loadContextWorkflowProvider,
  projectWorkflowResourceLocation,
  projectWorkflowRouteAction,
} from "./workflow/workflowProvider.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowRouteActionSource,
} from "./workflow/workflowTypes.js";

const INDEXER_GRAPH_ID = "indexer";
const INDEXER_GRAPH_ENTRY = "agent-step";
const INDEXER_ACTION_ID = "run-indexer-agent-step";
const INDEXER_POST_AUTHOR_GRAPH_ENTRY = "post-author-composer-step";
const INDEXER_POST_AUTHOR_ACTION_ID = "run-indexer-post-author-composer";

function assertInstructionRunBinding(input: {
  request: IndexerInstructionMaterializationRequest;
  runRequest: ReturnType<typeof validateIndexerProgramRunRequest>;
}): void {
  const workset = input.runRequest.workset;
  if (
    workset.workset_digest !== input.request.workset_digest ||
    workset.requirement_set_digest !== input.request.requirement_set_digest ||
    input.runRequest.final_authority.integrity !== input.request.provider_integrity
  ) {
    throw new TypeError("Indexer Agent step request does not match its instructions/workset authority");
  }
  if (input.runRequest.workset.indexer_id !== input.request.indexer_id) {
    throw new TypeError("Indexer Agent step instructions belong to another main Indexer");
  }
}

function assertWorksetViewRunBinding(input: {
  request: IndexerWorksetViewMaterializationRequest;
  runRequest: ReturnType<typeof validateIndexerProgramRunRequest>;
}): void {
  if (
    input.request.workset_digest !== input.runRequest.workset.workset_digest ||
    input.request.execution_request_digest !== input.runRequest.execution_request_digest
  ) {
    throw new TypeError("Indexer Agent step request does not match its authorized workset View");
  }
}

export interface IndexerAgentStepRoute {
  route: ContextResolvedWorkflowRoute;
  step_input: IndexerAgentStepInput;
  instruction_location: HostActionResourceLocation;
  workset_view_location: HostActionResourceLocation;
  stable_fingerprint: string;
}

export interface IndexerPostAuthorAgentStepRoute {
  route: ContextResolvedWorkflowRoute;
  step_input: IndexerPostAuthorFragmentRequest;
  instruction_location: HostActionResourceLocation;
  workset_view_location: HostActionResourceLocation;
  stable_fingerprint: string;
}

export async function buildIndexerAgentStepRoute(input: {
  run_request: unknown;
  instruction_request: unknown;
  workset_view_request: unknown;
  workspaceRoot: string;
  authorities?: readonly import("./workflow/workflowTypes.js").ContextWorkflowAuthority[];
  managed?: boolean;
}): Promise<IndexerAgentStepRoute> {
  const runRequest = validateIndexerProgramRunRequest(input.run_request);
  const instructionRequest = validateIndexerInstructionMaterializationRequest(
    input.instruction_request,
  );
  assertInstructionRunBinding({ request: instructionRequest, runRequest });
  const worksetViewRequest = validateIndexerWorksetViewMaterializationRequest(
    input.workset_view_request,
  );
  assertWorksetViewRunBinding({ request: worksetViewRequest, runRequest });
  const stepInput = buildIndexerAgentStepInput({
    run_request: runRequest,
    instruction_request_digest: instructionRequest.request_digest,
  });
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, INDEXER_GRAPH_ID, INDEXER_GRAPH_ENTRY);
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    throw new TypeError("Context Indexer graph has no run-indexer-agent-step Route");
  }
  const resolved = await resolveRoute(
    provider,
    INDEXER_GRAPH_ID,
    INDEXER_GRAPH_ENTRY,
    primary.routeId,
    { workspace: input.workspaceRoot },
    evaluated.evaluation.revision,
  );
  if (
    resolved.action?.id !== INDEXER_ACTION_ID ||
    resolved.action.runner !== "agent" ||
    resolved.action.skill === undefined ||
    resolved.action.inputSchema === undefined ||
    resolved.action.outputSchema === undefined
  ) {
    throw new TypeError("Context Indexer graph Agent Action contract is incomplete");
  }
  const templateLocation = resolved.resources.required.find((resource) =>
    resource.id === instructionRequest.resource_id
  );
  if (templateLocation?.schema !== "agent-graph.resource-location.host-action.v1") {
    throw new TypeError("Context Indexer graph has no resolved instructions Host Resource");
  }
  const dynamicLocation = indexerInstructionHostLocation(instructionRequest);
  dynamicLocation.readState = "read-required";
  const templateWorksetViewLocation = resolved.resources.required.find((resource) =>
    resource.id === worksetViewRequest.resource_id
  );
  if (
    templateWorksetViewLocation?.schema !==
      "agent-graph.resource-location.host-action.v1"
  ) {
    throw new TypeError("Context Indexer graph has no authorized workset View Resource");
  }
  const worksetViewLocation = indexerWorksetViewHostLocation(worksetViewRequest);
  worksetViewLocation.readState = "read-required";
  const graphDigest = provider.graphDigests.get(INDEXER_GRAPH_ID);
  if (graphDigest === undefined) {
    throw new TypeError("Context Indexer graph digest is unavailable");
  }
  const stableFingerprint = indexerProtocolDigest({
    protocol: "context.indexer.agent-step-route-fingerprint/v1",
    provider_graph_digest: graphDigest,
    step_input_digest: stepInput.input_digest,
    instruction_request_digest: instructionRequest.request_digest,
    workset_view_request_digest: worksetViewRequest.request_digest,
  });
  const actionSource: ContextWorkflowRouteActionSource = {
    ...resolved.action,
    input: stepInput as unknown as JsonValue,
  };
  const action = projectWorkflowRouteAction({
    action: actionSource,
    revision: stableFingerprint,
    authorities: input.authorities ?? [],
  });
  const required = resolved.resources.required.map((resource) =>
    projectWorkflowResourceLocation(
      resource.id === dynamicLocation.id
        ? dynamicLocation
        : resource.id === worksetViewLocation.id
        ? worksetViewLocation
        : resource,
      stableFingerprint,
      input.authorities ?? [],
    )
  );
  const recommended = resolved.resources.recommended.map((resource) =>
    projectWorkflowResourceLocation(
      resource,
      stableFingerprint,
      input.authorities ?? [],
    )
  );
  const authorityOptions = authorityCommandOptions(
    input.authorities ?? [],
    "workflow",
  );
  const route: ContextResolvedWorkflowRoute = {
    protocol: "context.workflow.route.v1",
    id: resolved.routeId,
    revision: stableFingerprint,
    node: resolved.node,
    reason_code: resolved.reasonCode,
    availability: resolved.availability,
    commands: [{
      command: `context${authorityOptions} action complete-current --revision '${stableFingerprint}'${input.managed === true ? " --managed" : ""} --input - --format json`,
      effect: "write",
      availability: "immediate",
      managed_execution: "agent-required",
    }],
    ...(action === undefined ? {} : { action }),
    resources: { required, recommended },
    after_action: { evaluate: true },
  };
  return {
    route,
    step_input: stepInput,
    instruction_location: dynamicLocation,
    workset_view_location: worksetViewLocation,
    stable_fingerprint: stableFingerprint,
  };
}

function composerIdFromRef(composerRef: string): string {
  const marker = "#composer:";
  const offset = composerRef.lastIndexOf(marker);
  if (offset < 0) throw new TypeError("post-author composer ref is invalid");
  return composerRef.slice(offset + marker.length);
}

function assertPostAuthorInstructionBinding(input: {
  request: IndexerPostAuthorFragmentRequest;
  instructionRequest: IndexerInstructionMaterializationRequest;
}): void {
  const composerId = composerIdFromRef(input.request.composer_ref);
  if (
    input.instructionRequest.composer_id !== composerId ||
    input.instructionRequest.workset_digest !== input.request.workset.workset_digest ||
    !input.request.composer_ref.startsWith(`${input.request.target_layer_ref}#composer:`) ||
    !input.request.target_layer_ref.startsWith(
      `provider:${input.instructionRequest.provider_id}#`,
    )
  ) {
    throw new TypeError(
      "post-author Agent step instructions do not match its composer/workset authority",
    );
  }
}

export async function buildIndexerPostAuthorAgentStepRoute(input: {
  fragment_request: unknown;
  instruction_request: unknown;
  workspaceRoot: string;
  authorities?: readonly import("./workflow/workflowTypes.js").ContextWorkflowAuthority[];
  managed?: boolean;
}): Promise<IndexerPostAuthorAgentStepRoute> {
  const fragmentRequest = validateIndexerPostAuthorFragmentRequest(
    input.fragment_request,
  );
  const instructionRequest = validateIndexerInstructionMaterializationRequest(
    input.instruction_request,
  );
  assertPostAuthorInstructionBinding({
    request: fragmentRequest,
    instructionRequest,
  });
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(
    provider,
    INDEXER_GRAPH_ID,
    INDEXER_POST_AUTHOR_GRAPH_ENTRY,
  );
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    throw new TypeError("Context Indexer graph has no post-author composer Route");
  }
  const resolved = await resolveRoute(
    provider,
    INDEXER_GRAPH_ID,
    INDEXER_POST_AUTHOR_GRAPH_ENTRY,
    primary.routeId,
    { workspace: input.workspaceRoot },
    evaluated.evaluation.revision,
  );
  if (
    resolved.action?.id !== INDEXER_POST_AUTHOR_ACTION_ID ||
    resolved.action.runner !== "agent" ||
    resolved.action.skill === undefined ||
    resolved.action.inputSchema === undefined ||
    resolved.action.outputSchema === undefined
  ) {
    throw new TypeError("Context post-author composer Action contract is incomplete");
  }
  const templateLocation = resolved.resources.required.find((resource) =>
    resource.id === instructionRequest.resource_id
  );
  if (templateLocation?.schema !== "agent-graph.resource-location.host-action.v1") {
    throw new TypeError(
      "Context post-author composer Route has no resolved instructions Host Resource",
    );
  }
  const instructionLocation = indexerInstructionHostLocation(instructionRequest);
  instructionLocation.readState = "read-required";
  const worksetViewLocation: HostActionResourceLocation = {
    schema: "agent-graph.resource-location.host-action.v1",
    id: "authorized-indexer-workset-view",
    kind: "procedure",
    mediaType: "application/json",
    revision: fragmentRequest.primary_result_view.view_digest,
    materialize: {
      handler: "context.materialize-indexer-workset-view/v1",
      input: {
        schema: "context.indexer.layer-fragment-request/v1",
        value: fragmentRequest as unknown as JsonValue,
      },
      output_schema: "context.indexer.primary-result-view/v1",
    },
  };
  worksetViewLocation.readState = "read-required";
  const graphDigest = provider.graphDigests.get(INDEXER_GRAPH_ID);
  if (graphDigest === undefined) {
    throw new TypeError("Context Indexer graph digest is unavailable");
  }
  const stableFingerprint = indexerProtocolDigest({
    protocol: "context.indexer.agent-step-route-fingerprint/v1",
    phase: "post-author",
    provider_graph_digest: graphDigest,
    step_input_digest: fragmentRequest.request_digest,
    instruction_request_digest: instructionRequest.request_digest,
    primary_result_view_digest: fragmentRequest.primary_result_view.view_digest,
  });
  const action = projectWorkflowRouteAction({
    action: {
      ...resolved.action,
      input: fragmentRequest as unknown as JsonValue,
    },
    revision: stableFingerprint,
    authorities: input.authorities ?? [],
  });
  const required = [...resolved.resources.required.map((resource) =>
    projectWorkflowResourceLocation(
      resource.id === instructionLocation.id ? instructionLocation : resource,
      stableFingerprint,
      input.authorities ?? [],
    )
  ), projectWorkflowResourceLocation(
    worksetViewLocation,
    stableFingerprint,
    input.authorities ?? [],
  )];
  const recommended = resolved.resources.recommended.map((resource) =>
    projectWorkflowResourceLocation(resource, stableFingerprint, input.authorities ?? [])
  );
  const authorityOptions = authorityCommandOptions(input.authorities ?? [], "workflow");
  return {
    route: {
      protocol: "context.workflow.route.v1",
      id: resolved.routeId,
      revision: stableFingerprint,
      node: resolved.node,
      reason_code: resolved.reasonCode,
      availability: resolved.availability,
      commands: [{
        command: `context${authorityOptions} action complete-current --revision '${stableFingerprint}'${input.managed === true ? " --managed" : ""} --input - --format json`,
        effect: "write",
        availability: "immediate",
        managed_execution: "agent-required",
      }],
      ...(action === undefined ? {} : { action }),
      resources: { required, recommended },
      after_action: { evaluate: true },
    },
    step_input: fragmentRequest,
    instruction_location: instructionLocation,
    workset_view_location: worksetViewLocation,
    stable_fingerprint: stableFingerprint,
  };
}
