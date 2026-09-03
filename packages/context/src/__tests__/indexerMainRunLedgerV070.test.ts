import { describe, expect, test } from "bun:test";
import {
  acceptIndexerMainRun,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  failIndexerMainRun,
  indexerProtocolDigest,
  initializeIndexerMainRunLedger,
  observeIndexerMainRunLedger,
  recoverIndexerMainRunLedger,
  retryIndexerMainPartitionRun,
  startIndexerMainRun,
  type IndexerMainAcceptedRecord,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
  type IndexerMainWorkset,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function workset(input: {
  indexer_id: string;
  owner: string;
  input_digest: string;
}): IndexerMainPartitionWorkset {
  const built = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: input.indexer_id,
    requirement_ref: "requirement:knowledge",
    owner_cell_refs: [input.owner],
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
      namespace: input.indexer_id,
      kind: "module",
      local_key: "root",
    },
    strategy_set_digest: digest("a"),
    reader_question_refs: ["question:knowledge"],
    partition_input_digests: [input.input_digest],
    partition_inventory_digest: digest("b"),
    allowed_question_target_refs: ["question-target:knowledge"],
  });
  if (built.stage !== "partition") throw new Error("expected partition workset");
  return built;
}

function accepted(input: {
  workset: IndexerMainWorkset;
  request_digest: string;
  result_digest?: string;
}): IndexerMainAcceptedRecord {
  const payload = {
    protocol: "context.indexer.main-accepted-result/v1" as const,
    workset_digest: input.workset.workset_digest,
    stage: input.workset.stage,
    execution_request_digest: input.request_digest,
    result_digest: input.result_digest ?? indexerProtocolDigest({ results: [] }),
    receipt_digest: digest("d"),
    run_envelope_digest: digest("e"),
    artifact_dependency_set_digest: input.workset.stage === "author"
      ? indexerProtocolDigest({
          protocol: "context.indexer.empty-artifact-dependency-set/v1",
          workset_digest: input.workset.workset_digest,
        })
      : null,
  };
  return { ...payload, acceptance_digest: indexerProtocolDigest(payload) };
}

function authorWorkset(
  index: number,
  groupProjectionDigest = indexerProtocolDigest({ kind: "group", index }),
): IndexerMainAuthorWorkset {
  const identity = index.toString().padStart(4, "0");
  const built = buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "component-library",
    requirement_ref: "requirement:knowledge",
    owner_cell_refs: ["owner-cell:knowledge#components"],
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
    partition_plan_binding_digest: digest("a"),
    group_key: `component:${identity}`,
    logical_unit_ref: `node:component/${identity}`,
    member_ids_digest: indexerProtocolDigest({ kind: "members", index }),
    member_inventory_digest: indexerProtocolDigest({ kind: "inventory", index }),
    group_projection_digest: groupProjectionDigest,
    group_dependency_view_digest: indexerProtocolDigest({ kind: "dependencies", index }),
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: indexerProtocolDigest({ kind: "policy", index }),
  });
  if (built.stage !== "author") throw new Error("expected author workset");
  return built;
}

