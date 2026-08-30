import { z } from "zod";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const canonicalIdListSchema = z.array(indexerIdSchema);
const canonicalDigestListSchema = z.array(indexerDigestSchema);

export const indexerAuditBindingSchema = z.object({
  requirement_set_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  inventory_digest: indexerDigestSchema,
  layout_digest: indexerDigestSchema.nullable(),
  candidate_set_digest: indexerDigestSchema.nullable(),
  effective_revision_digest: indexerDigestSchema.nullable(),
}).strict();

export const indexerAuditReportSchema = z.object({
  protocol: z.literal("context.indexer.audit/v1"),
  stage: z.enum(["precompile", "postcompile"]),
  binding: indexerAuditBindingSchema,
  baseline: z.object({
    clear: z.boolean(),
    failed_check_ids: canonicalIdListSchema,
    finding_digests: canonicalDigestListSchema,
  }).strict(),
  profile: z.object({
    state: z.enum([
      "not-applicable",
      "passed",
      "revision-required",
      "human-guidance-required",
    ]),
    failed_metric_ids: canonicalIdListSchema,
    report_digest: indexerDigestSchema.nullable(),
  }).strict(),
  report_digest: indexerDigestSchema,
}).strict();

export const indexerCandidateReviewBindingSchema = z.object({
  requirement_set_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  inventory_digest: indexerDigestSchema,
  layout_digest: indexerDigestSchema,
  candidate_set_digest: indexerDigestSchema,
  effective_revision_digest: indexerDigestSchema,
}).strict();

export const indexerCandidateReviewReadinessInputSchema = z.object({
  protocol: z.literal("context.indexer.candidate-review-readiness-input/v1"),
  binding: indexerCandidateReviewBindingSchema,
  precompile_audit_report_digest: indexerDigestSchema,
  postcompile_audit_report_digest: indexerDigestSchema,
  profile_override_receipt_digest: indexerDigestSchema.nullable(),
  input_digest: indexerDigestSchema,
}).strict();

export type IndexerAuditBinding = z.infer<typeof indexerAuditBindingSchema>;
export type IndexerAuditReport = z.infer<typeof indexerAuditReportSchema>;
export type IndexerCandidateReviewBinding = z.infer<
  typeof indexerCandidateReviewBindingSchema
>;
export type IndexerCandidateReviewReadinessInput = z.infer<
  typeof indexerCandidateReviewReadinessInputSchema
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

function reportPayload(report: IndexerAuditReport) {
  return {
    protocol: report.protocol,
    stage: report.stage,
    binding: report.binding,
    baseline: report.baseline,
    profile: report.profile,
  };
}

export function validateIndexerAuditReport(value: unknown): IndexerAuditReport {
  const report = indexerAuditReportSchema.parse(value);
  assertCanonical(report.baseline.failed_check_ids, "audit baseline failed_check_ids");
  assertCanonical(report.baseline.finding_digests, "audit baseline finding_digests");
  assertCanonical(report.profile.failed_metric_ids, "audit profile failed_metric_ids");
  if (
    report.baseline.clear !==
      (report.baseline.failed_check_ids.length === 0 &&
        report.baseline.finding_digests.length === 0)
  ) {
    throw new TypeError("audit baseline clear state does not match its failures");
  }
  if (report.stage === "precompile") {
    if (
      report.binding.layout_digest !== null ||
      report.binding.candidate_set_digest !== null ||
      report.binding.effective_revision_digest !== null ||
      report.profile.state !== "not-applicable" ||
      report.profile.failed_metric_ids.length !== 0 ||
      report.profile.report_digest !== null
    ) {
      throw new TypeError("precompile audit cannot claim layout, candidates, or profile results");
    }
  } else if (
    report.binding.layout_digest === null ||
    report.binding.candidate_set_digest === null ||
    report.binding.effective_revision_digest === null ||
    report.profile.state === "not-applicable"
  ) {
    throw new TypeError("postcompile audit requires exact layout, candidate, revision, and profile results");
  }
  const profileShapeValid = report.profile.state === "not-applicable"
    ? report.profile.failed_metric_ids.length === 0 &&
      report.profile.report_digest === null
    : report.profile.state === "passed"
    ? report.profile.failed_metric_ids.length === 0 &&
      report.profile.report_digest !== null
    : report.profile.failed_metric_ids.length > 0 &&
      report.profile.report_digest !== null;
  if (!profileShapeValid) {
    throw new TypeError("audit profile state does not match its failed metrics or report");
  }
  if (indexerProtocolDigest(reportPayload(report)) !== report.report_digest) {
    throw new TypeError("Indexer audit report digest is invalid");
  }
  return report;
}

