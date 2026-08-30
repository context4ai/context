import {
  buildIndexerAuditReport,
  buildIndexerProfileMetricAudit,
  compareIndexerCanonicalText,
  inflationSensitiveHardMaximum,
  type IndexerAuditBinding,
  type IndexerAuditReport,
  type IndexerMetricContract,
  type IndexerProfileContractEntry,
  type IndexerProfileMetricAudit,
  type IndexerProfileMetricResult,
} from "@c4a/context";
import { BUNDLED_CODE_PROFILE_IDS } from "./indexerBaseContractCatalog.js";
import {
  BUNDLED_INDEXER_METRIC_IDS,
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "./indexerBaseContracts.js";

export interface BundledIndexerMetricObservation {
  subject_ref: string;
  numerator: number;
  denominator: number;
}

export interface BundledIndexerMetricMeasurement {
  metric_id: string;
  observations: BundledIndexerMetricObservation[];
  missing_refs: string[];
}

const SUM_COUNT_OPERATORS = new Set([
  "reference-only-count",
  "ordinal-partition-count",
]);
const MAX_COUNT_OPERATORS = new Set(["discretionary-artifact-count"]);

export const BUNDLED_CODE_METRIC_REPAIR_GUIDANCE = Object.fromEntries(
  BUNDLED_INDEXER_METRIC_IDS.map((metricId) => [
    metricId,
    `bundle:context-code-indexer/references/metrics.md#${metricId}`,
  ]),
) as Readonly<Record<typeof BUNDLED_INDEXER_METRIC_IDS[number], string>>;

function assertObservation(input: {
  metric: IndexerMetricContract;
  observation: BundledIndexerMetricObservation;
}): void {
  const { metric, observation } = input;
  if (
    !observation.subject_ref.includes(":") ||
    !Number.isSafeInteger(observation.numerator) ||
    observation.numerator < 0 ||
    !Number.isSafeInteger(observation.denominator) ||
    observation.denominator < 0
  ) {
    throw new TypeError(`${metric.id} has an invalid canonical observation`);
  }
  if (metric.unit === "ratio" && observation.numerator > observation.denominator) {
    throw new TypeError(`${metric.id} ratio numerator exceeds its denominator`);
  }
}

function thresholdBoundaries(input: {
  metric: IndexerMetricContract;
  variant: IndexerProfileContractEntry["artifact_policy_variants"][number];
}): Pick<IndexerProfileMetricResult, "recommended" | "hard"> {
  const { metric, variant } = input;
  if (metric.threshold_policy === "explicit") {
    return metric.direction === "minimum"
      ? {
        recommended: { min: metric.recommended_min, max: null },
        hard: { min: metric.hard_min, max: null },
      }
      : {
        recommended: { min: null, max: metric.recommended_max },
        hard: { min: null, max: metric.hard_max },
      };
  }
  const recommendedMax = variant.thresholds[metric.id]?.recommended_max;
  if (recommendedMax === undefined) {
    throw new TypeError(
      `${variant.id} does not declare the required threshold for ${metric.id}`,
    );
  }
  return {
    recommended: { min: null, max: recommendedMax },
    hard: {
      min: null,
      max: inflationSensitiveHardMaximum(recommendedMax, metric.unit),
    },
  };
}

function metricActual(input: {
  metric: IndexerMetricContract;
  observations: readonly BundledIndexerMetricObservation[];
}): { numerator: number; denominator: number; actual: number } {
  const { metric, observations } = input;
  const denominator = observations.reduce((sum, item) => sum + item.denominator, 0);
  if (metric.unit === "ratio") {
    const numerator = observations.reduce((sum, item) => sum + item.numerator, 0);
    return {
      numerator,
      denominator,
      actual: denominator === 0
        ? metric.direction === "minimum" ? 1 : 0
        : numerator / denominator,
    };
  }
  if (SUM_COUNT_OPERATORS.has(metric.operator)) {
    const numerator = observations.reduce((sum, item) => sum + item.numerator, 0);
    return { numerator, denominator, actual: numerator };
  }
  if (MAX_COUNT_OPERATORS.has(metric.operator)) {
    const actual = observations.reduce(
      (maximum, item) => Math.max(maximum, item.numerator),
      0,
    );
    return { numerator: actual, denominator: observations.length, actual };
  }
  throw new TypeError(`no CLI count aggregation is registered for ${metric.operator}`);
}

function metricStatus(input: {
  actual: number;
  boundaries: Pick<IndexerProfileMetricResult, "recommended" | "hard">;
}): IndexerProfileMetricResult["status"] {
  const hardFailure =
    (input.boundaries.hard.min !== null && input.actual < input.boundaries.hard.min) ||
    (input.boundaries.hard.max !== null && input.actual > input.boundaries.hard.max);
  if (hardFailure) return "failed";
  const recommendedMiss =
    (input.boundaries.recommended.min !== null &&
      input.actual < input.boundaries.recommended.min) ||
    (input.boundaries.recommended.max !== null &&
      input.actual > input.boundaries.recommended.max);
  return recommendedMiss ? "warning" : "passed";
}

export function buildBundledCodeProfileMetricAudit(input: {
  profile_id: string;
  artifact_policy_variant_id: string;
  measurements: BundledIndexerMetricMeasurement[];
}): IndexerProfileMetricAudit {
  if (!BUNDLED_CODE_PROFILE_IDS.includes(
    input.profile_id as typeof BUNDLED_CODE_PROFILE_IDS[number],
  )) {
    throw new TypeError(`Code profile metric audit does not support ${input.profile_id}`);
  }
  const operators = bundledIndexerOperatorContract();
  const contract = bundledIndexerProfileContract(operators);
  const profile = contract.profiles.find((item) => item.id === input.profile_id)!;
  const variant = profile.artifact_policy_variants.find((item) =>
    item.id === input.artifact_policy_variant_id
  );
  if (variant === undefined) {
    throw new TypeError(`unknown Artifact policy variant ${input.artifact_policy_variant_id}`);
  }
  const measurements = new Map<string, BundledIndexerMetricMeasurement>();
  for (const measurement of input.measurements) {
    if (measurements.has(measurement.metric_id)) {
      throw new TypeError(`duplicate metric measurement ${measurement.metric_id}`);
    }
    measurements.set(measurement.metric_id, measurement);
  }
  const expectedMetricIds = new Set(profile.metrics.map((metric) => metric.id));
  for (const metricId of measurements.keys()) {
    if (!expectedMetricIds.has(metricId)) {
      throw new TypeError(`measurement references an unknown profile metric ${metricId}`);
    }
  }
  const metrics = profile.metrics.map((metric): IndexerProfileMetricResult => {
    const measurement = measurements.get(metric.id);
    if (measurement === undefined) {
      throw new TypeError(`missing CLI measurement for ${metric.id}`);
    }
    const subjectRefs = measurement.observations.map((item) => item.subject_ref);
    if (new Set(subjectRefs).size !== subjectRefs.length) {
      throw new TypeError(`${metric.id} observations must have unique subject refs`);
    }
    measurement.observations.forEach((observation) =>
      assertObservation({ metric, observation })
    );
    const actual = metricActual({ metric, observations: measurement.observations });
    const boundaries = thresholdBoundaries({ metric, variant });
    const guidance = BUNDLED_CODE_METRIC_REPAIR_GUIDANCE[
      metric.id as typeof BUNDLED_INDEXER_METRIC_IDS[number]
    ];
    if (guidance === undefined) {
      throw new TypeError(`missing CLI repair guidance binding for ${metric.id}`);
    }
    return {
      metric_id: metric.id,
      operator: metric.operator,
      unit: metric.unit,
      ...actual,
      ...boundaries,
      status: metricStatus({ actual: actual.actual, boundaries }),
      evidence: [...subjectRefs].sort(compareIndexerCanonicalText),
      missing: [...measurement.missing_refs].sort(compareIndexerCanonicalText),
      repair_guidance: [guidance],
    };
  });
  return buildIndexerProfileMetricAudit({
    profile_id: profile.id,
    profile_contract_digest: contract.contract_digest,
    artifact_policy_variant_id: variant.id,
    metrics,
  });
}

export function buildBundledCodePostcompileAudit(input: {
  profile_id: string;
  artifact_policy_variant_id: string;
  measurements: BundledIndexerMetricMeasurement[];
  binding: IndexerAuditBinding;
  baseline: IndexerAuditReport["baseline"];
}): {
  profile_metric_audit: IndexerProfileMetricAudit;
  audit_report: IndexerAuditReport;
} {
  const profileMetricAudit = buildBundledCodeProfileMetricAudit(input);
  return {
    profile_metric_audit: profileMetricAudit,
    audit_report: buildIndexerAuditReport({
      protocol: "context.indexer.audit/v1",
      stage: "postcompile",
      binding: input.binding,
      baseline: input.baseline,
      profile: {
        state: profileMetricAudit.failed_metric_ids.length === 0
          ? "passed"
          : "revision-required",
        failed_metric_ids: profileMetricAudit.failed_metric_ids,
        report_digest: profileMetricAudit.audit_digest,
      },
    }),
  };
}
