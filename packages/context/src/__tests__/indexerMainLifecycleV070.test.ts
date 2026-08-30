import { describe, expect, test } from "bun:test";
import {
  buildIndexerMainAcceptedRecord,
  buildIndexerMainAuthorWorksets,
  buildIndexerMainPartitionWorksets,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerTargetResolutionView,
  canonicalIndexerNodeRef,
  indexerPartitionPlanCanonicalHash,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  indexerTargetQueryRef,
  observeIndexerMainWorksetState,
  validateIndexerMainAcceptedRecord,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const common = {
  indexer_id: "component-library",
  requirement_ref: "requirement:knowledge",
  owner_cell_refs: ["owner-cell:knowledge#public-contract"],
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
};
const GROUP_SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample",
  kind: "component",
  local_key: "button",
};
const STRATEGY: IndexerPartitionStrategy = {
  kind: "cli-builtin",
  strategy_id: "component-family",
  implementation_digest: digest("a"),
};
const STRATEGIES = [{ strategy_ref: STRATEGY, strategy_digest: digest("f") }];
const INVENTORY = [{ member_id: "member:button", member_kind: "component" as const }];

function partition(): IndexerMainPartitionWorkset {
  const workset = buildIndexerMainWorkset({
    ...common,
    stage: "partition",
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "sample",
      kind: "module",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest(STRATEGIES),
    reader_question_refs: ["question:public-contract"],
    partition_input_digests: [digest("b")],
    partition_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    allowed_question_target_refs: ["question-target:public-contract"],
  });
  if (workset.stage !== "partition") throw new Error("expected partition workset");
  return workset;
}

function partitionPlan(workset: IndexerMainPartitionWorkset): IndexerPartitionPlan {
  const payload = {
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
      parent_scope_ref: workset.module_ref!,
      inventory_digest: workset.partition_inventory_digest,
      question_target_inventory_digest: workset.question_target_inventory_digest,
    },
    strategy_ref: STRATEGY,
    strategy_digest: digest("f"),
    unit_type: "component",
    partition_axis: "canonical-export-root",
    reader_question_refs: workset.reader_question_refs,
    groups: [{
      group_key: "component:button",
      subject_key: GROUP_SUBJECT,
      subject_intent: "enrich-or-independent" as const,
      logical_unit_ref: canonicalIndexerNodeRef(GROUP_SUBJECT),
      label: "Button",
      reader_question_refs: workset.reader_question_refs,
      question_target_bindings: [{
        target_ref: workset.allowed_question_target_refs[0]!,
        role: "primary-carrier" as const,
      }],
      member_ids: ["member:button"],
    }],
    member_dispositions: [{
      member_id: "member:button",
      member_kind: "component" as const,
      inventory_disposition: "owned" as const,
      group_key: "component:button",
    }],
    failure: null,
  };
  return { ...payload, canonical_hash: indexerPartitionPlanCanonicalHash(payload) };
}

function author(): IndexerMainAuthorWorkset {
  const workset = buildIndexerMainWorkset({
    ...common,
    stage: "author",
    partition_plan_binding_digest: digest("a"),
    group_key: "component:button",
    logical_unit_ref: "node:subject/button",
    member_ids_digest: digest("b"),
    member_inventory_digest: digest("0"),
    group_projection_digest: digest("c"),
    group_dependency_view_digest: digest("d"),
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: digest("e"),
  });
  if (workset.stage !== "author") throw new Error("expected author workset");
  return workset;
}

function acceptedRecord(workset: IndexerMainPartitionWorkset) {
  const request = {
    workset,
    execution_request_digest: digest("e"),
  } as Parameters<typeof buildIndexerMainAcceptedRecord>[0]["request"];
  const result = {
    consumed_input_view_digest: digest("f"),
    workset_read_receipt_digests: [digest("0")],
    result: { result: { status: "complete" } },
  } as Parameters<typeof buildIndexerMainAcceptedRecord>[0]["result"];
  return buildIndexerMainAcceptedRecord({
    request,
    result,
    run_envelope: {
      envelope_digest: digest("1"),
    } as Parameters<typeof buildIndexerMainAcceptedRecord>[0]["run_envelope"],
    artifact_dependency_set: null,
  });
}

