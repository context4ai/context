import { z } from "zod";
import {
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  indexerRegistryDigests,
  indexerRegistrySchema,
  validateFinalizedIndexerRegistry,
} from "./indexerRegistry.js";

export const indexerProviderSelectionProposalInputSchema = z.object({
  protocol: z.literal("context.indexer.selection-proposal-input/v1"),
  project_ref: z.string().min(1),
  registry: indexerRegistrySchema,
}).strict();

export const indexerProviderSelectionProposalSchema = z.object({
  protocol: z.literal("context.indexer.selection-proposal/v1"),
  project_ref: z.string().min(1),
  requirement_set_digest: indexerDigestSchema,
  indexer_selection_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  registry: indexerRegistrySchema,
  proposal_digest: indexerDigestSchema,
}).strict();

export type IndexerProviderSelectionProposalInput = z.infer<
  typeof indexerProviderSelectionProposalInputSchema
>;
export type IndexerProviderSelectionProposal = z.infer<
  typeof indexerProviderSelectionProposalSchema
>;

function payload(
  value: Omit<IndexerProviderSelectionProposal, "proposal_digest">,
): Omit<IndexerProviderSelectionProposal, "proposal_digest"> {
  return value;
}

export function buildIndexerProviderSelectionProposal(
  value: unknown,
): IndexerProviderSelectionProposal {
  const input = indexerProviderSelectionProposalInputSchema.parse(value);
  validateFinalizedIndexerRegistry(input.registry);
  const digests = indexerRegistryDigests(input.registry);
  const proposal = payload({
    protocol: "context.indexer.selection-proposal/v1",
    project_ref: input.project_ref,
    requirement_set_digest: digests.requirementSetDigest,
    indexer_selection_digest: digests.indexerSelectionDigest,
    registry_digest: digests.registryDigest,
    registry: input.registry,
  });
  return indexerProviderSelectionProposalSchema.parse({
    ...proposal,
    proposal_digest: indexerProtocolDigest(proposal),
  });
}

export function validateIndexerProviderSelectionProposal(
  value: unknown,
): IndexerProviderSelectionProposal {
  const proposal = indexerProviderSelectionProposalSchema.parse(value);
  const expected = buildIndexerProviderSelectionProposal({
    protocol: "context.indexer.selection-proposal-input/v1",
    project_ref: proposal.project_ref,
    registry: proposal.registry,
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(proposal)) {
    throw new TypeError("Indexer selection proposal is stale or invalid");
  }
  return proposal;
}
