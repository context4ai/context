import { z } from "zod";
import {
  indexerMaterialAnswerCandidateSetSchema,
  validateIndexerMaterialAnswerCandidateSet,
} from "./indexerMaterialAnswer.js";
import {
  INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE,
  buildIndexerMaterialAnswerBaselineReport,
  decideIndexerMaterialAnswerReview,
  indexerMaterialAnswerBaselineReportSchema,
  indexerMaterialAnswerReviewDecisionSchema,
  validateIndexerMaterialAnswerBaselineReport,
} from "./indexerMaterialAnswerReview.js";
import {
  approveIndexerMaterialAnswer,
  indexerMaterialGapLedgerSchema,
  validateIndexerMaterialGapLedger,
} from "./indexerMaterialGapLedger.js";
import {
  indexerMaterialQuestionWorksetSchema,
  validateIndexerMaterialQuestionWorkset,
} from "./indexerMaterialQuestionWorkset.js";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const inspectionInputPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-review-inspection-input/v1"),
  workset: indexerMaterialQuestionWorksetSchema,
  candidate_set: indexerMaterialAnswerCandidateSetSchema,
  question_key: z.string().min(1),
}).strict();

export const indexerMaterialAnswerReviewInspectionInputSchema =
  inspectionInputPayloadSchema.extend({
    input_digest: digestSchema,
  }).strict();

const inspectionResultPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-review-inspection-result/v1"),
  state: z.literal("review-required"),
  review_scope: z.literal(INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE),
  input_digest: digestSchema,
  workset_digest: digestSchema,
  candidate_set_digest: digestSchema,
  baseline_report: indexerMaterialAnswerBaselineReportSchema,
}).strict();

export const indexerMaterialAnswerReviewInspectionResultSchema =
  inspectionResultPayloadSchema.extend({
    result_digest: digestSchema,
  }).strict();

const resolutionInputPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-review-resolution-input/v1"),
  ledger: indexerMaterialGapLedgerSchema,
  workset: indexerMaterialQuestionWorksetSchema,
  candidate_set: indexerMaterialAnswerCandidateSetSchema,
  baseline_report: indexerMaterialAnswerBaselineReportSchema,
  decision: z.enum(["approved", "rejected"]),
}).strict();

export const indexerMaterialAnswerReviewResolutionInputSchema =
  resolutionInputPayloadSchema.extend({
    input_digest: digestSchema,
  }).strict();

const reviewResolutionBaseSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-review-resolution-result/v1"),
  review_scope: z.literal(INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE),
  input_digest: digestSchema,
  workset_digest: digestSchema,
  candidate_set_digest: digestSchema,
  baseline_report_digest: digestSchema,
  review_decision: indexerMaterialAnswerReviewDecisionSchema,
});

const approvedReviewResolutionSchema = reviewResolutionBaseSchema.extend({
  state: z.literal("approved"),
  answer_approval: z.object({
    predecessor_ledger_revision: digestSchema,
    successor_ledger: indexerMaterialGapLedgerSchema,
    consumed_workset_digest: digestSchema,
    binding_digest: digestSchema,
  }).strict(),
  result_digest: digestSchema,
}).strict();

const rejectedReviewResolutionSchema = reviewResolutionBaseSchema.extend({
  state: z.literal("rejected"),
  result_digest: digestSchema,
}).strict();

export const indexerMaterialAnswerReviewResolutionResultSchema =
  z.discriminatedUnion("state", [
    approvedReviewResolutionSchema,
    rejectedReviewResolutionSchema,
  ]);

export type IndexerMaterialAnswerReviewInspectionInput = z.infer<
  typeof indexerMaterialAnswerReviewInspectionInputSchema
>;
export type IndexerMaterialAnswerReviewInspectionResult = z.infer<
  typeof indexerMaterialAnswerReviewInspectionResultSchema
>;
export type IndexerMaterialAnswerReviewResolutionInput = z.infer<
  typeof indexerMaterialAnswerReviewResolutionInputSchema
>;
export type IndexerMaterialAnswerReviewResolutionResult = z.infer<
  typeof indexerMaterialAnswerReviewResolutionResultSchema
>;

function withDigest<
  T extends Record<string, unknown>,
  F extends "input_digest" | "result_digest",
>(
  payload: T,
  field: F,
): T & Record<F, string> {
  return { ...payload, [field]: indexerProtocolDigest(payload) } as
    T & Record<F, string>;
}

function withoutDigest<
  T extends Record<string, unknown>,
  F extends "input_digest" | "result_digest",
