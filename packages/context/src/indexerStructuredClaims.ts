import { z } from "zod";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";

const structuredClaimOwnerSchema = z.object({
  artifact_id: indexerIdSchema,
  section_key: indexerIdSchema,
}).strict();

const structuredClaimSchema = z.object({
  claim_ref: indexerCanonicalRefSchema,
  claim_kind: indexerIdSchema,
  subject_ref: indexerCanonicalRefSchema,
  owner: structuredClaimOwnerSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerStructuredClaimSetSchema = z.object({
  protocol: z.literal("context.indexer.structured-claim-set/v1"),
  author_workset_digest: indexerDigestSchema,
  logical_unit_ref: indexerCanonicalRefSchema,
  claims: z.array(structuredClaimSchema).min(1),
  claims_digest: indexerDigestSchema,
}).strict();

export type IndexerStructuredClaimSet = z.infer<
  typeof indexerStructuredClaimSetSchema
>;

function assertCanonicalUnique(values: readonly string[], label: string): void {
  const expected = [...new Set(values)].sort(compareIndexerCanonicalText);
  if (
    expected.length !== values.length ||
    expected.some((value, index) => value !== values[index])
  ) {
    throw new TypeError(`${label} must be unique and canonically sorted`);
  }
}

function structuredClaimSetPayload(
  value: Omit<IndexerStructuredClaimSet, "claims_digest">,
): unknown {
  return value;
}

export function buildIndexerStructuredClaimSet(input: {
  author_workset_digest: string;
  logical_unit_ref: string;
  claims: readonly z.input<typeof structuredClaimSchema>[];
}): IndexerStructuredClaimSet {
  const payload = indexerStructuredClaimSetSchema.omit({ claims_digest: true }).parse({
    protocol: "context.indexer.structured-claim-set/v1",
    author_workset_digest: input.author_workset_digest,
    logical_unit_ref: input.logical_unit_ref,
    claims: input.claims,
  });
  return indexerStructuredClaimSetSchema.parse({
    ...payload,
    claims_digest: indexerProtocolDigest(structuredClaimSetPayload(payload)),
  });
}

export function validateIndexerStructuredClaimSet(input: {
  value: unknown;
  expected_author_workset_digest: string;
  expected_logical_unit_ref: string;
  authorized_subject_refs: readonly string[];
  known_evidence_refs: readonly string[];
  section_evidence_inventory: readonly {
    artifact_id: string;
    section_key: string;
    evidence_refs: readonly string[];
  }[];
}): IndexerStructuredClaimSet {
  const value = indexerStructuredClaimSetSchema.parse(input.value);
  if (
    value.author_workset_digest !== input.expected_author_workset_digest ||
    value.logical_unit_ref !== input.expected_logical_unit_ref
  ) {
    throw new TypeError("structured claim set does not match its author workset/logical unit");
  }
  if (
    value.claims_digest !== indexerProtocolDigest(structuredClaimSetPayload({
      protocol: value.protocol,
      author_workset_digest: value.author_workset_digest,
      logical_unit_ref: value.logical_unit_ref,
      claims: value.claims,
    }))
  ) {
    throw new TypeError("structured claim set digest is invalid");
  }
  assertCanonicalUnique(
    value.claims.map((claim) => claim.claim_ref),
    "structured claims.claim_ref",
  );
  const authorizedSubjects = new Set(input.authorized_subject_refs);
  const knownEvidence = new Set(input.known_evidence_refs);
  const ownerEvidence = new Map(input.section_evidence_inventory.map((section) => [
    `${section.artifact_id}\u0000${section.section_key}`,
    new Set(section.evidence_refs),
  ]));
  for (const claim of value.claims) {
    assertCanonicalUnique(claim.evidence_refs, `${claim.claim_ref}.evidence_refs`);
    if (!authorizedSubjects.has(claim.subject_ref)) {
      throw new TypeError(`structured claim ${claim.claim_ref} has an unauthorized subject`);
    }
    if (claim.evidence_refs.some((ref) => !knownEvidence.has(ref))) {
      throw new TypeError(`structured claim ${claim.claim_ref} references unknown evidence`);
    }
    const evidence = ownerEvidence.get(
      `${claim.owner.artifact_id}\u0000${claim.owner.section_key}`,
    );
    if (evidence === undefined) {
      throw new TypeError(`structured claim ${claim.claim_ref} references an unknown owner Section`);
    }
    if (claim.evidence_refs.some((ref) => !evidence.has(ref))) {
      throw new TypeError(
        `structured claim ${claim.claim_ref} evidence is not carried by its owner Section`,
      );
    }
  }
  return value;
}
