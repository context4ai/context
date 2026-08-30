import { z } from "zod";
import {
  indexerCanonicalRefSchema,
  validateIndexerLayerCompositionInput,
} from "./indexerLayerComposition.js";
import {
  buildIndexerMaterialAnswerRunRequest,
  indexerMaterialAnswerRunRequestSchema,
  validateIndexerMaterialAnswerRunRequest,
  type IndexerMaterialAnswerRunRequest,
} from "./indexerMaterialAnswerRunProtocol.js";
import {
  validateIndexerMaterialQuestionWorkset,
  type IndexerMaterialQuestionWorkset,
} from "./indexerMaterialQuestionWorkset.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  indexerRunFinalAuthoritySchema,
} from "./indexerRunProtocolCommon.js";

const executionPlanRunSchema = z.object({
  run_ref: indexerCanonicalRefSchema,
  answer_indexer_id: indexerIdSchema,
  eligible_question_keys: z.array(indexerCanonicalRefSchema).min(1),
  request: indexerMaterialAnswerRunRequestSchema,
}).strict();

const executionPlanPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-execution-plan/v1"),
  workset_digest: indexerDigestSchema,
  predecessor_ledger_revision: indexerDigestSchema,
  runs: z.array(executionPlanRunSchema),
  unresolved_question_keys: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerMaterialAnswerExecutionPlanSchema =
  executionPlanPayloadSchema.extend({
    plan_digest: indexerDigestSchema,
  }).strict();

export type IndexerMaterialAnswerExecutionPlanRun = z.infer<
  typeof executionPlanRunSchema
>;
export type IndexerMaterialAnswerExecutionPlan = z.infer<
  typeof indexerMaterialAnswerExecutionPlanSchema
>;

export interface IndexerMaterialAnswerExecutionAuthority {
  answer_indexer_id: string;
  composition_input: IndexerMaterialAnswerRunRequest["composition_input"];
  final_authority: IndexerMaterialAnswerRunRequest["final_authority"];
  answer_provider_composition_fingerprint: string;
}

export function indexerMaterialAnswerProviderCompositionFingerprint(input: {
  answer_indexer_id: string;
  composition_input: unknown;
  final_authority: unknown;
}): string {
  const answerIndexerId = indexerIdSchema.parse(input.answer_indexer_id);
  const compositionInput = validateIndexerLayerCompositionInput(input.composition_input);
  const finalAuthority = indexerRunFinalAuthoritySchema.parse(input.final_authority);
  if (compositionInput.final_authority_layer_ref !== finalAuthority.layer_ref) {
    throw new TypeError("material-answer composition does not match final Provider authority");
  }
  return indexerProtocolDigest({
    protocol: "context.indexer.material-answer-provider-composition/v1",
    answer_indexer_id: answerIndexerId,
    final_authority: finalAuthority,
    composition_input_view_digest: compositionInput.view_digest,
  });
}

