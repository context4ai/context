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
  restoreIndexerCurrentBatch,
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
  });

  test("stops at the first budget boundary without truncating a task", () => {
    const planned = planIndexerCurrentBatch({
      candidates: [
        candidate(0, { input_bytes: indexerBatchStagePolicy("partition").max_input_bytes / 2 }),
        candidate(1, { input_bytes: indexerBatchStagePolicy("partition").max_input_bytes / 2 }),
        candidate(2),
      ],
      shared_instruction_bytes: 1024,
    });

    expect(planned.candidates).toHaveLength(1);
    expect(planned.candidates[0]?.workset.workset_digest).toBe(workset(0).workset_digest);
  });

  test("delivers an oversized semantic task alone without clipping it", () => {
    const planned = planIndexerCurrentBatch({
      candidates: [candidate(0, { input_bytes: 6 * 1024 * 1024 }), candidate(1)],
      shared_instruction_bytes: 1,
    });

    expect(planned.candidates).toHaveLength(1);
    expect(planned.input_bytes).toBe(6 * 1024 * 1024 + 1);
    expect(planned.candidates[0]!.workset).toEqual(workset(0));
  });

  test("Author starts even when shared instructions, output estimates or item counts exceed packing targets", () => {
    const policy = indexerBatchStagePolicy("author");
    for (const overrides of [
      { input_bytes: 252_334 },
      { output_reserve_bytes: policy.max_output_reserve_bytes + 1 },
      { view_item_count: policy.max_view_items + 1 },
    ]) {
      const first = { ...candidate(0, overrides), workset: authorWorkset(0) };
      const planned = planIndexerCurrentBatch({
        candidates: [first, { ...candidate(1), workset: authorWorkset(1) }],
        shared_instruction_bytes: 20_049,
      });
      expect(planned.candidates).toEqual([first]);
      expect(planned.input_bytes).toBe(first.input_bytes + 20_049);
    }
  });

  test("restores all running tasks when packing targets or delivery costs change", () => {
    const candidates = Array.from({ length: 3 }, (_, index) => ({
      ...candidate(index, { input_bytes: 300_000, view_item_count: 900 }),
      workset: authorWorkset(index),
    }));
    const input = { candidates, shared_instruction_bytes: 300_000 };
    expect(planIndexerCurrentBatch(input).candidates).toHaveLength(1);
    const restored = restoreIndexerCurrentBatch(input);
    expect(restored.candidates).toEqual(candidates);
    expect(restored.input_bytes).toBe(1_200_000);
    expect(restored.view_item_count).toBe(2_700);
    expect(restoreIndexerCurrentBatch(input)).toEqual(restored);
    expect(() => restoreIndexerCurrentBatch({ ...input, candidates: [candidates[0]!, candidate(5)] }))
      .toThrow("one authorized batch");
    expect(() => restoreIndexerCurrentBatch({ ...input, candidates: [
      candidates[0]!, { ...candidates[1]!, instruction_identity: digest("different") },
    ] })).toThrow("one authorized batch");
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
