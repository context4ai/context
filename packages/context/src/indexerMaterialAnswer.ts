import { z } from "zod";
import {
  indexerCanonicalRefSchema,
} from "./indexerLayerComposition.js";
import {
  INDEXER_EVIDENCE_KINDS,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  type IndexerEvidenceKind,
} from "./indexerProtocolCommon.js";
import {
  validateIndexerMaterialQuestionWorkset,
  type IndexerMaterialQuestionWorkset,
  type IndexerMaterialQuestionWorksetItem,
} from "./indexerMaterialQuestionWorkset.js";
import { evaluateIndexerRestrictedSelector } from "./indexerRestrictedSelector.js";

export const INDEXER_EVIDENCE_PROVENANCE_FACT_PATHS = [
  "content.digest",
  "evidence.kind",
  "locator.valid",
  "snapshot.current",
  "snapshot.digest",
  "source.origin_ref",
  "source.ref",
  "source.role",
  "tool.trust",
] as const;

export const indexerSourceSpanRefSchema = z.object({
  unit: z.enum(["byte", "line"]),
  start: z.number().int().nonnegative(),
  end_exclusive: z.number().int().positive(),
}).strict().superRefine((span, context) => {
  if (span.end_exclusive <= span.start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "end_exclusive must be greater than start",
      path: ["end_exclusive"],
    });
  }
});

export type IndexerSourceSpanRef = z.infer<typeof indexerSourceSpanRefSchema>;

export const indexerMaterialAnswerEvidenceClaimSchema = z.object({
  kind: z.enum(INDEXER_EVIDENCE_KINDS),
  source_ref: indexerCanonicalRefSchema,
  source_spans: z.array(indexerSourceSpanRefSchema).min(1),
  evidence_digest: indexerDigestSchema,
}).strict();

export type IndexerMaterialAnswerEvidenceClaim = z.infer<
  typeof indexerMaterialAnswerEvidenceClaimSchema
>;

const materialAnswerBindingSchema = z.object({
  workset_digest: indexerDigestSchema,
  question_key: indexerCanonicalRefSchema,
  question_revision_digest: indexerDigestSchema,
  evidence_claims: z.array(indexerMaterialAnswerEvidenceClaimSchema).min(1),
}).strict();

export const indexerMaterialAnswerResultSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-result/v1"),
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  answer_indexer_id: indexerIdSchema,
  answer_provider_composition_fingerprint: indexerDigestSchema,
  bindings: z.array(materialAnswerBindingSchema),
  result_digest: indexerDigestSchema,
}).strict();

export type IndexerMaterialAnswerBinding = z.infer<typeof materialAnswerBindingSchema>;
export type IndexerMaterialAnswerResult = z.infer<
  typeof indexerMaterialAnswerResultSchema
>;

export function indexerMaterialAnswerResultDigest(
  value: Omit<IndexerMaterialAnswerResult, "result_digest">,
): string {
  return indexerProtocolDigest(value);
}

export const indexerCurrentEvidenceSourceSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  source_origin_ref: indexerCanonicalRefSchema,
  source_input_digest: indexerDigestSchema,
  source_role: indexerIdSchema,
  evidence_kinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)).min(1),
  span_unit: z.enum(["byte", "line"]),
  span_extent: z.number().int().positive(),
  snapshot_current: z.literal(true),
  locator_valid: z.literal(true),
  tool_trust: indexerIdSchema,
}).strict();

export type IndexerCurrentEvidenceSource = z.infer<
  typeof indexerCurrentEvidenceSourceSchema
>;

export const indexerCanonicalMaterialAnswerEvidenceSchema = z.object({
  evidence_item_ref: indexerCanonicalRefSchema,
  kind: z.enum(INDEXER_EVIDENCE_KINDS),
  source_ref: indexerCanonicalRefSchema,
  source_origin_ref: indexerCanonicalRefSchema,
  source_input_digest: indexerDigestSchema,
  source_spans: z.array(indexerSourceSpanRefSchema).min(1),
  evidence_digest: indexerDigestSchema,
}).strict();

