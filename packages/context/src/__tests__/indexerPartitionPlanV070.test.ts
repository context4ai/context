import { describe, expect, test } from "bun:test";
import {
  buildIndexerMainWorkset,
  canonicalIndexerNodeRef,
  indexerPartitionGroupProjectionDigest,
  indexerInventoryMembersDigest,
  indexerPartitionPlanBindingDigest,
  indexerPartitionPlanCanonicalHash,
  indexerPartitionStrategySetDigest,
  validateIndexerPartitionPlan,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const STRATEGY: IndexerPartitionStrategy = {
  kind: "project-indexer",
  indexer_id: "component-library",
  strategy_id: "component-family",
  implementation_digest: digest("a"),
};
const STRATEGY_DIGEST = digest("b");
const AUTHORIZED_STRATEGIES = [{
  strategy_ref: STRATEGY,
  strategy_digest: STRATEGY_DIGEST,
}];
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};
const MEMBER_IDS = [
  "member:example/basic",
  "member:export/button",
  "member:type/button-props",
];
const INVENTORY = [{
  member_id: MEMBER_IDS[0]!,
  member_kind: "example" as const,
}, {
  member_id: MEMBER_IDS[1]!,
  member_kind: "component" as const,
}, {
  member_id: MEMBER_IDS[2]!,
  member_kind: "component" as const,
}];
const QUESTION_REFS = ["question:operations", "question:public-contract"];
const TARGET_REFS = [
  "question-target:operations",
  "question-target:public-contract",
];
type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
type FailedPartitionPlan = Extract<IndexerPartitionPlan, { status: "failed" }>;

function workset(): IndexerMainPartitionWorkset {
  const value = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: "component-library",
    requirement_ref: "requirement:public-knowledge",
    owner_cell_refs: ["owner-cell:public-knowledge#public-contract"],
    source_ref: "repo:sample@revision",
    module_ref: "module:packages/sample",
    primary_registry_projection_digest: digest("1"),
    requirement_set_digest: digest("2"),
    primary_execution_fingerprint: digest("3"),
    profile_contract_digest: digest("4"),
    subject_key_schema_digest: digest("5"),
    source_scope_digest: digest("6"),
    source_binding_digest: digest("7"),
    primary_resource_binding_digest: digest("8"),
    question_target_inventory_digest: digest("9"),
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "sample-package",
      kind: "component-library",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest(AUTHORIZED_STRATEGIES),
    reader_question_refs: QUESTION_REFS,
    partition_input_digests: [digest("c")],
    partition_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    allowed_question_target_refs: TARGET_REFS,
  });
  if (value.stage !== "partition") throw new Error("expected partition workset");
  return value;
}

function rehash(plan: IndexerPartitionPlan): void {
  const payload = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "canonical_hash"),
  ) as Omit<IndexerPartitionPlan, "canonical_hash">;
  plan.canonical_hash = indexerPartitionPlanCanonicalHash(payload);
}

function completePlan(currentWorkset = workset()): CompletePartitionPlan {
  const payload: Omit<CompletePartitionPlan, "canonical_hash"> = {
    protocol: "context.indexer.partition-plan/v1",
    status: "complete",
    binding: {
      partition_workset_digest: currentWorkset.workset_digest,
      indexer_id: currentWorkset.indexer_id,
      indexer_fingerprint: currentWorkset.primary_execution_fingerprint,
      requirement_digest: currentWorkset.requirement_set_digest,
      subject_key_schema_digest: currentWorkset.subject_key_schema_digest,
      source_scope_digest: currentWorkset.source_scope_digest,
      source_refs: [currentWorkset.source_ref],
      module_ref: currentWorkset.module_ref,
      partition_subject_key: currentWorkset.partition_subject_key,
      parent_scope_ref: currentWorkset.module_ref!,
      inventory_digest: currentWorkset.partition_inventory_digest,
      question_target_inventory_digest: currentWorkset.question_target_inventory_digest,
    },
    strategy_ref: STRATEGY,
    strategy_digest: STRATEGY_DIGEST,
    unit_type: "component-family",
    partition_axis: "canonical-export-root",
    reader_question_refs: QUESTION_REFS,
    groups: [{
      group_key: "component:button",
      subject_key: SUBJECT,
      subject_intent: "primary",
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      label: "Button",
      reader_question_refs: QUESTION_REFS,
      question_target_bindings: [{
        target_ref: TARGET_REFS[0]!,
        role: "primary-carrier",
      }, {
        target_ref: TARGET_REFS[1]!,
        role: "primary-carrier",
      }],
      member_ids: [...MEMBER_IDS],
    }],
    member_dispositions: INVENTORY.map((member) => ({
      member_id: member.member_id,
      member_kind: member.member_kind,
      inventory_disposition: "owned" as const,
      group_key: "component:button",
    })),
    failure: null,
  };
  return {
    ...payload,
    canonical_hash: indexerPartitionPlanCanonicalHash(payload),
  };
}

function validate(plan: unknown, currentWorkset = workset()) {
  return validateIndexerPartitionPlan({
    plan,
    workset: currentWorkset,
    canonical_inventory_members: INVENTORY,
    authorized_source_refs: [currentWorkset.source_ref],
    authorized_strategies: AUTHORIZED_STRATEGIES,
    required_question_target_refs: TARGET_REFS,
  });
}

