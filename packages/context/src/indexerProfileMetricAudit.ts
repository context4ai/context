import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const thresholdBoundarySchema = z.object({
  min: z.number().finite().nullable(),
  max: z.number().finite().nullable(),
}).strict();

export const indexerProfileMetricResultSchema = z.object({
  metric_id: indexerIdSchema,
  operator: indexerIdSchema,
  unit: z.enum(["count", "ratio"]),
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  actual: z.number().finite().nonnegative(),
  recommended: thresholdBoundarySchema,
  hard: thresholdBoundarySchema,
  status: z.enum(["passed", "warning", "failed"]),
  evidence: z.array(indexerCanonicalRefSchema),
  missing: z.array(indexerCanonicalRefSchema),
  repair_guidance: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerProfileMetricAuditSchema = z.object({
  protocol: z.literal("context.indexer.profile-metric-audit/v1"),
  profile_id: indexerIdSchema,
  profile_contract_digest: indexerDigestSchema,
  artifact_policy_variant_id: indexerIdSchema,
  metrics: z.array(indexerProfileMetricResultSchema).min(1),
  failed_metric_ids: z.array(indexerIdSchema),
  audit_digest: indexerDigestSchema,
}).strict();

export type IndexerProfileMetricResult = z.infer<
  typeof indexerProfileMetricResultSchema
>;
export type IndexerProfileMetricAudit = z.infer<
  typeof indexerProfileMetricAuditSchema
>;

function assertCanonical(values: readonly string[], label: string): void {
  const expected = [...new Set(values)].sort(compareIndexerCanonicalText);
  if (
    values.length !== expected.length ||
    values.some((value, index) => value !== expected[index])
  ) {
    throw new TypeError(`${label} must be unique and canonically sorted`);
  }
}

function expectedStatus(metric: IndexerProfileMetricResult): IndexerProfileMetricResult["status"] {
  const hardFailure =
    (metric.hard.min !== null && metric.actual < metric.hard.min) ||
    (metric.hard.max !== null && metric.actual > metric.hard.max);
  if (hardFailure) return "failed";
  const recommendedMiss =
    (metric.recommended.min !== null && metric.actual < metric.recommended.min) ||
    (metric.recommended.max !== null && metric.actual > metric.recommended.max);
  return recommendedMiss ? "warning" : "passed";
}

function validateMetric(metric: IndexerProfileMetricResult): void {
  assertCanonical(metric.evidence, `${metric.metric_id} evidence`);
  assertCanonical(metric.missing, `${metric.metric_id} missing`);
  assertCanonical(metric.repair_guidance, `${metric.metric_id} repair_guidance`);
  if (metric.unit === "ratio") {
    if (metric.actual > 1 || metric.numerator > metric.denominator) {
      throw new TypeError(`${metric.metric_id} ratio measurement is invalid`);
    }
  } else if (!Number.isSafeInteger(metric.actual)) {
    throw new TypeError(`${metric.metric_id} count actual must be a safe integer`);
  }
  const minimum = metric.recommended.min !== null || metric.hard.min !== null;
  const maximum = metric.recommended.max !== null || metric.hard.max !== null;
  if (minimum === maximum) {
    throw new TypeError(`${metric.metric_id} must have exactly one threshold direction`);
  }
  if (
    minimum && (
      metric.recommended.min === null ||
      metric.hard.min === null ||
      metric.hard.min > metric.recommended.min
    )
  ) {
    throw new TypeError(`${metric.metric_id} minimum thresholds are invalid`);
  }
  if (
    maximum && (
      metric.recommended.max === null ||
      metric.hard.max === null ||
      metric.hard.max < metric.recommended.max
    )
  ) {
    throw new TypeError(`${metric.metric_id} maximum thresholds are invalid`);
  }
  if (expectedStatus(metric) !== metric.status) {
    throw new TypeError(`${metric.metric_id} status does not match its thresholds`);
  }
}

function auditPayload(audit: IndexerProfileMetricAudit) {
  return {
    protocol: audit.protocol,
    profile_id: audit.profile_id,
    profile_contract_digest: audit.profile_contract_digest,
    artifact_policy_variant_id: audit.artifact_policy_variant_id,
    metrics: audit.metrics,
    failed_metric_ids: audit.failed_metric_ids,
  };
}

export function validateIndexerProfileMetricAudit(
  value: unknown,
): IndexerProfileMetricAudit {
  const audit = indexerProfileMetricAuditSchema.parse(value);
  assertCanonical(
    audit.metrics.map((metric) => metric.metric_id),
    "profile metric audit metrics",
  );
  audit.metrics.forEach(validateMetric);
  assertCanonical(audit.failed_metric_ids, "profile metric audit failed_metric_ids");
  const failed = audit.metrics
    .filter((metric) => metric.status === "failed")
    .map((metric) => metric.metric_id);
  if (
    failed.length !== audit.failed_metric_ids.length ||
    failed.some((metricId, index) => metricId !== audit.failed_metric_ids[index])
  ) {
    throw new TypeError("profile metric audit failed_metric_ids do not match metric status");
  }
  if (indexerProtocolDigest(auditPayload(audit)) !== audit.audit_digest) {
    throw new TypeError("profile metric audit digest is invalid");
  }
  return audit;
}

export function validateCurrentIndexerProfileMetricAudit(input: {
  audit: unknown;
  profile_id: string;
  profile_contract_digest: string;
  artifact_policy_variant_id: string;
}): IndexerProfileMetricAudit {
  const audit = validateIndexerProfileMetricAudit(input.audit);
  if (
    audit.profile_id !== input.profile_id ||
    audit.profile_contract_digest !== input.profile_contract_digest ||
    audit.artifact_policy_variant_id !== input.artifact_policy_variant_id
  ) {
    throw new TypeError("profile metric audit is stale for the current profile contract");
  }
  return audit;
}

export function buildIndexerProfileMetricAudit(input: {
  profile_id: string;
  profile_contract_digest: string;
  artifact_policy_variant_id: string;
  metrics: IndexerProfileMetricResult[];
}): IndexerProfileMetricAudit {
  const metrics = [...input.metrics]
    .map((metric) => ({
      ...metric,
      evidence: [...new Set(metric.evidence)].sort(compareIndexerCanonicalText),
      missing: [...new Set(metric.missing)].sort(compareIndexerCanonicalText),
      repair_guidance: [...new Set(metric.repair_guidance)].sort(
        compareIndexerCanonicalText,
      ),
    }))
    .sort((left, right) => compareIndexerCanonicalText(left.metric_id, right.metric_id));
  const payload = {
    protocol: "context.indexer.profile-metric-audit/v1" as const,
    profile_id: input.profile_id,
    profile_contract_digest: input.profile_contract_digest,
    artifact_policy_variant_id: input.artifact_policy_variant_id,
    metrics,
    failed_metric_ids: metrics
      .filter((metric) => metric.status === "failed")
      .map((metric) => metric.metric_id),
  };
  return validateIndexerProfileMetricAudit({
    ...payload,
    audit_digest: indexerProtocolDigest(payload),
  });
}
