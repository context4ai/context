import { describe, expect, test } from "bun:test";
import {
  buildIndexerToolSnapshotReadReceipt,
  indexerToolSnapshotDigest,
  indexerToolSnapshotPageRef,
  indexerToolSnapshotReadReceiptDigest,
  indexerToolSnapshotResponseDigest,
  validateAuthorizedIndexerToolSnapshot,
  validateIndexerToolSnapshot,
  type IndexerToolSnapshot,
} from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const READ_HANDLER = "example.context.service-catalog-read/v1";

const EXPECTED_READ = {
  handler: READ_HANDLER,
  authority_ref: "tool-authority:community",
  authority_digest: DIGEST_A,
  source_ref: "repo:sample",
  module_ref: "module:service",
  input_digest: DIGEST_B,
};

function snapshot(state: "complete" | "partial" = "complete"): IndexerToolSnapshot {
  const resourceIdentity = "tool-resource:service-catalog";
  const cursorOut = state === "complete" ? null : "cursor-2";
  const page = {
    page_ref: indexerToolSnapshotPageRef({
      resource_identity: resourceIdentity,
      query_arguments_digest: DIGEST_B,
      cursor_in: null,
      response_digest: DIGEST_C,
    }),
    cursor_in: null,
    cursor_out: cursorOut,
    item_count: 2,
    response_digest: DIGEST_C,
  };
  const payload: Omit<IndexerToolSnapshot, "snapshot_digest"> = {
    protocol: "context.indexer.tool-snapshot/v1",
    tool: {
      id: "service-catalog-client",
      version: "1.2.3",
      implementation_digest: DIGEST_A,
      authority_ref: "tool-authority:community",
    },
    source: {
      source_ref: "repo:sample",
      module_ref: "module:service",
      input_digest: DIGEST_B,
    },
    resource: {
      provider: "service-catalog",
      kind: "service-catalog",
      identity: resourceIdentity,
      endpoint_type: "service-methods",
      protocol: "rpc",
      resolved_revision: "2026.08.27",
    },
    location: { site: "example", region: "region-a" },
    query: { operation: "list-methods", arguments_digest: DIGEST_B },
    pages: [page],
    completion: { state, next_cursor: cursorOut },
    observation: {
      observed_at: "2026-08-27T12:00:00.000Z",
      response_digest: indexerToolSnapshotResponseDigest([page]),
    },
  };
  return { ...payload, snapshot_digest: indexerToolSnapshotDigest(payload) };
}

describe("tool snapshot source ABI", () => {
  test("binds exact tool, source, location, endpoint, revision, query, pagination, observation, and response digests", () => {
    expect(validateIndexerToolSnapshot(snapshot())).toEqual(snapshot());
    expect(validateIndexerToolSnapshot(snapshot("partial")).completion.next_cursor)
      .toBe("cursor-2");
  });

  test("rejects forged page identity, broken cursor chain, and false completion", () => {
    const forged = snapshot();
    forged.pages[0]!.page_ref = "tool-page:forged";
    expect(() => validateIndexerToolSnapshot(forged)).toThrow(/non-canonical identity/);

    const broken = snapshot("partial");
    broken.completion = { state: "complete", next_cursor: null };
    expect(() => validateIndexerToolSnapshot(broken)).toThrow(/completion/);
  });

  test("rejects semantic drift under an old snapshot digest", () => {
    const changed = snapshot();
    changed.tool.version = "1.2.4";
    expect(() => validateIndexerToolSnapshot(changed)).toThrow(/snapshot digest/);
  });

  test("rejects a forged aggregate response digest", () => {
    const changed = snapshot();
    changed.observation.response_digest = DIGEST_A;
    const payload = { ...changed };
    Reflect.deleteProperty(payload, "snapshot_digest");
    changed.snapshot_digest = indexerToolSnapshotDigest(payload);
    expect(() => validateIndexerToolSnapshot(changed)).toThrow(/response digest/);
  });

  test("requires a receipt bound to the expected remote read authority and source", () => {
    const value = snapshot();
    const receipt = buildIndexerToolSnapshotReadReceipt({
      snapshot: value,
      handler: READ_HANDLER,
      authority_digest: DIGEST_A,
    });
    expect(validateAuthorizedIndexerToolSnapshot({
      value,
      receipt,
      expected: EXPECTED_READ,
    })).toEqual({ snapshot: value, receipt });

    expect(() => validateAuthorizedIndexerToolSnapshot({
      value,
      receipt: undefined,
      expected: EXPECTED_READ,
    })).toThrow();
    expect(() => validateAuthorizedIndexerToolSnapshot({
      value,
      receipt: buildIndexerToolSnapshotReadReceipt({
        snapshot: value,
        handler: READ_HANDLER,
        authority_digest: DIGEST_C,
      }),
      expected: EXPECTED_READ,
    })).toThrow(/expected authority/);
  });

  test("rejects a rehashed receipt for another source or output", () => {
    const otherSource = snapshot();
    otherSource.source.source_ref = "repo:other";
    const payload = { ...otherSource };
    Reflect.deleteProperty(payload, "snapshot_digest");
    otherSource.snapshot_digest = indexerToolSnapshotDigest(payload);
    const otherSourceReceipt = buildIndexerToolSnapshotReadReceipt({
      snapshot: otherSource,
      handler: READ_HANDLER,
      authority_digest: DIGEST_A,
    });
    expect(() => validateAuthorizedIndexerToolSnapshot({
      value: otherSource,
      receipt: otherSourceReceipt,
      expected: EXPECTED_READ,
    })).toThrow(/resolved source identity/);

    const value = snapshot();
    const forgedOutputReceipt = buildIndexerToolSnapshotReadReceipt({
      snapshot: value,
      handler: READ_HANDLER,
      authority_digest: DIGEST_A,
    });
    forgedOutputReceipt.output.response_digest = DIGEST_A;
    const receiptPayload = { ...forgedOutputReceipt };
    Reflect.deleteProperty(receiptPayload, "receipt_digest");
    forgedOutputReceipt.receipt_digest = indexerToolSnapshotReadReceiptDigest(receiptPayload);
    expect(() => validateAuthorizedIndexerToolSnapshot({
      value,
      receipt: forgedOutputReceipt,
      expected: EXPECTED_READ,
    })).toThrow(/current output/);
  });
});
