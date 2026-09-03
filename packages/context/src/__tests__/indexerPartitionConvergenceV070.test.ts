import { describe, expect, test } from "bun:test";
import {
  buildIndexerMainWorkset,
  canonicalIndexerNodeRef,
  convergeIndexerPartitionPlan,
  indexerPartitionPlanCanonicalHash,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  validateIndexerPartitionConvergenceRecord,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const MEMBERS = ["member:a", "member:b", "member:c", "member:d"];
const INVENTORY = MEMBERS.map((member_id) => ({
  member_id,
  member_kind: "method" as const,
}));
const TARGET_REF = "question-target:overview";
const FIRST_STRATEGY: IndexerPartitionStrategy = {
  kind: "project-indexer",
  indexer_id: "sample",
  strategy_id: "fixed-size",
  implementation_digest: digest("a"),
};
const SECOND_STRATEGY: IndexerPartitionStrategy = {
  kind: "project-indexer",
  indexer_id: "sample",
  strategy_id: "capability",
  implementation_digest: digest("b"),
};
const FALLBACK_STRATEGY: IndexerPartitionStrategy = {
  kind: "cli-builtin",
  strategy_id: "catalog-fallback",
  implementation_digest: digest("e"),
};
const STRATEGIES = [{
  strategy_ref: FIRST_STRATEGY,
  strategy_digest: digest("c"),
}, {
  strategy_ref: SECOND_STRATEGY,
  strategy_digest: digest("d"),
}, {
  strategy_ref: FALLBACK_STRATEGY,
  strategy_digest: digest("f"),
}];

function workset(): IndexerMainPartitionWorkset {
  const result = buildIndexerMainWorkset({
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
    source_binding_digest: digest("7"),
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
    partition_input_digests: [digest("e")],
    partition_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    allowed_question_target_refs: [TARGET_REF],
  });
  if (result.stage !== "partition") throw new Error("expected partition workset");
  return result;
}

function group(input: {
  key: string;
  local_key: string;
  label: string;
  members: string[];
  role: "primary-carrier" | "enricher";
}) {
  const subjectKey = {
    protocol: "context.subject-key/v1" as const,
    namespace: "sample",
    kind: "capability",
    local_key: input.local_key,
  };
  return {
    group_key: input.key,
    subject_key: subjectKey,
    subject_intent: "primary" as const,
    logical_unit_ref: canonicalIndexerNodeRef(subjectKey),
    label: input.label,
    reader_question_refs: ["question:overview"],
    question_target_bindings: [{ target_ref: TARGET_REF, role: input.role }],
    member_ids: input.members,
  };
}

function completePlan(input: {
  current: IndexerMainPartitionWorkset;
  strategy_index: 0 | 1;
  axis: string;
  groups: ReturnType<typeof group>[];
}): IndexerPartitionPlan {
  const strategy = STRATEGIES[input.strategy_index]!;
  const payload = {
    protocol: "context.indexer.partition-plan/v1" as const,
    status: "complete" as const,
    binding: {
      partition_workset_digest: input.current.workset_digest,
      indexer_id: input.current.indexer_id,
      indexer_fingerprint: input.current.primary_execution_fingerprint,
      requirement_digest: input.current.requirement_set_digest,
      subject_key_schema_digest: input.current.subject_key_schema_digest,
      source_scope_digest: input.current.source_scope_digest,
      source_refs: [input.current.source_ref],
      module_ref: input.current.module_ref,
      partition_subject_key: input.current.partition_subject_key,
      parent_scope_ref: input.current.module_ref!,
      inventory_digest: input.current.partition_inventory_digest,
      question_target_inventory_digest: input.current.question_target_inventory_digest,
    },
    strategy_ref: strategy.strategy_ref,
    strategy_digest: strategy.strategy_digest,
    unit_type: "capability",
    partition_axis: input.axis,
    reader_question_refs: input.current.reader_question_refs,
    groups: input.groups,
    member_dispositions: input.groups.flatMap((entry) => entry.member_ids.map((memberId) => ({
      member_id: memberId,
      member_kind: "method" as const,
      inventory_disposition: "owned" as const,
      group_key: entry.group_key,
    }))).sort((left, right) => left.member_id < right.member_id ? -1 : 1),
    failure: null,
  };
  return { ...payload, canonical_hash: indexerPartitionPlanCanonicalHash(payload) };
}

function convergenceInput(current: IndexerMainPartitionWorkset, plan: IndexerPartitionPlan) {
  return {
    plan,
    workset: current,
    canonical_inventory_members: INVENTORY,
    authorized_source_refs: [current.source_ref],
    authorized_strategies: STRATEGIES,
    required_question_target_refs: [TARGET_REF],
  };
}

describe("partition strategy convergence", () => {
  test("automatically advances a fixed-count plan to the next strategy without a user Gate", () => {
    const current = workset();
    const firstPlan = completePlan({
      current,
      strategy_index: 0,
      axis: "fixed-count-2",
      groups: [
        group({
          key: "batch-1",
          local_key: "batch-1",
          label: "Batch 1",
          members: MEMBERS.slice(0, 2),
          role: "primary-carrier",
        }),
        group({
          key: "batch-2",
          local_key: "batch-2",
          label: "Batch 2",
          members: MEMBERS.slice(2),
          role: "enricher",
        }),
      ],
    });
    const first = convergeIndexerPartitionPlan(convergenceInput(current, firstPlan));
    expect(first).toMatchObject({
      decision: "retry-required",
      outcome: "partial",
      user_gate_required: false,
      next_strategy_attempt: {
        strategy_order: 1,
        strategy_ref: SECOND_STRATEGY,
        strategy_digest: digest("d"),
      },
    });
    expect(first.attempts[0]).toMatchObject({
      classification: "fixed-count",
      relationship: {
        group_sizes: [2, 2],
        uniform_nonfinal_group_size: true,
        ordinal_identity_sequence: true,
      },
    });

    const secondPlan = completePlan({
      current,
      strategy_index: 1,
      axis: "capability-group",
      groups: [group({
        key: "capability:batch-processing",
        local_key: "batch-processing",
        label: "Batch processing",
        members: MEMBERS,
        role: "primary-carrier",
      })],
    });
    const second = convergeIndexerPartitionPlan({
      ...convergenceInput(current, secondPlan),
      previous_record: first,
    });
    expect(second).toMatchObject({
      decision: "accepted",
      accepted_plan_hash: secondPlan.canonical_hash,
      outcome: "completed",
      user_gate_required: false,
      next_strategy_attempt: null,
    });
    expect(second.attempts).toHaveLength(2);
    expect(second.attempts[1]?.previous_attempt_digest).toBe(
      second.attempts[0]?.attempt_digest,
    );
    expect(validateIndexerPartitionConvergenceRecord(second)).toEqual(second);
  });

  test("classifies alphabetical axes but does not classify a legitimate batch capability name", () => {
    const current = workset();
    const alphabetical = completePlan({
      current,
      strategy_index: 0,
      axis: "alphabetical-range",
      groups: [
        group({
          key: "range:a-b",
          local_key: "range-a-b",
          label: "A-B",
          members: MEMBERS.slice(0, 2),
          role: "primary-carrier",
        }),
        group({
          key: "range:c-d",
          local_key: "range-c-d",
          label: "C-D",
          members: MEMBERS.slice(2),
          role: "enricher",
        }),
      ],
    });
    expect(convergeIndexerPartitionPlan(convergenceInput(current, alphabetical))).toMatchObject({
      decision: "retry-required",
      attempts: [{ classification: "alphabetical" }],
    });

    const semantic = completePlan({
      current,
      strategy_index: 0,
      axis: "capability-group",
      groups: [group({
        key: "capability:batch-processing",
        local_key: "batch-processing",
        label: "Batch processing",
        members: MEMBERS,
        role: "primary-carrier",
      })],
    });
    expect(convergeIndexerPartitionPlan(convergenceInput(current, semantic))).toMatchObject({
      decision: "accepted",
      attempts: [{ classification: "semantic" }],
    });
  });

  test("routes exhausted planning to catalog fallback but blocks damaged identity input", () => {
    const current = workset();
    const first = convergeIndexerPartitionPlan(convergenceInput(current, completePlan({
      current,
      strategy_index: 0,
      axis: "ordinal",
      groups: [group({
        key: "part-1",
        local_key: "part-1",
        label: "Part 1",
        members: MEMBERS,
        role: "primary-carrier",
      })],
    })));
    const exhausted = convergeIndexerPartitionPlan({
      ...convergenceInput(current, completePlan({
        current,
        strategy_index: 1,
        axis: "fixed-count-4",
        groups: [group({
          key: "part-1",
          local_key: "part-1",
          label: "Part 1",
          members: MEMBERS,
          role: "primary-carrier",
        })],
      })),
      previous_record: first,
    });
    expect(exhausted).toMatchObject({
      decision: "catalog-fallback-required",
      outcome: "partial",
      next_strategy_attempt: {
        strategy_order: 2,
        strategy_ref: FALLBACK_STRATEGY,
        strategy_digest: digest("f"),
      },
      user_gate_required: false,
    });

    const strategy = STRATEGIES[0]!;
    const failedPayload = {
      protocol: "context.indexer.partition-plan/v1" as const,
      status: "failed" as const,
      binding: {
        partition_workset_digest: current.workset_digest,
        indexer_id: current.indexer_id,
        indexer_fingerprint: current.primary_execution_fingerprint,
        requirement_digest: current.requirement_set_digest,
        subject_key_schema_digest: current.subject_key_schema_digest,
        source_scope_digest: current.source_scope_digest,
        source_refs: [current.source_ref],
        module_ref: current.module_ref,
        partition_subject_key: current.partition_subject_key,
        parent_scope_ref: current.module_ref!,
        inventory_digest: current.partition_inventory_digest,
        question_target_inventory_digest: current.question_target_inventory_digest,
      },
      strategy_ref: strategy.strategy_ref,
      strategy_digest: strategy.strategy_digest,
      unit_type: "capability",
      partition_axis: "capability-group",
      reader_question_refs: current.reader_question_refs,
      groups: [],
      member_dispositions: [],
      failure: {
        code: "insufficient-identity-facts" as const,
        message: "module identity is missing",
        unassigned_member_ids: MEMBERS,
        missing_capabilities: ["module-identity"],
      },
    };
    const damaged: IndexerPartitionPlan = {
      ...failedPayload,
      canonical_hash: indexerPartitionPlanCanonicalHash(failedPayload),
    };
    expect(convergeIndexerPartitionPlan(convergenceInput(current, damaged))).toMatchObject({
      decision: "blocked-invalid-input",
      outcome: "failed",
      user_gate_required: false,
    });
  });

  test("rejects skipped or stale strategy attempts", () => {
    const current = workset();
    const skipped = completePlan({
      current,
      strategy_index: 1,
      axis: "capability-group",
      groups: [group({
        key: "capability:all",
        local_key: "all",
        label: "All capabilities",
        members: MEMBERS,
        role: "primary-carrier",
      })],
    });
    expect(() => convergeIndexerPartitionPlan(convergenceInput(current, skipped))).toThrow(
      /next authorized strategy/,
    );
  });
});
