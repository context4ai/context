import { z } from "zod";
import {
  indexerLayoutProposalSchema,
  type IndexerLayoutProposal,
} from "./indexerLayoutResolver.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { validateIndexerSharedArtifactFingerprint } from
  "./indexerSharedArtifactFingerprint.js";

const layoutProposalSetPayloadSchema = z.object({
  protocol: z.literal("context.indexer.layout-proposal-set/v1"),
  subject_key_schema_set_digest: indexerDigestSchema,
  proposals: z.array(indexerLayoutProposalSchema).min(1),
}).strict();

export const indexerLayoutProposalSetSchema = layoutProposalSetPayloadSchema.extend({
  set_digest: indexerDigestSchema,
}).strict();

export type IndexerLayoutProposalSet = z.infer<typeof indexerLayoutProposalSetSchema>;

function proposalPayload(
  value: IndexerLayoutProposal,
): Omit<IndexerLayoutProposal, "proposal_digest"> {
  const { proposal_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function validateProposalDigest(value: unknown): IndexerLayoutProposal {
  const proposal = indexerLayoutProposalSchema.parse(value);
  if (indexerProtocolDigest(proposalPayload(proposal)) !== proposal.proposal_digest) {
    throw new TypeError("layout proposal set contains an invalid proposal digest");
  }
  const sharedFingerprint = validateIndexerSharedArtifactFingerprint(
    proposal.shared_artifact_fingerprint,
  );
  if (
    sharedFingerprint.indexer_id !== proposal.indexer_id ||
    proposal.artifacts.some((artifact) =>
      artifact.shared_artifact_fingerprint_digest !==
        sharedFingerprint.fingerprint_digest
    )
  ) {
    throw new TypeError("layout proposal Artifacts do not share one Indexer fingerprint");
  }
  const artifacts = new Map(proposal.artifacts.map((artifact) => [
    artifact.artifact_ref,
    artifact,
  ]));
  for (const artifact of proposal.artifacts) {
    if (artifact.purpose === "semantic-split") {
      const parent = artifact.split_of_artifact_ref === null
        ? undefined
        : artifacts.get(artifact.split_of_artifact_ref);
      if (
        artifact.split_of_artifact_ref === null ||
        artifact.split_boundary === null ||
        artifact.split_of_artifact_ref === artifact.artifact_ref ||
        parent === undefined ||
        parent.purpose === "semantic-split" ||
        parent.artifact_kind !== artifact.artifact_kind ||
        compareIndexerCanonicalText(
          artifact.split_boundary.start_key,
          artifact.split_boundary.end_key,
        ) > 0
      ) {
        throw new TypeError("semantic-split layout Artifact has invalid parent lineage");
      }
    } else if (
      artifact.split_of_artifact_ref !== null ||
      artifact.split_boundary !== null
    ) {
      throw new TypeError("non-split layout Artifact must not declare split lineage");
    }
  }
  return proposal;
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`layout proposal set has conflicting ${field}`);
  }
}

export function buildIndexerLayoutProposalSet(
  values: readonly unknown[],
): IndexerLayoutProposalSet {
  const proposals = values.map(validateProposalDigest).sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.node.node_ref}\u0000${left.indexer_id}\u0000${left.proposal_digest}`,
      `${right.node.node_ref}\u0000${right.indexer_id}\u0000${right.proposal_digest}`,
    )
  );
  if (proposals.length === 0) {
    throw new TypeError("layout proposal set must contain at least one proposal");
  }
  const schemaDigests = new Set(
    proposals.map((proposal) => proposal.subject_key_schema_set_digest),
  );
  if (schemaDigests.size !== 1) {
    throw new TypeError("layout proposal set mixes SubjectKey schema authorities");
  }
  assertUnique(proposals.map((proposal) => proposal.proposal_digest), "proposal digests");
  assertUnique(proposals.map((proposal) => proposal.node.node_ref), "Node ownership");
  const fingerprintByIndexer = new Map<string, string>();
  for (const proposal of proposals) {
    const fingerprint = proposal.shared_artifact_fingerprint.fingerprint_digest;
    const current = fingerprintByIndexer.get(proposal.indexer_id);
    if (current !== undefined && current !== fingerprint) {
      throw new TypeError("layout proposal set mixes fingerprints for the same Indexer");
    }
    fingerprintByIndexer.set(proposal.indexer_id, fingerprint);
  }
  assertUnique(
    proposals.flatMap((proposal) => proposal.artifacts.map((artifact) => artifact.artifact_ref)),
    "Artifact identities",
  );
  assertUnique(
    proposals.flatMap((proposal) => proposal.artifacts.map((artifact) => artifact.output_path)),
    "Artifact output paths",
  );
  assertUnique(
    proposals.flatMap((proposal) => proposal.artifacts.flatMap((artifact) =>
      artifact.sections.map((section) => section.section_ref)
    )),
    "Section placements",
  );
  assertUnique(
    proposals.flatMap((proposal) => proposal.artifacts.flatMap((artifact) =>
      artifact.sections.map((section) => section.section_identity_ref)
    )),
    "logical Section identities",
  );
  const payload = layoutProposalSetPayloadSchema.parse({
    protocol: "context.indexer.layout-proposal-set/v1",
    subject_key_schema_set_digest: proposals[0]!.subject_key_schema_set_digest,
    proposals,
  });
  return indexerLayoutProposalSetSchema.parse({
    ...payload,
    set_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerLayoutProposalSet(value: unknown): IndexerLayoutProposalSet {
  const parsed = indexerLayoutProposalSetSchema.parse(value);
  const expected = buildIndexerLayoutProposalSet(parsed.proposals);
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(parsed)) {
    throw new TypeError("layout proposal set is stale or forged");
  }
  return parsed;
}
