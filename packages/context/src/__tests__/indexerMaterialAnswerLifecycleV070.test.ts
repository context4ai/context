import { describe, expect, test } from "bun:test";
import {
  actualizeIndexerMaterialAnswer,
  approveIndexerMaterialAnswer,
  buildIndexerPlannedMaterialAnswer,
  buildIndexerMaterialAnswerBaselineReport,
  buildIndexerMaterialAnswerLayoutProposal,
  closeIndexerResolvedMaterialAnswers,
  decideIndexerMaterialAnswerReview,
  deriveIndexerMaterialAnswerFlowStatus,
  indexerProtocolDigest,
  invalidateIndexerMaterialAnswerActualizations,
  validateIndexerPlannedMaterialAnswer,
} from "../index.js";
import {
  OWNER_REF,
  SOURCE,
  actualizationAuthority,
  approve,
  candidate,
  digest,
  ledger,
  proposal,
  question,
} from "./indexerMaterialAnswerV070.fixture.js";

describe("Material Answer limited Review and actualization", () => {
  test("applies answer Review with predecessor CAS and does not self-stale", () => {
    const initial = ledger();
    const approved = approve(initial);
    expect(approved.ledger.revision).not.toBe(initial.revision);
    expect(approved.consumed_workset_digest).toBe(approved.workset.workset_digest);
    expect(approved.ledger.entries[0]).toMatchObject({
      state: "answer-approved",
      answer: {
        accepted_workset_digest: approved.workset.workset_digest,
        answer_indexer_id: "answer-indexer",
        review_decision_digest: approved.reviewDecision.decision_digest,
      },
    });
    const approvedEntry = approved.ledger.entries[0];
    if (approvedEntry?.state !== "answer-approved") {
      throw new Error("expected answer-approved entry");
    }
    const planned = buildIndexerPlannedMaterialAnswer(approvedEntry);
    expect(validateIndexerPlannedMaterialAnswer(planned)).toEqual(planned);
    expect(planned).toMatchObject({
      protocol: "context.indexer.planned-material-answer/v1",
      question_key: approved.workset.items[0]!.question_key,
      answer_landing_ref: approved.workset.items[0]!.question.answer_landing_ref,
      binding_digest: approved.binding_digest,
      evidence_items: approvedEntry.answer.evidence,
    });
    expect(planned).not.toHaveProperty("answer_body");
    const forgedPlanned = structuredClone(planned);
    forgedPlanned.evidence_items[0]!.evidence_digest = digest("9");
    expect(() => validateIndexerPlannedMaterialAnswer(forgedPlanned))
      .toThrow(/digest|canonical/);

    const resolved = actualizeIndexerMaterialAnswer({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: approved.binding_digest,
      layout_proposal: proposal([{
        answer_landing_ref: approved.workset.items[0]!.question.answer_landing_ref!,
        actualized_target_ref: "artifact:operations/button",
        section_ref: "section:operations/button#recovery",
      }]),
      ...actualizationAuthority(),
    });
    expect(resolved.state).toBe("resolved");
    expect(resolved.evidence_compatibility.state).toBe("compatible");
    expect(resolved.planned_answer?.planned_answer_digest).toBe(
      planned.planned_answer_digest,
    );
    expect(resolved.ledger.entries[0]).toHaveProperty(
      "actualization.planned_answer_digest",
      planned.planned_answer_digest,
    );
  });

  test("limits Review to an exact baseline binding without final-content authority", () => {
    const initial = ledger();
    const { currentWorkset, candidateSet } = candidate(initial);
    const baselineReport = buildIndexerMaterialAnswerBaselineReport({
      workset: currentWorkset,
      candidate_set: candidateSet,
      question_key: currentWorkset.items[0]!.question_key,
    });
    expect(baselineReport).toMatchObject({
      review_scope: "question-target-source-span-evidence-binding",
      baseline_passed: true,
    });
    expect(baselineReport).not.toHaveProperty("artifact_ref");
    expect(baselineReport).not.toHaveProperty("reader_content_approved");

    const rejected = decideIndexerMaterialAnswerReview({
      baseline_report: baselineReport,
      decision: "rejected",
    });
    expect(() => approveIndexerMaterialAnswer({
      ledger: initial,
      workset: currentWorkset,
      candidate_set: candidateSet,
      baseline_report: baselineReport,
      review_decision: rejected,
    })).toThrow(/approved limited Review/);

    const forged = structuredClone(decideIndexerMaterialAnswerReview({
      baseline_report: baselineReport,
      decision: "approved",
    })) as unknown as Record<string, unknown>;
    forged.final_reader_page_approved = true;
    expect(() => approveIndexerMaterialAnswer({
      ledger: initial,
      workset: currentWorkset,
      candidate_set: candidateSet,
      baseline_report: baselineReport,
      review_decision: forged,
    })).toThrow();
  });

  test("rejects a concurrent predecessor and a non-reviewable answer", () => {
    const initial = ledger();
    const { currentWorkset, candidateSet } = candidate(initial);
    const baselineReport = buildIndexerMaterialAnswerBaselineReport({
      workset: currentWorkset,
      candidate_set: candidateSet,
      question_key: currentWorkset.items[0]!.question_key,
    });
    const reviewDecision = decideIndexerMaterialAnswerReview({
      baseline_report: baselineReport,
      decision: "approved",
    });
    const changed = {
      ...initial,
      revision: digest("9"),
    };
    expect(() => approveIndexerMaterialAnswer({
      ledger: changed,
      workset: currentWorkset,
      candidate_set: candidateSet,
      baseline_report: baselineReport,
      review_decision: reviewDecision,
    })).toThrow(/revision|stale/);

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
    expect(() => approveIndexerMaterialAnswer({
      ledger: initial,
      workset: currentWorkset,
      candidate_set: insufficient,
      baseline_report: baselineReport,
      review_decision: reviewDecision,
    })).toThrow();
  });

  test("reopens unresolved when an approved landing is missing or colliding", () => {
    const approved = approve();
    const missing = actualizeIndexerMaterialAnswer({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: approved.binding_digest,
      layout_proposal: proposal([]),
      ...actualizationAuthority(),
    });
    expect(missing).toMatchObject({
      state: "unresolved",
      reason_codes: ["answer-landing-not-unique"],
    });
    expect(missing.ledger.entries[0]).not.toHaveProperty("answer");

    const landingRef = approved.workset.items[0]!.question.answer_landing_ref!;
    const ambiguous = actualizeIndexerMaterialAnswer({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: approved.binding_digest,
      layout_proposal: proposal([
        {
          answer_landing_ref: landingRef,
          actualized_target_ref: "artifact:operations/button",
        },
        {
          answer_landing_ref: landingRef,
          actualized_target_ref: "artifact:operations/button-recovery",
        },
      ]),
      ...actualizationAuthority(),
    });
    expect(ambiguous).toMatchObject({
      state: "unresolved",
      reason_codes: ["answer-landing-not-unique"],
    });
    expect(() => buildIndexerMaterialAnswerLayoutProposal({
      layout_digest: digest("8"),
      landing_mappings: [{
        answer_landing_ref: landingRef,
        actualized_target_ref: "planned-artifact:operations/button",
      }],
    })).toThrow(/Node, Artifact, or Section/);
  });

  test("revalidates retained evidence compatibility before actualization", () => {
    const approved = approve();
    const reopened = actualizeIndexerMaterialAnswer({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: approved.binding_digest,
      layout_proposal: proposal([]),
      current_question_revision_digest:
        approved.workset.items[0]!.question_revision_digest,
      current_question: question(),
      current_provider_composition_fingerprints: new Set([digest("5")]),
      current_source_input_digests: [digest("9")],
      current_sources: [{ ...SOURCE, source_input_digest: digest("9") }],
      resolve_evidence_digest: () => digest("8"),
    });
    expect(reopened.state).toBe("unresolved");
    expect(reopened.evidence_compatibility).toMatchObject({
      state: "incompatible",
      reason_codes: expect.arrayContaining([
        "source-input-set-stale",
        "source-input-stale",
        "evidence-content-stale",
      ]),
    });
  });

  test("admits layout before main Review, then requires current actualization", () => {
    const initial = ledger();
    expect(deriveIndexerMaterialAnswerFlowStatus({
      ledger: initial,
      current_layout_digest: digest("8"),
      owner_domain_authorities: [{
        owner_cell_ref: OWNER_REF,
        domain_state: "required",
      }],
    })).toMatchObject({
      layout_allowed: false,
      conditional_layout_gate_allowed: false,
      main_candidate_review_allowed: false,
      effective_blocking_gap_count: 1,
    });

    const approved = approve(initial);
    expect(deriveIndexerMaterialAnswerFlowStatus({
      ledger: approved.ledger,
      current_layout_digest: digest("8"),
      owner_domain_authorities: [{
        owner_cell_ref: OWNER_REF,
        domain_state: "required",
      }],
    })).toMatchObject({
      layout_allowed: true,
      conditional_layout_gate_allowed: false,
      main_candidate_review_allowed: false,
    });

    const resolved = actualizeIndexerMaterialAnswer({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: approved.binding_digest,
      layout_proposal: proposal([{
        answer_landing_ref: approved.workset.items[0]!.question.answer_landing_ref!,
        actualized_target_ref: "artifact:operations/button",
      }]),
      ...actualizationAuthority(),
    });
    expect(deriveIndexerMaterialAnswerFlowStatus({
      ledger: resolved.ledger,
      current_layout_digest: digest("8"),
      owner_domain_authorities: [{
        owner_cell_ref: OWNER_REF,
        domain_state: "required",
      }],
    })).toMatchObject({
      conditional_layout_gate_allowed: true,
      main_candidate_review_allowed: true,
      effective_blocking_gap_count: 0,
    });
    expect(deriveIndexerMaterialAnswerFlowStatus({
      ledger: resolved.ledger,
      current_layout_digest: digest("9"),
      owner_domain_authorities: [{
        owner_cell_ref: OWNER_REF,
        domain_state: "required",
      }],
    })).toMatchObject({
      conditional_layout_gate_allowed: false,
      main_candidate_review_allowed: false,
      effective_blocking_gap_count: 1,
    });

    const invalidated = invalidateIndexerMaterialAnswerActualizations({
      ledger: resolved.ledger,
      expected_revision: resolved.ledger.revision,
      invalidated_layout_digest: digest("8"),
      affected_answer_landing_refs: [
        approved.workset.items[0]!.question.answer_landing_ref!,
      ],
    });
    expect(invalidated.reopened_question_keys).toEqual([
      approved.workset.items[0]!.question_key,
    ]);
    expect(invalidated.ledger.entries[0]!.state).toBe("answer-approved");
  });

  test("reopens when source, Provider, question, or binding authority is stale", () => {
    const approved = approve();
    const reopened = actualizeIndexerMaterialAnswer({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: digest("8"),
      layout_proposal: proposal([], digest("9")),
      current_question_revision_digest: digest("8"),
      current_question: question(),
      current_provider_composition_fingerprints: new Set(),
      current_source_input_digests: [],
      current_sources: [],
      resolve_evidence_digest: () => digest("6"),
    });
    expect(reopened.state).toBe("unresolved");
    expect(reopened.reason_codes).toEqual([
      "evidence-source-missing",
      "minimum-distinct-sources-not-met",
      "minimum-items-not-met",
      "provider-composition-stale",
      "question-or-binding-stale",
      "source-input-set-stale",
    ]);
  });

  test("closes only a binding and provenance present in approved structure", () => {
    const approved = approve();
    const resolved = actualizeIndexerMaterialAnswer({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: approved.binding_digest,
      layout_proposal: proposal([{
        answer_landing_ref: approved.workset.items[0]!.question.answer_landing_ref!,
        actualized_target_ref: "artifact:operations/button",
      }]),
      ...actualizationAuthority(),
    });
    const entry = resolved.ledger.entries[0];
    if (entry?.state !== "resolved") throw new Error("expected resolved entry");
    const evidenceRefs = entry.answer.evidence.map((item) => item.evidence_item_ref);
    const projection = {
      question_key: approved.workset.items[0]!.question_key,
      binding_digest: approved.binding_digest,
      planned_answer_digest: entry.actualization.planned_answer_digest,
      actualization_digest: entry.actualization.actualization_digest,
      actualized_target_ref: entry.actualization.actualized_target_ref,
      evidence_item_refs: evidenceRefs,
      evidence_set_digest: indexerProtocolDigest({ evidence_item_refs: evidenceRefs }),
    };
    expect(closeIndexerResolvedMaterialAnswers({
      ledger: resolved.ledger,
      expected_revision: resolved.ledger.revision,
      approved_structure_bindings: [projection],
    }).entries).toEqual([]);

    const forgedRefs = ["evidence-item:forged"];
    expect(() => closeIndexerResolvedMaterialAnswers({
      ledger: resolved.ledger,
      expected_revision: resolved.ledger.revision,
      approved_structure_bindings: [{
        ...projection,
        evidence_item_refs: forgedRefs,
        evidence_set_digest: indexerProtocolDigest({
          evidence_item_refs: forgedRefs,
        }),
      }],
    })).toThrow(/absent/);
  });
});
