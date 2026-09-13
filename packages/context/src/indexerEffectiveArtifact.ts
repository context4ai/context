import { z } from "zod";
import { indexerArtifactReferences, type IndexerArtifact } from "./indexerArtifact.js";
import {
  buildIndexerArtifactBundle,
  type IndexerArtifactBundle,
} from "./indexerArtifactPolicy.js";
import {
  indexerMaterializedLayerFragmentSchema,
  validateIndexerMaterializedLayerFragment,
} from "./indexerLayerComposition.js";
import {
  indexerComposerRefSchema,
  indexerDigestSchema,
  indexerProtocolDigest,
  indexerProviderLayerRefSchema,
} from "./indexerProtocolCommon.js";
import { validateIndexerPrimaryArtifactResult } from "./indexerPrimaryResultView.js";

export const indexerComposerInvocationReceiptSchema = z.object({
  protocol: z.literal("context.indexer.composer-invocation-receipt/v1"),
  composer_ref: indexerComposerRefSchema,
  composer_selection_entry_digest: indexerDigestSchema,
  layer_ref: indexerProviderLayerRefSchema,
  layer_integrity: indexerDigestSchema,
  request_digest: indexerDigestSchema,
  primary_result_view_digest: indexerDigestSchema,
  consumed_primary_result_view_digest: indexerDigestSchema,
  result_digest: indexerDigestSchema,
  fragment_digests: z.array(indexerDigestSchema),
}).strict();

export type IndexerComposerInvocationReceipt = z.infer<
  typeof indexerComposerInvocationReceiptSchema
>;

export const indexerComposedResultEnvelopeSchema = z.object({
  protocol: z.literal("context.indexer.composed-result-envelope/v1"),
  workset_digest: indexerDigestSchema,
  primary_result_digest: indexerDigestSchema,
  primary_result_view_digest: indexerDigestSchema,
  accepted_input_view_digest: indexerDigestSchema,
  effective_composer_set_digest: indexerDigestSchema,
  accepted_post_author_fragments: z.array(indexerMaterializedLayerFragmentSchema),
  composer_invocation_receipts: z.array(indexerComposerInvocationReceiptSchema),
  composition_fingerprint: indexerDigestSchema,
}).strict();

export type IndexerComposedResultEnvelope = z.infer<
  typeof indexerComposedResultEnvelopeSchema
>;

export interface IndexerEffectiveArtifactSet {
  artifacts: IndexerArtifact[];
  artifact_bundle: IndexerArtifactBundle | null;
  composition_fingerprint: string | null;
}

function validateComposedEnvelopeFingerprint(
  envelope: IndexerComposedResultEnvelope,
): void {
  const fingerprint = indexerProtocolDigest({
    workset_digest: envelope.workset_digest,
    primary_result_digest: envelope.primary_result_digest,
    accepted_input_view_digest: envelope.accepted_input_view_digest,
    effective_composer_set_digest: envelope.effective_composer_set_digest,
    primary_result_view_digest: envelope.primary_result_view_digest,
    composer_invocation_receipts: envelope.composer_invocation_receipts,
    accepted_post_author_fragments: envelope.accepted_post_author_fragments,
  });
  if (fingerprint !== envelope.composition_fingerprint) {
    throw new TypeError("post-author envelope composition fingerprint is invalid");
  }
}

export function materializeIndexerEffectiveArtifactSet(input: {
  artifact_result: unknown;
  post_author_envelope?: unknown | null;
}): IndexerEffectiveArtifactSet {
  const result = validateIndexerPrimaryArtifactResult(input.artifact_result);
  if (input.post_author_envelope === undefined || input.post_author_envelope === null) {
    return {
      artifacts: [...result.artifacts],
      artifact_bundle: result.artifact_bundle,
      composition_fingerprint: null,
    };
  }
  const envelope = indexerComposedResultEnvelopeSchema.parse(input.post_author_envelope);
  validateComposedEnvelopeFingerprint(envelope);
  if (
    envelope.workset_digest !== result.author_workset_digest ||
    envelope.primary_result_digest !== indexerProtocolDigest(result)
  ) {
    throw new TypeError("post-author envelope is bound to another accepted ArtifactResult");
  }
  const primaryReferences = new Set(result.artifacts.flatMap(indexerArtifactReferences).map(ref => JSON.stringify(ref)));
  const proposals = envelope.accepted_post_author_fragments.flatMap((fragment) => {
    const materialized = validateIndexerMaterializedLayerFragment(fragment);
    if (
      materialized.kind !== "derived-artifact-proposal" ||
      materialized.payload.protocol !==
        "context.indexer.fragment.derived-artifact-proposal/v1"
    ) {
      throw new TypeError("post-author envelope contains a non-derived fragment");
    }
    return materialized.payload.proposals.map((proposal) => {
      if (
        proposal.composer_ref !== materialized.composer_ref ||
        proposal.target_node_ref !== result.logical_unit.logical_unit_ref
      ) {
        throw new TypeError("derived Artifact proposal targets another composer or Node");
      }
      if (indexerArtifactReferences(proposal.artifact).some(ref => !primaryReferences.has(JSON.stringify(ref)))) {
        throw new TypeError("Derived article uses a source region outside the accepted primary articles");
      }
      const projections = proposal.artifact.representation === "sections"
        ? proposal.artifact.sections
        : proposal.artifact.section_projections;
      if (projections.some((projection) =>
        projection.owner_indexer_id !== result.indexer_id ||
        projection.artifact_kind !== proposal.artifact.artifact_kind
      )) {
        throw new TypeError("derived Artifact proposal changes Section owner or kind");
      }
      return proposal;
    });
  });
  const artifacts = [
    ...result.artifacts,
    ...proposals.map((proposal) => proposal.artifact),
  ];
  if (new Set(artifacts.map((artifact) => artifact.artifact_id)).size !== artifacts.length) {
    throw new TypeError("derived Artifact proposal collides with another Artifact identity");
  }
  const primaryVariant = result.artifact_bundle?.artifact_policy_variant;
  const variants = new Set(artifacts.map((artifact) => artifact.artifact_policy_variant));
  if (
    variants.size !== 1 ||
    (primaryVariant !== undefined && !variants.has(primaryVariant))
  ) {
    throw new TypeError("derived Artifact proposal changes the primary Artifact policy variant");
  }
  const baseEntries = result.artifact_bundle?.artifacts ?? [];
  const artifactBundle = artifacts.length === 0
    ? null
    : buildIndexerArtifactBundle({
        logical_unit_ref: result.logical_unit.logical_unit_ref,
        artifact_policy_variant: [...variants][0]!,
        artifacts: [
          ...baseEntries,
          ...proposals.map((proposal) => ({
            artifact_id: proposal.artifact.artifact_id,
            artifact_kind: proposal.artifact.artifact_kind,
            purpose: "discretionary" as const,
            reader_question_refs: [],
          })),
        ],
      });
  return {
    artifacts,
    artifact_bundle: artifactBundle,
    composition_fingerprint: envelope.composition_fingerprint,
  };
}
