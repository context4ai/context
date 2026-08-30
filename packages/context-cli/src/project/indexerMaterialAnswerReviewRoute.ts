import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
} from "@c4a/agent-graph";
import { indexerProtocolDigest } from "@c4a/context";
import {
  inspectProjectIndexerMaterialAnswerReview,
  validateIndexerMaterialAnswerReviewInspectionInput,
  validateIndexerMaterialAnswerReviewResolutionInput,
  type IndexerMaterialAnswerReviewInspectionInput,
  type IndexerMaterialAnswerReviewResolutionInput,
} from "./indexerMaterialAnswerReviewActions.js";
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
const ENTRY = "material-answer-review";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function validateInputRef(value: string, label: string): string {
  if (value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function gateAction(input: {
  source: ContextWorkflowRouteActionSource | undefined;
  actionInput: IndexerMaterialAnswerReviewInspectionInput |
    IndexerMaterialAnswerReviewResolutionInput;
  revision: string;
  authorities: readonly ContextWorkflowAuthority[];
}): NonNullable<ContextResolvedWorkflowRoute["action"]> | undefined {
  if (input.source === undefined) return undefined;
  return projectWorkflowRouteAction({
    action: { ...input.source, input: input.actionInput as unknown as JsonValue },
    node: "review-material-answer-candidates",
    hasStructureBatch: false,
    revision: input.revision,
    authorities: [...input.authorities],
  });
}

export async function buildIndexerMaterialAnswerReviewRoute(input: {
  projectRoot: string;
  inspection_input: unknown;
  resolution_input: unknown;
  inspectionInputRef: string;
  resolutionInputRef: string;
  authorities?: readonly ContextWorkflowAuthority[];
}): Promise<{
  route: ContextResolvedWorkflowRoute;
  inspection_input: IndexerMaterialAnswerReviewInspectionInput;
  resolution_input: IndexerMaterialAnswerReviewResolutionInput;
}> {
  validateInputRef(
    input.inspectionInputRef,
    "material-answer Review inspection input reference",
  );
  const resolutionInputRef = validateInputRef(
    input.resolutionInputRef,
    "material-answer Review resolution input reference",
  );
  const inspectionInput = validateIndexerMaterialAnswerReviewInspectionInput(
    input.inspection_input,
  );
  const resolutionInput = validateIndexerMaterialAnswerReviewResolutionInput(
    input.resolution_input,
  );
  const inspection = inspectProjectIndexerMaterialAnswerReview(inspectionInput);
  if (
    resolutionInput.workset.workset_digest !== inspection.workset_digest ||
    resolutionInput.candidate_set.candidate_set_digest !==
      inspection.candidate_set_digest ||
    resolutionInput.baseline_report.report_digest !==
      inspection.baseline_report.report_digest
  ) {
    throw new TypeError("material-answer Review route inputs do not bind the same baseline");
  }
  const authorities = [...(input.authorities ?? [])];
  const facts = {
    indexer_material_answer_review: {
      state: "review-required",
      review_scope: inspection.review_scope,
      workset_digest: inspection.workset_digest,
      candidate_set_digest: inspection.candidate_set_digest,
      baseline_report_digest: inspection.baseline_report.report_digest,
    },
  };
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, GRAPH_ID, ENTRY, { facts, authorities });
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    throw new TypeError("Context Indexer material-answer Review Gate is unavailable");
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
    resolved.gate?.id !== "review-material-answer-candidates" ||
    resolved.gate.inspectionAction?.action.effect !== "read" ||
    resolved.gate.resolutionAction?.action.effect !== "external" ||
    resolved.gate.delegatable !== true
  ) {
    throw new TypeError("Context Indexer material-answer Review Gate is incomplete");
  }
  const graphDigest = provider.graphDigests.get(GRAPH_ID);
  if (graphDigest === undefined) throw new TypeError("Context Indexer graph digest is unavailable");
  const revision = indexerProtocolDigest({
    protocol: "context.indexer.material-answer-review-route-fingerprint/v1",
    graph_digest: graphDigest,
    inspection_input_digest: inspectionInput.input_digest,
    resolution_input_digest: resolutionInput.input_digest,
    baseline_report_digest: inspection.baseline_report.report_digest,
  });
  const inspectionAction = gateAction({
    source: resolved.gate.inspectionAction?.action,
    actionInput: inspectionInput,
    revision,
    authorities,
  });
  const resolutionAction = gateAction({
    source: resolved.gate.resolutionAction?.action,
    actionInput: resolutionInput,
    revision,
    authorities,
  });
  const required = resolved.resources.required.map((resource) =>
    projectWorkflowResourceLocation(resource, revision, authorities)
  );
  const recommended = resolved.resources.recommended.map((resource) =>
    projectWorkflowResourceLocation(resource, revision, authorities)
  );
  const delegated = resolved.gate.resolution === "session-authority";
  return {
    inspection_input: inspectionInput,
    resolution_input: resolutionInput,
    route: {
      protocol: "context.workflow.route.v1",
      id: resolved.routeId,
      revision,
      node: resolved.node,
      reason_code: resolved.reasonCode,
      availability: resolved.availability,
      commands: [{
        command: `context indexer review-material-answer-candidate --input ${shellQuote(resolutionInputRef)} --format json`,
        effect: "external",
        availability: delegated ? "immediate" : "after-human-confirmation",
        managed_execution: delegated ? "automatic" : "agent-required",
      }],
      resources: { required, recommended },
      gate: {
        id: resolved.gate.id,
        ...(resolved.gate.authority === undefined ? {} : {
          authority: resolved.gate.authority,
        }),
        delegatable: true,
        resolution: resolved.gate.resolution,
        ...(inspectionAction === undefined ? {} : {
          inspection_action: inspectionAction as NonNullable<
            NonNullable<ContextResolvedWorkflowRoute["gate"]>["inspection_action"]
          >,
        }),
        ...(resolutionAction === undefined ? {} : {
          resolution_action: resolutionAction as NonNullable<
            NonNullable<ContextResolvedWorkflowRoute["gate"]>["resolution_action"]
          >,
        }),
      },
      after_action: { evaluate: true },
    },
  };
}
