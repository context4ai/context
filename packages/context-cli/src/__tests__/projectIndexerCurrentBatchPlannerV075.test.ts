import { describe, expect, test } from "bun:test";
import {
  buildIndexerMainWorkset,
  indexerProtocolDigest,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
} from "@c4a/context";
import {
  indexerBatchStagePolicy,
  planIndexerCurrentBatch,
} from "../project/indexerCurrentBatchPlanner.js";

const SOURCE_REF = "repo:20260904/batch-fixture";

function digest(value: unknown): string {
  return indexerProtocolDigest(value);
}

function workset(index: number): IndexerMainPartitionWorkset {
  const built = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: "batch-fixture",
    requirement_ref: "requirement:batch-fixture",
    owner_cell_refs: ["owner-cell:batch-fixture#public-contract"],
    source_ref: SOURCE_REF,
    module_ref: `module:package-${index}`,
    primary_registry_projection_digest: digest("registry"),
    requirement_set_digest: digest("requirements"),
    primary_execution_fingerprint: digest("execution"),
    profile_contract_digest: digest("profile"),
    subject_key_schema_digest: digest("subject-schema"),
    source_scope_digest: digest("source-scope"),
    source_binding_digest: digest("source-binding"),
    primary_resource_binding_digest: digest("resource-binding"),
    question_target_inventory_digest: digest("questions"),
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "batch-fixture",
      kind: "package",
      local_key: `package-${index}`,
    },
    strategy_set_digest: digest("strategies"),
    reader_question_refs: ["question:public-contract"],
    partition_input_digests: [digest({ input: index })],
    partition_inventory_digest: digest({ inventory: index }),
    allowed_question_target_refs: ["question-target:public-contract"],
  });
  if (built.stage !== "partition") throw new Error("expected Partition workset");
  return built;
}

function authorWorkset(index: number): IndexerMainAuthorWorkset {
  const built = buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "batch-fixture",
    requirement_ref: "requirement:batch-fixture",
    owner_cell_refs: ["owner-cell:batch-fixture#public-contract"],
    source_ref: SOURCE_REF,
    module_ref: `module:package-${index}`,
    primary_registry_projection_digest: digest("registry"),
    requirement_set_digest: digest("requirements"),
    primary_execution_fingerprint: digest("execution"),
    profile_contract_digest: digest("profile"),
    subject_key_schema_digest: digest("subject-schema"),
    source_scope_digest: digest("source-scope"),
    source_binding_digest: digest("source-binding"),
    primary_resource_binding_digest: digest("resource-binding"),
    question_target_inventory_digest: digest("questions"),
    partition_plan_binding_digest: digest("partition-plan"),
    group_key: `package-${index}`,
    logical_unit_ref: `node:subject:${digest({ package: index })}`,
    member_ids_digest: digest({ member_ids: index }),
    member_inventory_digest: digest({ inventory: index }),
    group_projection_digest: digest({ projection: index }),
    group_dependency_view_digest: digest({ dependencies: index }),
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: digest({ eligibility: index }),
  });
  if (built.stage !== "author") throw new Error("expected Author workset");
  return built;
}

function candidate(index: number, overrides: {
  input_bytes?: number;
  output_reserve_bytes?: number;
  view_item_count?: number;
} = {}) {
  return {
    workset: workset(index),
    instruction_identity: digest("instructions"),
    input_bytes: overrides.input_bytes ?? 1_024,
    output_reserve_bytes: overrides.output_reserve_bytes ?? 1_024,
    view_item_count: overrides.view_item_count ?? 1,
  };
}

describe("0.7.5 current Indexer batch planner", () => {
  test("packs a stable prefix using the Partition task limit", () => {
    const taskLimit = indexerBatchStagePolicy("partition").max_tasks;
    const candidates = Array.from({ length: taskLimit + 4 }, (_, index) => candidate(index));
    const first = planIndexerCurrentBatch({
      candidates,
      shared_instruction_bytes: 2_048,
    });
    const second = planIndexerCurrentBatch({
      candidates,
      shared_instruction_bytes: 2_048,
    });

    expect(first.candidates).toHaveLength(taskLimit);
    expect(first.candidates.map((item) => item.workset.workset_digest)).toEqual(
      candidates.slice(0, taskLimit)
        .map((item) => item.workset.workset_digest),
    );
    expect(second).toEqual(first);
    expect(first.oversized_single_task).toBe(false);
  });

  test("stops at the first budget boundary without truncating a task", () => {
    const planned = planIndexerCurrentBatch({
      candidates: [
        candidate(0, { input_bytes: 3 * 1024 * 1024 }),
        candidate(1, { input_bytes: 3 * 1024 * 1024 }),
        candidate(2),
      ],
      shared_instruction_bytes: 1024 * 1024,
    });

    expect(planned.candidates).toHaveLength(1);
    expect(planned.candidates[0]?.workset.workset_digest).toBe(workset(0).workset_digest);
    expect(planned.oversized_single_task).toBe(false);
  });

  test("marks an oversized semantic task instead of silently clipping it", () => {
    const planned = planIndexerCurrentBatch({
      candidates: [candidate(0, { input_bytes: 6 * 1024 * 1024 })],
      shared_instruction_bytes: 1,
    });

    expect(planned.candidates).toHaveLength(1);
    expect(planned.oversized_single_task).toBe(true);
  });

  test("never mixes later-stage work into the current-stage batch", () => {
    const partition = candidate(0);
    const author = {
      ...candidate(1),
      workset: authorWorkset(1),
    };
    const nextPartition = candidate(2);

    const planned = planIndexerCurrentBatch({
      candidates: [partition, author, nextPartition],
      shared_instruction_bytes: 1,
    });

    expect(planned.stage).toBe("partition");
    expect(planned.candidates.map((item) => item.workset.workset_digest)).toEqual([
      partition.workset.workset_digest,
      nextPartition.workset.workset_digest,
    ]);
    expect(planned.candidates.some((item) => item.workset.stage === "author")).toBe(false);
  });
});
