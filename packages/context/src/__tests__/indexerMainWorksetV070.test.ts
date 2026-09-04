import { describe, expect, test } from "bun:test";
import {
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerMainTransportBatch,
  buildIndexerTargetResolutionView,
  canonicalIndexerNodeRef,
  indexerOwnerCohortRef,
  indexerMainWorksetDigest,
  indexerMainTransportBatchSchema,
  validateIndexerMainWorkset,
  validateIndexerTargetResolutionView,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
  type IndexerSubjectKey,
} from "../index.js";

const DIGESTS = Array.from(
  { length: 16 },
  (_, index) => `sha256:${index.toString(16).repeat(64)}`,
);
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component-library",
  local_key: "root",
};

const common = {
  indexer_id: "component-library",
  requirement_ref: "requirement:public-knowledge",
  owner_cell_refs: [
    "owner-cell:public-knowledge#operations",
    "owner-cell:public-knowledge#public-contract",
  ],
  source_ref: "repo:sample@revision",
  module_ref: "module:packages/sample",
  primary_registry_projection_digest: DIGESTS[1]!,
  requirement_set_digest: DIGESTS[2]!,
  primary_execution_fingerprint: DIGESTS[3]!,
  profile_contract_digest: DIGESTS[4]!,
  subject_key_schema_digest: DIGESTS[5]!,
  source_scope_digest: DIGESTS[6]!,
  source_binding_digest: DIGESTS[7]!,
  primary_resource_binding_digest: DIGESTS[8]!,
  question_target_inventory_digest: DIGESTS[9]!,
};

function partitionWorkset(): IndexerMainPartitionWorkset {
  const workset = buildIndexerMainWorkset({
    ...common,
    stage: "partition",
    partition_subject_key: SUBJECT,
    strategy_set_digest: DIGESTS[10]!,
    reader_question_refs: ["question:operations", "question:public-contract"],
    partition_input_digests: [DIGESTS[12]!, DIGESTS[11]!],
    partition_inventory_digest: DIGESTS[13]!,
    allowed_question_target_refs: [
      "question-target:public-contract",
      "question-target:operations",
    ],
  });
  if (workset.stage !== "partition") throw new Error("expected partition workset");
  return workset;
}

function authorWorkset(
  groupProjectionDigest = DIGESTS[12]!,
): IndexerMainAuthorWorkset {
  const targetView = buildIndexerTargetResolutionView({
    requirement_ref: common.requirement_ref,
    subject_key_schema_digest: common.subject_key_schema_digest,
    query_digest: DIGESTS[14]!,
    entries: [{
      query_ref: DIGESTS[15]!,
      state: "resolved",
      subject_key: SUBJECT,
      node_ref: canonicalIndexerNodeRef(SUBJECT),
    }],
  });
  const workset = buildIndexerMainWorkset({
    ...common,
    stage: "author",
    partition_plan_binding_digest: DIGESTS[10]!,
    group_key: "component:root",
    logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
    member_ids_digest: DIGESTS[11]!,
    member_inventory_digest: DIGESTS[12]!,
    group_projection_digest: groupProjectionDigest,
    group_dependency_view_digest: DIGESTS[13]!,
    target_resolution_view: targetView,
    allowed_artifact_policy_variants: ["standard", "compact"],
    artifact_policy_eligibility_digest: DIGESTS[14]!,
  });
  if (workset.stage !== "author") throw new Error("expected author workset");
  return workset;
}

