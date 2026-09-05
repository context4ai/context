import { describe, expect, test } from "bun:test";
import {
  buildIndexerMainWorkset,
  canonicalIndexerNodeRef,
  indexerInventoryMembersDigest,
  indexerPartitionPlanCanonicalHash,
  indexerPartitionStrategySetDigest,
  type IndexerInventoryMember,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
  type IndexerPartitionValidationInput,
} from "@c4a/context";
import { convergeIndexerPartitionSubjects } from
  "../project/indexerPartitionSubjectConvergence.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT = {
  protocol: "context.subject-key/v1" as const,
  namespace: "sample",
  kind: "component",
  local_key: "button",
};
const FALLBACK: IndexerPartitionStrategy = {
  kind: "cli-builtin",
  strategy_id: "catalog-fallback",
  implementation_digest: digest("b"),
};
function partition(
  member: IndexerInventoryMember,
  suffix: string,
  options: {
    indexer_id?: string;
    source_ref?: string;
    module_ref?: string | null;
    subject_intent?: "primary" | "enrich-or-independent";
    reader_question_ref?: string;
  } = {},
): IndexerPartitionValidationInput {
  const indexerId = options.indexer_id ?? "sample";
  const strategy: IndexerPartitionStrategy = {
    kind: "project-indexer",
    indexer_id: indexerId,
    strategy_id: "public-target-family",
    implementation_digest: digest("a"),
  };
  const strategies = [{ strategy_ref: strategy, strategy_digest: digest("c") }, {
    strategy_ref: FALLBACK,
    strategy_digest: digest("d"),
  }];
  const inventory = [member];
  const built = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: indexerId,
    requirement_ref: "requirement:overview",
    owner_cell_refs: ["owner-cell:overview#public-api"],
    source_ref: options.source_ref ?? "repo:sample@revision",
    module_ref: options.module_ref === undefined ? "module:sample" : options.module_ref,
    primary_registry_projection_digest: digest("1"),
    requirement_set_digest: digest("2"),
    primary_execution_fingerprint: indexerId === "sample" ? digest("3") : digest("e"),
    profile_contract_digest: digest("4"),
    subject_key_schema_digest: digest("5"),
    source_scope_digest: digest("6"),
    source_binding_digest: digest("7"),
    primary_resource_binding_digest: digest("8"),
    question_target_inventory_digest: digest("9"),
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "sample",
      kind: "module",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest(strategies),
    reader_question_refs: [options.reader_question_ref ?? "question:overview"],
    partition_input_digests: [digest(suffix)],
    partition_inventory_digest: indexerInventoryMembersDigest(inventory),
    allowed_question_target_refs: ["question-target:overview"],
  });
  if (built.stage !== "partition") throw new Error("expected partition workset");
  const workset: IndexerMainPartitionWorkset = built;
  const planPayload = {
    protocol: "context.indexer.partition-plan/v1" as const,
    status: "complete" as const,
    binding: {
      partition_workset_digest: workset.workset_digest,
      indexer_id: workset.indexer_id,
      indexer_fingerprint: workset.primary_execution_fingerprint,
      requirement_digest: workset.requirement_set_digest,
      subject_key_schema_digest: workset.subject_key_schema_digest,
      source_scope_digest: workset.source_scope_digest,
      source_refs: [workset.source_ref],
      module_ref: workset.module_ref,
      partition_subject_key: workset.partition_subject_key,
      parent_scope_ref: workset.module_ref ?? workset.source_ref,
      inventory_digest: workset.partition_inventory_digest,
      question_target_inventory_digest: workset.question_target_inventory_digest,
    },
    strategy_ref: strategy,
    strategy_digest: strategies[0]!.strategy_digest,
    unit_type: "component",
    partition_axis: "public-target-family",
    reader_question_refs: workset.reader_question_refs,
    groups: [{
      group_key: `button-${suffix}`,
      subject_key: SUBJECT,
      subject_intent: options.subject_intent ?? "primary",
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      label: "Button",
      reader_question_refs: [options.reader_question_ref ?? "question:overview"],
      question_target_bindings: [{
        target_ref: "question-target:overview",
        role: "primary-carrier" as const,
      }],
      member_ids: [member.member_id],
    }],
    member_dispositions: [{
      ...member,
      inventory_disposition: "owned" as const,
      group_key: `button-${suffix}`,
    }],
    failure: null,
  };
  const plan: IndexerPartitionPlan = {
    ...planPayload,
    canonical_hash: indexerPartitionPlanCanonicalHash(planPayload),
  };
  return {
    plan,
    workset,
    canonical_inventory_members: inventory,
    authorized_source_refs: [workset.source_ref],
    authorized_strategies: strategies,
    required_question_target_refs: ["question-target:overview"],
  };
}

