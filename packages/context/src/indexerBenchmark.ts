import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const sourceSnapshotSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  commit_or_tree_digest: indexerDigestSchema,
  scope_digest: indexerDigestSchema,
}).strict();

const benchmarkToolchainSchema = z.object({
  context_cli: z.string().trim().min(1),
  contract_digest: indexerDigestSchema,
  parser_set_digest: indexerDigestSchema,
}).strict();

const benchmarkManifestPayloadSchema = z.object({
  protocol: z.literal("context.indexer.benchmark-manifest/v1"),
  workload_id: indexerIdSchema,
  source_snapshots: z.array(sourceSnapshotSchema).min(1),
  requirement_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  toolchain: benchmarkToolchainSchema,
  capture_command_digest: indexerDigestSchema,
  oracle_ref: indexerCanonicalRefSchema,
}).strict();

export const indexerBenchmarkManifestSchema = benchmarkManifestPayloadSchema.extend({
  manifest_digest: indexerDigestSchema,
}).strict();

const profileComposerEntrySchema = z.object({
  module_ref: indexerCanonicalRefSchema,
  primary_profile_ref: indexerCanonicalRefSchema,
  additional_profile_refs: z.array(indexerCanonicalRefSchema),
  composer_refs: z.array(indexerCanonicalRefSchema),
}).strict();

const inventoryObservationSchema = z.object({
  inventory_ref: indexerCanonicalRefSchema,
  item_ref: indexerCanonicalRefSchema,
  disposition: z.enum([
    "owned",
    "excluded-with-reason",
    "unsupported",
    "request-material",
  ]),
}).strict();

