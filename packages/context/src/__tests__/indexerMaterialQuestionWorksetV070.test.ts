import { describe, expect, test } from "bun:test";
import {
  buildIndexerMaterialQuestionWorkset,
  buildIndexerQuestionTargetInventory,
  indexerMaterialQuestionWorksetDigest,
  indexerResolvedMaterialQuestionDigest,
  validateIndexerMaterialQuestionWorkset,
  type IndexerResolvedMaterialQuestion,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};
const REQUIREMENT_REF = "requirement:public-knowledge";
const OWNER_REF = "owner-cell:public-knowledge#operations";

function resolvedQuestion(): IndexerResolvedMaterialQuestion {
  const payload: Omit<IndexerResolvedMaterialQuestion, "contract_digest"> = {
    ref: "question:failure-recovery",
    authority: {
      kind: "cli-base-contract",
      ref: "contract:community-profile",
      digest: digest("a"),
    },
    contract_version: 1,
    semantic: "How does this capability recover from failure?",
    coverage_domain: "operations",
    target_domain_ref: "component",
    target_selector: {
      protocol: "context.indexer.selector/v1",
      expression: { op: "equals", fact: "target.visibility", value: "public" },
    },
    evidence_contract: {
      accepted_kinds: ["documentation", "runbook"],
      minimum_items: 2,
      minimum_distinct_sources: 1,
    },
    allowed_exclusion_reason_codes: ["not-applicable"],
  };
  return {
    ...payload,
    contract_digest: indexerResolvedMaterialQuestionDigest(payload),
  };
}

function inventory() {
  return buildIndexerQuestionTargetInventory({
    requirement_set_digest: digest("b"),
    profile_contract_digests: [digest("c")],
    source_inventory_digests: [digest("d")],
    items: [{
      target_domain_ref: "component",
      requirement_ref: REQUIREMENT_REF,
      owner_cell_ref: OWNER_REF,
      source_ref: "repo:sample@revision",
      module_ref: "module:packages/sample",
      subject_key: SUBJECT,
      canonical_fact_slice_digest: digest("e"),
    }],
  });
}

function build(overrides: {
  predecessor?: string;
  visibility?: string;
  question?: IndexerResolvedMaterialQuestion;
  sourceInputDigests?: string[];
  answerLandingRef?: string;
  answerLandingDependencyDigest?: string;
  candidate?: {
    operations: string[];
    requirement_binding_role: "primary" | "enricher";
    provider_operation_supported: boolean;
    supported_evidence_kinds: Array<"documentation" | "runbook" | "code">;
  };
  } = {}) {
  const targetInventory = inventory();
  const targetRef = targetInventory.items[0]!.target_ref;
  const currentQuestion = overrides.question ?? resolvedQuestion();
  return buildIndexerMaterialQuestionWorkset({
    question_target_inventory: targetInventory,
    resolved_questions: [{
      requirement_ref: REQUIREMENT_REF,
      question: currentQuestion,
    }],
    owner_cells: [{
      owner_cell_ref: OWNER_REF,
      owner_cell_digest: digest("f"),
      requirement_ref: REQUIREMENT_REF,
      coverage_domain: "operations",
      domain_state: "required",
    }],
    target_facts: {
      [targetRef]: { target: { visibility: overrides.visibility ?? "public" } },
    },
    allowed_selector_fact_paths: new Set(["target.visibility"]),
    routes: [{
      requirement_ref: REQUIREMENT_REF,
      question_ref: currentQuestion.ref,
      target_ref: targetRef,
      ...(overrides.answerLandingRef === undefined
        ? {}
        : { answer_landing_ref: overrides.answerLandingRef }),
      ...(overrides.answerLandingDependencyDigest === undefined
        ? {}
        : {
            answer_landing_dependency_digest:
              overrides.answerLandingDependencyDigest,
          }),
      authorized_source_refs: ["source:runbook", "repo:sample@revision"],
      candidates: [{
        indexer_id: "answer-indexer",
        operations: overrides.candidate?.operations ?? ["material-answer"],
        requirement_binding_role:
          overrides.candidate?.requirement_binding_role ?? "enricher",
        provider_operation_supported:
          overrides.candidate?.provider_operation_supported ?? true,
        supported_evidence_kinds:
          overrides.candidate?.supported_evidence_kinds ?? ["documentation"],
      }],
    }],
    predecessor_ledger_revision: overrides.predecessor ?? digest("0"),
    registry_digest: digest("1"),
    requirement_set_digest: digest("b"),
    source_input_digests: overrides.sourceInputDigests ?? [digest("3"), digest("2")],
  });
}

