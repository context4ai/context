import { describe, expect, test } from "bun:test";
import {
  buildIndexerQuestionTargetInventory,
  canonicalOwnerCellRef,
  canonicalIndexerNodeRef,
  evaluateIndexerRestrictedSelector,
  indexerMaterialQuestionKey,
  indexerQuestionRevisionDigest,
  indexerQuestionSetDigest,
  indexerQuestionSubjectTargetRef,
  indexerQuestionTargetInventoryDigest,
  indexerQuestionTargetItemDigest,
  indexerResolvedMaterialQuestionDigest,
  validateIndexerQuestionTargetInventory,
  validateIndexerResolvedMaterialQuestion,
  type IndexerRequirementQuestionBinding,
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
const ALLOWED_FACTS = new Set([
  "evidence.current",
  "target.kind",
  "target.visibility",
]);

function questionFixture(): {
  binding: IndexerRequirementQuestionBinding;
  question: IndexerResolvedMaterialQuestion;
} {
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
      expression: {
        op: "all",
        args: [{ op: "equals", fact: "target.kind", value: "component" }, {
          op: "equals",
          fact: "target.visibility",
          value: "public",
        }],
      },
    },
    evidence_contract: {
      accepted_kinds: ["documentation", "runbook"],
      minimum_items: 2,
      minimum_distinct_sources: 1,
      provenance_constraints: {
        protocol: "context.indexer.selector/v1",
        expression: { op: "equals", fact: "evidence.current", value: true },
      },
    },
    allowed_exclusion_reason_codes: ["not-applicable"],
  };
  const contractDigest = indexerResolvedMaterialQuestionDigest(payload);
  const binding: IndexerRequirementQuestionBinding = {
    ref: payload.ref,
    authority: payload.authority,
    contract_version: payload.contract_version,
    contract_digest: contractDigest,
  };
  return {
    binding,
    question: { ...payload, contract_digest: contractDigest },
  };
}

function inventory() {
  return buildIndexerQuestionTargetInventory({
    requirement_set_digest: digest("b"),
    profile_contract_digests: [digest("d"), digest("c")],
    source_inventory_digests: [digest("f"), digest("e")],
    items: [{
      target_domain_ref: "component",
      requirement_ref: "requirement:public-knowledge",
      owner_cell_ref: "owner-cell:public-knowledge#operations",
      source_ref: "repo:sample@revision",
      module_ref: "module:packages/sample",
      subject_key: SUBJECT,
      canonical_fact_slice_digest: digest("0"),
    }],
  });
}

describe("restricted selector", () => {
  test("evaluates the fixed data-only DSL against allowlisted facts", () => {
    const { question } = questionFixture();
    expect(evaluateIndexerRestrictedSelector({
      selector: question.target_selector,
      facts: { target: { kind: "component", visibility: "public" } },
      allowed_fact_paths: ALLOWED_FACTS,
    })).toBe(true);
    expect(evaluateIndexerRestrictedSelector({
      selector: question.target_selector,
      facts: { target: { kind: "component", visibility: "private" } },
      allowed_fact_paths: ALLOWED_FACTS,
    })).toBe(false);
  });

  test("rejects unknown facts and invalid regular expressions", () => {
    expect(() => evaluateIndexerRestrictedSelector({
      selector: {
        protocol: "context.indexer.selector/v1",
        expression: { op: "exists", fact: "provider.self_reported_score" },
      },
      facts: {},
      allowed_fact_paths: ALLOWED_FACTS,
    })).toThrow(/unauthorized fact/);
    expect(() => evaluateIndexerRestrictedSelector({
      selector: {
        protocol: "context.indexer.selector/v1",
        expression: { op: "regex", fact: "target.kind", value: "[" },
      },
      facts: { target: { kind: "component" } },
      allowed_fact_paths: ALLOWED_FACTS,
    })).toThrow(/invalid regular expression/);
  });
});

