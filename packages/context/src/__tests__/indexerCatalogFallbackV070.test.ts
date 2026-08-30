import { describe, expect, test } from "bun:test";
import {
  buildIndexerCatalogContinuationPlan,
  buildIndexerCatalogFallback,
  buildIndexerMainWorkset,
  canonicalIndexerNodeRef,
  convergeIndexerPartitionPlan,
  indexerPartitionPlanCanonicalHash,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  indexerProtocolDigest,
  validateIndexerCatalogContinuationPlan,
  validateIndexerCatalogFallbackRecord,
  type IndexerCatalogContinuationPlan,
  type IndexerCatalogFallbackRecord,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const MEMBERS = ["member:a", "member:b", "member:c", "member:d"];
const INVENTORY = MEMBERS.map((member_id) => ({
  member_id,
  member_kind: "project" as const,
}));
const TARGETS = ["question-target:details", "question-target:overview"];
const STRATEGIES: readonly {
  strategy_ref: IndexerPartitionStrategy;
  strategy_digest: string;
}[] = [{
  strategy_ref: {
    kind: "project-indexer",
    indexer_id: "sample",
    strategy_id: "first-semantic-attempt",
    implementation_digest: digest("a"),
  },
  strategy_digest: digest("b"),
}, {
  strategy_ref: {
    kind: "project-indexer",
    indexer_id: "sample",
    strategy_id: "second-semantic-attempt",
    implementation_digest: digest("c"),
  },
  strategy_digest: digest("d"),
}, {
  strategy_ref: {
    kind: "cli-builtin",
    strategy_id: "catalog-fallback",
    implementation_digest: digest("e"),
  },
  strategy_digest: digest("f"),
}];

function workset(): IndexerMainPartitionWorkset {
  const value = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: "sample",
    requirement_ref: "requirement:overview",
    owner_cell_refs: ["owner-cell:overview#technical-structure"],
    source_ref: "repo:sample@revision",
    module_ref: "module:sample",
    primary_registry_projection_digest: digest("1"),
    requirement_set_digest: digest("2"),
    primary_execution_fingerprint: digest("3"),
    profile_contract_digest: digest("4"),
    subject_key_schema_digest: digest("5"),
    source_scope_digest: digest("6"),
    parser_contract_digest: digest("7"),
    primary_resource_binding_digest: digest("8"),
    question_target_inventory_digest: digest("9"),
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "sample",
      kind: "module",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest(STRATEGIES),
    reader_question_refs: ["question:overview"],
    partition_input_digests: [digest("0")],
    partition_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    allowed_question_target_refs: TARGETS,
  });
  if (value.stage !== "partition") throw new Error("expected partition workset");
  return value;
}

function nonSemanticPlan(input: {
  workset: IndexerMainPartitionWorkset;
  strategyOrder: 0 | 1;
  axis: string;
}): IndexerPartitionPlan {
  const selected = STRATEGIES[input.strategyOrder]!;
  const subjectKey = {
    protocol: "context.subject-key/v1" as const,
    namespace: "sample",
    kind: "capability",
    local_key: `part-${input.strategyOrder + 1}`,
  };
  const payload = {
    protocol: "context.indexer.partition-plan/v1" as const,
    status: "complete" as const,
    binding: {
      partition_workset_digest: input.workset.workset_digest,
      indexer_id: input.workset.indexer_id,
      indexer_fingerprint: input.workset.primary_execution_fingerprint,
      requirement_digest: input.workset.requirement_set_digest,
      subject_key_schema_digest: input.workset.subject_key_schema_digest,
      source_scope_digest: input.workset.source_scope_digest,
      source_refs: [input.workset.source_ref],
      module_ref: input.workset.module_ref,
      partition_subject_key: input.workset.partition_subject_key,
      parent_scope_ref: input.workset.module_ref!,
      inventory_digest: input.workset.partition_inventory_digest,
      question_target_inventory_digest: input.workset.question_target_inventory_digest,
    },
    strategy_ref: selected.strategy_ref,
    strategy_digest: selected.strategy_digest,
    unit_type: "capability",
    partition_axis: input.axis,
    reader_question_refs: input.workset.reader_question_refs,
    groups: [{
      group_key: `part-${input.strategyOrder + 1}`,
      subject_key: subjectKey,
      subject_intent: "primary" as const,
      logical_unit_ref: canonicalIndexerNodeRef(subjectKey),
      label: `Part ${input.strategyOrder + 1}`,
      reader_question_refs: input.workset.reader_question_refs,
      question_target_bindings: TARGETS.map((targetRef) => ({
        target_ref: targetRef,
        role: "primary-carrier" as const,
      })),
      member_ids: MEMBERS,
    }],
    member_dispositions: INVENTORY.map((member) => ({
      member_id: member.member_id,
      member_kind: member.member_kind,
      inventory_disposition: "owned" as const,
      group_key: `part-${input.strategyOrder + 1}`,
    })),
    failure: null,
  };
  return { ...payload, canonical_hash: indexerPartitionPlanCanonicalHash(payload) };
}

function exhaustedConvergence(current: IndexerMainPartitionWorkset) {
  const common = {
    workset: current,
    canonical_inventory_members: INVENTORY,
    authorized_source_refs: [current.source_ref],
    authorized_strategies: STRATEGIES,
    required_question_target_refs: TARGETS,
  };
  const first = convergeIndexerPartitionPlan({
    ...common,
    plan: nonSemanticPlan({ workset: current, strategyOrder: 0, axis: "ordinal" }),
  });
  return convergeIndexerPartitionPlan({
    ...common,
    plan: nonSemanticPlan({
      workset: current,
      strategyOrder: 1,
      axis: "fixed-count-100",
    }),
    previous_record: first,
  });
}