>(
  value: T,
  field: F,
): Omit<T, F> {
  const { [field]: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function buildIndexerMaterialAnswerReviewInspectionInput(input: {
  workset: unknown;
  candidate_set: unknown;
  question_key: string;
}): IndexerMaterialAnswerReviewInspectionInput {
  const payload = inspectionInputPayloadSchema.parse({
    protocol: "context.indexer.material-answer-review-inspection-input/v1",
    workset: validateIndexerMaterialQuestionWorkset(input.workset),
    candidate_set: validateIndexerMaterialAnswerCandidateSet(input.candidate_set),
    question_key: input.question_key,
  });
  return indexerMaterialAnswerReviewInspectionInputSchema.parse(
    withDigest(payload, "input_digest"),
  );
}

export function validateIndexerMaterialAnswerReviewInspectionInput(
  value: unknown,
): IndexerMaterialAnswerReviewInspectionInput {
  const input = indexerMaterialAnswerReviewInspectionInputSchema.parse(value);
  if (indexerProtocolDigest(withoutDigest(input, "input_digest")) !== input.input_digest) {
    throw new TypeError("material-answer Review inspection input digest is invalid");
  }
  return input;
}

export function inspectIndexerMaterialAnswerReview(
  value: unknown,
): IndexerMaterialAnswerReviewInspectionResult {
  const input = validateIndexerMaterialAnswerReviewInspectionInput(value);
  const baselineReport = buildIndexerMaterialAnswerBaselineReport({
    workset: input.workset,
    candidate_set: input.candidate_set,
    question_key: input.question_key,
  });
  const payload = inspectionResultPayloadSchema.parse({
    protocol: "context.indexer.material-answer-review-inspection-result/v1",
    state: "review-required",
    review_scope: INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE,
    input_digest: input.input_digest,
    workset_digest: input.workset.workset_digest,
    candidate_set_digest: input.candidate_set.candidate_set_digest,
    baseline_report: baselineReport,
  });
  return indexerMaterialAnswerReviewInspectionResultSchema.parse(
    withDigest(payload, "result_digest"),
  );
}

export function buildIndexerMaterialAnswerReviewResolutionInput(input: {
  ledger: unknown;
  workset: unknown;
  candidate_set: unknown;
  baseline_report: unknown;
  decision: "approved" | "rejected";
}): IndexerMaterialAnswerReviewResolutionInput {
  const payload = resolutionInputPayloadSchema.parse({
    protocol: "context.indexer.material-answer-review-resolution-input/v1",
    ledger: validateIndexerMaterialGapLedger(input.ledger),
    workset: validateIndexerMaterialQuestionWorkset(input.workset),
    candidate_set: validateIndexerMaterialAnswerCandidateSet(input.candidate_set),
    baseline_report: validateIndexerMaterialAnswerBaselineReport(input.baseline_report),
    decision: input.decision,
  });
  return indexerMaterialAnswerReviewResolutionInputSchema.parse(
    withDigest(payload, "input_digest"),
  );
}

export function validateIndexerMaterialAnswerReviewResolutionInput(
  value: unknown,
): IndexerMaterialAnswerReviewResolutionInput {
  const input = indexerMaterialAnswerReviewResolutionInputSchema.parse(value);
  if (indexerProtocolDigest(withoutDigest(input, "input_digest")) !== input.input_digest) {
    throw new TypeError("material-answer Review resolution input digest is invalid");
  }
  if (
    input.ledger.revision !== input.workset.predecessor_ledger_revision ||
    input.candidate_set.workset_digest !== input.workset.workset_digest
  ) {
    throw new TypeError("material-answer Review resolution input is stale");
  }
  const expectedBaseline = buildIndexerMaterialAnswerBaselineReport({
    workset: input.workset,
    candidate_set: input.candidate_set,
    question_key: input.baseline_report.question_key,
  });
  if (canonicalIndexerJson(expectedBaseline) !== canonicalIndexerJson(input.baseline_report)) {
    throw new TypeError("material-answer Review baseline is stale");
  }
  return input;
}

export function resolveIndexerMaterialAnswerReview(
  value: unknown,
): IndexerMaterialAnswerReviewResolutionResult {
  const input = validateIndexerMaterialAnswerReviewResolutionInput(value);
  const reviewDecision = decideIndexerMaterialAnswerReview({
    baseline_report: input.baseline_report,
    decision: input.decision,
  });
  const base = {
    protocol: "context.indexer.material-answer-review-resolution-result/v1" as const,
    review_scope: INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE,
    input_digest: input.input_digest,
    workset_digest: input.workset.workset_digest,
    candidate_set_digest: input.candidate_set.candidate_set_digest,
    baseline_report_digest: input.baseline_report.report_digest,
    review_decision: reviewDecision,
  };
  if (input.decision === "rejected") {
    const payload = rejectedReviewResolutionSchema.omit({ result_digest: true }).parse({
      ...base,
      state: "rejected",
    });
    return indexerMaterialAnswerReviewResolutionResultSchema.parse(
      withDigest(payload, "result_digest"),
    );
  }
  const approved = approveIndexerMaterialAnswer({
    ledger: input.ledger,
    workset: input.workset,
    candidate_set: input.candidate_set,
    baseline_report: input.baseline_report,
    review_decision: reviewDecision,
  });
  const payload = approvedReviewResolutionSchema.omit({ result_digest: true }).parse({
    ...base,
    state: "approved",
    answer_approval: {
      predecessor_ledger_revision: input.ledger.revision,
      successor_ledger: approved.ledger,
      consumed_workset_digest: approved.consumed_workset_digest,
      binding_digest: approved.binding_digest,
    },
  });
  return indexerMaterialAnswerReviewResolutionResultSchema.parse(
    withDigest(payload, "result_digest"),
  );
}