export type IndexerCanonicalMaterialAnswerEvidence = z.infer<
  typeof indexerCanonicalMaterialAnswerEvidenceSchema
>;

const materialAnswerCandidateSchema = z.object({
  state: z.literal("candidate"),
  question_key: indexerCanonicalRefSchema,
  question_revision_digest: indexerDigestSchema,
  binding_digest: indexerDigestSchema,
  evidence_item_count: z.number().int().positive(),
  distinct_source_count: z.number().int().positive(),
  evidence: z.array(indexerCanonicalMaterialAnswerEvidenceSchema).min(1),
}).strict();

const insufficientReasonSchema = z.enum([
  "minimum-items-not-met",
  "minimum-distinct-sources-not-met",
  "provenance-constraint-not-met",
]);

const materialAnswerInsufficientSchema = z.object({
  state: z.literal("material-answer-evidence-insufficient"),
  question_key: indexerCanonicalRefSchema,
  question_revision_digest: indexerDigestSchema,
  reason_codes: z.array(insufficientReasonSchema).min(1),
  accepted_evidence_item_count: z.number().int().nonnegative(),
  distinct_source_count: z.number().int().nonnegative(),
  rejected_evidence_item_refs: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerMaterialAnswerCandidateSetSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-candidate-set/v1"),
  candidate_set_digest: indexerDigestSchema,
  workset_digest: indexerDigestSchema,
  answer_result_digest: indexerDigestSchema,
  answer_indexer_id: indexerIdSchema,
  answer_provider_composition_fingerprint: indexerDigestSchema,
  evaluations: z.array(z.union([
    materialAnswerCandidateSchema,
    materialAnswerInsufficientSchema,
  ])),
}).strict();

export type IndexerMaterialAnswerCandidate = z.infer<
  typeof materialAnswerCandidateSchema
>;
export type IndexerMaterialAnswerEvaluation =
  | IndexerMaterialAnswerCandidate
  | z.infer<typeof materialAnswerInsufficientSchema>;
export type IndexerMaterialAnswerCandidateSet = z.infer<
  typeof indexerMaterialAnswerCandidateSetSchema
>;

export function indexerEvidenceItemRef(input: {
  kind: IndexerEvidenceKind;
  source_origin_ref: string;
  source_input_digest: string;
  source_spans: readonly IndexerSourceSpanRef[];
  evidence_digest: string;
}): string {
  return `evidence-item:${indexerProtocolDigest(input)}`;
}

export function indexerMaterialAnswerBindingDigest(input: {
  accepted_workset_digest: string;
  question_key: string;
  question_revision_digest: string;
  answer_indexer_id: string;
  answer_provider_composition_fingerprint: string;
  answer_result_digest: string;
  evidence: readonly IndexerCanonicalMaterialAnswerEvidence[];
}): string {
  return indexerProtocolDigest(input);
}

export function normalizeIndexerSourceSpans(input: {
  spans: readonly IndexerSourceSpanRef[];
  source: IndexerCurrentEvidenceSource;
}): IndexerSourceSpanRef[] {
  const source = indexerCurrentEvidenceSourceSchema.parse(input.source);
  const spans = input.spans.map((span) => indexerSourceSpanRefSchema.parse(span))
    .sort((left, right) =>
      left.start - right.start || right.end_exclusive - left.end_exclusive
    );
  const normalized: IndexerSourceSpanRef[] = [];
  for (const span of spans) {
    if (span.unit !== source.span_unit || span.end_exclusive > source.span_extent) {
      throw new TypeError(`evidence span is outside current source ${source.source_ref}`);
    }
    const previous = normalized.at(-1);
    if (previous === undefined || span.start >= previous.end_exclusive) {
      normalized.push(span);
      continue;
    }
    if (span.end_exclusive <= previous.end_exclusive) continue;
    throw new TypeError("partially overlapping evidence spans are not canonical");
  }
  return normalized;
}

