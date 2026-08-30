import type {
  IndexerProviderRouteInput,
  IndexerProviderRouteReport,
  IndexerOverlayQuestionAuthorityProof,
  IndexerProjectProposal,
} from "@c4a/context";
import {
  indexerProgramIdentityDigest,
  indexerProtocolDigest,
  validateIndexerCapabilityGapProof,
} from "@c4a/context";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import {
  applyIndexerProjectProposal,
  stageIndexerProjectProposal,
  type IndexerProjectApplyReceipt,
  type StagedIndexerProjectProposalReceipt,
} from "./indexerProjectApply.js";
import {
  applyIndexerOverlayQuestionRegistryProposal,
  stageIndexerOverlayQuestionRegistryApplyProposal,
  type IndexerOverlayQuestionApplyReceipt,
  type StagedIndexerOverlayQuestionProposalReceipt,
} from "./indexerOverlayQuestionApply.js";
import type { IndexerOverlayQuestionRebindReceipt } from
  "./indexerOverlayQuestionRebind.js";
import {
  validateIndexerSelectionFinal,
  type IndexerResolvedSelectionInput,
  type IndexerSelectionStaticReport,
} from "./indexerSelectionValidation.js";
import {
  validateIndexerProgramExecutionAuthorizationResult,
  type IndexerProgramExecutionAuthorizationResult,
} from "./indexerProgramExecutionAuthorization.js";

export interface IndexerProjectStagingValidationInput {
  protocol: "context.indexer.project-staging-validation-input/v1";
  static_report: IndexerSelectionStaticReport;
  resolved: IndexerResolvedSelectionInput[];
  customizations: IndexerCustomizationView[];
  operator_contract: unknown;
  profile_contract: unknown;
  overlay_question_authorities?: IndexerOverlayQuestionAuthorityProof[];
  program_authorization?: IndexerProgramExecutionAuthorizationResult;
  capability_gap?: {
    route_input: IndexerProviderRouteInput;
    route_report: IndexerProviderRouteReport;
  };
}

export function indexerProjectLocalProgramScopeDigest(input: {
  project_ref: string;
  indexer_id: string;
  read_scope: unknown;
}): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.project-local-program-scope/v1",
    project_ref: input.project_ref,
    indexer_id: input.indexer_id,
    read_scope: input.read_scope,
  });
}

function validateProjectProgramAuthorization(input: {
  proposal: IndexerProjectProposal;
  final_report: Awaited<ReturnType<typeof validateIndexerSelectionFinal>>;
  authorization: IndexerProjectStagingValidationInput["program_authorization"];
}): void {
  if (input.proposal.program_execution_policy_digest === null) {
    if (input.authorization !== undefined) {
      throw new TypeError("project proposal without a local program cannot carry program authorization");
    }
    return;
  }
  if (input.authorization === undefined) {
    throw new TypeError("project-local program proposal requires independent execution authorization");
  }
  const result = validateIndexerProgramExecutionAuthorizationResult(input.authorization);
  const authorization = result.authorization;
  const programTargets = input.proposal.targets.filter((target) =>
    /^src\/indexer\/[a-z0-9][a-z0-9._-]*\/index\.ts$/u.test(target.path) &&
    target.operation === "write" && target.target_digest !== null
  );
  if (programTargets.length !== 1) {
    throw new TypeError("project-local program authorization requires one exact index.ts target");
  }
  const target = programTargets[0]!;
  const indexerId = target.path.split("/")[2]!;
  const indexer = input.proposal.target_document.indexers.find((item) => item.id === indexerId);
  const primary = indexer?.providers.find((provider) => provider.role === "primary");
  const provider = input.final_report.providers.find((item) =>
    item.indexer_id === indexerId && item.provider_id === primary?.id
  );
  if (indexer === undefined || primary === undefined || provider === undefined) {
    throw new TypeError("project-local program authorization has no final Provider authority");
  }
  const expectedProgramDigest = indexerProgramIdentityDigest({
    origin: "project-local",
    path: target.path,
    content_digest: target.target_digest!,
    provider_integrity: primary.integrity,
    execution_digest: authorization.execution_digest,
  });
  if (
    authorization.project_ref !== input.proposal.project_ref ||
    authorization.program_origin !== "project-local" ||
    authorization.provider_integrity !== primary.integrity ||
    authorization.provider_fingerprint !== provider.provider_fingerprint ||
    authorization.manifest_digest !== provider.manifest_digest ||
    authorization.program_digest !== expectedProgramDigest ||
    authorization.dependency_set_digest !== input.proposal.dependencies.intent_set_digest ||
    authorization.scope_digest !== indexerProjectLocalProgramScopeDigest({
      project_ref: input.proposal.project_ref,
      indexer_id: indexer.id,
      read_scope: indexer.read_scope,
    }) ||
    authorization.execution_policy_digest !== input.proposal.program_execution_policy_digest
  ) {
    throw new TypeError("project-local program authorization does not bind the exact proposal");
  }
}

