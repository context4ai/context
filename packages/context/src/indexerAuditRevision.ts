import { z } from "zod";
import {
  indexerCandidateReviewBindingSchema,
  validateIndexerAuditReport,
} from "./indexerAuditProtocol.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const nonEmptyTextSchema = z.string().min(1).refine((value) => !value.includes("\0"));
const canonicalRefSchema = nonEmptyTextSchema.refine((value) => value.includes(":"));

export const indexerProfileProblemLineageSchema = z.object({
  protocol: z.literal("context.indexer.profile-problem-lineage/v1"),
  requirement_lineage_id: indexerDigestSchema,
  source_material_epoch: indexerDigestSchema,
  unit_ref: canonicalRefSchema,
  problem_class: indexerIdSchema,
  lineage_id: indexerDigestSchema,
}).strict();

export const indexerProfileAuditAttemptSchema = z.object({
  protocol: z.literal("context.indexer.profile-audit-attempt/v1"),
  lineage_id: indexerDigestSchema,
  attempt: z.number().int().min(1).max(3),
  audit_report_digest: indexerDigestSchema,
  profile_report_digest: indexerDigestSchema,
  indexer_result_fingerprint: indexerDigestSchema,
  actions_taken: z.array(nonEmptyTextSchema).min(1),
  unresolved_reasons: z.array(nonEmptyTextSchema).min(1),
  attempt_digest: indexerDigestSchema,
}).strict();

const indexerProfileAuditLineageRecordSchema = z.object({
  lineage: indexerProfileProblemLineageSchema,
  attempts: z.array(indexerProfileAuditAttemptSchema).max(3),
}).strict();

export const indexerProfileAuditLedgerSchema = z.object({
  protocol: z.literal("context.indexer.profile-audit-ledger/v1"),
  lineages: z.array(indexerProfileAuditLineageRecordSchema),
  ledger_digest: indexerDigestSchema,
}).strict();

export const indexerFailureModuleProfileSchema = z.object({
  unit_ref: canonicalRefSchema,
  classification: indexerIdSchema,
  primary_profile: indexerIdSchema,
  additional_profiles: z.array(indexerIdSchema),
  composers: z.array(indexerIdSchema),
  profile_contract_digests: z.array(indexerDigestSchema).min(1),
}).strict();

export const indexerFailureExpectedArtifactSchema = z.object({
  classification: indexerIdSchema,
  bundle_variant: indexerIdSchema,
  expected_artifact_kinds: z.array(indexerIdSchema).min(1),
  anonymous_example: nonEmptyTextSchema,
  anonymous_anti_example: nonEmptyTextSchema,
}).strict();

export const indexerFailureMetricSchema = z.object({
  metric_id: indexerIdSchema,
  unit: z.enum(["percent", "count", "ratio", "boolean"]),
  recommended: z.number().nullable(),
  hard_gate: z.number().nullable(),
  observed: z.number().nullable(),
  denominator: z.number().nonnegative(),
  sample_refs: z.array(canonicalRefSchema).min(1),
}).strict();

export const indexerProfileFailureReportSchema = z.object({
  protocol: z.literal("context.indexer.profile-failure-report/v1"),
  lineage: indexerProfileProblemLineageSchema,
  binding: indexerCandidateReviewBindingSchema,
  precompile_audit_report_digest: indexerDigestSchema,
  latest_audit_report_digest: indexerDigestSchema,
  profile_report_digest: indexerDigestSchema,
  module_profiles: z.array(indexerFailureModuleProfileSchema).min(1),
  expected_artifacts: z.array(indexerFailureExpectedArtifactSchema).min(1),
  metrics: z.array(indexerFailureMetricSchema).min(1),
  attempts: z.array(indexerProfileAuditAttemptSchema).length(3),
  likely_missing_inputs: z.array(nonEmptyTextSchema).min(1),
  capability_losses: z.array(nonEmptyTextSchema).min(1),
  options: z.array(z.enum([
    "provide-material",
    "change-scope",
    "correct-classification",
    "force-approve-risk",
  ])).min(3),
  report_digest: indexerDigestSchema,
}).strict();

