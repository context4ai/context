import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const INDEXER_READER_TARGET_AUTHORITATIVE_OBSERVATIONS = [
  "declaration",
  "public-export",
  "contract-declaration",
  "runtime-registration",
  "approved-subject",
  "partition-subject",
] as const;

export const INDEXER_READER_TARGET_REFERENCE_OBSERVATIONS = [
  "symbol-reference",
  "import-alias",
  "re-export-alias",
  "internal-helper-reference",
  "lightweight-evidence",
] as const;

export const INDEXER_READER_TARGET_OBSERVATION_KINDS = [
  ...INDEXER_READER_TARGET_AUTHORITATIVE_OBSERVATIONS,
  ...INDEXER_READER_TARGET_REFERENCE_OBSERVATIONS,
] as const;

const readerTargetIdentityObservationSchema = z.object({
  observation_ref: indexerCanonicalRefSchema,
  canonical_identity_ref: indexerCanonicalRefSchema,
  observation_kind: z.enum(INDEXER_READER_TARGET_OBSERVATION_KINDS),
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  content_digest: indexerDigestSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerReaderTargetFactInventorySchema = z.object({
  protocol: z.literal("context.indexer.reader-target-fact-inventory/v1"),
  source_scope_digest: indexerDigestSchema,
  observations: z.array(readerTargetIdentityObservationSchema),
  inventory_digest: indexerDigestSchema,
}).strict();

const readerTargetProjectionItemSchema = z.object({
  reader_target_ref: indexerCanonicalRefSchema,
  canonical_identity_ref: indexerCanonicalRefSchema,
  target_kind: indexerIdSchema,
  landing_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerReaderTargetProjectionSchema = z.object({
  protocol: z.literal("context.indexer.reader-target-projection/v1"),
  artifact_set_digest: indexerDigestSchema,
  targets: z.array(readerTargetProjectionItemSchema),
  projection_digest: indexerDigestSchema,
}).strict();

export type IndexerReaderTargetObservation = z.infer<
  typeof readerTargetIdentityObservationSchema
>;
export type IndexerReaderTargetFactInventory = z.infer<
  typeof indexerReaderTargetFactInventorySchema
>;
export type IndexerReaderTargetProjection = z.infer<
  typeof indexerReaderTargetProjectionSchema
>;

export interface IndexerReaderTargetObservationInput {
  canonical_identity_ref: string;
  observation_kind: typeof INDEXER_READER_TARGET_OBSERVATION_KINDS[number];
  source_ref: string;
  module_ref: string | null;
  content_digest: string;
  evidence_refs: readonly string[];
}

export interface IndexerReaderTargetProjectionInput {
  canonical_identity_ref: string;
  target_kind: string;
  landing_refs: readonly string[];
}

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate identities`);
  }
  return sorted;
}

export function indexerReaderTargetRef(canonicalIdentityRef: string): string {
  const identity = indexerCanonicalRefSchema.parse(canonicalIdentityRef);
  return `reader-target:${indexerProtocolDigest({ canonical_identity_ref: identity })}`;
}

export function indexerReaderTargetObservationRef(input: Omit<
  IndexerReaderTargetObservation,
  "observation_ref" | "evidence_refs"
>): string {
  return `reader-target-observation:${indexerProtocolDigest(input)}`;
}

export function indexerReaderTargetFactInventoryDigest(
  value: Omit<IndexerReaderTargetFactInventory, "inventory_digest">,
): string {
  return indexerProtocolDigest(value);
}

function normalizeObservation(
  input: IndexerReaderTargetObservationInput,
): IndexerReaderTargetObservation {
  const core = {
    canonical_identity_ref: indexerCanonicalRefSchema.parse(input.canonical_identity_ref),
    observation_kind: z.enum(INDEXER_READER_TARGET_OBSERVATION_KINDS).parse(
      input.observation_kind,
    ),
    source_ref: indexerCanonicalRefSchema.parse(input.source_ref),
    module_ref: input.module_ref === null
      ? null
      : indexerCanonicalRefSchema.parse(input.module_ref),
    content_digest: indexerDigestSchema.parse(input.content_digest),
  };
  return readerTargetIdentityObservationSchema.parse({
    observation_ref: indexerReaderTargetObservationRef(core),
    ...core,
    evidence_refs: canonicalUnique(
      input.evidence_refs,
      "reader target observation evidence_refs",
    ),
  });
}

export function buildIndexerReaderTargetFactInventory(input: {
  source_scope_digest: string;
  observations: readonly IndexerReaderTargetObservationInput[];
}): IndexerReaderTargetFactInventory {
  const byObservation = new Map<string, IndexerReaderTargetObservation>();
  for (const raw of input.observations) {
    const observation = normalizeObservation(raw);
    const current = byObservation.get(observation.observation_ref);
    if (current === undefined) {
      byObservation.set(observation.observation_ref, observation);
      continue;
    }
    current.evidence_refs = [...new Set([
      ...current.evidence_refs,
      ...observation.evidence_refs,
    ])].sort(compareIndexerCanonicalText);
  }
  const observations = [...byObservation.values()].sort((left, right) =>
    compareIndexerCanonicalText(left.observation_ref, right.observation_ref)
  );
  const payload: Omit<IndexerReaderTargetFactInventory, "inventory_digest"> = {
    protocol: "context.indexer.reader-target-fact-inventory/v1",
    source_scope_digest: indexerDigestSchema.parse(input.source_scope_digest),
    observations,
  };
  return indexerReaderTargetFactInventorySchema.parse({
    ...payload,
    inventory_digest: indexerReaderTargetFactInventoryDigest(payload),
  });
}

export function validateIndexerReaderTargetFactInventory(input: {
  value: unknown;
  expected_source_scope_digest?: string;
  known_evidence_refs?: readonly string[];
}): IndexerReaderTargetFactInventory {
  const value = indexerReaderTargetFactInventorySchema.parse(input.value);
  const rebuilt = buildIndexerReaderTargetFactInventory({
    source_scope_digest: value.source_scope_digest,
    observations: value.observations,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(value)) {
    throw new TypeError("reader target fact inventory is non-canonical or invalid");
  }
  if (
    input.expected_source_scope_digest !== undefined &&
    value.source_scope_digest !== input.expected_source_scope_digest
  ) {
    throw new TypeError("reader target fact inventory belongs to another source scope");
  }
  if (input.known_evidence_refs !== undefined) {
    const known = new Set(canonicalUnique(
      input.known_evidence_refs,
      "known reader target evidence refs",
    ));
    if (value.observations.some((observation) =>
      observation.evidence_refs.some((ref) => !known.has(ref))
    )) {
      throw new TypeError("reader target fact inventory references unknown evidence");
    }
  }
  return value;
}

export function indexerReaderTargetProjectionDigest(
  value: Omit<IndexerReaderTargetProjection, "projection_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerReaderTargetProjection(input: {
  artifact_set_digest: string;
  targets: readonly IndexerReaderTargetProjectionInput[];
}): IndexerReaderTargetProjection {
  const targets = input.targets.map((target) => {
    const canonicalIdentityRef = indexerCanonicalRefSchema.parse(
      target.canonical_identity_ref,
    );
    return readerTargetProjectionItemSchema.parse({
      reader_target_ref: indexerReaderTargetRef(canonicalIdentityRef),
      canonical_identity_ref: canonicalIdentityRef,
      target_kind: target.target_kind,
      landing_refs: canonicalUnique(target.landing_refs, "reader target landing_refs"),
    });
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.reader_target_ref, right.reader_target_ref)
  );
  const identities = targets.map((target) => target.canonical_identity_ref);
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("one canonical identity cannot create multiple reader targets");
  }
  const payload: Omit<IndexerReaderTargetProjection, "projection_digest"> = {
    protocol: "context.indexer.reader-target-projection/v1",
    artifact_set_digest: indexerDigestSchema.parse(input.artifact_set_digest),
    targets,
  };
  return indexerReaderTargetProjectionSchema.parse({
    ...payload,
    projection_digest: indexerReaderTargetProjectionDigest(payload),
  });
}

export function validateIndexerReaderTargetProjection(
  valueInput: unknown,
): IndexerReaderTargetProjection {
  const value = indexerReaderTargetProjectionSchema.parse(valueInput);
  const rebuilt = buildIndexerReaderTargetProjection({
    artifact_set_digest: value.artifact_set_digest,
    targets: value.targets,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(value)) {
    throw new TypeError("reader target projection is non-canonical or invalid");
  }
  return value;
}
