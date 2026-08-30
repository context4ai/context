import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
  type ResourceReadReceiptSet,
  type ResourceLocationV2,
} from "@c4a/agent-graph";
import {
  buildIndexerAgentStepInput,
  indexerProtocolDigest,
  validateIndexerProgramRunRequest,
  type IndexerAgentStepInput,
} from "@c4a/context";
import {
  indexerInstructionHostLocation,
  validateIndexerInstructionMaterializationRequest,
  type IndexerInstructionMaterializationRequest,
} from "./indexerInstructionMaterialization.js";
import {
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
  if (input.runRequest.operation === "main-index") {
    if (input.runRequest.workset.indexer_id !== input.request.indexer_id) {
      throw new TypeError("Indexer Agent step instructions belong to another main Indexer");
    }
    return;
  }
  if (input.runRequest.workset.items.some((item) =>
    !item.eligible_answer_indexer_ids.includes(input.request.indexer_id)
  )) {
    throw new TypeError("Indexer Agent step instructions are not eligible for every material answer item");
  }
}

function dynamicResourceReadState(input: {
  location: ResourceLocationV2;
  receipts?: ResourceReadReceiptSet;
}): "read-required" | "current" {
  if (input.receipts?.provider !== "c4a/context") return "read-required";
  return input.receipts.receipts.some((receipt) =>
    receipt.id === input.location.id &&
    receipt.revision === input.location.revision &&
    receipt.digest.startsWith("sha256:")
  ) ? "current" : "read-required";
}

export interface IndexerAgentStepRoute {
  route: ContextResolvedWorkflowRoute;
  step_input: IndexerAgentStepInput;
  instruction_location: ResourceLocationV2;
  stable_fingerprint: string;
}

export async function buildIndexerAgentStepRoute(input: {
  run_request: unknown;
  instruction_request: unknown;
  workspaceRoot: string;
  resource_receipts?: ResourceReadReceiptSet;
}): Promise<IndexerAgentStepRoute> {
  const runRequest = validateIndexerProgramRunRequest(input.run_request);
  const instructionRequest = validateIndexerInstructionMaterializationRequest(
    input.instruction_request,
  );
  assertInstructionRunBinding({ request: instructionRequest, runRequest });
  const stepInput = buildIndexerAgentStepInput({
    run_request: runRequest,
    instruction_request_digest: instructionRequest.request_digest,
  });
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, INDEXER_GRAPH_ID, INDEXER_GRAPH_ENTRY, {
    ...(input.resource_receipts === undefined
      ? {}
      : { resourceReceipts: input.resource_receipts }),
  });
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    throw new TypeError("Context Indexer graph has no run-indexer-agent-step Route");
  }
  const resolved = await resolveRoute(
    provider,
    INDEXER_GRAPH_ID,
    INDEXER_GRAPH_ENTRY,
    primary.routeId,
    {
      workspace: input.workspaceRoot,
      ...(input.resource_receipts === undefined
        ? {}
        : { resourceReceipts: input.resource_receipts }),
    },
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
  if (templateLocation?.schema !== "agent-graph.resource-location.v2") {
    throw new TypeError("Context Indexer graph has no v2 resolved instructions Resource");
  }
  const dynamicLocation = indexerInstructionHostLocation(instructionRequest);
  dynamicLocation.readState = dynamicResourceReadState({
    location: dynamicLocation,
    ...(input.resource_receipts === undefined
      ? {}
      : { receipts: input.resource_receipts }),
  });
  const graphDigest = provider.graphDigests.get(INDEXER_GRAPH_ID);
  if (graphDigest === undefined) {
    throw new TypeError("Context Indexer graph digest is unavailable");
  }
  const stableFingerprint = indexerProtocolDigest({
    protocol: "context.indexer.agent-step-route-fingerprint/v1",
    provider_graph_digest: graphDigest,
    step_input_digest: stepInput.input_digest,
    instruction_request_digest: instructionRequest.request_digest,
  });
  const actionSource: ContextWorkflowRouteActionSource = {
    ...resolved.action,
    input: stepInput as unknown as JsonValue,
  };
  const action = projectWorkflowRouteAction({
    action: actionSource,
    node: resolved.node,
    hasStructureBatch: false,
    revision: stableFingerprint,
    authorities: [],
  });
  const required = resolved.resources.required.map((resource) =>
    projectWorkflowResourceLocation(
      resource.id === dynamicLocation.id ? dynamicLocation : resource,
      stableFingerprint,
      [],
    )
  );
  const recommended = resolved.resources.recommended.map((resource) =>
    projectWorkflowResourceLocation(resource, stableFingerprint, [])
  );
  const route: ContextResolvedWorkflowRoute = {
    protocol: "context.workflow.route.v1",
    id: resolved.routeId,
    revision: stableFingerprint,
    node: resolved.node,
    reason_code: resolved.reasonCode,
    availability: resolved.availability,
    commands: [],
    ...(action === undefined ? {} : { action }),
    resources: { required, recommended },
    after_action: { evaluate: true },
  };
  return {
    route,
    step_input: stepInput,
    instruction_location: dynamicLocation,
    stable_fingerprint: stableFingerprint,
  };
}