export const indexerProfileOverrideDecisionSchema = z.object({
  protocol: z.literal("context.indexer.profile-override-decision/v1"),
  failure_report_digest: indexerDigestSchema,
  audit_report_digest: indexerDigestSchema,
  binding: indexerCandidateReviewBindingSchema,
  indexer_result_fingerprint: indexerDigestSchema,
  failed_metric_ids: z.array(indexerIdSchema).min(1),
  decision: z.literal("force-approve-profile-risk"),
  confirmed_by: nonEmptyTextSchema,
  confirmed_at: z.string().datetime({ offset: true }),
  decision_digest: indexerDigestSchema,
}).strict();

export const indexerProfileOverrideReceiptSchema = z.object({
  protocol: z.literal("context.indexer.profile-override-receipt/v1"),
  failure_report_digest: indexerDigestSchema,
  precompile_audit_report_digest: indexerDigestSchema,
  audit_report_digest: indexerDigestSchema,
  binding: indexerCandidateReviewBindingSchema,
  indexer_result_fingerprint: indexerDigestSchema,
  failed_metric_ids: z.array(indexerIdSchema).min(1),
  confirmed_by: nonEmptyTextSchema,
  confirmed_at: z.string().datetime({ offset: true }),
  decision_digest: indexerDigestSchema,
  receipt_digest: indexerDigestSchema,
}).strict();

export type IndexerProfileProblemLineage = z.infer<
  typeof indexerProfileProblemLineageSchema
>;
export type IndexerProfileAuditAttempt = z.infer<
  typeof indexerProfileAuditAttemptSchema
>;
export type IndexerProfileAuditLedger = z.infer<
  typeof indexerProfileAuditLedgerSchema
>;
export type IndexerProfileFailureReport = z.infer<
  typeof indexerProfileFailureReportSchema
>;
export type IndexerProfileOverrideDecision = z.infer<
  typeof indexerProfileOverrideDecisionSchema
>;
export type IndexerProfileOverrideReceipt = z.infer<
  typeof indexerProfileOverrideReceiptSchema
>;

function assertCanonical(values: readonly string[], label: string): void {
  const expected = [...new Set(values)].sort(compareIndexerCanonicalText);
  if (
    expected.length !== values.length ||
    expected.some((value, index) => value !== values[index])
  ) {
    throw new TypeError(`${label} must be unique and canonically sorted`);
  }
}

function digestPayload(
  value: object,
  digestField: string,
): string {
  return indexerProtocolDigest(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== digestField),
  ));
}

function canonicalUniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): T[] {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError(`${label} must have unique identities`);
  }
  return [...values].sort((left, right) =>
    compareIndexerCanonicalText(key(left), key(right))
  );
}

