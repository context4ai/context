import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
  type HostActionResourceLocation,
} from "@c4a/agent-graph";
import {
  buildIndexerAgentStepInput,
  buildIndexerPostAuthorAgentStepInput,
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
    workset.stage !== input.request.stage ||
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
  workset_view_locations: readonly HostActionResourceLocation[];
  stable_fingerprint: string;
}

export interface IndexerPostAuthorAgentStepRoute {
  route: ContextResolvedWorkflowRoute;
  step_input: Extract<IndexerAgentStepInput, { stage: "post-author" }>;
  instruction_location: HostActionResourceLocation;
  workset_view_locations: readonly HostActionResourceLocation[];
  stable_fingerprint: string;
}

export async function buildIndexerAgentStepRoute(input: {
  run_requests: readonly unknown[];
  instruction_request: unknown;
  workset_view_requests: readonly unknown[];
  ready_instruction: { path: string; digest: string };
  ready_workset_views: readonly {
    resource_id: string;
    path: string;
    digest: string;
  }[];
  workspaceRoot: string;
  authorities?: readonly import("./workflow/workflowTypes.js").ContextWorkflowAuthority[];
  managed?: boolean;
}): Promise<IndexerAgentStepRoute> {
  const runRequests = input.run_requests.map(validateIndexerProgramRunRequest);
  if (runRequests.length === 0) {
    throw new TypeError("Context Indexer Agent Route requires at least one run request");
  }
  const instructionRequest = validateIndexerInstructionMaterializationRequest(
    input.instruction_request,
  );
  const worksetViewRequests = input.workset_view_requests.map(
    validateIndexerWorksetViewMaterializationRequest,
  );
  if (worksetViewRequests.length !== runRequests.length) {
    throw new TypeError("Context Indexer Agent Route requires one View per run request");
  }
  if (input.ready_workset_views.length !== worksetViewRequests.length) {
    throw new TypeError("Context Indexer Agent Route requires one ready View per run request");
  }
  runRequests.forEach((runRequest, index) => {
    assertInstructionRunBinding({ request: instructionRequest, runRequest });
    assertWorksetViewRunBinding({
      request: worksetViewRequests[index]!,
      runRequest,
    });
  });
  const stepInput = buildIndexerAgentStepInput({
    run_requests: runRequests,
    instruction_request_digest: instructionRequest.request_digest,
    workset_view_requests: worksetViewRequests,
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
    resource.id === "authorized-indexer-workset-view"
  );
  if (
    templateWorksetViewLocation?.schema !==
      "agent-graph.resource-location.host-action.v1"
  ) {
    throw new TypeError("Context Indexer graph has no authorized workset View Resource");
  }
  const worksetViewLocations = worksetViewRequests.map((request) => {
    const location = indexerWorksetViewHostLocation(request);
    location.readState = "read-required";
    return location;
  });
  const readyResources = new Map([
    [instructionRequest.resource_id, input.ready_instruction] as const,
    ...input.ready_workset_views.map((resource) => [
      resource.resource_id,
      { path: resource.path, digest: resource.digest },
    ] as const),
  ]);
  for (const [index, request] of worksetViewRequests.entries()) {
    const ready = input.ready_workset_views[index];
    if (
      ready?.resource_id !== request.resource_id ||
      ready.digest !== request.payload_digest
    ) {
      throw new TypeError("Context Indexer Agent Route ready View does not match its request");
    }
  }
  const graphDigest = provider.graphDigests.get(INDEXER_GRAPH_ID);
  if (graphDigest === undefined) {
    throw new TypeError("Context Indexer graph digest is unavailable");
  }
  const stableFingerprint = indexerProtocolDigest({
    protocol: "context.indexer.agent-step-route-fingerprint/v1",
    provider_graph_digest: graphDigest,
    step_input_digest: stepInput.input_digest,
    instruction_request_digest: instructionRequest.request_digest,
    workset_view_request_digests: worksetViewRequests.map((request) =>
      request.request_digest
    ),
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
  const required = resolved.resources.required.flatMap((resource) => {
    const locations = resource.id === dynamicLocation.id
      ? [dynamicLocation]
      : resource.id === "authorized-indexer-workset-view"
      ? worksetViewLocations
      : [resource];
    return locations.map((location) => {
      const projected = projectWorkflowResourceLocation(
        location,
        stableFingerprint,
        input.authorities ?? [],
      );
      const ready = readyResources.get(location.id);
      return ready === undefined
        ? projected
        : {
            id: projected.id,
            kind: projected.kind,
            media_type: projected.media_type,
            digest: ready.digest,
            path: ready.path,
            ...(projected.revision === undefined
              ? {}
              : { revision: projected.revision }),
            read_state: "read-required" as const,
          };
    });
  });
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
    workset_view_locations: worksetViewLocations,
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
    input.instructionRequest.stage !== "post-author" ||
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
  fragment_requests: readonly unknown[];
  instruction_request: unknown;
  ready_instruction: { path: string; digest: string };
  ready_workset_views: readonly {
    resource_id: string;
    path: string;
    digest: string;
  }[];
  workspaceRoot: string;
  authorities?: readonly import("./workflow/workflowTypes.js").ContextWorkflowAuthority[];
  managed?: boolean;
}): Promise<IndexerPostAuthorAgentStepRoute> {
  const fragmentRequests = input.fragment_requests.map(
    validateIndexerPostAuthorFragmentRequest,
  );
  if (fragmentRequests.length === 0) {
    throw new TypeError("Context post-author Agent Route requires at least one request");
  }
  const instructionRequest = validateIndexerInstructionMaterializationRequest(
    input.instruction_request,
  );
  fragmentRequests.forEach((request) => assertPostAuthorInstructionBinding({
    request,
    instructionRequest,
  }));
  const stepInput = buildIndexerPostAuthorAgentStepInput({
    fragment_requests: fragmentRequests,
    instruction_request_digest: instructionRequest.request_digest,
  });
  if (input.ready_workset_views.length !== fragmentRequests.length) {
    throw new TypeError("Context post-author Agent Route requires one ready View per task");
  }
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
  const worksetViewLocations = fragmentRequests.map((request, index) => {
    const taskKey = `task-${String(index + 1).padStart(3, "0")}`;
    const location: HostActionResourceLocation = {
      schema: "agent-graph.resource-location.host-action.v1",
      id: `authorized-indexer-workset-view/${taskKey}`,
      kind: "procedure",
      mediaType: "application/json",
      revision: request.primary_result_view.view_digest,
      materialize: {
        handler: "context.materialize-indexer-workset-view/v1",
        input: {
          schema: "context.indexer.layer-fragment-request/v1",
          value: request as unknown as JsonValue,
        },
        output_schema: "context.indexer.primary-result-view/v1",
      },
    };
    location.readState = "read-required";
    return location;
  });
  for (const [index, request] of fragmentRequests.entries()) {
    const ready = input.ready_workset_views[index];
    const location = worksetViewLocations[index]!;
    if (
      ready?.resource_id !== location.id ||
      ready.digest !== request.primary_result_view.view_digest
    ) {
      throw new TypeError("Context post-author Agent Route ready View does not match its task");
    }
  }
  const graphDigest = provider.graphDigests.get(INDEXER_GRAPH_ID);
  if (graphDigest === undefined) {
    throw new TypeError("Context Indexer graph digest is unavailable");
  }
  const stableFingerprint = indexerProtocolDigest({
    protocol: "context.indexer.agent-step-route-fingerprint/v1",
    phase: "post-author",
    provider_graph_digest: graphDigest,
    step_input_digest: stepInput.input_digest,
    instruction_request_digest: instructionRequest.request_digest,
    primary_result_view_digests: fragmentRequests.map((request) =>
      request.primary_result_view.view_digest
    ),
  });
  const action = projectWorkflowRouteAction({
    action: {
      ...resolved.action,
      input: stepInput as unknown as JsonValue,
    },
    revision: stableFingerprint,
    authorities: input.authorities ?? [],
  });
  const required = resolved.resources.required.map((resource) => {
    const location = resource.id === instructionLocation.id ? instructionLocation : resource;
    const projected = projectWorkflowResourceLocation(
      location,
      stableFingerprint,
      input.authorities ?? [],
    );
    return location.id !== instructionLocation.id
      ? projected
      : {
          id: projected.id,
          kind: projected.kind,
          media_type: projected.media_type,
          digest: input.ready_instruction.digest,
          path: input.ready_instruction.path,
          ...(projected.revision === undefined ? {} : { revision: projected.revision }),
          read_state: "read-required" as const,
        };
  });
  required.push(...worksetViewLocations.map((location, index) => {
    const projected = projectWorkflowResourceLocation(
      location,
      stableFingerprint,
      input.authorities ?? [],
    );
    const ready = input.ready_workset_views[index]!;
    return {
      id: projected.id,
      kind: projected.kind,
      media_type: projected.media_type,
      digest: ready.digest,
      path: ready.path,
      ...(projected.revision === undefined ? {} : { revision: projected.revision }),
      read_state: "read-required" as const,
    };
  }));
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
    step_input: stepInput as Extract<IndexerAgentStepInput, { stage: "post-author" }>,
    instruction_location: instructionLocation,
    workset_view_locations: worksetViewLocations,
    stable_fingerprint: stableFingerprint,
  };
}