describe("PartitionPlan authority and closure", () => {
  test("validates exact workset binding, SubjectKey identity, members, and targets", () => {
    const currentWorkset = workset();
    const plan = completePlan(currentWorkset);
    expect(validate(plan, currentWorkset)).toEqual(plan);
    expect(indexerPartitionPlanBindingDigest(plan)).toMatch(/^sha256:/);
    expect(indexerPartitionGroupProjectionDigest(plan, "component:button")).toMatch(
      /^sha256:/,
    );
  });

  test("allows a complete semantic partition when the requirement has no questions", () => {
    const currentWorkset = workset();
    currentWorkset.reader_question_refs = [];
    currentWorkset.allowed_question_target_refs = [];
    const plan = completePlan(currentWorkset);
    plan.reader_question_refs = [];
    plan.groups[0]!.reader_question_refs = [];
    plan.groups[0]!.question_target_bindings = [];
    rehash(plan);
    expect(validateIndexerPartitionPlan({
      plan,
      workset: currentWorkset,
      canonical_inventory_members: INVENTORY,
      authorized_source_refs: [currentWorkset.source_ref],
      authorized_strategies: AUTHORIZED_STRATEGIES,
      required_question_target_refs: [],
    })).toEqual(plan);
  });

  test("rejects incomplete disposition closure and inconsistent group projection", () => {
    const incomplete = completePlan();
    incomplete.member_dispositions.pop();
    rehash(incomplete);
    expect(() => validate(incomplete)).toThrow(/close every inventory member/);

    const inconsistent = completePlan();
    inconsistent.groups[0]!.member_ids.pop();
    rehash(inconsistent);
    expect(() => validate(inconsistent)).toThrow(/member projection is inconsistent/);
  });

  test("rejects invented question targets and missing primary carriers", () => {
    const invented = completePlan();
    invented.groups[0]!.question_target_bindings[0]!.target_ref =
      "question-target:invented";
    rehash(invented);
    expect(() => validate(invented)).toThrow(/unknown question target/);

    const noPrimary = completePlan();
    noPrimary.groups[0]!.question_target_bindings[0]!.role = "enricher";
    rehash(noPrimary);
    expect(() => validate(noPrimary)).toThrow(/exactly one primary carrier/);
  });

  test("rejects non-canonical logical units but leaves labels as diagnostics", () => {
    const wrongIdentity = completePlan();
    wrongIdentity.groups[0]!.logical_unit_ref = "node:other";
    rehash(wrongIdentity);
    expect(() => validate(wrongIdentity)).toThrow(/non-canonical logical unit/);

    const ordinal = completePlan();
    ordinal.groups[0]!.label = "batch-1";
    rehash(ordinal);
    expect(validate(ordinal)).toEqual(ordinal);

    const legitimate = completePlan();
    legitimate.groups[0]!.label = "Batch processing";
    rehash(legitimate);
    expect(validate(legitimate)).toEqual(legitimate);
  });

  test("rejects request-material and an unauthorized strategy structurally", () => {
    const requestMaterial = completePlan() as unknown as Record<string, unknown>;
    requestMaterial.member_dispositions = [{
      member_id: MEMBER_IDS[0],
      inventory_disposition: "request-material",
    }];
    expect(() => validate(requestMaterial)).toThrow();

    const unauthorized = completePlan();
    unauthorized.strategy_digest = digest("e");
    rehash(unauthorized);
    expect(() => validate(unauthorized)).toThrow(/authorized strategy set/);
  });

  test("requires exact missing identity diagnostics on a failed plan", () => {
    const currentWorkset = workset();
    const complete = completePlan(currentWorkset);
    const payload: Omit<FailedPartitionPlan, "canonical_hash"> = {
      protocol: complete.protocol,
      status: "failed",
      binding: complete.binding,
      strategy_ref: complete.strategy_ref,
      strategy_digest: complete.strategy_digest,
      unit_type: complete.unit_type,
      partition_axis: complete.partition_axis,
      reader_question_refs: complete.reader_question_refs,
      groups: [],
      member_dispositions: [],
      failure: {
        code: "insufficient-identity-facts",
        message: "a stable key cannot be derived",
        unassigned_member_ids: MEMBER_IDS,
        missing_capabilities: ["qualified-symbols"],
      },
    };
    const failed: FailedPartitionPlan = {
      ...payload,
      canonical_hash: indexerPartitionPlanCanonicalHash(payload),
    };
    expect(validate(failed)).toEqual(failed);

    delete failed.failure.missing_capabilities;
    rehash(failed);
    expect(() => validate(failed)).toThrow(/must name missing capability or source/);
  });

  test("rejects canonical hash or binding drift", () => {
    const hashDrift = completePlan();
    hashDrift.canonical_hash = digest("f");
    expect(() => validate(hashDrift)).toThrow(/canonical hash/);

    const bindingDrift = completePlan();
    bindingDrift.binding.indexer_id = "another-indexer";
    rehash(bindingDrift);
    expect(() => validate(bindingDrift)).toThrow(/binding/);
  });
});