function canonicalUnique(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${label} must be unique`);
  }
  return sorted;
}

function runRef(request: IndexerMaterialAnswerRunRequest): string {
  return `material-answer-run:${indexerProtocolDigest({
    workset_digest: request.workset.workset_digest,
    answer_indexer_id: request.answer_indexer_id,
    execution_request_digest: request.execution_request_digest,
  })}`;
}

export function buildIndexerMaterialAnswerExecutionPlan(input: {
  workset: unknown;
  authorities: readonly IndexerMaterialAnswerExecutionAuthority[];
}): IndexerMaterialAnswerExecutionPlan {
  const workset = validateIndexerMaterialQuestionWorkset(input.workset);
  const authorityByIndexer = new Map(
    input.authorities.map((authority) => [authority.answer_indexer_id, authority]),
  );
  if (authorityByIndexer.size !== input.authorities.length) {
    throw new TypeError("material-answer execution authorities must be unique by Indexer");
  }
  const eligibleIndexerIds = [...new Set(workset.items.flatMap((item) =>
    item.authorized_source_refs.length === 0 ? [] : item.eligible_answer_indexer_ids
  ))].sort(compareIndexerCanonicalText);
  const extraAuthorities = [...authorityByIndexer.keys()].filter((indexerId) =>
    !eligibleIndexerIds.includes(indexerId)
  );
  if (extraAuthorities.length > 0) {
    throw new TypeError("material-answer execution authority is outside workset eligibility");
  }
  const runs = eligibleIndexerIds.map((answerIndexerId) => {
    const authority = authorityByIndexer.get(answerIndexerId);
    if (authority === undefined) {
      throw new TypeError(`material-answer execution authority is missing for ${answerIndexerId}`);
    }
    const providerFingerprint = indexerMaterialAnswerProviderCompositionFingerprint(
      authority,
    );
    if (authority.answer_provider_composition_fingerprint !== providerFingerprint) {
      throw new TypeError("material-answer Provider composition fingerprint is invalid");
    }
    const request = buildIndexerMaterialAnswerRunRequest({
      workset,
      answer_indexer_id: answerIndexerId,
      composition_input: authority.composition_input,
      final_authority: authority.final_authority,
      answer_provider_composition_fingerprint: providerFingerprint,
    });
    return executionPlanRunSchema.parse({
      run_ref: runRef(request),
      answer_indexer_id: answerIndexerId,
      eligible_question_keys: request.eligible_question_keys,
      request,
    });
  }).sort((left, right) => compareIndexerCanonicalText(left.run_ref, right.run_ref));
  const unresolvedQuestionKeys = canonicalUnique(workset.items.filter((item) =>
    item.authorized_source_refs.length === 0 ||
    item.eligible_answer_indexer_ids.length === 0
  ).map((item) => item.question_key), "unresolved material question keys");
  const payload = executionPlanPayloadSchema.parse({
    protocol: "context.indexer.material-answer-execution-plan/v1",
    workset_digest: workset.workset_digest,
    predecessor_ledger_revision: workset.predecessor_ledger_revision,
    runs,
    unresolved_question_keys: unresolvedQuestionKeys,
  });
  return indexerMaterialAnswerExecutionPlanSchema.parse({
    ...payload,
    plan_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerMaterialAnswerExecutionPlan(
  value: unknown,
): IndexerMaterialAnswerExecutionPlan {
  const plan = indexerMaterialAnswerExecutionPlanSchema.parse(value);
  const { plan_digest: _digest, ...payload } = plan;
  void _digest;
  if (indexerProtocolDigest(payload) !== plan.plan_digest) {
    throw new TypeError("material-answer execution plan digest is invalid");
  }
  const runRefs = canonicalUnique(plan.runs.map((run) => run.run_ref), "run refs");
  if (canonicalIndexerJson(runRefs) !== canonicalIndexerJson(plan.runs.map((run) =>
    run.run_ref
  ))) {
    throw new TypeError("material-answer execution plan runs are not canonical");
  }
  canonicalUnique(plan.runs.map((run) => run.answer_indexer_id), "run Indexers");
  canonicalUnique(plan.unresolved_question_keys, "unresolved question keys");
  for (const run of plan.runs) {
    const request = validateIndexerMaterialAnswerRunRequest(run.request);
    if (
      run.run_ref !== runRef(request) ||
      run.answer_indexer_id !== request.answer_indexer_id ||
      canonicalIndexerJson(run.eligible_question_keys) !==
        canonicalIndexerJson(request.eligible_question_keys) ||
      request.workset.workset_digest !== plan.workset_digest ||
      request.workset.predecessor_ledger_revision !== plan.predecessor_ledger_revision
    ) {
      throw new TypeError("material-answer execution plan run binding is invalid");
    }
  }
  return plan;
}

export function materialAnswerExecutionPlanWorkset(
  plan: IndexerMaterialAnswerExecutionPlan,
): IndexerMaterialQuestionWorkset | undefined {
  const first = plan.runs[0]?.request.workset;
  if (first === undefined) return undefined;
  return first;
}
