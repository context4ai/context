import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerProviderResolutionActionInput,
  buildIndexerProviderSelectionProposal,
  canonicalIndexerJson,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerProviderSelectionProposal,
  type IndexerProviderSelectionProposal,
  type IndexerProviderResolutionActionInput,
} from "@c4a/context";
import {
  validateIndexerSelectionStatic,
  type IndexerSelectionStaticReport,
} from "./indexerSelectionValidation.js";

export interface IndexerSelectionProposalValidation {
  protocol: "context.indexer.selection-proposal-validation/v1";
  proposal: IndexerProviderSelectionProposal;
  static_report: IndexerSelectionStaticReport;
  outcome: "provider-resolution-required";
  next_provider_requests: IndexerSelectionStaticReport["provider_requests"];
  resolution_requests: IndexerProviderResolutionActionInput[];
  validation_digest: string;
}

function validateCurrentRequirements(input: {
  currentRequirementDigest: string;
  currentRequirements: unknown;
  proposal: IndexerProviderSelectionProposal;
}): void {
  if (
    input.currentRequirementDigest !== input.proposal.requirement_set_digest ||
    canonicalIndexerJson(input.currentRequirements) !==
      canonicalIndexerJson(input.proposal.registry.requirements)
  ) {
    throw new TypeError(
      "Indexer selection proposal cannot modify or target stale requirements",
    );
  }
}

export async function validateProjectIndexerSelectionProposal(input: {
  projectRoot: string;
  value: unknown;
}): Promise<IndexerSelectionProposalValidation> {
  const current = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const valueIsRecord = input.value !== null &&
    typeof input.value === "object" &&
    !Array.isArray(input.value);
  const proposal = valueIsRecord &&
      (input.value as { protocol?: unknown }).protocol ===
        "context.indexer.selection-proposal/v1"
    ? validateIndexerProviderSelectionProposal(input.value)
    : buildIndexerProviderSelectionProposal(input.value);
  const currentDigests = indexerRegistryDigests(current);
  validateCurrentRequirements({
    currentRequirementDigest: currentDigests.requirementSetDigest,
    currentRequirements: current.requirements,
    proposal,
  });
  const staticReport = validateIndexerSelectionStatic(proposal.registry);
  const resolutionRequests = staticReport.provider_requests.map((request) =>
    buildIndexerProviderResolutionActionInput({
      protocol: "context.indexer.resolve-provider-input/v1",
      project_ref: proposal.project_ref,
      selection_proposal_digest: proposal.proposal_digest,
      static_report_digest: staticReport.report_digest,
      provider: {
        indexer_id: request.indexer_id,
        provider_id: request.provider_id,
        skill: request.skill,
        version: request.version,
        integrity: request.integrity,
        distribution: request.distribution,
      },
    })
  );
  const result: Omit<IndexerSelectionProposalValidation, "validation_digest"> = {
    protocol: "context.indexer.selection-proposal-validation/v1",
    proposal,
    static_report: staticReport,
    outcome: "provider-resolution-required",
    next_provider_requests: staticReport.provider_requests,
    resolution_requests: resolutionRequests,
  };
  return { ...result, validation_digest: indexerProtocolDigest(result) };
}