function stagingValidationInput(
  value: unknown,
): IndexerProjectStagingValidationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer project staging validation input must be an object");
  }
  const input = value as Partial<IndexerProjectStagingValidationInput>;
  if (
    input.protocol !== "context.indexer.project-staging-validation-input/v1" ||
    !Array.isArray(input.resolved) ||
    !Array.isArray(input.customizations) ||
    input.static_report === undefined ||
    input.operator_contract === undefined ||
    input.profile_contract === undefined
  ) {
    throw new TypeError("Indexer project staging validation input is incomplete");
  }
  return input as IndexerProjectStagingValidationInput;
}

export function validateIndexerProjectCustomizationGap(input: {
  proposal: IndexerProjectProposal;
  capability_gap: IndexerProjectStagingValidationInput["capability_gap"];
  customizations: readonly IndexerCustomizationView[];
}): void {
  const gapInput = input.capability_gap;
  if (input.proposal.mode === "registry-only") {
    if (gapInput !== undefined) {
      throw new TypeError("registry-only project validation cannot carry a capability gap");
    }
    return;
  }
  if (gapInput === undefined) {
    throw new TypeError("customization project validation requires a CLI capability-gap proof");
  }
  const proof = validateIndexerCapabilityGapProof({
    route_input: gapInput.route_input,
    report: gapInput.route_report,
  });
  if (
    proof.project_ref !== input.proposal.project_ref ||
    proof.requirement_set_digest !== input.proposal.requirement_set_digest ||
    proof.gap_digest !== input.proposal.capability_gap_digest
  ) {
    throw new TypeError("customization project proposal is not bound to the current CLI capability gap");
  }
  const customized = new Map(input.customizations
    .filter((view) => view.mode !== "none")
    .map((view) => [view.indexer_id, view]));
  const declared = input.proposal.target_document.indexers.filter((indexer) =>
    indexer.customization !== undefined
  );
  if (customized.size !== declared.length) {
    throw new TypeError("customization project validation requires one declared customization view");
  }
  for (const indexer of declared) {
    const view = customized.get(indexer.id);
    if (
      view === undefined ||
      view.mode !== indexer.customization?.mode ||
      view.plan.capability_gap_digest !== proof.gap_digest
    ) {
      throw new TypeError("customization plan does not consume the current CLI capability gap");
    }
  }
}

export async function validateIndexerProjectStaging(input: {
  proposal: IndexerProjectProposal;
  validation: unknown;
}): Promise<string[]> {
  const validation = stagingValidationInput(input.validation);
  validateIndexerProjectCustomizationGap({
    proposal: input.proposal,
    capability_gap: validation.capability_gap,
    customizations: validation.customizations,
  });
  const report = await validateIndexerSelectionFinal({
    registry: input.proposal.target_document,
    static_report: validation.static_report,
    resolved: validation.resolved,
    customizations: validation.customizations,
    operator_contract: validation.operator_contract,
    profile_contract: validation.profile_contract,
    ...(validation.overlay_question_authorities === undefined
      ? {}
      : { overlay_question_authorities: validation.overlay_question_authorities }),
  });
  validateProjectProgramAuthorization({
    proposal: input.proposal,
    final_report: report,
    authorization: validation.program_authorization,
  });
  return [report.report_digest];
}

export async function stageProjectIndexerProposal(input: {
  projectRoot: string;
  proposal: unknown;
}): Promise<
  StagedIndexerProjectProposalReceipt | StagedIndexerOverlayQuestionProposalReceipt
> {
  if (
    input.proposal !== null && typeof input.proposal === "object" &&
    !Array.isArray(input.proposal) &&
    (input.proposal as { protocol?: unknown }).protocol ===
      "context.indexer.overlay-question-registry-apply-proposal/v1"
  ) {
    return stageIndexerOverlayQuestionRegistryApplyProposal(input);
  }
  return stageIndexerProjectProposal(input);
}

interface IndexerOverlayQuestionProjectApplyInput {
  protocol: "context.indexer.overlay-question-project-apply-input/v1";
  rebind_receipt: IndexerOverlayQuestionRebindReceipt;
}

function overlayQuestionApplyInput(
  value: unknown,
): IndexerOverlayQuestionProjectApplyInput | undefined {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    (value as { protocol?: unknown }).protocol !==
      "context.indexer.overlay-question-project-apply-input/v1"
  ) {
    return undefined;
  }
  const input = value as Partial<IndexerOverlayQuestionProjectApplyInput>;
  if (input.rebind_receipt === undefined || Object.keys(input).some((key) =>
    key !== "protocol" && key !== "rebind_receipt"
  )) {
    throw new TypeError("overlay question project apply input is invalid");
  }
  return input as IndexerOverlayQuestionProjectApplyInput;
}

export async function applyProjectIndexerProposal(input: {
  projectRoot: string;
  proposal_digest: string;
  validation: unknown;
}): Promise<IndexerProjectApplyReceipt | IndexerOverlayQuestionApplyReceipt> {
  const overlayInput = overlayQuestionApplyInput(input.validation);
  if (overlayInput !== undefined) {
    return applyIndexerOverlayQuestionRegistryProposal({
      projectRoot: input.projectRoot,
      proposal_digest: input.proposal_digest,
      rebind_receipt: overlayInput.rebind_receipt,
    });
  }
  return applyIndexerProjectProposal({
    projectRoot: input.projectRoot,
    proposal_digest: input.proposal_digest,
    validate_staging: (proposal) => validateIndexerProjectStaging({
      proposal,
      validation: input.validation,
    }),
  });
}
