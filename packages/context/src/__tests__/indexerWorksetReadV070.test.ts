import { describe, expect, test } from "bun:test";
import {
  buildIndexerWorksetReadReceipt,
  buildIndexerWorksetReadRequest,
  buildIndexerWorksetReadResponse,
  validateIndexerWorksetReadReceipt,
  validateIndexerWorksetReadRequest,
  validateIndexerWorksetReadResponse,
} from "../index.js";

const WORKSET_DIGEST = `sha256:${"a".repeat(64)}`;
const REFS = ["member:sample/button", "member:sample/input"];

function request(cursor?: string, pageSize = 1) {
  return buildIndexerWorksetReadRequest({
    workset_digest: WORKSET_DIGEST,
    read_kind: "source",
    requested_refs: [...REFS].reverse(),
    allowed_refs: REFS,
    ...(cursor === undefined ? {} : { cursor }),
    page_size: pageSize,
  });
}

describe("workset-scoped source/evidence reads", () => {
  test("keeps cursor and page size outside request and page payload identity", () => {
    const firstRequest = request(undefined, 1);
    const resumedRequest = request("opaque:page-2", 100);
    expect(firstRequest.request_digest).toBe(resumedRequest.request_digest);
    expect(firstRequest.requested_refs).toEqual([...REFS].sort());

    const firstPage = buildIndexerWorksetReadResponse({
      request: firstRequest,
      items: [{ ref: REFS[0]!, value: { source: "export const Button = {};" } }],
      next_cursor: "opaque:page-2",
    });
    const replayedPayload = buildIndexerWorksetReadResponse({
      request: resumedRequest,
      request_cursor: "opaque:page-2",
      items: [{ ref: REFS[0]!, value: { source: "export const Button = {};" } }],
    });
    expect(firstPage.page_payload_digest).toBe(replayedPayload.page_payload_digest);
    expect(firstPage.transport).not.toEqual(replayedPayload.transport);
  });

  test("closes a cursor chain into an exact CLI-issued read receipt", () => {
    const firstRequest = request();
    const firstPage = buildIndexerWorksetReadResponse({
      request: firstRequest,
      items: [{ ref: REFS[0]!, value: { source: "button" } }],
      next_cursor: "opaque:page-2",
    });
    const secondRequest = request("opaque:page-2", 25);
    const secondPage = buildIndexerWorksetReadResponse({
      request: secondRequest,
      request_cursor: "opaque:page-2",
      items: [{ ref: REFS[1]!, value: { source: "input" } }],
    });
    expect(validateIndexerWorksetReadRequest({
      request: secondRequest,
      expected_workset_digest: WORKSET_DIGEST,
      allowed_refs: REFS,
    })).toEqual(secondRequest);
    expect(validateIndexerWorksetReadResponse({
      response: secondPage,
      request: secondRequest,
    })).toEqual(secondPage);

    const receipt = buildIndexerWorksetReadReceipt({
      request: firstRequest,
      responses: [firstPage, secondPage],
    });
    expect(receipt.read_set.map((item) => item.ref)).toEqual([...REFS].sort());
    expect(receipt.page_payload_digests).toEqual([
      firstPage.page_payload_digest,
      secondPage.page_payload_digest,
    ]);
    expect(validateIndexerWorksetReadReceipt(receipt)).toEqual(receipt);
  });

  test("rejects reads outside the workset view and broken or incomplete pagination", () => {
    expect(() => buildIndexerWorksetReadRequest({
      workset_digest: WORKSET_DIGEST,
      read_kind: "evidence",
      requested_refs: ["member:private/secret"],
      allowed_refs: REFS,
      page_size: 10,
    })).toThrow(/outside the authorized view/);

    const firstRequest = request();
    const incomplete = buildIndexerWorksetReadResponse({
      request: firstRequest,
      items: [{ ref: REFS[0]!, value: { source: "button" } }],
      next_cursor: "opaque:page-2",
    });
    expect(() => buildIndexerWorksetReadReceipt({
      request: firstRequest,
      responses: [incomplete],
    })).toThrow(/complete cursor chain/);

    const wrongCursorRequest = request("opaque:wrong");
    const wrongCursorPage = buildIndexerWorksetReadResponse({
      request: wrongCursorRequest,
      request_cursor: "opaque:wrong",
      items: [{ ref: REFS[1]!, value: { source: "input" } }],
    });
    expect(() => buildIndexerWorksetReadReceipt({
      request: firstRequest,
      responses: [incomplete, wrongCursorPage],
    })).toThrow(/exact request/);

    const missingRefPage = buildIndexerWorksetReadResponse({
      request: firstRequest,
      items: [{ ref: REFS[0]!, value: { source: "button" } }],
    });
    expect(() => buildIndexerWorksetReadReceipt({
      request: firstRequest,
      responses: [missingRefPage],
    })).toThrow(/exact requested ref set/);
  });
});
