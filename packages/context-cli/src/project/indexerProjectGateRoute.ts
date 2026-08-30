import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
} from "@c4a/agent-graph";
import {
  compareIndexerCanonicalText,
  indexerProtocolDigest,
} from "@c4a/context";
import { loadStagedIndexerProjectProposal } from "./indexerProjectApply.js";
import { validateIndexerProjectStaging } from "./indexerProjectFlow.js";
import {
  loadContextWorkflowProvider,
  projectWorkflowResourceLocation,
  projectWorkflowRouteAction,
} from "./workflow/workflowProvider.js";
import {
  CONTEXT_WORKFLOW_AUTHORITIES as WORKFLOW_AUTHORITIES,
} from "./workflow/workflowTypes.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowAuthority,
  ContextWorkflowRouteActionSource,
} from "./workflow/workflowTypes.js";

const GRAPH_ID = "indexer";
const ENTRY = "project-confirmation";

export interface IndexerProjectGateInput {
  protocol: "context.indexer.project-gate-input/v1";
  proposal_digest: string;
  requirement_set_digest: string;
  mode: "registry-only" | "customization";
  target_paths: string[];
  providers: Array<{
    indexer_id: string;
    provider_id: string;
    role: "primary" | "extension";
    skill: string;
    version: string;
    integrity: string;
  }>;
  customizations: Array<{
    indexer_id: string;
    mode: "extend" | "replace";
  }>;
  dependencies: Array<{
    package: string;
    version: string;
    state: "locked" | "requires-authorization";
    install_scripts: false;
  }>;
  dependency_intent_digest: string;
  capability_gap_digest: string | null;
  managed_confirmation_eligible: boolean;
  managed_confirmation_blockers: Array<
    "replace-customization" | "external-dependencies"
  >;
  validation_report_digests: string[];
  confirmation_batch_digest: string;
  input_digest: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function indexerProjectManagedConfirmation(input: {
  proposal: Awaited<ReturnType<typeof loadStagedIndexerProjectProposal>>;
}): {
  eligible: boolean;
  blockers: IndexerProjectGateInput["managed_confirmation_blockers"];
} {
  const blockers: IndexerProjectGateInput["managed_confirmation_blockers"] = [];
  if (input.proposal.target_document.indexers.some((indexer) =>
    indexer.customization?.mode === "replace"
  )) {
    blockers.push("replace-customization");
  }
  if (input.proposal.dependencies.intents.length > 0) {
    blockers.push("external-dependencies");
  }
  return { eligible: blockers.length === 0, blockers };
}

function projectGateAction(input: {
  source: ContextWorkflowRouteActionSource | undefined;
  gateInput: IndexerProjectGateInput;
  revision: string;
}): NonNullable<ContextResolvedWorkflowRoute["action"]> | undefined {
  if (input.source === undefined) return undefined;
  return projectWorkflowRouteAction({
    action: {
      ...input.source,
      input: input.gateInput as unknown as JsonValue,
    },
    node: "confirm-indexer-project",
    hasStructureBatch: false,
    revision: input.revision,
    authorities: [],
  });
}

export async function buildIndexerProjectConfirmationRoute(input: {
  projectRoot: string;
  proposal_digest: string;
  validation: unknown;
  validationInputRef: string;
  authorities?: readonly ContextWorkflowAuthority[];
}): Promise<{
  route: ContextResolvedWorkflowRoute;
  gate_input: IndexerProjectGateInput;
}> {
  if (input.validationInputRef.length === 0 || input.validationInputRef.includes("\0")) {
    throw new TypeError("Indexer project validation input reference is invalid");
  }
  const proposal = await loadStagedIndexerProjectProposal({
    projectRoot: input.projectRoot,
    proposal_digest: input.proposal_digest,
  });
  const validationReportDigests = await validateIndexerProjectStaging({
    proposal,
    validation: input.validation,
  });
  if (
    validationReportDigests.length !== proposal.finalized_validation_report_digests.length ||
    validationReportDigests.some((digest, index) =>
      digest !== proposal.finalized_validation_report_digests[index]
    )
  ) {
    throw new TypeError("Indexer project proposal finalized validation reports are stale");
  }
  const managedConfirmation = indexerProjectManagedConfirmation({ proposal });
  const providers = proposal.target_document.indexers.flatMap((indexer) =>
    indexer.providers.map((provider) => ({
      indexer_id: indexer.id,
      provider_id: provider.id,
      role: provider.role,
      skill: provider.skill,
      version: provider.version,
      integrity: provider.integrity,
    }))
  ).sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.indexer_id}\u0000${left.provider_id}`,
      `${right.indexer_id}\u0000${right.provider_id}`,
    )
  );
  const customizations = proposal.target_document.indexers.flatMap((indexer) =>
    indexer.customization === undefined
      ? []
      : [{ indexer_id: indexer.id, mode: indexer.customization.mode }]
  ).sort((left, right) =>
    compareIndexerCanonicalText(left.indexer_id, right.indexer_id)
  );
  const dependencies = proposal.dependencies.intents.map((intent) => ({
    package: intent.package,
    version: intent.version,
    state: intent.state,
    install_scripts: intent.install_scripts,
  }));
  const confirmationBatchDigest = indexerProtocolDigest({
    protocol: "context.indexer.project-confirmation-batch/v1",
    proposal_digest: proposal.proposal_digest,
    requirement_set_digest: proposal.requirement_set_digest,
    mode: proposal.mode,
    targets: proposal.targets.map((target) => ({
      path: target.path,
      operation: target.operation,
      base_digest: target.base_digest,
      target_digest: target.target_digest,
    })),
    providers,
    customizations,
    dependencies,
    dependency_intent_digest: proposal.dependencies.intent_set_digest,
    capability_gap_digest: proposal.capability_gap_digest,
    validation_report_digests: validationReportDigests,
  });
  const gatePayload = {
    protocol: "context.indexer.project-gate-input/v1" as const,
    proposal_digest: proposal.proposal_digest,
    requirement_set_digest: proposal.requirement_set_digest,
    mode: proposal.mode,
    target_paths: proposal.targets.map((target) => target.path),
    providers,
    customizations,
    dependencies,
    dependency_intent_digest: proposal.dependencies.intent_set_digest,
    capability_gap_digest: proposal.capability_gap_digest,
    managed_confirmation_eligible: managedConfirmation.eligible,
    managed_confirmation_blockers: managedConfirmation.blockers,
    validation_report_digests: validationReportDigests,
    confirmation_batch_digest: confirmationBatchDigest,
  };
  const gateInput: IndexerProjectGateInput = {
    ...gatePayload,
    input_digest: indexerProtocolDigest(gatePayload),
  };
  const authorities = [...(input.authorities ?? [])].filter((authority) =>
    managedConfirmation.eligible ||
    authority !== WORKFLOW_AUTHORITIES.indexerProjectConfirmation
  );
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, GRAPH_ID, ENTRY, {
    facts: { indexer_project: { confirmed: false } },
    authorities,
  });
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) throw new TypeError("Context Indexer project Gate is unavailable");
  const resolved = await resolveRoute(
    provider,
    GRAPH_ID,
    ENTRY,
    primary.routeId,
    {
      workspace: input.projectRoot,
      facts: { indexer_project: { confirmed: false } },
      authorities,
    },
    evaluated.evaluation.revision,
  );
  if (
    resolved.gate?.id !== "confirm-indexer-project" ||
    resolved.gate.inspectionAction?.action.effect !== "read" ||
    resolved.gate.resolutionAction?.action.effect === "read"
  ) {
    throw new TypeError("Context Indexer project confirmation Gate contract is incomplete");
  }
  const graphDigest = provider.graphDigests.get(GRAPH_ID);
  if (graphDigest === undefined) throw new TypeError("Context Indexer graph digest is unavailable");
  const revision = indexerProtocolDigest({
    protocol: "context.indexer.project-gate-route-fingerprint/v1",
    graph_digest: graphDigest,
    gate_input_digest: gateInput.input_digest,
  });
  const inspection = projectGateAction({
    source: resolved.gate.inspectionAction?.action,
    gateInput,
    revision,
  });
  const resolution = projectGateAction({
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
  const route: ContextResolvedWorkflowRoute = {
    protocol: "context.workflow.route.v1",
    id: resolved.routeId,
    revision,
    node: resolved.node,
    reason_code: resolved.reasonCode,
    availability: resolved.availability,
    commands: [{
      command: `context indexer apply-indexer-project --proposal ${shellQuote(proposal.proposal_digest)} --validation-input ${shellQuote(input.validationInputRef)} --format json`,
      effect: "write",
      availability: managed ? "immediate" : "after-human-confirmation",
      managed_execution: "automatic",
    }],
    resources: { required, recommended },
    gate: {
      id: resolved.gate.id,
      ...(resolved.gate.authority === undefined
        ? {}
        : { authority: resolved.gate.authority }),
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
  };
  return { route, gate_input: gateInput };
}