describe("MaterialQuestionWorkset", () => {
  test("builds the complete selected pair with immutable question revision", () => {
    const workset = build();
    expect(workset.items).toHaveLength(1);
    expect(workset.items[0]).toMatchObject({
      eligible_answer_indexer_ids: ["answer-indexer"],
      authorized_source_refs: ["repo:sample@revision", "source:runbook"],
      question: {
        owner_cell_ref: OWNER_REF,
        question_ref: "question:failure-recovery",
        answer_landing_ref: inventory().items[0]!.node_ref,
      },
    });
    expect(workset.source_input_digests).toEqual([digest("2"), digest("3")]);
    expect(validateIndexerMaterialQuestionWorkset(workset)).toEqual(workset);
  });

  test("ledger predecessor changes the workset CAS identity, not question revision", () => {
    const first = build({ predecessor: digest("0") });
    const second = build({ predecessor: digest("1") });
    expect(second.items[0]!.question_revision_digest).toBe(
      first.items[0]!.question_revision_digest,
    );
    expect(second.workset_digest).not.toBe(first.workset_digest);
  });

  test("keeps question-target identity stable while answer-landing authority stales", () => {
    const current = build({
      answerLandingRef: "planned-section:recovery",
      answerLandingDependencyDigest: digest("4"),
    });
    const landingChanged = build({
      answerLandingRef: "planned-section:recovery-v2",
      answerLandingDependencyDigest: digest("5"),
    });

    expect(landingChanged.question_target_set_digest).toBe(
      current.question_target_set_digest,
    );
    expect(landingChanged.items[0]!.question.question_subject_target_ref).toBe(
      current.items[0]!.question.question_subject_target_ref,
    );
    expect(landingChanged.items[0]!.question.question_target_item_digest).toBe(
      current.items[0]!.question.question_target_item_digest,
    );
    expect(landingChanged.items[0]!.question_revision_digest).not.toBe(
      current.items[0]!.question_revision_digest,
    );
    expect(landingChanged.workset_digest).not.toBe(current.workset_digest);
  });

  test("re-signs after CAS and invalidates Review inputs for question, source, or eligibility drift", () => {
    const current = build();
    const resigned = build({ predecessor: digest("1") });
    const sourceChanged = build({ sourceInputDigests: [digest("2"), digest("9")] });
    const eligibilityChanged = build({
      candidate: {
        operations: ["material-answer"],
        requirement_binding_role: "enricher",
        provider_operation_supported: false,
        supported_evidence_kinds: ["documentation"],
      },
    });
    const questionPayload = {
      ...resolvedQuestion(),
      semantic: "How is failure recovery verified after restart?",
      contract_version: 2,
    };
    const { contract_digest: _oldDigest, ...questionWithoutDigest } = questionPayload;
    void _oldDigest;
    const questionChanged = build({
      question: {
        ...questionWithoutDigest,
        contract_digest: indexerResolvedMaterialQuestionDigest(questionWithoutDigest),
      },
    });

    for (const changed of [resigned, sourceChanged, eligibilityChanged, questionChanged]) {
      expect(changed.workset_digest).not.toBe(current.workset_digest);
    }
    expect(resigned.predecessor_ledger_revision).toBe(digest("1"));
    expect(sourceChanged.source_input_digests).toEqual([digest("2"), digest("9")]);
    expect(eligibilityChanged.items[0]?.eligible_answer_indexer_ids).toEqual([]);
    expect(questionChanged.items[0]?.question_revision_digest).not.toBe(
      current.items[0]?.question_revision_digest,
    );
    expect(resigned.items[0]?.question_revision_digest).toBe(
      current.items[0]?.question_revision_digest,
    );
  });

  test("fails a required question when its selector matches zero targets", () => {
    expect(() => build({ visibility: "private" })).toThrow(/matched zero target/);
  });

  test("retains unresolved pairs when semantic eligibility is absent", () => {
    for (const candidate of [
      {
        operations: ["main-index"],
        requirement_binding_role: "enricher" as const,
        provider_operation_supported: true,
        supported_evidence_kinds: ["documentation" as const],
      },
      {
        operations: ["material-answer"],
        requirement_binding_role: "primary" as const,
        provider_operation_supported: true,
        supported_evidence_kinds: ["documentation" as const],
      },
      {
        operations: ["material-answer"],
        requirement_binding_role: "enricher" as const,
        provider_operation_supported: false,
        supported_evidence_kinds: ["documentation" as const],
      },
      {
        operations: ["material-answer"],
        requirement_binding_role: "enricher" as const,
        provider_operation_supported: true,
        supported_evidence_kinds: ["code" as const],
      },
    ]) {
      expect(build({ candidate }).items[0]!.eligible_answer_indexer_ids).toEqual([]);
    }
  });

  test("rejects workset digest, pair-set digest, and item ordering drift", () => {
    const digestDrift = build();
    digestDrift.workset_digest = digest("9");
    expect(() => validateIndexerMaterialQuestionWorkset(digestDrift)).toThrow(/digest/);

    const pairDrift = build();
    pairDrift.question_target_set_digest = digest("9");
    const payload = Object.fromEntries(
      Object.entries(pairDrift).filter(([key]) => key !== "workset_digest"),
    ) as Omit<typeof pairDrift, "workset_digest">;
    pairDrift.workset_digest = indexerMaterialQuestionWorksetDigest(payload);
    expect(() => validateIndexerMaterialQuestionWorkset(pairDrift)).toThrow(/target set/);
  });

  test("strict schema does not persist severity or copied semantic authority", () => {
    const workset = build() as unknown as Record<string, unknown>;
    workset.severity = "blocking";
    workset.semantic_snapshot = "copied question meaning";
    expect(() => validateIndexerMaterialQuestionWorkset(workset)).toThrow();
  });
});