const inventorySummaryEntrySchema = z.object({
  inventory_ref: indexerCanonicalRefSchema,
  total_count: z.number().int().nonnegative(),
  dispositions: z.object({
    owned: z.number().int().nonnegative(),
    excluded_with_reason: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    request_material: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const inventorySummarySchema = z.object({
  total_count: z.number().int().nonnegative(),
  inventories: z.array(inventorySummaryEntrySchema),
}).strict();

const artifactObservationSchema = z.object({
  logical_unit_ref: indexerCanonicalRefSchema,
  bundle_digest: indexerDigestSchema,
  artifact_ref: indexerCanonicalRefSchema,
  purpose: z.enum(["required", "discretionary", "semantic-split"]),
  split_of: indexerCanonicalRefSchema.nullable(),
  readability_advisory: z.boolean(),
}).strict();

const artifactSummarySchema = z.object({
  logical_unit_count: z.number().int().nonnegative(),
  bundle_count: z.number().int().nonnegative(),
  artifact_count: z.number().int().nonnegative(),
  semantic_split_count: z.number().int().nonnegative(),
  readability_advisory_count: z.number().int().nonnegative(),
}).strict();

const directoryDifferenceSchema = z.object({
  difference_ref: indexerCanonicalRefSchema,
  kind: z.enum(["missing", "unexpected", "relocated"]),
  expected_path: portableIndexerPathSchema.nullable(),
  actual_path: portableIndexerPathSchema.nullable(),
  reason_code: indexerIdSchema,
}).strict();

const pageDeviationInputSchema = z.object({
  expected_min: z.number().int().nonnegative().nullable(),
  expected_max: z.number().int().nonnegative().nullable(),
  actual_count: z.number().int().nonnegative(),
  reason_codes: z.array(indexerIdSchema),
}).strict();

const pageDeviationSchema = pageDeviationInputSchema.extend({
  state: z.enum(["not-estimated", "below", "within", "above"]),
}).strict();

const qualityNegativeSampleSchema = z.object({
  category: z.enum([
    "missing",
    "duplicate",
    "placeholder",
    "representative-only-coverage",
    "fabricated-call-chain",
  ]),
  sample_ref: indexerCanonicalRefSchema,
  disposition: z.enum(["cleared", "review-required", "blocking"]),
}).strict();

const reviewDecisionSchema = z.object({
  report_ref: indexerCanonicalRefSchema,
  decision: z.enum(["pending", "approved", "approved-with-changes", "rejected"]),
}).strict();

const materialGapEntrySchema = z.object({
  category: indexerIdSchema,
  required_evidence_kinds: z.array(indexerIdSchema),
  resolved_count: z.number().int().nonnegative(),
  unresolved_question_refs: z.array(indexerCanonicalRefSchema),
}).strict();

const providerConfigurationEntrySchema = z.object({
  module_ref: indexerCanonicalRefSchema,
  indexer_ref: indexerCanonicalRefSchema,
  provider_identity: indexerCanonicalRefSchema,
  provider_version: z.string().trim().min(1),
  provider_integrity: indexerDigestSchema,
  config_fingerprint: indexerDigestSchema,
  customization_reason: z.string().trim().min(1).nullable(),
}).strict();

const localCustomizationBurdenSchema = z.object({
  file_count: z.number().int().nonnegative(),
  covered_resource_refs: z.array(indexerCanonicalRefSchema),
  affected_artifact_refs: z.array(indexerCanonicalRefSchema),
  repeated_logic_candidate: z.boolean(),
}).strict();

const metricObservationSchema = z.object({
  metric_id: indexerIdSchema,
  numerator: z.number().finite().nonnegative(),
  denominator: z.number().finite().positive().nullable(),
  status: z.enum(["passed", "warning", "failed"]),
  evidence_refs: z.array(indexerCanonicalRefSchema),
}).strict();

const metricResultSchema = metricObservationSchema.extend({
  observed_value: z.number().finite().nonnegative(),
}).strict();

const oracleDifferenceSchema = z.object({
  difference_ref: indexerCanonicalRefSchema,
  category: indexerIdSchema,
  expected_digest: indexerDigestSchema.nullable(),
  actual_digest: indexerDigestSchema.nullable(),
  severity: z.enum(["advisory", "blocking"]),
}).strict();

const benchmarkOverrideSchema = z.object({
  state: z.enum(["none", "human-approved"]),
  approval_ref: indexerCanonicalRefSchema.nullable(),
  reason: z.string().trim().min(1).nullable(),
}).strict();

export const indexerBenchmarkObservationSchema = z.object({
  result_fingerprint: indexerDigestSchema,
  profile_composer_summary: z.array(profileComposerEntrySchema).min(1),
  inventory_items: z.array(inventoryObservationSchema),
  artifacts: z.array(artifactObservationSchema),
  directory_differences: z.array(directoryDifferenceSchema),
  page_deviation: pageDeviationInputSchema,
  quality_negative_samples: z.array(qualityNegativeSampleSchema),
  review_decision: reviewDecisionSchema,
  material_gaps: z.array(materialGapEntrySchema),
  provider_configuration: z.array(providerConfigurationEntrySchema).min(1),
  local_customization_burden: localCustomizationBurdenSchema,
  metrics: z.array(metricObservationSchema),
}).strict();

const benchmarkReportPayloadSchema = z.object({
  protocol: z.literal("context.indexer.benchmark-report/v1"),
  workload_id: indexerIdSchema,
  manifest_digest: indexerDigestSchema,
  result_fingerprint: indexerDigestSchema,
  profile_composer_summary: z.array(profileComposerEntrySchema).min(1),
  inventory_summary: inventorySummarySchema,
  artifact_summary: artifactSummarySchema,
  directory_differences: z.array(directoryDifferenceSchema),
  page_deviation: pageDeviationSchema,
  quality_negative_samples: z.array(qualityNegativeSampleSchema),
  review_decision: reviewDecisionSchema,
  material_gaps: z.array(materialGapEntrySchema),
  provider_configuration: z.array(providerConfigurationEntrySchema).min(1),
  local_customization_burden: localCustomizationBurdenSchema,
  metric_results: z.array(metricResultSchema),
  oracle_differences: z.array(oracleDifferenceSchema),
  override_state: z.enum(["none", "human-approved"]),
  override_approval_ref: indexerCanonicalRefSchema.nullable(),
  override_reason: z.string().trim().min(1).nullable(),
  conformance: z.enum(["automatic-pass", "human-exempt", "nonconformant"]),
}).strict();

export const indexerBenchmarkReportSchema = benchmarkReportPayloadSchema.extend({
  report_digest: indexerDigestSchema,
}).strict();

export const indexerBenchmarkCurrentAuthoritySchema = z.object({
  source_snapshots: z.array(sourceSnapshotSchema).min(1),
  requirement_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  toolchain: benchmarkToolchainSchema,
  capture_command_digest: indexerDigestSchema,
  mounted_agent_resource_refs: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerBenchmarkOracleEvaluationSchema = z.object({
  oracle_ref: indexerCanonicalRefSchema,
  differences: z.array(oracleDifferenceSchema),
}).strict();

export type IndexerBenchmarkManifest = z.infer<typeof indexerBenchmarkManifestSchema>;
export type IndexerBenchmarkObservation = z.infer<typeof indexerBenchmarkObservationSchema>;
export type IndexerBenchmarkReport = z.infer<typeof indexerBenchmarkReportSchema>;
export type IndexerBenchmarkCurrentAuthority = z.infer<
  typeof indexerBenchmarkCurrentAuthoritySchema
>;
export type IndexerBenchmarkOracleEvaluation = z.infer<
  typeof indexerBenchmarkOracleEvaluationSchema
>;

function sortedUnique<T>(
  values: readonly T[],
  identity: (value: T) => string,
  label: string,
): T[] {
  const sorted = [...values].sort((left, right) =>
    compareIndexerCanonicalText(identity(left), identity(right))
  );
  if (new Set(sorted.map(identity)).size !== sorted.length) {
    throw new TypeError(`${label} must contain unique identities`);
  }
  return sorted;
}

function sortedRefs(values: readonly string[], label: string): string[] {
  return sortedUnique(values, (value) => value, label);
}

function manifestPayload(
  value: IndexerBenchmarkManifest,
): Omit<IndexerBenchmarkManifest, "manifest_digest"> {
  const { manifest_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function buildIndexerBenchmarkManifest(
  input: z.input<typeof benchmarkManifestPayloadSchema>,
): IndexerBenchmarkManifest {
  const parsed = benchmarkManifestPayloadSchema.parse(input);
  const payload = benchmarkManifestPayloadSchema.parse({
    ...parsed,
    source_snapshots: sortedUnique(
      parsed.source_snapshots,
      (item) => item.source_ref,
      "benchmark source snapshots",
    ),
  });
  return indexerBenchmarkManifestSchema.parse({
    ...payload,
    manifest_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerBenchmarkManifest(value: unknown): IndexerBenchmarkManifest {
  const manifest = indexerBenchmarkManifestSchema.parse(value);
  const rebuilt = buildIndexerBenchmarkManifest(manifestPayload(manifest));
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(manifest)) {
    throw new TypeError("benchmark manifest is non-canonical or has an invalid digest");
  }
  return manifest;
}

export function validateCurrentIndexerBenchmarkManifest(input: {
  value: unknown;
  current_authority: unknown;
}): IndexerBenchmarkManifest {
  const manifest = validateIndexerBenchmarkManifest(input.value);
  const current = indexerBenchmarkCurrentAuthoritySchema.parse(input.current_authority);
  const snapshots = sortedUnique(
    current.source_snapshots,
    (item) => item.source_ref,
    "current benchmark source snapshots",
  );
  const expected = {
    source_snapshots: snapshots,
    requirement_digest: current.requirement_digest,
    registry_digest: current.registry_digest,
    toolchain: current.toolchain,
    capture_command_digest: current.capture_command_digest,
  };
  const observed = {
    source_snapshots: manifest.source_snapshots,
    requirement_digest: manifest.requirement_digest,
    registry_digest: manifest.registry_digest,
    toolchain: manifest.toolchain,
    capture_command_digest: manifest.capture_command_digest,
  };
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(observed)) {
    throw new TypeError("benchmark manifest source/toolchain authority is stale");
  }
  const mounted = sortedRefs(
    current.mounted_agent_resource_refs,
    "mounted Agent resources",
  );
  if (mounted.includes(manifest.oracle_ref)) {
    throw new TypeError("benchmark oracle must not be mounted in the execution Agent workspace");
  }
  return manifest;
}

function canonicalProfiles(
  values: readonly z.infer<typeof profileComposerEntrySchema>[],
): z.infer<typeof profileComposerEntrySchema>[] {
  return sortedUnique(values.map((entry) => ({
    ...entry,
    additional_profile_refs: sortedRefs(
      entry.additional_profile_refs,
      `${entry.module_ref} additional profiles`,
    ),
    composer_refs: sortedRefs(entry.composer_refs, `${entry.module_ref} composers`),
  })), (entry) => entry.module_ref, "benchmark profile/composer modules");
}

function inventorySummary(
  items: readonly z.infer<typeof inventoryObservationSchema>[],
): z.infer<typeof inventorySummarySchema> {
  const canonical = sortedUnique(
    items,
    (item) => `${item.inventory_ref}\u0000${item.item_ref}`,
    "benchmark inventory items",
  );
  const grouped = new Map<string, typeof canonical>();
  for (const item of canonical) {
    const current = grouped.get(item.inventory_ref) ?? [];
    current.push(item);
    grouped.set(item.inventory_ref, current);
  }
  return {
    total_count: canonical.length,
    inventories: [...grouped.entries()].map(([inventoryRef, entries]) => ({
      inventory_ref: inventoryRef,
      total_count: entries.length,
      dispositions: {
        owned: entries.filter((item) => item.disposition === "owned").length,
        excluded_with_reason: entries.filter((item) =>
          item.disposition === "excluded-with-reason"
        ).length,
        unsupported: entries.filter((item) => item.disposition === "unsupported").length,
        request_material: entries.filter((item) =>
          item.disposition === "request-material"
        ).length,
      },
    })),
  };
}

function artifactSummary(
  artifacts: readonly z.infer<typeof artifactObservationSchema>[],
): z.infer<typeof artifactSummarySchema> {
  const canonical = sortedUnique(
    artifacts,
    (item) => `${item.bundle_digest}\u0000${item.artifact_ref}`,
    "benchmark Artifacts",
  );
  for (const artifact of canonical) {
    if ((artifact.purpose === "semantic-split") !== (artifact.split_of !== null)) {
      throw new TypeError("benchmark semantic split must have exactly one split_of identity");
    }
  }
  return {
    logical_unit_count: new Set(canonical.map((item) => item.logical_unit_ref)).size,
    bundle_count: new Set(canonical.map((item) => item.bundle_digest)).size,
    artifact_count: canonical.length,
    semantic_split_count: canonical.filter((item) => item.purpose === "semantic-split").length,
    readability_advisory_count: canonical.filter((item) => item.readability_advisory).length,
  };
}

function pageDeviation(
  input: z.infer<typeof pageDeviationInputSchema>,
): z.infer<typeof pageDeviationSchema> {
  const reasons = sortedRefs(input.reason_codes, "benchmark page deviation reasons");
  if ((input.expected_min === null) !== (input.expected_max === null)) {
    throw new TypeError("benchmark page estimate must provide both bounds or neither");
  }
  if (input.expected_min === null || input.expected_max === null) {
    return { ...input, reason_codes: reasons, state: "not-estimated" };
  }
  if (input.expected_min > input.expected_max) {
    throw new TypeError("benchmark page estimate minimum exceeds maximum");
  }
  const state = input.actual_count < input.expected_min
    ? "below" as const
    : input.actual_count > input.expected_max
    ? "above" as const
    : "within" as const;
  if (state !== "within" && reasons.length === 0) {
    throw new TypeError("benchmark page deviation requires a factual reason");
  }
  return { ...input, reason_codes: reasons, state };
}

function metricResults(
  values: readonly z.infer<typeof metricObservationSchema>[],
): z.infer<typeof metricResultSchema>[] {
  return sortedUnique(values.map((metric) => ({
    ...metric,
    evidence_refs: sortedRefs(metric.evidence_refs, `${metric.metric_id} evidence`),
    observed_value: metric.denominator === null
      ? metric.numerator
      : metric.numerator / metric.denominator,
  })), (metric) => metric.metric_id, "benchmark metrics");
}

function conformance(input: {
  observation: IndexerBenchmarkObservation;
  oracleDifferences: readonly z.infer<typeof oracleDifferenceSchema>[];
  override: z.infer<typeof benchmarkOverrideSchema>;
}): "automatic-pass" | "human-exempt" | "nonconformant" {
  if (input.override.state === "human-approved") return "human-exempt";
  const blocked = input.observation.quality_negative_samples.some((item) =>
    item.disposition === "blocking"
  ) || input.observation.review_decision.decision === "pending" ||
    input.observation.review_decision.decision === "rejected" ||
    input.observation.material_gaps.some((item) =>
      item.unresolved_question_refs.length > 0
    ) || input.observation.metrics.some((item) => item.status === "failed") ||
    input.oracleDifferences.some((item) => item.severity === "blocking");
  return blocked ? "nonconformant" : "automatic-pass";
}

function reportPayload(
  value: IndexerBenchmarkReport,
): Omit<IndexerBenchmarkReport, "report_digest"> {
  const { report_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function buildIndexerBenchmarkReport(input: {
  manifest: unknown;
  observation: unknown;
  oracle_evaluation: unknown;
  override: unknown;
}): IndexerBenchmarkReport {
  const manifest = validateIndexerBenchmarkManifest(input.manifest);
  const observation = indexerBenchmarkObservationSchema.parse(input.observation);
  const oracle = indexerBenchmarkOracleEvaluationSchema.parse(input.oracle_evaluation);
  const override = benchmarkOverrideSchema.parse(input.override);
  if (oracle.oracle_ref !== manifest.oracle_ref) {
    throw new TypeError("benchmark oracle evaluation belongs to another manifest");
  }
  if (
    (override.state === "none" &&
      (override.approval_ref !== null || override.reason !== null)) ||
    (override.state === "human-approved" &&
      (override.approval_ref === null || override.reason === null))
  ) {
    throw new TypeError("benchmark override state must be explicit and fully authorized");
  }
  const oracleDifferences = sortedUnique(
    oracle.differences,
    (item) => item.difference_ref,
    "benchmark oracle differences",
  );
  const payload = benchmarkReportPayloadSchema.parse({
    protocol: "context.indexer.benchmark-report/v1",
    workload_id: manifest.workload_id,
    manifest_digest: manifest.manifest_digest,
    result_fingerprint: observation.result_fingerprint,
    profile_composer_summary: canonicalProfiles(observation.profile_composer_summary),
    inventory_summary: inventorySummary(observation.inventory_items),
    artifact_summary: artifactSummary(observation.artifacts),
    directory_differences: sortedUnique(
      observation.directory_differences,
      (item) => item.difference_ref,
      "benchmark directory differences",
    ),
    page_deviation: pageDeviation(observation.page_deviation),
    quality_negative_samples: sortedUnique(
      observation.quality_negative_samples,
      (item) => item.sample_ref,
      "benchmark quality-negative samples",
    ),
    review_decision: observation.review_decision,
    material_gaps: sortedUnique(
      observation.material_gaps.map((item) => ({
        ...item,
        required_evidence_kinds: sortedRefs(
          item.required_evidence_kinds,
          `${item.category} required evidence kinds`,
        ),
        unresolved_question_refs: sortedRefs(
          item.unresolved_question_refs,
          `${item.category} unresolved questions`,
        ),
      })),
      (item) => item.category,
      "benchmark material-gap categories",
    ),
    provider_configuration: sortedUnique(
      observation.provider_configuration,
      (item) => `${item.module_ref}\u0000${item.indexer_ref}`,
      "benchmark Provider configuration",
    ),
    local_customization_burden: {
      ...observation.local_customization_burden,
      covered_resource_refs: sortedRefs(
        observation.local_customization_burden.covered_resource_refs,
        "benchmark customized resources",
      ),
      affected_artifact_refs: sortedRefs(
        observation.local_customization_burden.affected_artifact_refs,
        "benchmark customization-affected Artifacts",
      ),
    },
    metric_results: metricResults(observation.metrics),
    oracle_differences: oracleDifferences,
    override_state: override.state,
    override_approval_ref: override.approval_ref,
    override_reason: override.reason,
    conformance: conformance({ observation, oracleDifferences, override }),
  });
  return indexerBenchmarkReportSchema.parse({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerBenchmarkReport(value: unknown): IndexerBenchmarkReport {
  const report = indexerBenchmarkReportSchema.parse(value);
  if (report.report_digest !== indexerProtocolDigest(reportPayload(report))) {
    throw new TypeError("benchmark report digest is invalid");
  }
  if (report.inventory_summary.total_count !== report.inventory_summary.inventories.reduce(
    (total, inventory) => total + inventory.total_count,
    0,
  )) {
    throw new TypeError("benchmark inventory summary total is inconsistent");
  }
  for (const inventory of report.inventory_summary.inventories) {
    const total = Object.values(inventory.dispositions).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (total !== inventory.total_count) {
      throw new TypeError("benchmark inventory disposition denominator is inconsistent");
    }
  }
  if (
    report.artifact_summary.semantic_split_count > report.artifact_summary.artifact_count ||
    report.artifact_summary.readability_advisory_count >
      report.artifact_summary.artifact_count
  ) {
    throw new TypeError("benchmark Artifact summary is inconsistent");
  }
  if (
    (report.override_state === "none" &&
      (report.override_approval_ref !== null || report.override_reason !== null)) ||
    (report.override_state === "human-approved" &&
      (report.override_approval_ref === null || report.override_reason === null)) ||
    (report.override_state === "human-approved" && report.conformance !== "human-exempt") ||
    (report.override_state === "none" && report.conformance === "human-exempt")
  ) {
    throw new TypeError("benchmark override/conformance state is inconsistent");
  }
  return report;
}

export function validateCurrentIndexerBenchmarkReport(input: {
  value: unknown;
  manifest: unknown;
  observation: unknown;
  oracle_evaluation: unknown;
  override: unknown;
}): IndexerBenchmarkReport {
  const report = validateIndexerBenchmarkReport(input.value);
  const expected = buildIndexerBenchmarkReport({
    manifest: input.manifest,
    observation: input.observation,
    oracle_evaluation: input.oracle_evaluation,
    override: input.override,
  });
  if (canonicalIndexerJson(report) !== canonicalIndexerJson(expected)) {
    throw new TypeError("benchmark report is stale or cannot be recomputed");
  }
  return report;
}
