import { z } from "zod";
import {
  INDEXER_EVIDENCE_PROVENANCE_FACT_PATHS,
  indexerCanonicalMaterialAnswerEvidenceSchema,
  indexerCurrentEvidenceSourceSchema,
  indexerEvidenceItemRef,
  normalizeIndexerSourceSpans,
  validateIndexerMaterialAnswerCandidateSet,
  type IndexerCanonicalMaterialAnswerEvidence,
  type IndexerCurrentEvidenceSource,
  type IndexerMaterialAnswerCandidateSet,
  type IndexerSourceSpanRef,
} from "./indexerMaterialAnswer.js";
import {
  validateIndexerMaterialQuestionWorkset,
} from "./indexerMaterialQuestionWorkset.js";
import {
  indexerResolvedMaterialQuestionSchema,
  type IndexerResolvedMaterialQuestion,
} from "./indexerQuestionAuthority.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { evaluateIndexerRestrictedSelector } from "./indexerRestrictedSelector.js";

export const INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE =
  "question-target-source-span-evidence-binding" as const;

const compatibilityReasonSchema = z.enum([
  "question-contract-stale",
  "source-input-set-stale",
  "evidence-source-missing",
  "source-origin-stale",
  "source-input-stale",
  "evidence-kind-incompatible",
  "source-kind-incompatible",
  "evidence-span-stale",
  "evidence-content-stale",
  "provenance-constraint-not-met",
  "minimum-items-not-met",
  "minimum-distinct-sources-not-met",
]);

export type IndexerMaterialAnswerCompatibilityReason = z.infer<
  typeof compatibilityReasonSchema
>;

const compatibilityBaseSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-evidence-compatibility/v1"),
  question_key: z.string().min(1),
  question_revision_digest: indexerDigestSchema,
  question_contract_digest: indexerDigestSchema,
  binding_digest: indexerDigestSchema,
  expected_source_input_set_digest: indexerDigestSchema,
  current_source_input_set_digest: indexerDigestSchema,
  accepted_evidence_item_refs: z.array(z.string().min(1)),
  rejected_evidence_item_refs: z.array(z.string().min(1)),
  accepted_evidence_item_count: z.number().int().nonnegative(),
  distinct_source_count: z.number().int().nonnegative(),
  compatibility_digest: indexerDigestSchema,
});

const compatibleEvidenceSchema = compatibilityBaseSchema.extend({
  state: z.literal("compatible"),
  reason_codes: z.array(compatibilityReasonSchema).length(0),
}).strict();

const incompatibleEvidenceSchema = compatibilityBaseSchema.extend({
  state: z.literal("incompatible"),
  reason_codes: z.array(compatibilityReasonSchema).min(1),
}).strict();

export const indexerMaterialAnswerEvidenceCompatibilitySchema =
  z.discriminatedUnion("state", [
    compatibleEvidenceSchema,
    incompatibleEvidenceSchema,
  ]);

export type IndexerMaterialAnswerEvidenceCompatibility = z.infer<
  typeof indexerMaterialAnswerEvidenceCompatibilitySchema
>;

export function indexerMaterialAnswerSourceInputSetDigest(
  sourceInputDigests: readonly string[],
): string {
  const digests = sourceInputDigests.map((digest) => indexerDigestSchema.parse(digest))
    .sort(compareIndexerCanonicalText);
  if (new Set(digests).size !== digests.length) {
    throw new TypeError("material-answer source input digests must be unique");
  }
  return indexerProtocolDigest({ inputs: digests });
}

function compatibilityPayload(
  report: IndexerMaterialAnswerEvidenceCompatibility,
): Omit<IndexerMaterialAnswerEvidenceCompatibility, "compatibility_digest"> {
  const { compatibility_digest: _digest, ...payload } = report;
  void _digest;
  return payload;
}

export function validateIndexerMaterialAnswerEvidenceCompatibility(
  value: unknown,
): IndexerMaterialAnswerEvidenceCompatibility {
  const report = indexerMaterialAnswerEvidenceCompatibilitySchema.parse(value);
  if (indexerProtocolDigest(compatibilityPayload(report)) !== report.compatibility_digest) {
    throw new TypeError("material-answer evidence compatibility digest is invalid");
  }
  const accepted = report.accepted_evidence_item_refs;
  const rejected = report.rejected_evidence_item_refs;
  if (
    canonicalIndexerJson(accepted) !== canonicalIndexerJson([...accepted].sort()) ||
    canonicalIndexerJson(rejected) !== canonicalIndexerJson([...rejected].sort()) ||
    new Set([...accepted, ...rejected]).size !== accepted.length + rejected.length ||
    report.accepted_evidence_item_count !== accepted.length
  ) {
    throw new TypeError("material-answer evidence compatibility refs are not canonical");
  }
  const reasons = report.reason_codes;
  if (
    canonicalIndexerJson(reasons) !== canonicalIndexerJson([...new Set(reasons)].sort())
  ) {
    throw new TypeError("material-answer compatibility reasons are not canonical");
  }
  return report;
}