describe("material question authority", () => {
  test("resolves only the exact requirement binding and canonical contract digest", () => {
    const { binding, question } = questionFixture();
    expect(validateIndexerResolvedMaterialQuestion({
      binding,
      resolved_question: question,
      allowed_selector_fact_paths: ALLOWED_FACTS,
      coverage_domain_state: "required",
    })).toEqual(question);
    expect(indexerQuestionSetDigest([question])).toMatch(/^sha256:/);
  });

  test("rejects authority drift, out-of-scope domains, and invalid evidence cardinality", () => {
    const { binding, question } = questionFixture();
    const drift = structuredClone(question);
    drift.contract_version = 2;
    expect(() => validateIndexerResolvedMaterialQuestion({
      binding,
      resolved_question: drift,
      allowed_selector_fact_paths: ALLOWED_FACTS,
      coverage_domain_state: "required",
    })).toThrow(/authority binding/);
    expect(() => validateIndexerResolvedMaterialQuestion({
      binding,
      resolved_question: {
        ...question,
        semantic: "A Provider upgrade silently changed this question's meaning.",
      },
      allowed_selector_fact_paths: ALLOWED_FACTS,
      coverage_domain_state: "required",
    })).toThrow(/contract digest/);
    expect(() => validateIndexerResolvedMaterialQuestion({
      binding,
      resolved_question: question,
      allowed_selector_fact_paths: ALLOWED_FACTS,
      coverage_domain_state: "out-of-scope",
    })).toThrow(/out-of-scope/);
    expect(() => validateIndexerResolvedMaterialQuestion({
      binding,
      resolved_question: {
        ...question,
        evidence_contract: {
          ...question.evidence_contract,
          minimum_items: 1,
          minimum_distinct_sources: 2,
        },
      },
      allowed_selector_fact_paths: ALLOWED_FACTS,
      coverage_domain_state: "required",
    })).toThrow(/minimum_distinct_sources/);
  });
});

describe("QuestionTargetInventory identity", () => {
  test("derives target and Node identity without Artifact/Page counts", () => {
    const value = inventory();
    const item = value.items[0]!;
    expect(item.target_ref).toBe(indexerQuestionSubjectTargetRef(item));
    expect(item.node_ref).toBe(canonicalIndexerNodeRef(SUBJECT));
    expect(indexerQuestionTargetItemDigest(item)).toMatch(/^sha256:/);
    expect(validateIndexerQuestionTargetInventory(value)).toEqual(value);
  });

  test("rejects a forged target ref or inventory digest", () => {
    const targetDrift = inventory();
    targetDrift.items[0]!.target_ref = "question-target:forged";
    const payload = Object.fromEntries(
      Object.entries(targetDrift).filter(([key]) => key !== "inventory_digest"),
    ) as Omit<typeof targetDrift, "inventory_digest">;
    targetDrift.inventory_digest = indexerQuestionTargetInventoryDigest(payload);
    expect(() => validateIndexerQuestionTargetInventory(targetDrift)).toThrow(
      /forged target refs/,
    );

    const digestDrift = inventory();
    digestDrift.inventory_digest = digest("9");
    expect(() => validateIndexerQuestionTargetInventory(digestDrift)).toThrow(/digest/);
  });

  test("derives stable question key and revision from owner/contract/target dependencies", () => {
    const { question } = questionFixture();
    const item = inventory().items[0]!;
    const questionKey = indexerMaterialQuestionKey({
      owner_cell_ref: item.owner_cell_ref,
      question_contract_digest: question.contract_digest,
      question_subject_target_ref: item.target_ref,
    });
    const revision = indexerQuestionRevisionDigest({
      question_contract_digest: question.contract_digest,
      question_key: questionKey,
      owner_cell_digest: digest("7"),
      question_target_item_digest: indexerQuestionTargetItemDigest(item),
    });
    expect(questionKey).toMatch(/^question-key:sha256:/);
    expect(revision).toMatch(/^sha256:/);
  });

  test("keeps same-named required and optional questions separate by owner cell", () => {
    const { question } = questionFixture();
    const target = inventory().items[0]!;
    const requiredOwner = canonicalOwnerCellRef({
      requirementRef: "required-knowledge",
      coverageDomain: "operations",
      sourceRef: target.source_ref,
      moduleRef: target.module_ref,
    });
    const optionalOwner = canonicalOwnerCellRef({
      requirementRef: "optional-guidance",
      coverageDomain: "operations",
      sourceRef: target.source_ref,
      moduleRef: target.module_ref,
    });
    const requiredKey = indexerMaterialQuestionKey({
      owner_cell_ref: requiredOwner,
      question_contract_digest: question.contract_digest,
      question_subject_target_ref: target.target_ref,
    });
    const optionalKey = indexerMaterialQuestionKey({
      owner_cell_ref: optionalOwner,
      question_contract_digest: question.contract_digest,
      question_subject_target_ref: target.target_ref,
    });

    expect(requiredOwner).not.toBe(optionalOwner);
    expect(requiredKey).not.toBe(optionalKey);
  });
});