describe("main workset lifecycle facts", () => {
  test("builds a canonical partition set without a batch identity", () => {
    const built = buildIndexerMainPartitionWorksets([{
      ...partition(),
      protocol: undefined,
      operation: undefined,
      workset_digest: undefined,
    } as unknown as Parameters<typeof buildIndexerMainPartitionWorksets>[0][number]]);
    expect(built.worksets).toHaveLength(1);
    expect(built.workset_set.items[0]?.stage).toBe("partition");
  });

  test("publishes pending and accepted result set Facts from a deterministic join", () => {
    const partitionWorkset = partition();
    const authorWorkset = author();
    const worksetSet = buildIndexerMainWorksetSet([partitionWorkset, authorWorkset]);
    const accepted = acceptedRecord(partitionWorkset);
    const status = observeIndexerMainWorksetState({
      workset_set: worksetSet,
      records: [{ ...accepted, state: "accepted" }],
    });
    expect(status).toMatchObject({
      total_count: 2,
      pending_count: 1,
      accepted_count: 1,
      failed_count: 0,
      stale_count: 0,
      outcome: "index-main-workset-pending",
      can_advance: false,
    });
    expect(status.next_refs).toEqual([expect.objectContaining({
      workset_digest: authorWorkset.workset_digest,
      state: "pending",
    })]);
    expect(status.accepted_result_set_digest).toMatch(/^sha256:/);
  });

  test("derives one author workset per fully validated group and binds its exact target query", () => {
    const partitionWorkset = partition();
    const plan = partitionPlan(partitionWorkset);
    const queryRef = indexerTargetQueryRef({
      subject_intent: "enrich-or-independent",
      subject_key: GROUP_SUBJECT,
      subject_key_schema_digest: partitionWorkset.subject_key_schema_digest,
    });
    const targetView = buildIndexerTargetResolutionView({
      requirement_ref: partitionWorkset.requirement_ref,
      subject_key_schema_digest: partitionWorkset.subject_key_schema_digest,
      query_digest: digest("0"),
      entries: [{ query_ref: queryRef, state: "absent" }],
    });
    const built = buildIndexerMainAuthorWorksets({
      partitions: [{
        plan,
        workset: partitionWorkset,
        canonical_inventory_members: INVENTORY,
        authorized_source_refs: [partitionWorkset.source_ref],
        authorized_strategies: STRATEGIES,
        required_question_target_refs: partitionWorkset.allowed_question_target_refs,
      }],
      group_contexts: [{
        partition_workset_digest: partitionWorkset.workset_digest,
        group_key: "component:button",
        group_dependency_view_digest: digest("1"),
        allowed_artifact_policy_variants: ["standard"],
        artifact_policy_eligibility_digest: digest("2"),
        target_resolution_view: targetView,
      }],
    });
    expect(built.worksets).toHaveLength(1);
    expect(built.worksets[0]).toMatchObject({
      stage: "author",
      group_key: "component:button",
      target_resolution_view: targetView,
    });
    expect(built.workset_set.items[0]?.stage).toBe("author");
  });

  test("blocks advancement on failed or stale records and rejects forged acceptance", () => {
    const partitionWorkset = partition();
    const worksetSet = buildIndexerMainWorksetSet([partitionWorkset]);
    const failed = observeIndexerMainWorksetState({
      workset_set: worksetSet,
      records: [{
        workset_digest: partitionWorkset.workset_digest,
        state: "failed",
        execution_request_digest: digest("e"),
        reason_code: "provider-failed",
        dependency_digests: [digest("f")],
      }],
    });
    expect(failed.outcome).toBe("index-main-workset-failed");
    const accepted = acceptedRecord(partitionWorkset);
    expect(() => observeIndexerMainWorksetState({
      workset_set: worksetSet,
      records: [{ ...accepted, state: "accepted", acceptance_digest: digest("f") }],
    })).toThrow(/invalid digest/);
    expect(() => validateIndexerMainAcceptedRecord({
      ...accepted,
      stage: "author",
    })).toThrow(/author records require an Artifact dependency set/);
  });
});