function parseAndValidateResult(input: {
  result: unknown;
  workset: IndexerMaterialQuestionWorkset;
  expected_execution_request_digest: string;
  expected_provider_composition_fingerprint: string;
}): IndexerMaterialAnswerResult {
  const result = indexerMaterialAnswerResultSchema.parse(input.result);
  if (
    result.workset_digest !== input.workset.workset_digest ||
    result.execution_request_digest !== input.expected_execution_request_digest ||
    result.answer_provider_composition_fingerprint !==
      input.expected_provider_composition_fingerprint
  ) {
    throw new TypeError("MaterialAnswerResult does not match its workset/request/Provider");
  }
  const payload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
    protocol: result.protocol,
    workset_digest: result.workset_digest,
    execution_request_digest: result.execution_request_digest,
    answer_indexer_id: result.answer_indexer_id,
    answer_provider_composition_fingerprint:
      result.answer_provider_composition_fingerprint,
    bindings: result.bindings,
  };
  if (indexerMaterialAnswerResultDigest(payload) !== result.result_digest) {
    throw new TypeError("MaterialAnswerResult digest is invalid");
  }
  const keys = result.bindings.map((binding) => binding.question_key);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("MaterialAnswerResult contains duplicate question bindings");
  }
  return result;
}

function canonicalizeClaim(input: {
  claim: IndexerMaterialAnswerEvidenceClaim;
  workset_source_input_digests: readonly string[];
  workset_item: IndexerMaterialQuestionWorksetItem;
  source: IndexerCurrentEvidenceSource;
  resolve_evidence_digest: (input: {
    source: IndexerCurrentEvidenceSource;
    source_spans: readonly IndexerSourceSpanRef[];
  }) => string;
}): IndexerCanonicalMaterialAnswerEvidence {
  const claim = indexerMaterialAnswerEvidenceClaimSchema.parse(input.claim);
  const source = indexerCurrentEvidenceSourceSchema.parse(input.source);
  if (
    claim.source_ref !== source.source_ref ||
    !input.workset_item.authorized_source_refs.includes(claim.source_ref) ||
    !input.workset_source_input_digests.includes(source.source_input_digest)
  ) {
    throw new TypeError("evidence claim does not reference an authorized current source");
  }
  if (
    !input.workset_item.question.evidence_contract.accepted_kinds.includes(claim.kind) ||
    !source.evidence_kinds.includes(claim.kind)
  ) {
    throw new TypeError("evidence claim kind is not compatible with question/source authority");
  }
  const sourceSpans = normalizeIndexerSourceSpans({
    spans: claim.source_spans,
    source,
  });
  const actualEvidenceDigest = indexerDigestSchema.parse(
    input.resolve_evidence_digest({ source, source_spans: sourceSpans }),
  );
  if (actualEvidenceDigest !== claim.evidence_digest) {
    throw new TypeError("evidence content digest does not match the current source spans");
  }
  return indexerCanonicalMaterialAnswerEvidenceSchema.parse({
    evidence_item_ref: indexerEvidenceItemRef({
      kind: claim.kind,
      source_origin_ref: source.source_origin_ref,
      source_input_digest: source.source_input_digest,
      source_spans: sourceSpans,
      evidence_digest: claim.evidence_digest,
    }),
    kind: claim.kind,
    source_ref: claim.source_ref,
    source_origin_ref: source.source_origin_ref,
    source_input_digest: source.source_input_digest,
    source_spans: sourceSpans,
    evidence_digest: claim.evidence_digest,
  });
}

