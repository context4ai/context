import { z } from "zod";
import {
  indexerFailureExpectedArtifactSchema,
  indexerFailureMetricSchema,
  indexerFailureModuleProfileSchema,
  indexerProfileProblemLineageSchema,
} from "./indexerAuditRevision.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const nonEmptyTextSchema = z.string().min(1).refine((value) => !value.includes("\0"));
const overrideOptionSchema = z.enum([
  "provide-material",
  "change-scope",
  "correct-classification",
  "force-approve-risk",
]);

export const indexerProfileRevisionRecordInputSchema = z.object({
  protocol: z.literal("context.indexer.profile-revision-record-input/v1"),
  lineage: indexerProfileProblemLineageSchema,
  precompile_audit_report_digest: indexerDigestSchema,
  audit_report_digest: indexerDigestSchema,
  indexer_result_fingerprint: indexerDigestSchema,
  actions_taken: z.array(nonEmptyTextSchema).min(1),
  unresolved_reasons: z.array(nonEmptyTextSchema).min(1),
  expected_ledger_digest: indexerDigestSchema,
  input_digest: indexerDigestSchema,
}).strict();

export const indexerProfileFailureReportInputSchema = z.object({
  protocol: z.literal("context.indexer.profile-failure-report-input/v1"),
  lineage_id: indexerDigestSchema,
  precompile_audit_report_digest: indexerDigestSchema,
  audit_report_digest: indexerDigestSchema,
  expected_ledger_digest: indexerDigestSchema,
  module_profiles: z.array(indexerFailureModuleProfileSchema).min(1),
  expected_artifacts: z.array(indexerFailureExpectedArtifactSchema).min(1),
  metrics: z.array(indexerFailureMetricSchema).min(1),
  likely_missing_inputs: z.array(nonEmptyTextSchema).min(1),
  capability_losses: z.array(nonEmptyTextSchema).min(1),
  options: z.array(overrideOptionSchema).min(3),
  input_digest: indexerDigestSchema,
}).strict();

export const indexerProfileFailureInspectionInputSchema = z.object({
  protocol: z.literal("context.indexer.profile-failure-inspection-input/v1"),
  failure_report_digest: indexerDigestSchema,
  input_digest: indexerDigestSchema,
}).strict();

export type IndexerProfileRevisionRecordInput = z.infer<
  typeof indexerProfileRevisionRecordInputSchema
>;
export type IndexerProfileFailureReportInput = z.infer<
  typeof indexerProfileFailureReportInputSchema
>;
export type IndexerProfileFailureInspectionInput = z.infer<
  typeof indexerProfileFailureInspectionInputSchema
>;

function withoutInputDigest<T extends { input_digest: string }>(value: T) {
  const payload: Record<string, unknown> = { ...value };
  delete payload.input_digest;
  return payload;
}

function assertCanonical(values: readonly string[], label: string): void {
  const expected = [...new Set(values)].sort(compareIndexerCanonicalText);
  if (
    expected.length !== values.length ||
    expected.some((value, index) => value !== values[index])
  ) {
    throw new TypeError(`${label} must be unique and canonically sorted`);
  }
}

export function buildIndexerProfileRevisionRecordInput(input: Omit<
  IndexerProfileRevisionRecordInput,
  "protocol" | "input_digest"
>): IndexerProfileRevisionRecordInput {
  const payload = {
    protocol: "context.indexer.profile-revision-record-input/v1" as const,
    ...input,
    actions_taken: [...new Set(input.actions_taken)].sort(compareIndexerCanonicalText),
    unresolved_reasons: [...new Set(input.unresolved_reasons)].sort(
      compareIndexerCanonicalText,
    ),
  };
  return indexerProfileRevisionRecordInputSchema.parse({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProfileRevisionRecordInput(
  value: unknown,
): IndexerProfileRevisionRecordInput {
  const input = indexerProfileRevisionRecordInputSchema.parse(value);
  assertCanonical(input.actions_taken, "profile revision actions_taken");
  assertCanonical(input.unresolved_reasons, "profile revision unresolved_reasons");
  if (indexerProtocolDigest(withoutInputDigest(input)) !== input.input_digest) {
    throw new TypeError("Indexer profile revision record input digest is invalid");
  }
  return input;
}

export function buildIndexerProfileFailureReportInput(input: Omit<
  IndexerProfileFailureReportInput,
  "protocol" | "input_digest"
>): IndexerProfileFailureReportInput {
  const payload = {
    protocol: "context.indexer.profile-failure-report-input/v1" as const,
    ...input,
    likely_missing_inputs: [...new Set(input.likely_missing_inputs)].sort(
      compareIndexerCanonicalText,
    ),
    capability_losses: [...new Set(input.capability_losses)].sort(
      compareIndexerCanonicalText,
    ),
    options: [...new Set(input.options)].sort(compareIndexerCanonicalText),
  };
  return indexerProfileFailureReportInputSchema.parse({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProfileFailureReportInput(
  value: unknown,
): IndexerProfileFailureReportInput {
  const input = indexerProfileFailureReportInputSchema.parse(value);
  assertCanonical(input.likely_missing_inputs, "profile failure likely_missing_inputs");
  assertCanonical(input.capability_losses, "profile failure capability_losses");
  assertCanonical(input.options, "profile failure options");
  if (!input.options.includes("force-approve-risk")) {
    throw new TypeError("profile failure report input must expose force-approve-risk");
  }
  if (indexerProtocolDigest(withoutInputDigest(input)) !== input.input_digest) {
    throw new TypeError("Indexer profile failure report input digest is invalid");
  }
  return input;
}

export function buildIndexerProfileFailureInspectionInput(input: {
  failure_report_digest: string;
}): IndexerProfileFailureInspectionInput {
  const payload = {
    protocol: "context.indexer.profile-failure-inspection-input/v1" as const,
    ...input,
  };
  return indexerProfileFailureInspectionInputSchema.parse({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProfileFailureInspectionInput(
  value: unknown,
): IndexerProfileFailureInspectionInput {
  const input = indexerProfileFailureInspectionInputSchema.parse(value);
  if (indexerProtocolDigest(withoutInputDigest(input)) !== input.input_digest) {
    throw new TypeError("Indexer profile failure inspection input digest is invalid");
  }
  return input;
}
