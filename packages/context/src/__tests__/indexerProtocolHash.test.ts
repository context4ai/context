import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { canonicalIndexerJson, indexerProtocolDigest } from "../indexerProtocolCommon.js";

test("streamed hashes retain canonical bytes for nested facts and JSON edge cases", () => {
  const shared = { text: "中文 😀 \\ \" \u0000", value: 4 };
  for (const value of [null, false, -0, NaN, Infinity, shared, [shared, shared],
    { "10": 1, "2": 2, z: undefined, a: [undefined, , Symbol("ignored")] },
    new Date(0), { toJSON: () => ({ z: 1, a: 2 }) },
    { nested: Array.from({ length: 1000 }, (_, n) => ({ n, shared, text: "a".repeat(100) })) },
  ]) {
    expect(indexerProtocolDigest(value)).toBe(`sha256:${createHash("sha256").update(canonicalIndexerJson(value)).digest("hex")}`);
  }
});