export function buildIndexerProfileProblemLineage(input: {
  requirement_lineage_id: string;
  source_material_epoch: string;
  unit_ref: string;
  problem_class: string;
}): IndexerProfileProblemLineage {
  const payload = {
    protocol: "context.indexer.profile-problem-lineage/v1" as const,
    ...input,
  };
  return indexerProfileProblemLineageSchema.parse({
    ...payload,
    lineage_id: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProfileProblemLineage(
  value: unknown,
): IndexerProfileProblemLineage {
  const lineage = indexerProfileProblemLineageSchema.parse(value);
  if (digestPayload(lineage, "lineage_id") !== lineage.lineage_id) {
    throw new TypeError("Indexer profile problem lineage digest is invalid");
  }
  return lineage;
}

export function emptyIndexerProfileAuditLedger(): IndexerProfileAuditLedger {
  const payload = {
    protocol: "context.indexer.profile-audit-ledger/v1" as const,
    lineages: [],
  };
  return { ...payload, ledger_digest: indexerProtocolDigest(payload) };
}

export function validateIndexerProfileAuditLedger(
  value: unknown,
): IndexerProfileAuditLedger {
  const ledger = indexerProfileAuditLedgerSchema.parse(value);
  const lineageIds = ledger.lineages.map((record) => record.lineage.lineage_id);
  assertCanonical(lineageIds, "profile audit ledger lineages");
  for (const record of ledger.lineages) {
    const lineage = validateIndexerProfileProblemLineage(record.lineage);
    record.attempts.forEach((attempt, index) => {
      if (attempt.lineage_id !== lineage.lineage_id || attempt.attempt !== index + 1) {
        throw new TypeError("profile audit attempts must be contiguous under one lineage");
      }
      assertCanonical(attempt.actions_taken, "profile audit attempt actions_taken");
      assertCanonical(attempt.unresolved_reasons, "profile audit attempt unresolved_reasons");
      if (digestPayload(attempt, "attempt_digest") !== attempt.attempt_digest) {
        throw new TypeError("profile audit attempt digest is invalid");
      }
    });
    const fingerprints = record.attempts.map((attempt) =>
      attempt.indexer_result_fingerprint
    );
    if (new Set(fingerprints).size !== fingerprints.length) {
      throw new TypeError("profile audit attempts must represent distinct result revisions");
    }
  }
  if (digestPayload(ledger, "ledger_digest") !== ledger.ledger_digest) {
    throw new TypeError("Indexer profile audit ledger digest is invalid");
  }
  return ledger;
}

export function recordIndexerProfileAuditAttempt(input: {
  ledger: unknown;
  lineage: unknown;
  audit_report: unknown;
  indexer_result_fingerprint: string;
  actions_taken: string[];
  unresolved_reasons: string[];
}): { ledger: IndexerProfileAuditLedger; attempt: IndexerProfileAuditAttempt } {
  const ledger = validateIndexerProfileAuditLedger(input.ledger);
  const lineage = validateIndexerProfileProblemLineage(input.lineage);
  const report = validateIndexerAuditReport(input.audit_report);
  if (
    report.stage !== "postcompile" ||
    !report.baseline.clear ||
    report.profile.state === "not-applicable" ||
    report.profile.state === "passed" ||
    report.profile.report_digest === null
  ) {
    throw new TypeError("profile revision requires a clear-baseline failed postcompile profile audit");
  }
  const current = ledger.lineages.find((record) =>
    record.lineage.lineage_id === lineage.lineage_id
  );
  const attempts = current?.attempts ?? [];
  if (attempts.length >= 3) {
    throw new TypeError("profile audit lineage already reached the three-attempt limit");
  }
  const attemptPayload = {
    protocol: "context.indexer.profile-audit-attempt/v1" as const,
    lineage_id: lineage.lineage_id,
    attempt: attempts.length + 1,
    audit_report_digest: report.report_digest,
    profile_report_digest: report.profile.report_digest,
    indexer_result_fingerprint: input.indexer_result_fingerprint,
    actions_taken: [...new Set(input.actions_taken)].sort(compareIndexerCanonicalText),
    unresolved_reasons: [...new Set(input.unresolved_reasons)].sort(
      compareIndexerCanonicalText,
    ),
  };
  const attempt = indexerProfileAuditAttemptSchema.parse({
    ...attemptPayload,
    attempt_digest: indexerProtocolDigest(attemptPayload),
  });
  const nextRecord = {
    lineage,
    attempts: [...attempts, attempt],
  };
  const lineages = ledger.lineages
    .filter((record) => record.lineage.lineage_id !== lineage.lineage_id)
    .concat(nextRecord)
    .sort((left, right) => compareIndexerCanonicalText(
      left.lineage.lineage_id,
      right.lineage.lineage_id,
    ));
  const payload = {
    protocol: "context.indexer.profile-audit-ledger/v1" as const,
    lineages,
  };
  return {
    attempt,
    ledger: validateIndexerProfileAuditLedger({
      ...payload,
      ledger_digest: indexerProtocolDigest(payload),
    }),
  };
}

export function buildIndexerProfileFailureReport(input: {
  ledger: unknown;
  lineage_id: string;
  precompile_audit_report: unknown;
  audit_report: unknown;
  module_profiles: z.input<typeof indexerFailureModuleProfileSchema>[];
  expected_artifacts: z.input<typeof indexerFailureExpectedArtifactSchema>[];
  metrics: z.input<typeof indexerFailureMetricSchema>[];
  likely_missing_inputs: string[];
  capability_losses: string[];
  options: Array<
    "provide-material" | "change-scope" | "correct-classification" |
    "force-approve-risk"
  >;
}): IndexerProfileFailureReport {
  const ledger = validateIndexerProfileAuditLedger(input.ledger);
  const precompile = validateIndexerAuditReport(input.precompile_audit_report);
  const audit = validateIndexerAuditReport(input.audit_report);
  const record = ledger.lineages.find((candidate) =>
    candidate.lineage.lineage_id === input.lineage_id
  );
  if (record === undefined || record.attempts.length !== 3) {
    throw new TypeError("profile failure report requires exactly three recorded attempts");
  }
  const latest = record.attempts[2]!;
  if (
    audit.report_digest !== latest.audit_report_digest ||
    audit.profile.report_digest !== latest.profile_report_digest ||
    audit.binding.layout_digest === null ||
    audit.binding.candidate_set_digest === null ||
    audit.binding.effective_revision_digest === null
  ) {
    throw new TypeError("profile failure report audit does not match the third attempt");
  }
  if (audit.profile.state === "passed" || audit.profile.state === "not-applicable") {
    throw new TypeError("profile failure report requires unresolved profile metrics");
  }
  if (
    precompile.stage !== "precompile" ||
    !precompile.baseline.clear ||
    precompile.binding.requirement_set_digest !== audit.binding.requirement_set_digest ||
    precompile.binding.registry_digest !== audit.binding.registry_digest ||
    precompile.binding.inventory_digest !== audit.binding.inventory_digest
  ) {
    throw new TypeError("profile failure report requires a clear, current precompile baseline");
  }
  const metrics = canonicalUniqueBy(
    input.metrics.map((metric) => indexerFailureMetricSchema.parse(metric)),
    (metric) => metric.metric_id,
    "profile failure report metrics",
  );
  const failedMetricIds = [...audit.profile.failed_metric_ids].sort(
    compareIndexerCanonicalText,
  );
  if (
    metrics.length !== failedMetricIds.length ||
    metrics.some((metric, index) => metric.metric_id !== failedMetricIds[index])
  ) {
    throw new TypeError("profile failure report metrics must exactly explain the failed audit metrics");
  }
  const payload = {
    protocol: "context.indexer.profile-failure-report/v1" as const,
    lineage: record.lineage,
    binding: {
      requirement_set_digest: audit.binding.requirement_set_digest,
      registry_digest: audit.binding.registry_digest,
      inventory_digest: audit.binding.inventory_digest,
      layout_digest: audit.binding.layout_digest,
      candidate_set_digest: audit.binding.candidate_set_digest,
      effective_revision_digest: audit.binding.effective_revision_digest,
    },
    precompile_audit_report_digest: precompile.report_digest,
    latest_audit_report_digest: audit.report_digest,
    profile_report_digest: audit.profile.report_digest,
    module_profiles: canonicalUniqueBy(
      input.module_profiles.map((profile) => indexerFailureModuleProfileSchema.parse({
        ...profile,
        additional_profiles: [...new Set(profile.additional_profiles)].sort(
          compareIndexerCanonicalText,
        ),
        composers: [...new Set(profile.composers)].sort(compareIndexerCanonicalText),
        profile_contract_digests: [...new Set(profile.profile_contract_digests)].sort(
          compareIndexerCanonicalText,
        ),
      })),
      (profile) => profile.unit_ref,
      "profile failure report module profiles",
    ),
    expected_artifacts: canonicalUniqueBy(
      input.expected_artifacts.map((artifact) => indexerFailureExpectedArtifactSchema.parse({
        ...artifact,
        expected_artifact_kinds: [...new Set(artifact.expected_artifact_kinds)].sort(
          compareIndexerCanonicalText,
        ),
      })),
      (artifact) => `${artifact.classification}\0${artifact.bundle_variant}`,
      "profile failure report expected artifacts",
    ),
    metrics,
    attempts: record.attempts,
    likely_missing_inputs: [...new Set(input.likely_missing_inputs)].sort(
      compareIndexerCanonicalText,
    ),
    capability_losses: [...new Set(input.capability_losses)].sort(
      compareIndexerCanonicalText,
    ),
    options: [...new Set(input.options)].sort(compareIndexerCanonicalText),
  };
  const report = indexerProfileFailureReportSchema.parse({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
  assertCanonical(report.options, "profile failure report options");
  if (!report.options.includes("force-approve-risk")) {
    throw new TypeError("profile failure report must expose the explicit risk option");
  }
  return report;
}

export function validateIndexerProfileFailureReport(
  value: unknown,
): IndexerProfileFailureReport {
  const report = indexerProfileFailureReportSchema.parse(value);
  validateIndexerProfileProblemLineage(report.lineage);
  canonicalUniqueBy(
    report.module_profiles,
    (profile) => profile.unit_ref,
    "profile failure report module profiles",
  ).forEach((profile, index) => {
    if (profile !== report.module_profiles[index]) {
      throw new TypeError("profile failure report module profiles must be canonically sorted");
    }
    assertCanonical(profile.additional_profiles, "module profile additional_profiles");
    assertCanonical(profile.composers, "module profile composers");
    assertCanonical(profile.profile_contract_digests, "module profile contract digests");
  });
  canonicalUniqueBy(
    report.expected_artifacts,
    (artifact) => `${artifact.classification}\0${artifact.bundle_variant}`,
    "profile failure report expected artifacts",
  ).forEach((artifact, index) => {
    if (artifact !== report.expected_artifacts[index]) {
      throw new TypeError("profile failure report expected artifacts must be canonically sorted");
    }
    assertCanonical(artifact.expected_artifact_kinds, "expected artifact kinds");
  });
  canonicalUniqueBy(
    report.metrics,
    (metric) => metric.metric_id,
    "profile failure report metrics",
  ).forEach((metric, index) => {
    if (metric !== report.metrics[index]) {
      throw new TypeError("profile failure report metrics must be canonically sorted");
    }
  });
  report.attempts.forEach((attempt, index) => {
    if (
      attempt.lineage_id !== report.lineage.lineage_id ||
      attempt.attempt !== index + 1 ||
      digestPayload(attempt, "attempt_digest") !== attempt.attempt_digest
    ) {
      throw new TypeError("profile failure report must contain the exact contiguous attempt history");
    }
    assertCanonical(attempt.actions_taken, "profile failure report attempt actions_taken");
    assertCanonical(attempt.unresolved_reasons, "profile failure report attempt unresolved_reasons");
  });
  const latest = report.attempts[2]!;
  if (
    latest.audit_report_digest !== report.latest_audit_report_digest ||
    latest.profile_report_digest !== report.profile_report_digest
  ) {
    throw new TypeError("profile failure report latest audit does not match its third attempt");
  }
  assertCanonical(report.likely_missing_inputs, "profile failure report likely_missing_inputs");
  assertCanonical(report.capability_losses, "profile failure report capability_losses");
  assertCanonical(report.options, "profile failure report options");
  if (!report.options.includes("force-approve-risk")) {
    throw new TypeError("profile failure report must expose the explicit risk option");
  }
  if (digestPayload(report, "report_digest") !== report.report_digest) {
    throw new TypeError("Indexer profile failure report digest is invalid");
  }
  return report;
}

export function buildIndexerProfileOverrideDecision(input: Omit<
  IndexerProfileOverrideDecision,
  "protocol" | "decision" | "decision_digest"
>): IndexerProfileOverrideDecision {
  const payload = {
    protocol: "context.indexer.profile-override-decision/v1" as const,
    ...input,
    decision: "force-approve-profile-risk" as const,
    failed_metric_ids: [...new Set(input.failed_metric_ids)].sort(
      compareIndexerCanonicalText,
    ),
  };
  return indexerProfileOverrideDecisionSchema.parse({
    ...payload,
    decision_digest: indexerProtocolDigest(payload),
  });
}

export function authorizeIndexerProfileOverride(input: {
  failure_report: unknown;
  precompile_audit_report: unknown;
  audit_report: unknown;
  decision: unknown;
}): IndexerProfileOverrideReceipt {
  const report = validateIndexerProfileFailureReport(input.failure_report);
  const precompile = validateIndexerAuditReport(input.precompile_audit_report);
  const audit = validateIndexerAuditReport(input.audit_report);
  const decision = indexerProfileOverrideDecisionSchema.parse(input.decision);
  if (digestPayload(decision, "decision_digest") !== decision.decision_digest) {
    throw new TypeError("Indexer profile override decision digest is invalid");
  }
  assertCanonical(decision.failed_metric_ids, "profile override decision failed_metric_ids");
  const latestAttempt = report.attempts[2]!;
  if (
    precompile.stage !== "precompile" ||
    precompile.report_digest !== report.precompile_audit_report_digest ||
    !precompile.baseline.clear ||
    precompile.binding.requirement_set_digest !== report.binding.requirement_set_digest ||
    precompile.binding.registry_digest !== report.binding.registry_digest ||
    precompile.binding.inventory_digest !== report.binding.inventory_digest ||
    decision.failure_report_digest !== report.report_digest ||
    decision.audit_report_digest !== audit.report_digest ||
    indexerProtocolDigest(decision.binding) !== indexerProtocolDigest(report.binding) ||
    decision.indexer_result_fingerprint !== latestAttempt.indexer_result_fingerprint ||
    indexerProtocolDigest(decision.failed_metric_ids) !==
      indexerProtocolDigest(audit.profile.failed_metric_ids) ||
    indexerProtocolDigest(decision.binding) !== indexerProtocolDigest({
      requirement_set_digest: audit.binding.requirement_set_digest,
      registry_digest: audit.binding.registry_digest,
      inventory_digest: audit.binding.inventory_digest,
      layout_digest: audit.binding.layout_digest,
      candidate_set_digest: audit.binding.candidate_set_digest,
      effective_revision_digest: audit.binding.effective_revision_digest,
    })
  ) {
    throw new TypeError("Indexer profile override does not bind current clear audits and candidate set");
  }
  if (
    !audit.baseline.clear ||
    audit.profile.state === "passed" ||
    audit.profile.state === "not-applicable" ||
    audit.profile.failed_metric_ids.length === 0
  ) {
    throw new TypeError("Indexer profile override applies only to profile failures after baseline passes");
  }
  const payload = {
    protocol: "context.indexer.profile-override-receipt/v1" as const,
    failure_report_digest: report.report_digest,
    precompile_audit_report_digest: report.precompile_audit_report_digest,
    audit_report_digest: audit.report_digest,
    binding: decision.binding,
    indexer_result_fingerprint: decision.indexer_result_fingerprint,
    failed_metric_ids: audit.profile.failed_metric_ids,
    confirmed_by: decision.confirmed_by,
    confirmed_at: decision.confirmed_at,
    decision_digest: decision.decision_digest,
  };
  return indexerProfileOverrideReceiptSchema.parse({
    ...payload,
    receipt_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProfileOverrideReceipt(
  value: unknown,
): IndexerProfileOverrideReceipt {
  const receipt = indexerProfileOverrideReceiptSchema.parse(value);
  assertCanonical(receipt.failed_metric_ids, "profile override failed_metric_ids");
  if (digestPayload(receipt, "receipt_digest") !== receipt.receipt_digest) {
    throw new TypeError("Indexer profile override receipt digest is invalid");
  }
  return receipt;
}