export function buildIndexerAuditReport(
  input: Omit<IndexerAuditReport, "report_digest">,
): IndexerAuditReport {
  const payload = indexerAuditReportSchema
    .omit({ report_digest: true })
    .parse(input);
  return validateIndexerAuditReport({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

function readinessPayload(input: IndexerCandidateReviewReadinessInput) {
  return {
    protocol: input.protocol,
    binding: input.binding,
    precompile_audit_report_digest: input.precompile_audit_report_digest,
    postcompile_audit_report_digest: input.postcompile_audit_report_digest,
    profile_override_receipt_digest: input.profile_override_receipt_digest,
  };
}

export function buildIndexerCandidateReviewReadinessInput(input: {
  binding: IndexerCandidateReviewBinding;
  precompile_audit_report_digest: string;
  postcompile_audit_report_digest: string;
  profile_override_receipt_digest?: string | null;
}): IndexerCandidateReviewReadinessInput {
  const payload = {
    protocol: "context.indexer.candidate-review-readiness-input/v1" as const,
    binding: input.binding,
    precompile_audit_report_digest: input.precompile_audit_report_digest,
    postcompile_audit_report_digest: input.postcompile_audit_report_digest,
    profile_override_receipt_digest: input.profile_override_receipt_digest ?? null,
  };
  return indexerCandidateReviewReadinessInputSchema.parse({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerCandidateReviewReadinessInput(
  value: unknown,
): IndexerCandidateReviewReadinessInput {
  const input = indexerCandidateReviewReadinessInputSchema.parse(value);
  if (indexerProtocolDigest(readinessPayload(input)) !== input.input_digest) {
    throw new TypeError("Indexer candidate Review readiness input digest is invalid");
  }
  return input;
}

function assertAuditBinding(input: {
  review: IndexerCandidateReviewBinding;
  report: IndexerAuditReport;
}): void {
  for (const field of [
    "requirement_set_digest",
    "registry_digest",
    "inventory_digest",
  ] as const) {
    if (input.report.binding[field] !== input.review[field]) {
      throw new TypeError(`Indexer audit ${field} does not match the Review candidate set`);
    }
  }
}

export function evaluateIndexerCandidateReviewReadiness(input: {
  request: unknown;
  precompile_report: unknown;
  postcompile_report: unknown;
}) {
  const request = validateIndexerCandidateReviewReadinessInput(input.request);
  const precompile = validateIndexerAuditReport(input.precompile_report);
  const postcompile = validateIndexerAuditReport(input.postcompile_report);
  if (
    precompile.stage !== "precompile" ||
    precompile.report_digest !== request.precompile_audit_report_digest ||
    postcompile.stage !== "postcompile" ||
    postcompile.report_digest !== request.postcompile_audit_report_digest
  ) {
    throw new TypeError("Indexer candidate Review references the wrong audit records");
  }
  assertAuditBinding({ review: request.binding, report: precompile });
  assertAuditBinding({ review: request.binding, report: postcompile });
  for (const field of [
    "layout_digest",
    "candidate_set_digest",
    "effective_revision_digest",
  ] as const) {
    if (postcompile.binding[field] !== request.binding[field]) {
      throw new TypeError(`Indexer postcompile audit ${field} is stale`);
    }
  }
  const state = !precompile.baseline.clear || !postcompile.baseline.clear
    ? "baseline-blocked" as const
    : postcompile.profile.state !== "passed"
    ? "profile-blocked" as const
    : "ready" as const;
  const payload = {
    protocol: "context.indexer.candidate-review-readiness-result/v1" as const,
    state,
    binding: request.binding,
    precompile_audit_report_digest: precompile.report_digest,
    postcompile_audit_report_digest: postcompile.report_digest,
    baseline_failed_check_ids: [...new Set([
      ...precompile.baseline.failed_check_ids,
      ...postcompile.baseline.failed_check_ids,
    ])].sort(compareIndexerCanonicalText),
    profile_state: postcompile.profile.state,
    profile_failed_metric_ids: postcompile.profile.failed_metric_ids,
    profile_override_receipt_digest: request.profile_override_receipt_digest,
    profile_override_applied: false,
    review_binding_digest: indexerProtocolDigest({
      binding: request.binding,
      precompile_audit_report_digest: precompile.report_digest,
      postcompile_audit_report_digest: postcompile.report_digest,
    }),
  };
  return {
    ...payload,
    graph_outcome: state === "ready"
      ? "completed" as const
      : state === "baseline-blocked"
      ? "failed" as const
      : "blocked" as const,
    result_digest: indexerProtocolDigest(payload),
  };
}