describe("content-addressed main Indexer run ledger", () => {
  test("recovers exact accepted empty results and resets interrupted running work", () => {
    const first = workset({
      indexer_id: "components",
      owner: "owner-cell:knowledge#components",
      input_digest: digest("c"),
    });
    const second = workset({
      indexer_id: "routes",
      owner: "owner-cell:knowledge#routes",
      input_digest: digest("e"),
    });
    const set = buildIndexerMainWorksetSet([first, second]);
    const firstRequest = digest("f");
    const secondRequest = digest("0");
    let ledger = initializeIndexerMainRunLedger({
      workset_set: set,
      run_identities: [
        { workset_digest: first.workset_digest, execution_request_digest: firstRequest },
        { workset_digest: second.workset_digest, execution_request_digest: secondRequest },
      ],
    });
    ledger = startIndexerMainRun({ ledger, workset_digest: second.workset_digest });
    const recovered = recoverIndexerMainRunLedger({
      workset_set: set,
      run_identities: [
        { workset_digest: first.workset_digest, execution_request_digest: firstRequest },
        { workset_digest: second.workset_digest, execution_request_digest: secondRequest },
      ],
      previous_ledger: ledger,
      accepted_records: [accepted({ workset: first, request_digest: firstRequest })],
    });
    expect(recovered.entries.map((entry) => entry.state)).toEqual([
      "accepted",
      "pending",
    ]);
    expect(observeIndexerMainRunLedger(recovered)).toMatchObject({
      accepted_count: 1,
      pending_count: 1,
      can_advance: false,
    });
  });

  test("invalidates only the changed logical item and preserves another accepted cache hit", () => {
    const unchanged = workset({
      indexer_id: "routes",
      owner: "owner-cell:knowledge#routes",
      input_digest: digest("1"),
    });
    const oldChanged = workset({
      indexer_id: "components",
      owner: "owner-cell:knowledge#components",
      input_digest: digest("2"),
    });
    const oldSet = buildIndexerMainWorksetSet([unchanged, oldChanged]);
    const unchangedRequest = digest("3");
    const oldRequest = digest("4");
    const previous = initializeIndexerMainRunLedger({
      workset_set: oldSet,
      run_identities: [
        { workset_digest: unchanged.workset_digest, execution_request_digest: unchangedRequest },
        { workset_digest: oldChanged.workset_digest, execution_request_digest: oldRequest },
      ],
    });
    const changed = workset({
      indexer_id: "components",
      owner: "owner-cell:knowledge#components",
      input_digest: digest("5"),
    });
    const currentSet = buildIndexerMainWorksetSet([unchanged, changed]);
    const recovered = recoverIndexerMainRunLedger({
      workset_set: currentSet,
      run_identities: [
        { workset_digest: unchanged.workset_digest, execution_request_digest: unchangedRequest },
        { workset_digest: changed.workset_digest, execution_request_digest: digest("6") },
      ],
      previous_ledger: previous,
      accepted_records: [accepted({
        workset: unchanged,
        request_digest: unchangedRequest,
      })],
    });
    expect(recovered.entries.find((entry) =>
      entry.workset_digest === unchanged.workset_digest
    )?.state).toBe("accepted");
    expect(recovered.entries.find((entry) =>
      entry.workset_digest === changed.workset_digest
    )).toMatchObject({
      state: "stale",
      previous_workset_digest: oldChanged.workset_digest,
      previous_execution_request_digest: oldRequest,
    });
  });

  test("requires running state for acceptance/failure and keeps deterministic next refs", () => {
    const current = workset({
      indexer_id: "components",
      owner: "owner-cell:knowledge#components",
      input_digest: digest("7"),
    });
    const requestDigest = digest("8");
    let ledger = initializeIndexerMainRunLedger({
      workset_set: buildIndexerMainWorksetSet([current]),
      run_identities: [{
        workset_digest: current.workset_digest,
        execution_request_digest: requestDigest,
      }],
    });
    expect(() => acceptIndexerMainRun({
      ledger,
      accepted_record: accepted({ workset: current, request_digest: requestDigest }),
    })).toThrow(/running/);
    ledger = startIndexerMainRun({ ledger, workset_digest: current.workset_digest });
    ledger = failIndexerMainRun({
      ledger,
      workset_digest: current.workset_digest,
      reason_code: "source-unavailable",
      dependency_digests: [digest("a")],
    });
    expect(observeIndexerMainRunLedger(ledger)).toMatchObject({
      failed_count: 1,
      outcome: "index-main-workset-failed",
      next_refs: [expect.objectContaining({ state: "failed" })],
    });
  });

  test("requeues the same partition item with a new strategy request identity", () => {
    const current = workset({
      indexer_id: "components",
      owner: "owner-cell:knowledge#components",
      input_digest: digest("1"),
    });
    const firstRequest = digest("2");
    const secondRequest = digest("3");
    let ledger = initializeIndexerMainRunLedger({
      workset_set: buildIndexerMainWorksetSet([current]),
      run_identities: [{
        workset_digest: current.workset_digest,
        execution_request_digest: firstRequest,
      }],
    });
    ledger = startIndexerMainRun({ ledger, workset_digest: current.workset_digest });
    const retried = retryIndexerMainPartitionRun({
      ledger,
      workset_digest: current.workset_digest,
      previous_execution_request_digest: firstRequest,
      next_execution_request_digest: secondRequest,
    });
    expect(retried.entries[0]).toMatchObject({
      state: "pending",
      workset_digest: current.workset_digest,
      execution_request_digest: secondRequest,
    });
    expect(retried.entries[0]?.run_identity_digest).not.toBe(
      ledger.entries[0]?.run_identity_digest,
    );
    expect(observeIndexerMainRunLedger(retried)).toMatchObject({
      pending_count: 1,
      failed_count: 0,
      stale_count: 0,
    });
    expect(() => retryIndexerMainPartitionRun({
      ledger: retried,
      workset_digest: current.workset_digest,
      previous_execution_request_digest: firstRequest,
      next_execution_request_digest: secondRequest,
    })).toThrow(/current running request/);
  });

  test("recovers hundreds of groups without rerunning accepted empty results", () => {
    const worksets = Array.from({ length: 384 }, (_, index) => authorWorkset(index));
    const set = buildIndexerMainWorksetSet(worksets);
    expect(buildIndexerMainWorksetSet([...worksets].reverse())).toEqual(set);
    const identities = worksets.map((current, index) => ({
      workset_digest: current.workset_digest,
      execution_request_digest: indexerProtocolDigest({ kind: "request", index }),
    }));
    const requestByWorkset = new Map(identities.map((identity) => [
      identity.workset_digest,
      identity.execution_request_digest,
    ]));
    let interrupted = initializeIndexerMainRunLedger({
      workset_set: set,
      run_identities: identities,
    });
    for (const current of worksets.slice(192, 204)) {
      interrupted = startIndexerMainRun({
        ledger: interrupted,
        workset_digest: current.workset_digest,
      });
    }
    const acceptedRecords = worksets.slice(0, 192).map((current) => accepted({
      workset: current,
      request_digest: requestByWorkset.get(current.workset_digest)!,
    }));
    const recovered = recoverIndexerMainRunLedger({
      workset_set: set,
      run_identities: identities,
      previous_ledger: interrupted,
      accepted_records: acceptedRecords,
    });
    const status = observeIndexerMainRunLedger(recovered);
    expect(status).toMatchObject({
      total_count: 384,
      accepted_count: 192,
      pending_count: 192,
      failed_count: 0,
      stale_count: 0,
      can_advance: false,
    });
    const acceptedDigests = new Set(acceptedRecords.map((record) => record.workset_digest));
    expect(status.next_refs.map((item) => item.workset_digest)).toEqual(
      set.items.filter((item) => !acceptedDigests.has(item.workset_digest))
        .map((item) => item.workset_digest),
    );
    expect(recoverIndexerMainRunLedger({
      workset_set: set,
      run_identities: identities,
      previous_ledger: recovered,
      accepted_records: acceptedRecords,
    })).toEqual(recovered);
  });

  test("makes only one changed author group stale while retaining all unrelated results", () => {
    const previousWorksets = Array.from(
      { length: 320 },
      (_, index) => authorWorkset(index),
    );
    const previousSet = buildIndexerMainWorksetSet(previousWorksets);
    const previousIdentities = previousWorksets.map((current, index) => ({
      workset_digest: current.workset_digest,
      execution_request_digest: indexerProtocolDigest({ kind: "request", index }),
    }));
    const previous = initializeIndexerMainRunLedger({
      workset_set: previousSet,
      run_identities: previousIdentities,
    });
    const changedIndex = 217;
    const currentWorksets = previousWorksets.map((current, index) =>
      index === changedIndex
        ? authorWorkset(index, indexerProtocolDigest({ kind: "changed-group", index }))
        : current
    );
    const currentSet = buildIndexerMainWorksetSet(currentWorksets);
    const currentIdentities = currentWorksets.map((current, index) => ({
      workset_digest: current.workset_digest,
      execution_request_digest: indexerProtocolDigest({ kind: "request", index }),
    }));
    const acceptedRecords = currentWorksets.flatMap((current, index) =>
      index === changedIndex ? [] : [accepted({
        workset: current,
        request_digest: currentIdentities[index]!.execution_request_digest,
      })]
    );
    const recovered = recoverIndexerMainRunLedger({
      workset_set: currentSet,
      run_identities: currentIdentities,
      previous_ledger: previous,
      accepted_records: acceptedRecords,
    });
    expect(observeIndexerMainRunLedger(recovered)).toMatchObject({
      total_count: 320,
      accepted_count: 319,
      pending_count: 0,
      stale_count: 1,
      outcome: "index-main-workset-stale",
    });
    expect(recovered.entries.filter((entry) => entry.state === "stale")).toEqual([
      expect.objectContaining({
        group_key: `component:${changedIndex.toString().padStart(4, "0")}`,
        previous_workset_digest: previousWorksets[changedIndex]!.workset_digest,
      }),
    ]);
  });
});