function fallbackFixture() {
  const current = workset();
  return buildIndexerCatalogFallback({
    workset: current,
    convergence: exhaustedConvergence(current),
    canonical_inventory_members: [...INVENTORY].reverse(),
    authorized_source_refs: [current.source_ref],
    authorized_strategies: STRATEGIES,
    required_question_target_refs: TARGETS,
  });
}

function rehashFallback(record: IndexerCatalogFallbackRecord): void {
  const payload = Object.fromEntries(Object.entries(record).filter(
    ([key]) => key !== "fallback_digest",
  ));
  record.fallback_digest = indexerProtocolDigest(payload);
}

function rehashContinuation(plan: IndexerCatalogContinuationPlan): void {
  const payload = Object.fromEntries(Object.entries(plan).filter(
    ([key]) => key !== "continuation_digest",
  ));
  plan.continuation_digest = indexerProtocolDigest(payload);
}

describe("catalog fallback and folded continuation", () => {
  test("builds one deterministic parent after semantic strategies are exhausted", () => {
    const fallback = fallbackFixture();
    const group = fallback.partition_plan.groups[0]!;
    expect(fallback).toMatchObject({
      protocol: "context.indexer.catalog-fallback/v1",
      user_gate_required: false,
      profile_revision_ledger_consumed: false,
      continuation_policy: {
        advisory_line_threshold: 1500,
        oversized_behavior: "advisory-only",
        split_mode: "physical-continuation",
      },
    });
    expect(fallback.partition_plan.groups).toHaveLength(1);
    expect(group).toMatchObject({
      group_key: "catalog-root",
      subject_intent: "primary",
      logical_unit_ref: canonicalIndexerNodeRef(workset().partition_subject_key),
      member_ids: MEMBERS,
    });
    expect(group.question_target_bindings).toEqual(TARGETS.map((targetRef) => ({
      target_ref: targetRef,
      role: "primary-carrier",
    })));
    expect(validateIndexerCatalogFallbackRecord(fallback)).toEqual(fallback);
  });

  test("keeps oversized continuation advisory-only and folded under one reader unit", () => {
    const fallback = fallbackFixture();
    const continuation = buildIndexerCatalogContinuationPlan({
      fallback,
      estimated_line_count: 1501,
      fragments: [{
        boundary_ref: "symbol:sample#c",
        member_ids: ["member:d", "member:c"],
      }, {
        boundary_ref: "symbol:sample#a",
        member_ids: ["member:b", "member:a"],
      }],
    });
    expect(continuation).toMatchObject({
      readability_advisory: true,
      blocking: false,
      user_gate_required: false,
      profile_revision_ledger_consumed: false,
    });
    expect(continuation.fragments).toHaveLength(2);
    expect(continuation.fragments.every((fragment) =>
      fragment.split_of === fallback.catalog_block.logical_unit_ref &&
      fragment.reader_title === null &&
      fragment.navigation_entry === false &&
      fragment.review_entry === false
    )).toBe(true);
    expect(validateIndexerCatalogContinuationPlan(continuation)).toEqual(continuation);

    const belowThreshold = buildIndexerCatalogContinuationPlan({
      fallback,
      estimated_line_count: 1500,
      fragments: [{ boundary_ref: null, member_ids: MEMBERS.slice(0, 2) }, {
        boundary_ref: null,
        member_ids: MEMBERS.slice(2),
      }],
    });
    expect(belowThreshold.readability_advisory).toBe(false);
    expect(belowThreshold.blocking).toBe(false);
  });

  test("rejects stale authority, incomplete inventory, and independently rehashed forgeries", () => {
    const current = workset();
    expect(() => buildIndexerCatalogFallback({
      workset: current,
      convergence: exhaustedConvergence(current),
      canonical_inventory_members: INVENTORY,
      authorized_source_refs: [current.source_ref],
      authorized_strategies: STRATEGIES.map((strategy, index) => index === 2
        ? { ...strategy, strategy_digest: digest("9") }
        : strategy),
      required_question_target_refs: TARGETS,
    })).toThrow(/authorized convergence successor/);

    const fallback = fallbackFixture();
    expect(() => buildIndexerCatalogContinuationPlan({
      fallback,
      estimated_line_count: 2000,
      fragments: [{ boundary_ref: null, member_ids: MEMBERS.slice(0, 2) }, {
        boundary_ref: null,
        member_ids: MEMBERS.slice(1),
      }],
    })).toThrow(/close the parent member inventory exactly once/);

    const forgedFallback = structuredClone(fallback);
    forgedFallback.partition_plan.groups[0]!.member_ids = MEMBERS.slice(1);
    rehashFallback(forgedFallback);
    expect(() => validateIndexerCatalogFallbackRecord(forgedFallback)).toThrow(
      /single-parent projection|canonical hash/,
    );

    const forgedContinuation = buildIndexerCatalogContinuationPlan({
      fallback,
      estimated_line_count: 2000,
      fragments: [{ boundary_ref: "symbol:sample#a", member_ids: MEMBERS.slice(0, 2) }, {
        boundary_ref: "symbol:sample#c",
        member_ids: MEMBERS.slice(2),
      }],
    });
    forgedContinuation.fragments[0]!.fragment_ref = "artifact-fragment:forged";
    rehashContinuation(forgedContinuation);
    expect(() => validateIndexerCatalogContinuationPlan(forgedContinuation)).toThrow(
      /fragment is not folded/,
    );
  });
});
