import { z } from "zod";
import {
  indexerCanonicalRefSchema,
  indexerLayerCompositionInputSchema,
  validateIndexerLayerCompositionInput,
} from "./indexerLayerComposition.js";
import {
  indexerMaterialAnswerResultSchema,
  validateIndexerMaterialAnswerResult,
  type IndexerCurrentEvidenceSource,
  type IndexerMaterialAnswerCandidateSet,
  type IndexerMaterialAnswerResult,
  type IndexerSourceSpanRef,
} from "./indexerMaterialAnswer.js";
import {
  indexerMaterialQuestionWorksetSchema,
  validateIndexerMaterialQuestionWorkset,
} from "./indexerMaterialQuestionWorkset.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { indexerRunFinalAuthoritySchema } from "./indexerRunProtocolCommon.js";

export const indexerMaterialAnswerRunRequestSchema = z.object({
  protocol: z.literal("context.indexer.run-request/v1"),
  operation: z.literal("material-answer"),
  workset: indexerMaterialQuestionWorksetSchema,
  answer_indexer_id: indexerIdSchema,
  eligible_question_keys: z.array(indexerCanonicalRefSchema).min(1),
  composition_input: indexerLayerCompositionInputSchema,
  final_authority: indexerRunFinalAuthoritySchema,
  answer_provider_composition_fingerprint: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
}).strict();

export type IndexerMaterialAnswerRunRequest = z.infer<
  typeof indexerMaterialAnswerRunRequestSchema
>;

export function indexerMaterialAnswerRunRequestDigest(
  value: Omit<IndexerMaterialAnswerRunRequest, "execution_request_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerMaterialAnswerRunRequest(input: {
  workset: IndexerMaterialAnswerRunRequest["workset"];
  answer_indexer_id: string;
  composition_input: IndexerMaterialAnswerRunRequest["composition_input"];
  final_authority: IndexerMaterialAnswerRunRequest["final_authority"];
  answer_provider_composition_fingerprint: string;
}): IndexerMaterialAnswerRunRequest {
  const workset = validateIndexerMaterialQuestionWorkset(input.workset);
  const answerIndexerId = indexerIdSchema.parse(input.answer_indexer_id);
  const eligibleQuestionKeys = workset.items.filter((item) =>
    item.eligible_answer_indexer_ids.includes(answerIndexerId) &&
    item.authorized_source_refs.length > 0
  ).map((item) => item.question_key).sort(compareIndexerCanonicalText);
  if (eligibleQuestionKeys.length === 0) {
    throw new TypeError("material-answer request has no eligible question for its Indexer");
  }
  const compositionInput = validateIndexerLayerCompositionInput(input.composition_input);
  const finalAuthority = indexerRunFinalAuthoritySchema.parse(input.final_authority);
  const providerFingerprint = indexerDigestSchema.parse(
    input.answer_provider_composition_fingerprint,
  );
  if (
    compositionInput.workset_digest !== workset.workset_digest ||
    compositionInput.final_authority_layer_ref !== finalAuthority.layer_ref
  ) {
    throw new TypeError(
      "material-answer composition input does not match workset/final authority",
    );
  }
  const payload: Omit<IndexerMaterialAnswerRunRequest, "execution_request_digest"> = {
    protocol: "context.indexer.run-request/v1",
    operation: "material-answer",
    workset,
    answer_indexer_id: answerIndexerId,
    eligible_question_keys: eligibleQuestionKeys,
    composition_input: compositionInput,
    final_authority: finalAuthority,
    answer_provider_composition_fingerprint: providerFingerprint,
  };
  return indexerMaterialAnswerRunRequestSchema.parse({
    ...payload,
    execution_request_digest: indexerMaterialAnswerRunRequestDigest(payload),
  });
}

export function validateIndexerMaterialAnswerRunRequest(
  value: unknown,
): IndexerMaterialAnswerRunRequest {
  const request = indexerMaterialAnswerRunRequestSchema.parse(value);
  const rebuilt = buildIndexerMaterialAnswerRunRequest(request);
  if (rebuilt.execution_request_digest !== request.execution_request_digest) {
    throw new TypeError("material-answer execution request digest is invalid");
  }
  return request;
}

export const indexerMaterialAnswerRunResultSchema = z.object({
  protocol: z.literal("context.indexer.run-result/v1"),
  operation: z.literal("material-answer"),
  consumed_input_view_digest: indexerDigestSchema,
  result: indexerMaterialAnswerResultSchema,
}).strict();

export type IndexerMaterialAnswerRunResult = z.infer<
  typeof indexerMaterialAnswerRunResultSchema
>;

export function validateIndexerMaterialAnswerRunResult(input: {
  request: unknown;
  result: unknown;
  current_sources: readonly IndexerCurrentEvidenceSource[];
  resolve_evidence_digest: (input: {
    source: IndexerCurrentEvidenceSource;
    source_spans: readonly IndexerSourceSpanRef[];
  }) => string;
}): {
  request: IndexerMaterialAnswerRunRequest;
  result: IndexerMaterialAnswerRunResult;
  operation_result: IndexerMaterialAnswerResult;
  candidate_set: IndexerMaterialAnswerCandidateSet;
} {
  const request = validateIndexerMaterialAnswerRunRequest(input.request);
  const result = indexerMaterialAnswerRunResultSchema.parse(input.result);
  if (
    result.consumed_input_view_digest !== request.composition_input.view_digest ||
    result.result.workset_digest !== request.workset.workset_digest ||
    result.result.execution_request_digest !== request.execution_request_digest ||
    result.result.answer_indexer_id !== request.answer_indexer_id ||
    result.result.bindings.some((binding) =>
      !request.eligible_question_keys.includes(binding.question_key)
    )
  ) {
    throw new TypeError(
      "material-answer Result does not match its request/workset/input view",
    );
  }
  const validated = validateIndexerMaterialAnswerResult({
    result: result.result,
    workset: request.workset,
    expected_execution_request_digest: request.execution_request_digest,
    expected_provider_composition_fingerprint:
      request.answer_provider_composition_fingerprint,
    current_sources: input.current_sources,
    resolve_evidence_digest: input.resolve_evidence_digest,
  });
  return {
    request,
    result,
    operation_result: validated.result,
    candidate_set: validated.candidate_set,
  };
}
