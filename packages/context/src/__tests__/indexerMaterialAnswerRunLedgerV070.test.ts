import { describe, expect, test } from "bun:test";
import {
  acceptIndexerMaterialAnswerRun,
  buildIndexerMaterialAnswerAcceptedRunRecord,
  buildIndexerMaterialAnswerExecutionPlan,
  composeIndexerLayerInput,
  indexerMaterialAnswerResultDigest,
  indexerMaterialAnswerProviderCompositionFingerprint,
  observeIndexerMaterialAnswerRuns,
  prepareIndexerMaterialAnswerRunLedger,
  startIndexerMaterialAnswerRun,
  validateIndexerMaterialAnswerRunResult,
  type IndexerMaterialAnswerResult,
} from "../index.js";
import {
  SOURCE,
  digest,
  ledger,
  workset,
} from "./indexerMaterialAnswerV070.fixture.js";

const provider = {
  layer_ref: "provider:answer#layer:primary",
  integrity: digest("a"),
  bundle_digest: digest("b"),
  config_fingerprint: digest("c"),
  customization_fingerprint: null,
};

function plan() {
  const currentWorkset = workset(ledger().revision);
  const authority = {
    answer_indexer_id: "answer-indexer",
    composition_input: composeIndexerLayerInput({
      workset_digest: currentWorkset.workset_digest,
      final_authority_layer_ref: provider.layer_ref,
      fragments: [],
    }),
    final_authority: provider,
  };
  return buildIndexerMaterialAnswerExecutionPlan({
    workset: currentWorkset,
    authorities: [{
      ...authority,
      answer_provider_composition_fingerprint:
        indexerMaterialAnswerProviderCompositionFingerprint(authority),
    }],
  });
}

function validatedRun(input: {
  executionPlan: ReturnType<typeof plan>;
  empty?: boolean;
}) {
  const run = input.executionPlan.runs[0]!;
  const item = run.request.workset.items[0]!;
  const payload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
    protocol: "context.indexer.material-answer-result/v1",
    workset_digest: input.executionPlan.workset_digest,
    execution_request_digest: run.request.execution_request_digest,
    answer_indexer_id: run.answer_indexer_id,
    answer_provider_composition_fingerprint:
      run.request.answer_provider_composition_fingerprint,
    bindings: input.empty ? [] : [{
      workset_digest: input.executionPlan.workset_digest,
      question_key: item.question_key,
      question_revision_digest: item.question_revision_digest,
      evidence_claims: [{
        kind: "runbook",
        source_ref: SOURCE.source_ref,
        source_spans: [{ unit: "line", start: 10, end_exclusive: 20 }],
        evidence_digest: digest("6"),
      }],
    }],
  };
  const runResult = {
    protocol: "context.indexer.run-result/v1" as const,
    operation: "material-answer" as const,
    consumed_input_view_digest: run.request.composition_input.view_digest,
    result: {
      ...payload,
      result_digest: indexerMaterialAnswerResultDigest(payload),
    },
  };
  const validated = validateIndexerMaterialAnswerRunResult({
    request: run.request,
    result: runResult,
    current_sources: [SOURCE],
    resolve_evidence_digest: () => digest("6"),
  });
  return { run, runResult, candidateSet: validated.candidate_set };
}

describe("material-answer run ledger", () => {
  test("accepts and reuses a legal empty Result without rerunning", () => {
    const executionPlan = plan();
    const initial = prepareIndexerMaterialAnswerRunLedger({ plan: executionPlan });
    const running = startIndexerMaterialAnswerRun({
      plan: executionPlan,
      ledger: initial,
      expected_revision: initial.revision,
      run_ref: executionPlan.runs[0]!.run_ref,
    });
    const validated = validatedRun({ executionPlan, empty: true });
    const record = buildIndexerMaterialAnswerAcceptedRunRecord({
      plan: executionPlan,
      run_ref: validated.run.run_ref,
      run_result: validated.runResult,
      candidate_set: validated.candidateSet,
      read_receipt_set_digest: digest("7"),
    });
    const accepted = acceptIndexerMaterialAnswerRun({
      plan: executionPlan,
      ledger: running,
      expected_revision: running.revision,
      record,
    });
    expect(observeIndexerMaterialAnswerRuns({
      plan: executionPlan,
      ledger: accepted,
    })).toMatchObject({
      accepted: 1,
      pending: 0,
      state: "material-required",
      graph_outcome: "blocked",
    });

    const recovered = prepareIndexerMaterialAnswerRunLedger({
      plan: executionPlan,
      previous_ledger: accepted,
      accepted_records: [record],
    });
    expect(recovered.entries[0]!.state).toBe("accepted");
    expect(observeIndexerMaterialAnswerRuns({
      plan: executionPlan,
      ledger: recovered,
    }).next_refs).toEqual([]);
  });

  test("recovers an interrupted run to pending when no complete record exists", () => {
    const executionPlan = plan();
    const initial = prepareIndexerMaterialAnswerRunLedger({ plan: executionPlan });
    const running = startIndexerMaterialAnswerRun({
      plan: executionPlan,
      ledger: initial,
      expected_revision: initial.revision,
      run_ref: executionPlan.runs[0]!.run_ref,
    });
    const recovered = prepareIndexerMaterialAnswerRunLedger({
      plan: executionPlan,
      previous_ledger: running,
    });
    expect(recovered.entries[0]!.state).toBe("pending");
  });

  test("publishes reviewable candidate keys only from validated accepted records", () => {
    const executionPlan = plan();
    const initial = prepareIndexerMaterialAnswerRunLedger({ plan: executionPlan });
    const running = startIndexerMaterialAnswerRun({
      plan: executionPlan,
      ledger: initial,
      expected_revision: initial.revision,
      run_ref: executionPlan.runs[0]!.run_ref,
    });
    const validated = validatedRun({ executionPlan });
    const record = buildIndexerMaterialAnswerAcceptedRunRecord({
      plan: executionPlan,
      run_ref: validated.run.run_ref,
      run_result: validated.runResult,
      candidate_set: validated.candidateSet,
      read_receipt_set_digest: digest("7"),
    });
    const accepted = acceptIndexerMaterialAnswerRun({
      plan: executionPlan,
      ledger: running,
      expected_revision: running.revision,
      record,
    });
    expect(observeIndexerMaterialAnswerRuns({
      plan: executionPlan,
      ledger: accepted,
    })).toMatchObject({
      state: "candidates-ready",
      graph_outcome: "unverified",
      candidate_question_keys: [validated.run.eligible_question_keys[0]],
      unresolved_question_keys: [],
    });

    const tampered = structuredClone(record);
    tampered.candidate_set.evaluations = [];
    expect(() => prepareIndexerMaterialAnswerRunLedger({
      plan: executionPlan,
      accepted_records: [tampered],
    })).toThrow();
  });
});
