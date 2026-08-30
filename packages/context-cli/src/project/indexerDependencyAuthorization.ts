import {
  authorizeIndexerDependencies,
  buildIndexerProjectProposal,
  indexerProtocolDigest,
  type IndexerDependencyAuthorizationReceipt,
  type IndexerDependencyIntentSet,
} from "@c4a/context";
import {
  loadStagedIndexerProjectProposal,
  stageIndexerProjectProposal,
  type StagedIndexerProjectProposalReceipt,
} from "./indexerProjectApply.js";

interface DependencyAuthorizationResolutionInput {
  protocol: "context.indexer.dependency-authorization-resolution/v1";
  authority_ref: string;
  authority_scope_digest: string;
  resolutions: Array<{
    package: string;
    version: string;
    lock_integrity: string;
    resolved_digest: string;
  }>;
}

export interface IndexerDependencyAuthorizationResult {
  protocol: "context.indexer.dependency-authorization-result/v1";
  proposal_digest: string;
  authorized_proposal_digest: string;
  request_intent_set_digest: string;
  receipt: IndexerDependencyAuthorizationReceipt;
  dependencies: IndexerDependencyIntentSet;
  stage_receipt: StagedIndexerProjectProposalReceipt;
  result_digest: string;
}

function resolutionInput(value: unknown): DependencyAuthorizationResolutionInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer dependency authorization resolution must be an object");
  }
  const input = value as Partial<DependencyAuthorizationResolutionInput>;
  if (
    input.protocol !== "context.indexer.dependency-authorization-resolution/v1" ||
    typeof input.authority_ref !== "string" || input.authority_ref.length === 0 ||
    typeof input.authority_scope_digest !== "string" ||
    !Array.isArray(input.resolutions)
  ) {
    throw new TypeError("Indexer dependency authorization resolution is incomplete");
  }
  return input as DependencyAuthorizationResolutionInput;
}

export async function authorizeProjectIndexerDependencies(input: {
  projectRoot: string;
  proposal_digest: string;
  resolution: unknown;
}): Promise<IndexerDependencyAuthorizationResult> {
  const proposal = await loadStagedIndexerProjectProposal({
    projectRoot: input.projectRoot,
    proposal_digest: input.proposal_digest,
  });
  const resolution = resolutionInput(input.resolution);
  const authorized = authorizeIndexerDependencies({
    dependencies: proposal.dependencies,
    resolutions: resolution.resolutions,
    authority_ref: resolution.authority_ref,
    authority_scope_digest: resolution.authority_scope_digest,
  });
  const { proposal_digest: _proposalDigest, ...proposalPayload } = proposal;
  void _proposalDigest;
  const authorizedProposal = buildIndexerProjectProposal({
    ...proposalPayload,
    dependencies: authorized.dependencies,
  });
  const stageReceipt = await stageIndexerProjectProposal({
    projectRoot: input.projectRoot,
    proposal: authorizedProposal,
  });
  const payload = {
    protocol: "context.indexer.dependency-authorization-result/v1" as const,
    proposal_digest: proposal.proposal_digest,
    authorized_proposal_digest: authorizedProposal.proposal_digest,
    request_intent_set_digest: proposal.dependencies.intent_set_digest,
    receipt: authorized.receipt,
    dependencies: authorized.dependencies,
    stage_receipt: stageReceipt,
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}
