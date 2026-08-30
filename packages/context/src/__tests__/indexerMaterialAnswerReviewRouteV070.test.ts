import { describe, expect, test } from "bun:test";
import {
  buildIndexerMaterialAnswerReviewInspectionInput,
  buildIndexerMaterialAnswerReviewResolutionInput,
  indexerProtocolDigest,
  inspectIndexerMaterialAnswerReview,
  resolveIndexerMaterialAnswerReview,
} from "../index.js";
import {
  candidate,
  ledger,
} from "./indexerMaterialAnswerV070.fixture.js";

describe("limited material-answer Review Route protocol", () => {
  test("approves only the exact evidence binding and returns a successor-ledger fact", () => {
    const current = ledger();
    const { currentWorkset, candidateSet } = candidate(current);
    const inspectionInput = buildIndexerMaterialAnswerReviewInspectionInput({
      workset: currentWorkset,
      candidate_set: candidateSet,
      question_key: currentWorkset.items[0]!.question_key,
    });
    const inspection = inspectIndexerMaterialAnswerReview(inspectionInput);
    const resolutionInput = buildIndexerMaterialAnswerReviewResolutionInput({
      ledger: current,
      workset: currentWorkset,
      candidate_set: candidateSet,
      baseline_report: inspection.baseline_report,
      decision: "approved",
    });
    const resolution = resolveIndexerMaterialAnswerReview(resolutionInput);

    expect(resolution).toMatchObject({
      state: "approved",
      review_scope: "question-target-source-span-evidence-binding",
      review_decision: { decision: "approved" },
    });
    if (resolution.state !== "approved") throw new Error("expected approved Review");
    expect(resolution.answer_approval.predecessor_ledger_revision)
      .toBe(current.revision);
    expect(resolution.answer_approval.successor_ledger.entries[0]!.state)
      .toBe("answer-approved");
    expect(resolution.answer_approval.successor_ledger.revision).not.toBe(current.revision);
    expect(resolution).not.toHaveProperty("artifact_ref");
    expect(resolution).not.toHaveProperty("reader_content_approved");
  });

  test("a rejection produces no answer approval or ledger mutation payload", () => {
    const current = ledger();
    const { currentWorkset, candidateSet } = candidate(current);
    const inspection = inspectIndexerMaterialAnswerReview(
      buildIndexerMaterialAnswerReviewInspectionInput({
        workset: currentWorkset,
        candidate_set: candidateSet,
        question_key: currentWorkset.items[0]!.question_key,
      }),
    );
    const resolution = resolveIndexerMaterialAnswerReview(
      buildIndexerMaterialAnswerReviewResolutionInput({
        ledger: current,
        workset: currentWorkset,
        candidate_set: candidateSet,
        baseline_report: inspection.baseline_report,
        decision: "rejected",
      }),
    );
    expect(resolution.state).toBe("rejected");
    expect(resolution).not.toHaveProperty("answer_approval");
  });

  test("rejects stale, expanded, and non-reviewable Gate inputs", () => {
    const current = ledger();
    const { currentWorkset, candidateSet } = candidate(current);
    const inspectionInput = buildIndexerMaterialAnswerReviewInspectionInput({
      workset: currentWorkset,
      candidate_set: candidateSet,
      question_key: currentWorkset.items[0]!.question_key,
    });
    const expanded = {
      ...inspectionInput,
      final_reader_page_approved: true,
    };
    expect(() => inspectIndexerMaterialAnswerReview(expanded)).toThrow();

    const insufficient = structuredClone(candidateSet);
    insufficient.evaluations[0] = {
      state: "material-answer-evidence-insufficient",
      question_key: currentWorkset.items[0]!.question_key,
      question_revision_digest: currentWorkset.items[0]!.question_revision_digest,
      reason_codes: ["minimum-items-not-met"],
      accepted_evidence_item_count: 0,
      distinct_source_count: 0,
      rejected_evidence_item_refs: [],
    };
    const { candidate_set_digest: _digest, ...payload } = insufficient;
    void _digest;
    insufficient.candidate_set_digest = indexerProtocolDigest(payload);
    expect(() => inspectIndexerMaterialAnswerReview(
      buildIndexerMaterialAnswerReviewInspectionInput({
        workset: currentWorkset,
        candidate_set: insufficient,
        question_key: currentWorkset.items[0]!.question_key,
      }),
    )).toThrow(/reviewable candidate/);

    const stale = structuredClone(inspectionInput);
    stale.question_key = `${stale.question_key}-stale`;
    expect(() => inspectIndexerMaterialAnswerReview(stale)).toThrow(/digest/);
  });
});