function provenanceFacts(
  evidence: IndexerCanonicalMaterialAnswerEvidence,
  source: IndexerCurrentEvidenceSource,
): Record<string, unknown> {
  return {
    content: { digest: evidence.evidence_digest },
    evidence: { kind: evidence.kind },
    locator: { valid: source.locator_valid },
    snapshot: {
      current: source.snapshot_current,
      digest: source.source_input_digest,
    },
    source: {
      origin_ref: source.source_origin_ref,
      ref: source.source_ref,
      role: source.source_role,
    },
    tool: { trust: source.tool_trust },
  };
}

function appendReason(
  reasons: Set<IndexerMaterialAnswerCompatibilityReason>,
  reason: IndexerMaterialAnswerCompatibilityReason,
): void {
  reasons.add(reason);
}

export function evaluateIndexerMaterialAnswerEvidenceCompatibility(input: {
  question_key: string;
  question_revision_digest: string;
  question_contract_digest: string;
  binding_digest: string;
  expected_source_input_set_digest: string;
  current_source_input_digests: readonly string[];
  current_question: IndexerResolvedMaterialQuestion;
  evidence: readonly IndexerCanonicalMaterialAnswerEvidence[];
  current_sources: readonly IndexerCurrentEvidenceSource[];
  resolve_evidence_digest: (input: {
    source: IndexerCurrentEvidenceSource;
    source_spans: readonly IndexerSourceSpanRef[];
  }) => string;
}): IndexerMaterialAnswerEvidenceCompatibility {
  const question = indexerResolvedMaterialQuestionSchema.parse(input.current_question);
  const evidence = input.evidence.map((item) =>
    indexerCanonicalMaterialAnswerEvidenceSchema.parse(item)
  );
  const sources = input.current_sources.map((source) =>
    indexerCurrentEvidenceSourceSchema.parse(source)
  );
  const sourceByRef = new Map(sources.map((source) => [source.source_ref, source]));
  if (sourceByRef.size !== sources.length) {
    throw new TypeError("current evidence source registrations must be unique");
  }
  const expectedSourceSet = indexerDigestSchema.parse(
    input.expected_source_input_set_digest,
  );
  const currentSourceSet = indexerMaterialAnswerSourceInputSetDigest(
    input.current_source_input_digests,
  );
  const reasons = new Set<IndexerMaterialAnswerCompatibilityReason>();
  if (question.contract_digest !== input.question_contract_digest) {
    appendReason(reasons, "question-contract-stale");
  }
  if (expectedSourceSet !== currentSourceSet) {
    appendReason(reasons, "source-input-set-stale");
  }
  const accepted: IndexerCanonicalMaterialAnswerEvidence[] = [];
  const rejected = new Set<string>();
  for (const item of evidence) {
    const itemReasons = new Set<IndexerMaterialAnswerCompatibilityReason>();
    const source = sourceByRef.get(item.source_ref);
    if (source === undefined) {
      itemReasons.add("evidence-source-missing");
    } else {
      if (source.source_origin_ref !== item.source_origin_ref) {
        itemReasons.add("source-origin-stale");
      }
      if (source.source_input_digest !== item.source_input_digest) {
        itemReasons.add("source-input-stale");
      }
      if (!question.evidence_contract.accepted_kinds.includes(item.kind)) {
        itemReasons.add("evidence-kind-incompatible");
      }
      if (!source.evidence_kinds.includes(item.kind)) {
        itemReasons.add("source-kind-incompatible");
      }
      try {
        const spans = normalizeIndexerSourceSpans({
          spans: item.source_spans,
          source,
        });
        if (canonicalIndexerJson(spans) !== canonicalIndexerJson(item.source_spans)) {
          itemReasons.add("evidence-span-stale");
        }
        const currentEvidenceDigest = indexerDigestSchema.parse(
          input.resolve_evidence_digest({ source, source_spans: spans }),
        );
        if (currentEvidenceDigest !== item.evidence_digest) {
          itemReasons.add("evidence-content-stale");
        }
        const currentItemRef = indexerEvidenceItemRef({
          kind: item.kind,
          source_origin_ref: source.source_origin_ref,
          source_input_digest: source.source_input_digest,
          source_spans: spans,
          evidence_digest: currentEvidenceDigest,
        });
        if (currentItemRef !== item.evidence_item_ref) {
          itemReasons.add("evidence-content-stale");
        }
      } catch {
        itemReasons.add("evidence-span-stale");
      }
      const provenance = question.evidence_contract.provenance_constraints;
      if (
        provenance !== undefined &&
        !evaluateIndexerRestrictedSelector({
          selector: provenance,
          facts: provenanceFacts(item, source),
          allowed_fact_paths: new Set(INDEXER_EVIDENCE_PROVENANCE_FACT_PATHS),
        })
      ) {
        itemReasons.add("provenance-constraint-not-met");
      }
    }
    if (itemReasons.size === 0) {
      accepted.push(item);
    } else {
      rejected.add(item.evidence_item_ref);
      itemReasons.forEach((reason) => reasons.add(reason));
    }
  }
  const acceptedRefs = accepted.map((item) => item.evidence_item_ref)
    .sort(compareIndexerCanonicalText);
  const distinctSources = new Set(accepted.map((item) => item.source_origin_ref)).size;
  if (accepted.length < question.evidence_contract.minimum_items) {
    appendReason(reasons, "minimum-items-not-met");
  }
  if (distinctSources < question.evidence_contract.minimum_distinct_sources) {
    appendReason(reasons, "minimum-distinct-sources-not-met");
  }
  const reasonCodes = [...reasons].sort(compareIndexerCanonicalText);
  const payload = {
    protocol: "context.indexer.material-answer-evidence-compatibility/v1" as const,
    question_key: input.question_key,
    question_revision_digest: indexerDigestSchema.parse(
      input.question_revision_digest,
    ),
    question_contract_digest: indexerDigestSchema.parse(
      input.question_contract_digest,
    ),
    binding_digest: indexerDigestSchema.parse(input.binding_digest),
    expected_source_input_set_digest: expectedSourceSet,
    current_source_input_set_digest: currentSourceSet,
    accepted_evidence_item_refs: acceptedRefs,
    rejected_evidence_item_refs: [...rejected].sort(compareIndexerCanonicalText),
    accepted_evidence_item_count: acceptedRefs.length,
    distinct_source_count: distinctSources,
    state: reasonCodes.length === 0 ? "compatible" as const : "incompatible" as const,
    reason_codes: reasonCodes,
  };
  return validateIndexerMaterialAnswerEvidenceCompatibility({
    ...payload,
    compatibility_digest: indexerProtocolDigest(payload),
  });
}

const materialAnswerBaselineReportPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-baseline-report/v1"),
  review_scope: z.literal(INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE),
  workset_digest: indexerDigestSchema,
  candidate_set_digest: indexerDigestSchema,
  question_key: z.string().min(1),
  question_contract_digest: indexerDigestSchema,
  question_revision_digest: indexerDigestSchema,
  question_target_item_digest: indexerDigestSchema,
  answer_landing_ref: z.string().min(1).optional(),
  binding_digest: indexerDigestSchema,
  evidence_item_refs: z.array(z.string().min(1)).min(1),
  evidence_set_digest: indexerDigestSchema,
  baseline_passed: z.literal(true),
}).strict();

export const indexerMaterialAnswerBaselineReportSchema =
  materialAnswerBaselineReportPayloadSchema.extend({
    report_digest: indexerDigestSchema,
  }).strict();

export type IndexerMaterialAnswerBaselineReport = z.infer<
  typeof indexerMaterialAnswerBaselineReportSchema
>;

export function buildIndexerMaterialAnswerBaselineReport(input: {
  workset: unknown;
  candidate_set: unknown;
  question_key: string;
}): IndexerMaterialAnswerBaselineReport {
  const workset = validateIndexerMaterialQuestionWorkset(input.workset);
  const candidateSet = validateIndexerMaterialAnswerCandidateSet(input.candidate_set);
  if (candidateSet.workset_digest !== workset.workset_digest) {
    throw new TypeError("material-answer baseline candidate belongs to another workset");
  }
  const item = workset.items.find((candidate) =>
    candidate.question_key === input.question_key
  );
  const candidate = candidateSet.evaluations.find((evaluation) =>
    evaluation.question_key === input.question_key && evaluation.state === "candidate"
  );
  if (item === undefined || candidate === undefined || candidate.state !== "candidate") {
    throw new TypeError("material-answer baseline requires a reviewable candidate");
  }
  if (candidate.question_revision_digest !== item.question_revision_digest) {
    throw new TypeError("material-answer baseline question revision is stale");
  }
  const evidenceItemRefs = candidate.evidence.map((evidence) =>
    evidence.evidence_item_ref
  ).sort(compareIndexerCanonicalText);
  const payload = materialAnswerBaselineReportPayloadSchema.parse({
    protocol: "context.indexer.material-answer-baseline-report/v1",
    review_scope: INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE,
    workset_digest: workset.workset_digest,
    candidate_set_digest: candidateSet.candidate_set_digest,
    question_key: item.question_key,
    question_contract_digest: item.question_contract_digest,
    question_revision_digest: item.question_revision_digest,
    question_target_item_digest: item.question.question_target_item_digest,
    ...(item.question.answer_landing_ref === undefined
      ? {}
      : { answer_landing_ref: item.question.answer_landing_ref }),
    binding_digest: candidate.binding_digest,
    evidence_item_refs: evidenceItemRefs,
    evidence_set_digest: indexerProtocolDigest({ evidence_item_refs: evidenceItemRefs }),
    baseline_passed: true,
  });
  return indexerMaterialAnswerBaselineReportSchema.parse({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerMaterialAnswerBaselineReport(
  value: unknown,
): IndexerMaterialAnswerBaselineReport {
  const report = indexerMaterialAnswerBaselineReportSchema.parse(value);
  const { report_digest: _digest, ...payload } = report;
  void _digest;
  if (indexerProtocolDigest(payload) !== report.report_digest) {
    throw new TypeError("material-answer baseline report digest is invalid");
  }
  if (
    new Set(report.evidence_item_refs).size !== report.evidence_item_refs.length ||
    canonicalIndexerJson(report.evidence_item_refs) !==
      canonicalIndexerJson([...report.evidence_item_refs].sort()) ||
    report.evidence_set_digest !== indexerProtocolDigest({
      evidence_item_refs: report.evidence_item_refs,
    })
  ) {
    throw new TypeError("material-answer baseline evidence set is not canonical");
  }
  return report;
}

const materialAnswerReviewDecisionPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-review-decision/v1"),
  review_scope: z.literal(INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE),
  baseline_report_digest: indexerDigestSchema,
  workset_digest: indexerDigestSchema,
  candidate_set_digest: indexerDigestSchema,
  question_key: z.string().min(1),
  question_revision_digest: indexerDigestSchema,
  binding_digest: indexerDigestSchema,
  decision: z.enum(["approved", "rejected"]),
}).strict();

export const indexerMaterialAnswerReviewDecisionSchema =
  materialAnswerReviewDecisionPayloadSchema.extend({
    decision_digest: indexerDigestSchema,
  }).strict();

export type IndexerMaterialAnswerReviewDecision = z.infer<
  typeof indexerMaterialAnswerReviewDecisionSchema
>;

export function decideIndexerMaterialAnswerReview(input: {
  baseline_report: unknown;
  decision: "approved" | "rejected";
}): IndexerMaterialAnswerReviewDecision {
  const report = validateIndexerMaterialAnswerBaselineReport(input.baseline_report);
  const payload = materialAnswerReviewDecisionPayloadSchema.parse({
    protocol: "context.indexer.material-answer-review-decision/v1",
    review_scope: INDEXER_MATERIAL_ANSWER_REVIEW_SCOPE,
    baseline_report_digest: report.report_digest,
    workset_digest: report.workset_digest,
    candidate_set_digest: report.candidate_set_digest,
    question_key: report.question_key,
    question_revision_digest: report.question_revision_digest,
    binding_digest: report.binding_digest,
    decision: input.decision,
  });
  return indexerMaterialAnswerReviewDecisionSchema.parse({
    ...payload,
    decision_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerMaterialAnswerReviewDecision(input: {
  decision: unknown;
  baseline_report: unknown;
  candidate_set: IndexerMaterialAnswerCandidateSet;
}): IndexerMaterialAnswerReviewDecision {
  const report = validateIndexerMaterialAnswerBaselineReport(input.baseline_report);
  const candidateSet = validateIndexerMaterialAnswerCandidateSet(input.candidate_set);
  const decision = indexerMaterialAnswerReviewDecisionSchema.parse(input.decision);
  const { decision_digest: _digest, ...payload } = decision;
  void _digest;
  if (indexerProtocolDigest(payload) !== decision.decision_digest) {
    throw new TypeError("material-answer Review decision digest is invalid");
  }
  if (
    report.candidate_set_digest !== candidateSet.candidate_set_digest ||
    decision.baseline_report_digest !== report.report_digest ||
    decision.workset_digest !== report.workset_digest ||
    decision.candidate_set_digest !== report.candidate_set_digest ||
    decision.question_key !== report.question_key ||
    decision.question_revision_digest !== report.question_revision_digest ||
    decision.binding_digest !== report.binding_digest
  ) {
    throw new TypeError("material-answer Review decision is not bound to its baseline");
  }
  return decision;
}
