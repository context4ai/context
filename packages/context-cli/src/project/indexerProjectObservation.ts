import { indexerProtocolDigest } from "@c4a/context";
import { observeAppliedIndexerProjectState } from "./indexerProjectApply.js";
import {
  validateIndexerProjectStaging,
  type IndexerProjectStagingValidationInput,
} from "./indexerProjectFlow.js";

export interface IndexerProjectObservationInput {
  protocol: "context.indexer.project-observation-input/v1";
  proposal_digest: string;
  apply_receipt_digest: string;
  staging_validation: IndexerProjectStagingValidationInput;
}

export interface IndexerProjectObservationResult {
  protocol: "context.indexer.project-observation-result/v1";
  state: "current";
  proposal_digest: string;
  apply_receipt_digest: string;
  target_set_digest: string;
  requirement_set_digest: string;
  registry_digest: string;
  indexer_selection_digest: string;
  validation_report_digests: string[];
  selection_proposal_input: {
    protocol: "context.indexer.selection-proposal-input/v1";
    project_ref: string;
    registry: Awaited<ReturnType<typeof observeAppliedIndexerProjectState>>["record"]["proposal"]["target_document"];
  };
  observation_digest: string;
  result_digest: string;
}

function observationInput(value: unknown): IndexerProjectObservationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer project observation input must be an object");
  }
  const input = value as Partial<IndexerProjectObservationInput>;
  if (
    input.protocol !== "context.indexer.project-observation-input/v1" ||
    typeof input.proposal_digest !== "string" ||
    typeof input.apply_receipt_digest !== "string" ||
    input.staging_validation === undefined
  ) {
    throw new TypeError("Indexer project observation input is incomplete");
  }
  return input as IndexerProjectObservationInput;
}

function sameDigests(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((digest, index) => digest === right[index]);
}

export async function observeProjectIndexerApply(input: {
  projectRoot: string;
  value: unknown;
}): Promise<IndexerProjectObservationResult> {
  const request = observationInput(input.value);
  const observed = await observeAppliedIndexerProjectState({
    projectRoot: input.projectRoot,
    proposal_digest: request.proposal_digest,
  });
  const { proposal, receipt } = observed.record;
  if (receipt.receipt_digest !== request.apply_receipt_digest) {
    throw new TypeError("Indexer project observation does not consume the exact apply receipt");
  }
  const validationReportDigests = [...await validateIndexerProjectStaging({
    proposal,
    validation: request.staging_validation,
  })].sort();
  if (!sameDigests(validationReportDigests, proposal.finalized_validation_report_digests)) {
    throw new TypeError("observed Indexer project finalized validation is stale");
  }
  const observationPayload = {
    protocol: "context.indexer.project-observation/v1" as const,
    proposal_digest: proposal.proposal_digest,
    apply_receipt_digest: receipt.receipt_digest,
    target_set_digest: observed.target_set_digest,
    requirement_set_digest: receipt.requirement_set_digest,
    registry_digest: receipt.registry_digest,
    indexer_selection_digest: receipt.indexer_selection_digest,
    validation_report_digests: validationReportDigests,
  };
  const payload = {
    protocol: "context.indexer.project-observation-result/v1" as const,
    state: "current" as const,
    proposal_digest: proposal.proposal_digest,
    apply_receipt_digest: receipt.receipt_digest,
    target_set_digest: observed.target_set_digest,
    requirement_set_digest: receipt.requirement_set_digest,
    registry_digest: receipt.registry_digest,
    indexer_selection_digest: receipt.indexer_selection_digest,
    validation_report_digests: validationReportDigests,
    selection_proposal_input: {
      protocol: "context.indexer.selection-proposal-input/v1" as const,
      project_ref: proposal.project_ref,
      registry: proposal.target_document,
    },
    observation_digest: indexerProtocolDigest(observationPayload),
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}
