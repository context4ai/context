import { z } from "zod";
import {
  compareIndexerLayout,
  indexerLayoutChangeReportSchema,
  validateIndexerApprovedLayoutProjection,
  validateIndexerLayoutChangeReport,
} from "./indexerLayoutChange.js";
import { validateIndexerLayoutProposalSet } from "./indexerLayoutProposalSet.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const layoutTransitionPayloadSchema = z.object({
  protocol: z.literal("context.indexer.layout-transition/v1"),
  layout_proposal_set_digest: indexerDigestSchema,
  base_projection_digests: z.array(indexerDigestSchema),
  change_reports: z.array(indexerLayoutChangeReportSchema),
  requires_confirmation: z.boolean(),
  gate: z.object({
    id: z.literal("confirm-layout-change"),
    authority: z.literal("human"),
    delegation: z.literal("forbidden"),
  }).strict().nullable(),
}).strict();

export const indexerLayoutTransitionSchema = layoutTransitionPayloadSchema.extend({
  transition_digest: indexerDigestSchema,
}).strict();

export type IndexerLayoutTransition = z.infer<typeof indexerLayoutTransitionSchema>;

function transitionPayload(
  value: IndexerLayoutTransition,
): Omit<IndexerLayoutTransition, "transition_digest"> {
  const { transition_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function buildIndexerLayoutTransition(input: {
  layout_proposal_set: unknown;
  base_projections: readonly unknown[];
}): IndexerLayoutTransition {
  const proposalSet = validateIndexerLayoutProposalSet(input.layout_proposal_set);
  const bases = input.base_projections.map(validateIndexerApprovedLayoutProjection)
    .sort((left, right) => compareIndexerCanonicalText(left.projection_digest, right.projection_digest));
  const ownerByArticle = new Map<string, typeof bases[number]>();
  for (const base of bases) for (const artifact of base.artifacts) {
    if (ownerByArticle.has(artifact.artifact_ref)) throw new TypeError("Duplicate approved article identity");
    ownerByArticle.set(artifact.artifact_ref, base);
  }
  const reports = proposalSet.proposals.map(proposal => {
    // A proposal may regroup existing articles, but must never imply deletion
    // of unrelated articles just because they shared an older delivery batch.
    const artifacts = proposal.artifacts.flatMap(artifact => {
      const base = ownerByArticle.get(artifact.artifact_ref);
      const previous = base?.artifacts.find(item => item.artifact_ref === artifact.artifact_ref);
      return previous ? [previous] : [];
    }).sort((a, b) => compareIndexerCanonicalText(a.artifact_ref, b.artifact_ref));
    const payload = {
      protocol: "context.indexer.approved-layout-projection/v1" as const,
      indexer_id: proposal.indexer_id,
      profile: proposal.profile,
      profile_contract_digest: proposal.profile_contract_digest,
      shared_artifact_fingerprint: proposal.shared_artifact_fingerprint,
      artifacts: artifacts.map(artifact => ({ ...artifact,
        shared_artifact_fingerprint_digest: proposal.shared_artifact_fingerprint.fingerprint_digest })),
    };
    return compareIndexerLayout({
      base: artifacts.length ? { ...payload, projection_digest: indexerProtocolDigest(payload) } : null,
      target: proposal,
    });
  });
  const requiresConfirmation = reports.some((report) => report.requires_confirmation);
  const payload = layoutTransitionPayloadSchema.parse({
    protocol: "context.indexer.layout-transition/v1",
    layout_proposal_set_digest: proposalSet.set_digest,
    base_projection_digests: bases.map((base) => base.projection_digest)
      .sort(compareIndexerCanonicalText),
    change_reports: reports,
    requires_confirmation: requiresConfirmation,
    gate: requiresConfirmation
      ? { id: "confirm-layout-change", authority: "human", delegation: "forbidden" }
      : null,
  });
  return indexerLayoutTransitionSchema.parse({
    ...payload,
    transition_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerLayoutTransition(value: unknown): IndexerLayoutTransition {
  const transition = indexerLayoutTransitionSchema.parse(value);
  if (indexerProtocolDigest(transitionPayload(transition)) !== transition.transition_digest) {
    throw new TypeError("layout transition digest is invalid");
  }
  const requiresConfirmation = transition.change_reports.some((report) =>
    validateIndexerLayoutChangeReport(report).requires_confirmation
  );
  if (
    requiresConfirmation !== transition.requires_confirmation ||
    (requiresConfirmation ? transition.gate === null : transition.gate !== null)
  ) {
    throw new TypeError("layout transition Gate state does not close its diff reports");
  }
  const expectedBaseDigests = [...transition.base_projection_digests]
    .sort(compareIndexerCanonicalText);
  if (
    new Set(expectedBaseDigests).size !== expectedBaseDigests.length ||
    canonicalIndexerJson(expectedBaseDigests) !==
      canonicalIndexerJson(transition.base_projection_digests)
  ) {
    throw new TypeError("layout transition base projection digests are not canonical");
  }
  return transition;
}