describe("MainIndexWorkset", () => {
  test("builds a canonical partition workset with a closed owner cohort", () => {
    const workset = partitionWorkset();
    expect(workset.owner_cell_refs).toEqual([...common.owner_cell_refs].sort());
    expect(workset.partition_input_digests).toEqual(
      [DIGESTS[11]!, DIGESTS[12]!],
    );
    expect(validateIndexerMainWorkset(workset)).toEqual(workset);
    expect(indexerOwnerCohortRef(workset)).toMatch(/^sha256:/);
  });

  test("binds an author workset to one group and a minimal target view", () => {
    const workset = authorWorkset();
    const targetView = workset.target_resolution_view!;
    expect(targetView.entries).toHaveLength(1);
    expect(validateIndexerTargetResolutionView(targetView)).toEqual(targetView);
    expect(validateIndexerMainWorkset(workset)).toEqual(workset);
  });

  test("rejects ambiguous targets before author execution and empty policy eligibility", () => {
    const ambiguous = buildIndexerTargetResolutionView({
      requirement_ref: common.requirement_ref,
      subject_key_schema_digest: common.subject_key_schema_digest,
      query_digest: DIGESTS[14]!,
      entries: [{
        query_ref: DIGESTS[15]!,
        state: "ambiguous",
        conflicting_node_refs: ["node:second", "node:first"],
      }],
    });
    expect(() => buildIndexerMainWorkset({
      ...common,
      stage: "author",
      partition_plan_binding_digest: DIGESTS[10]!,
      group_key: "component:root",
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      member_ids_digest: DIGESTS[11]!,
      member_inventory_digest: DIGESTS[12]!,
      group_projection_digest: DIGESTS[12]!,
      group_dependency_view_digest: DIGESTS[13]!,
      target_resolution_view: ambiguous,
      allowed_artifact_policy_variants: ["standard"],
      artifact_policy_eligibility_digest: DIGESTS[14]!,
    })).toThrow(/index-target-resolution-ambiguous/);

    const author = authorWorkset();
    expect(() => buildIndexerMainWorkset({
      ...author,
      allowed_artifact_policy_variants: [],
      workset_digest: undefined,
      protocol: undefined,
      operation: undefined,
    } as unknown as Parameters<typeof buildIndexerMainWorkset>[0])).toThrow();
  });

  test("rejects digest drift and non-canonical array order", () => {
    const drift = partitionWorkset();
    drift.workset_digest = DIGESTS[15]!;
    expect(() => validateIndexerMainWorkset(drift)).toThrow(/digest/);

    const unordered = partitionWorkset();
    unordered.owner_cell_refs.reverse();
    expect(() => validateIndexerMainWorkset(unordered)).toThrow(
      /digest|canonical ordering/,
    );
  });

  test("binds every canonical partition and author payload field into the digest", () => {
    for (const workset of [partitionWorkset(), authorWorkset()]) {
      const { workset_digest: originalDigest, ...payload } = workset;
      for (const key of Object.keys(payload)) {
        const changed = structuredClone(payload) as Record<string, unknown>;
        const value = changed[key];
        changed[key] = Array.isArray(value)
          ? [...value, `changed:${key}`]
          : value === null
          ? `changed:${key}`
          : typeof value === "string"
          ? `${value}-changed`
          : { ...(value as Record<string, unknown>), changed: key };
        expect(indexerMainWorksetDigest(
          changed as Parameters<typeof indexerMainWorksetDigest>[0],
        )).not.toBe(originalDigest);
      }
    }
  });

  test("keeps partition and author as closed discriminated branches", () => {
    expect(() => validateIndexerMainWorkset({
      ...partitionWorkset(),
      stage: "author",
    })).toThrow();
    expect(() => validateIndexerMainWorkset({
      ...authorWorkset(),
      stage: "partition",
    })).toThrow();
    expect(() => buildIndexerMainWorkset({
      ...common,
      stage: "partition",
      owner_cell_refs: [],
      partition_subject_key: SUBJECT,
      strategy_set_digest: DIGESTS[10]!,
      reader_question_refs: [],
      partition_input_digests: [DIGESTS[11]!],
      partition_inventory_digest: DIGESTS[12]!,
      allowed_question_target_refs: [],
    })).toThrow();
  });

  test("builds deterministic set items instead of a numeric cursor", () => {
    const partition = partitionWorkset();
    const author = authorWorkset();
    const forward = buildIndexerMainWorksetSet([partition, author]);
    const reverse = buildIndexerMainWorksetSet([author, partition]);
    expect(forward).toEqual(reverse);
    expect(forward.items.map((item) => item.workset_digest).sort()).toEqual(
      [partition.workset_digest, author.workset_digest].sort(),
    );
    expect(forward).not.toHaveProperty("cursor");
  });

  test("allows exactly one author workset for each stable group identity", () => {
    const author = authorWorkset();
    const conflicting = authorWorkset(DIGESTS[15]!);
    expect(conflicting.workset_digest).not.toBe(author.workset_digest);
    expect(() => buildIndexerMainWorksetSet([author, conflicting])).toThrow(
      /more than one author workset for a group/,
    );
  });

  test("allows the same local group key in different partition plans", () => {
    const first = authorWorkset();
    const second = buildIndexerMainWorkset({
      ...first,
      workset_digest: undefined,
      protocol: undefined,
      operation: undefined,
      partition_plan_binding_digest: DIGESTS[15]!,
    } as unknown as Parameters<typeof buildIndexerMainWorkset>[0]);
    expect(second.stage).toBe("author");
    expect(buildIndexerMainWorksetSet([first, second]).items).toHaveLength(2);
  });

  test("keeps Host batching transport-only and preserves each workset identity", () => {
    const partition = partitionWorkset();
    const author = authorWorkset();
    const first = buildIndexerMainTransportBatch([partition]);
    const combined = buildIndexerMainTransportBatch([partition, author]);
    expect(first.worksets[0]).toEqual(combined.worksets[0]);
    expect(combined.worksets.map((workset) => workset.workset_digest)).toEqual([
      partition.workset_digest,
      author.workset_digest,
    ]);
    expect(combined).not.toHaveProperty("batch_id");
    expect(combined).not.toHaveProperty("digest");
    expect(combined).not.toHaveProperty("page");
    expect(() => indexerMainTransportBatchSchema.parse({
      ...combined,
      batch_id: "batch-1",
    })).toThrow();
  });
});