function evidenceProvenanceFacts(
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

function evaluateBinding(input: {
  binding: IndexerMaterialAnswerBinding;
  result: IndexerMaterialAnswerResult;
  workset_source_input_digests: readonly string[];
  workset_item: IndexerMaterialQuestionWorksetItem;
  source_by_ref: ReadonlyMap<string, IndexerCurrentEvidenceSource>;
  resolve_evidence_digest: (input: {
    source: IndexerCurrentEvidenceSource;
    source_spans: readonly IndexerSourceSpanRef[];
  }) => string;
}): IndexerMaterialAnswerEvaluation {
  const canonicalClaims = input.binding.evidence_claims.map((claim) => {
    const source = input.source_by_ref.get(claim.source_ref);
    if (source === undefined) {
      throw new TypeError(`evidence source ${claim.source_ref} is not current`);
    }
    return canonicalizeClaim({
      claim,
      workset_source_input_digests: input.workset_source_input_digests,
      workset_item: input.workset_item,
      source,
      resolve_evidence_digest: input.resolve_evidence_digest,
    });
  });
  const provenance = input.workset_item.question.evidence_contract.provenance_constraints;
  const acceptedClaims = canonicalClaims.filter((evidence) => {
    if (provenance === undefined) return true;
    const source = input.source_by_ref.get(evidence.source_ref)!;
    return evaluateIndexerRestrictedSelector({
      selector: provenance,
      facts: evidenceProvenanceFacts(evidence, source),
      allowed_fact_paths: new Set(INDEXER_EVIDENCE_PROVENANCE_FACT_PATHS),
    });
  });
  const canonicalByItem = new Map<string, IndexerCanonicalMaterialAnswerEvidence>();
  for (const evidence of acceptedClaims) {
    const previous = canonicalByItem.get(evidence.evidence_item_ref);
    if (previous === undefined || evidence.source_ref < previous.source_ref) {
      canonicalByItem.set(evidence.evidence_item_ref, evidence);
    }
  }
  const evidence = [...canonicalByItem.values()].sort((left, right) =>
    compareIndexerCanonicalText(left.evidence_item_ref, right.evidence_item_ref)
  );
  const acceptedRefs = new Set(evidence.map((item) => item.evidence_item_ref));
  const rejected = [...new Set(canonicalClaims
    .map((item) => item.evidence_item_ref)
    .filter((ref) => !acceptedRefs.has(ref)))].sort();
  const distinctSources = new Set(evidence.map((item) => item.source_origin_ref)).size;
  const contract = input.workset_item.question.evidence_contract;
  const reasons: Array<z.infer<typeof insufficientReasonSchema>> = [];
  if (evidence.length < contract.minimum_items) reasons.push("minimum-items-not-met");
  if (distinctSources < contract.minimum_distinct_sources) {
    reasons.push("minimum-distinct-sources-not-met");
  }
  if (rejected.length > 0) reasons.push("provenance-constraint-not-met");
  if (reasons.length > 0) {
    return materialAnswerInsufficientSchema.parse({
      state: "material-answer-evidence-insufficient",
      question_key: input.binding.question_key,
      question_revision_digest: input.binding.question_revision_digest,
      reason_codes: reasons,
      accepted_evidence_item_count: evidence.length,
      distinct_source_count: distinctSources,
      rejected_evidence_item_refs: rejected,
    });
  }
  const bindingPayload = {
    accepted_workset_digest: input.binding.workset_digest,
    question_key: input.binding.question_key,
    question_revision_digest: input.binding.question_revision_digest,
    answer_indexer_id: input.result.answer_indexer_id,
    answer_provider_composition_fingerprint:
      input.result.answer_provider_composition_fingerprint,
    answer_result_digest: input.result.result_digest,
    evidence,
  };
  return materialAnswerCandidateSchema.parse({
    state: "candidate",
    question_key: input.binding.question_key,
    question_revision_digest: input.binding.question_revision_digest,
    binding_digest: indexerMaterialAnswerBindingDigest(bindingPayload),
    evidence_item_count: evidence.length,
    distinct_source_count: distinctSources,
    evidence,
  });
}

export function validateIndexerMaterialAnswerResult(input: {
  result: unknown;
  workset: unknown;
  expected_execution_request_digest: string;
  expected_provider_composition_fingerprint: string;
  current_sources: readonly IndexerCurrentEvidenceSource[];
  resolve_evidence_digest: (input: {
    source: IndexerCurrentEvidenceSource;
    source_spans: readonly IndexerSourceSpanRef[];
  }) => string;
}): {
  result: IndexerMaterialAnswerResult;
  candidate_set: IndexerMaterialAnswerCandidateSet;
} {
  const workset = validateIndexerMaterialQuestionWorkset(input.workset);
  const result = parseAndValidateResult({
    result: input.result,
    workset,
    expected_execution_request_digest: input.expected_execution_request_digest,
    expected_provider_composition_fingerprint:
      input.expected_provider_composition_fingerprint,
  });
  const sourceByRef = new Map(input.current_sources.map((source) => {
    const parsed = indexerCurrentEvidenceSourceSchema.parse(source);
    return [parsed.source_ref, parsed] as const;
  }));
  if (sourceByRef.size !== input.current_sources.length) {
    throw new TypeError("current evidence source registrations must be unique");
  }
  const worksetByQuestion = new Map(
    workset.items.map((item) => [item.question_key, item]),
  );
  const evaluations = result.bindings.map((binding) => {
    if (binding.workset_digest !== workset.workset_digest) {
      throw new TypeError("MaterialAnswerBinding belongs to another workset");
    }
    const item = worksetByQuestion.get(binding.question_key);
    if (
      item === undefined ||
      binding.question_revision_digest !== item.question_revision_digest ||
      !item.eligible_answer_indexer_ids.includes(result.answer_indexer_id)
    ) {
      throw new TypeError("MaterialAnswerBinding is not authorized by the workset");
    }
    return evaluateBinding({
      binding,
      result,
      workset_source_input_digests: workset.source_input_digests,
      workset_item: item,
      source_by_ref: sourceByRef,
      resolve_evidence_digest: input.resolve_evidence_digest,
    });
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.question_key, right.question_key)
  );
  const payload = {
    protocol: "context.indexer.material-answer-candidate-set/v1" as const,
    workset_digest: workset.workset_digest,
    answer_result_digest: result.result_digest,
    answer_indexer_id: result.answer_indexer_id,
    answer_provider_composition_fingerprint:
      result.answer_provider_composition_fingerprint,
    evaluations,
  };
  const candidateSet = indexerMaterialAnswerCandidateSetSchema.parse({
    ...payload,
    candidate_set_digest: indexerProtocolDigest(payload),
  });
  return { result, candidate_set: candidateSet };
}

export function validateIndexerMaterialAnswerCandidateSet(
  value: unknown,
): IndexerMaterialAnswerCandidateSet {
  const candidateSet = indexerMaterialAnswerCandidateSetSchema.parse(value);
  const payload = Object.fromEntries(
    Object.entries(candidateSet).filter(([key]) => key !== "candidate_set_digest"),
  ) as Omit<IndexerMaterialAnswerCandidateSet, "candidate_set_digest">;
  if (indexerProtocolDigest(payload) !== candidateSet.candidate_set_digest) {
    throw new TypeError("MaterialAnswerCandidateSet digest is invalid");
  }
  const questionKeys = candidateSet.evaluations.map((item) => item.question_key);
  if (
    new Set(questionKeys).size !== questionKeys.length ||
    questionKeys.some((key, index) => index > 0 && key < questionKeys[index - 1]!)
  ) {
    throw new TypeError("MaterialAnswerCandidateSet evaluations are not canonical");
  }
  for (const evaluation of candidateSet.evaluations) {
    if (evaluation.state !== "candidate") continue;
    const evidenceRefs = evaluation.evidence.map((item) => item.evidence_item_ref);
    if (
      new Set(evidenceRefs).size !== evidenceRefs.length ||
      evidenceRefs.some((ref, index) => index > 0 && ref < evidenceRefs[index - 1]!) ||
      evaluation.evidence_item_count !== evidenceRefs.length ||
      evaluation.distinct_source_count !==
        new Set(evaluation.evidence.map((item) => item.source_origin_ref)).size
    ) {
      throw new TypeError("MaterialAnswer candidate evidence is not canonical");
    }
    const expectedBindingDigest = indexerMaterialAnswerBindingDigest({
      accepted_workset_digest: candidateSet.workset_digest,
      question_key: evaluation.question_key,
      question_revision_digest: evaluation.question_revision_digest,
      answer_indexer_id: candidateSet.answer_indexer_id,
      answer_provider_composition_fingerprint:
        candidateSet.answer_provider_composition_fingerprint,
      answer_result_digest: candidateSet.answer_result_digest,
      evidence: evaluation.evidence,
    });
    if (expectedBindingDigest !== evaluation.binding_digest) {
      throw new TypeError("MaterialAnswer candidate binding digest is invalid");
    }
  }
  return candidateSet;
}