describe("0.7.5 partition Subject convergence", () => {
  test("keeps the primary origin first regardless of input and digest ordering", () => {
    for (const [primarySuffix, supplementalSuffix] of [["a", "b"], ["b", "a"]]) {
      const primary = partition({ member_id: "member:button", member_kind: "component" }, primarySuffix!);
      const supplementary = partition(
        { member_id: "member:button-props", member_kind: "entry" }, supplementalSuffix!,
        { subject_intent: "enrich-or-independent" },
      );
      for (const inputs of [[primary, supplementary], [supplementary, primary]]) {
        const result = convergeIndexerPartitionSubjects(inputs);
        expect([...result.origins_by_group_ref.values()][0]?.[0]).toEqual({
          partition_workset_digest: primary.workset.workset_digest,
          group_key: `button-${primarySuffix}`,
        });
      }
    }
  });

  test("creates one Author source group for the same Subject proposed by different shards", () => {
    const result = convergeIndexerPartitionSubjects([
      partition({ member_id: "member:button", member_kind: "component" }, "a"),
      partition({ member_id: "member:button-props", member_kind: "entry" }, "b"),
    ]);

    expect(result.partitions).toHaveLength(1);
    const converged = result.partitions[0]!;
    expect(converged.plan.status).toBe("complete");
    if (converged.plan.status !== "complete") throw new Error("expected complete plan");
    expect(converged.plan.groups).toHaveLength(1);
    expect(converged.plan.groups[0]?.member_ids).toEqual([
      "member:button",
      "member:button-props",
    ]);
    expect([...result.origins_by_group_ref.values()][0]).toHaveLength(2);
  });

  test("keeps one primary author and folds a Markdown source into the same Subject", () => {
    const result = convergeIndexerPartitionSubjects([
      partition({ member_id: "member:button", member_kind: "component" }, "a"),
      partition(
        { member_id: "document:button-guide", member_kind: "document" },
        "b",
        {
          indexer_id: "docs",
          source_ref: "file:product-guides",
          module_ref: null,
          subject_intent: "enrich-or-independent",
          reader_question_ref: "question:documentation",
        },
      ),
    ]);

    const converged = result.partitions[0]!;
    expect(converged.workset.indexer_id).toBe("sample");
    expect(converged.workset.source_ref).toBe("repo:sample@revision");
    expect(converged.authorized_source_refs).toEqual([
      "file:product-guides",
      "repo:sample@revision",
    ]);
    if (converged.plan.status !== "complete") throw new Error("expected complete plan");
    expect(converged.plan.groups[0]?.member_ids).toEqual([
      "document:button-guide",
      "member:button",
    ]);
    expect(converged.plan.groups[0]?.reader_question_refs).toEqual(["question:overview"]);
  });

  test("rejects two different Providers claiming primary ownership of one Subject", () => {
    expect(() => convergeIndexerPartitionSubjects([
      partition({ member_id: "member:button", member_kind: "component" }, "a"),
      partition(
        { member_id: "document:button-guide", member_kind: "document" },
        "b",
        {
          indexer_id: "docs",
          source_ref: "file:product-guides",
          module_ref: null,
        },
      ),
    ])).toThrow("requires exactly one primary author");
  });
});
