import { describe, expect, test } from "bun:test";
import {
  buildIndexerMaterialAnswerExecutionPlan,
  composeIndexerLayerInput,
  indexerMaterialAnswerResultDigest,
  indexerMaterialAnswerProviderCompositionFingerprint,
  indexerMaterialQuestionWorksetDigest,
  validateIndexerMaterialAnswerExecutionPlan,
  validateIndexerMaterialAnswerRunResult,
  type IndexerMaterialAnswerResult,
} from "../index.js";
import { digest, ledger, workset } from "./indexerMaterialAnswerV070.fixture.js";

const provider = {
  layer_ref: "provider:answer#layer:primary",
  integrity: digest("a"),
  bundle_digest: digest("b"),
  config_fingerprint: digest("c"),
  customization_fingerprint: null,
};

function authority(currentWorkset: ReturnType<typeof workset>) {
  const value = {
    answer_indexer_id: "answer-indexer",
    composition_input: composeIndexerLayerInput({
      workset_digest: currentWorkset.workset_digest,
      final_authority_layer_ref: provider.layer_ref,
      fragments: [],
    }),
    final_authority: provider,
  };
  return {
    ...value,
    answer_provider_composition_fingerprint:
      indexerMaterialAnswerProviderCompositionFingerprint(value),
  };
}

describe("material-answer execution plan", () => {
  test("builds one exact request per eligible answer Indexer", () => {
    const currentWorkset = workset(ledger().revision);
    const plan = buildIndexerMaterialAnswerExecutionPlan({
      workset: currentWorkset,
      authorities: [authority(currentWorkset)],
    });
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]).toMatchObject({
      answer_indexer_id: "answer-indexer",
      eligible_question_keys: [currentWorkset.items[0]!.question_key],
      request: {
        answer_indexer_id: "answer-indexer",
        eligible_question_keys: [currentWorkset.items[0]!.question_key],
      },
    });
    expect(plan.unresolved_question_keys).toEqual([]);
    expect(validateIndexerMaterialAnswerExecutionPlan(plan)).toEqual(plan);
  });

  test("keeps questions without an answerer unresolved and schedules no run", () => {
    const currentWorkset = structuredClone(workset(ledger().revision));
    currentWorkset.items[0]!.eligible_answer_indexer_ids = [];
    const { workset_digest: _digest, ...payload } = currentWorkset;
    void _digest;
    currentWorkset.workset_digest = indexerMaterialQuestionWorksetDigest(payload);
    const plan = buildIndexerMaterialAnswerExecutionPlan({
      workset: currentWorkset,
      authorities: [],
    });
    expect(plan.runs).toEqual([]);
    expect(plan.unresolved_question_keys).toEqual([
      currentWorkset.items[0]!.question_key,
    ]);
  });

  test("requires exact authority and binds legal empty Results to its Indexer", () => {
    const currentWorkset = workset(ledger().revision);
    expect(() => buildIndexerMaterialAnswerExecutionPlan({
      workset: currentWorkset,
      authorities: [],
    })).toThrow(/authority is missing/);
    expect(() => buildIndexerMaterialAnswerExecutionPlan({
      workset: currentWorkset,
      authorities: [{
        ...authority(currentWorkset),
        answer_provider_composition_fingerprint: digest("5"),
      }],
    })).toThrow(/fingerprint is invalid/);
    const plan = buildIndexerMaterialAnswerExecutionPlan({
      workset: currentWorkset,
      authorities: [authority(currentWorkset)],
    });
    const request = plan.runs[0]!.request;
    const resultPayload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
      protocol: "context.indexer.material-answer-result/v1",
      workset_digest: currentWorkset.workset_digest,
      execution_request_digest: request.execution_request_digest,
      answer_indexer_id: "answer-indexer",
      answer_provider_composition_fingerprint:
        request.answer_provider_composition_fingerprint,
      bindings: [],
    };
    const runResult = {
      protocol: "context.indexer.run-result/v1" as const,
      operation: "material-answer" as const,
      consumed_input_view_digest: request.composition_input.view_digest,
      result: {
        ...resultPayload,
        result_digest: indexerMaterialAnswerResultDigest(resultPayload),
      },
    };
    expect(validateIndexerMaterialAnswerRunResult({
      request,
      result: runResult,
      current_sources: [],
      resolve_evidence_digest: () => digest("9"),
    }).candidate_set.evaluations).toEqual([]);

    const forgedPayload = { ...resultPayload, answer_indexer_id: "other-indexer" };
    const forged = {
      ...runResult,
      result: {
        ...forgedPayload,
        result_digest: indexerMaterialAnswerResultDigest(forgedPayload),
      },
    };
    expect(() => validateIndexerMaterialAnswerRunResult({
      request,
      result: forged,
      current_sources: [],
      resolve_evidence_digest: () => digest("9"),
    })).toThrow(/request\/workset\/input view/);
  });
});
