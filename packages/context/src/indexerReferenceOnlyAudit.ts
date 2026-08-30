import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  INDEXER_READER_TARGET_AUTHORITATIVE_OBSERVATIONS,
  validateIndexerReaderTargetFactInventory,
  validateIndexerReaderTargetProjection,
} from "./indexerReaderTargetInventory.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const referenceOnlyMetricSchema = z.object({
  metric_id: z.literal("reference-only-reader-targets"),
  unit: z.literal("count"),
  actual: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  target_refs: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerReferenceOnlyReaderTargetAuditSchema = z.object({
  protocol: z.literal("context.indexer.reference-only-reader-target-audit/v1"),
  fact_inventory_digest: indexerDigestSchema,
  target_projection_digest: indexerDigestSchema,
  target_count: z.number().int().nonnegative(),
  authoritative_target_count: z.number().int().nonnegative(),
  reference_only_target_count: z.number().int().nonnegative(),
  unsubstantiated_target_count: z.number().int().nonnegative(),
  authoritative_target_refs: z.array(indexerCanonicalRefSchema),
  reference_only_target_refs: z.array(indexerCanonicalRefSchema),
  unsubstantiated_target_refs: z.array(indexerCanonicalRefSchema),
  metric: referenceOnlyMetricSchema,
  pass: z.boolean(),
  audit_digest: indexerDigestSchema,
}).strict();

export type IndexerReferenceOnlyReaderTargetAudit = z.infer<
  typeof indexerReferenceOnlyReaderTargetAuditSchema
>;

export function indexerReferenceOnlyReaderTargetAuditDigest(
  value: Omit<IndexerReferenceOnlyReaderTargetAudit, "audit_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerReferenceOnlyReaderTargetAudit(input: {
  fact_inventory: unknown;
  target_projection: unknown;
}): IndexerReferenceOnlyReaderTargetAudit {
  const inventory = validateIndexerReaderTargetFactInventory({
    value: input.fact_inventory,
  });
  const projection = validateIndexerReaderTargetProjection(input.target_projection);
  const authoritativeKinds = new Set<string>(
    INDEXER_READER_TARGET_AUTHORITATIVE_OBSERVATIONS,
  );
  const observationsByIdentity = new Map<string, typeof inventory.observations>();
  for (const observation of inventory.observations) {
    const current = observationsByIdentity.get(observation.canonical_identity_ref) ?? [];
    current.push(observation);
    observationsByIdentity.set(observation.canonical_identity_ref, current);
  }
  const authoritativeTargetRefs: string[] = [];
  const referenceOnlyTargetRefs: string[] = [];
  const unsubstantiatedTargetRefs: string[] = [];
  for (const target of projection.targets) {
    const observations = observationsByIdentity.get(target.canonical_identity_ref) ?? [];
    if (observations.some((item) => authoritativeKinds.has(item.observation_kind))) {
      authoritativeTargetRefs.push(target.reader_target_ref);
    } else if (observations.length > 0) {
      referenceOnlyTargetRefs.push(target.reader_target_ref);
    } else {
      unsubstantiatedTargetRefs.push(target.reader_target_ref);
    }
  }
  authoritativeTargetRefs.sort(compareIndexerCanonicalText);
  referenceOnlyTargetRefs.sort(compareIndexerCanonicalText);
  unsubstantiatedTargetRefs.sort(compareIndexerCanonicalText);
  const payload: Omit<IndexerReferenceOnlyReaderTargetAudit, "audit_digest"> = {
    protocol: "context.indexer.reference-only-reader-target-audit/v1",
    fact_inventory_digest: inventory.inventory_digest,
    target_projection_digest: projection.projection_digest,
    target_count: projection.targets.length,
    authoritative_target_count: authoritativeTargetRefs.length,
    reference_only_target_count: referenceOnlyTargetRefs.length,
    unsubstantiated_target_count: unsubstantiatedTargetRefs.length,
    authoritative_target_refs: authoritativeTargetRefs,
    reference_only_target_refs: referenceOnlyTargetRefs,
    unsubstantiated_target_refs: unsubstantiatedTargetRefs,
    metric: {
      metric_id: "reference-only-reader-targets",
      unit: "count",
      actual: referenceOnlyTargetRefs.length,
      denominator: projection.targets.length,
      target_refs: referenceOnlyTargetRefs,
    },
    pass: referenceOnlyTargetRefs.length === 0 && unsubstantiatedTargetRefs.length === 0,
  };
  return indexerReferenceOnlyReaderTargetAuditSchema.parse({
    ...payload,
    audit_digest: indexerReferenceOnlyReaderTargetAuditDigest(payload),
  });
}

export function validateIndexerReferenceOnlyReaderTargetAudit(input: {
  value: unknown;
  fact_inventory: unknown;
  target_projection: unknown;
}): IndexerReferenceOnlyReaderTargetAudit {
  const value = indexerReferenceOnlyReaderTargetAuditSchema.parse(input.value);
  const rebuilt = buildIndexerReferenceOnlyReaderTargetAudit({
    fact_inventory: input.fact_inventory,
    target_projection: input.target_projection,
  });
  if (canonicalIndexerJson(value) !== canonicalIndexerJson(rebuilt)) {
    throw new TypeError("reference-only reader target audit does not match current inputs");
  }
  return value;
}

export function assertNoReferenceOnlyReaderTargets(input: {
  value: unknown;
  fact_inventory: unknown;
  target_projection: unknown;
}): IndexerReferenceOnlyReaderTargetAudit {
  const audit = validateIndexerReferenceOnlyReaderTargetAudit(input);
  if (!audit.pass) {
    throw new TypeError(
      `reference-only-reader-targets: reference-only=${audit.reference_only_target_count}, ` +
      `unsubstantiated=${audit.unsubstantiated_target_count}`,
    );
  }
  return audit;
}
