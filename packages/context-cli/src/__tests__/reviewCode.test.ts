import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { createReviewCodeCodec } from "../project/reviewCode.js";
const hash = "a".repeat(64), other = "b".repeat(64);
const codec = createReviewCodeCodec();
for (const count of [1, 7, 8, 9, 50, 137, 500, 1000, 4000, 6000, 20000]) {
  test(`browser and CLI agree on ${count} decisions, segments <=980 characters`, () => {
    const statuses = Array.from({ length: count }, (_, i) => i % 3 ? "approved" : "rejected");
    const browser = runInContext(`(${createReviewCodeCodec.toString()})()`, createContext({})) as ReturnType<typeof createReviewCodeCodec>;
    const parts = browser.encode("all", hash, other, statuses);
    expect(parts.every((part) => part.length <= 980)).toBe(true);
    expect(parts).toEqual(codec.encode("all", hash, other, statuses));
    expect(codec.decode(parts.slice().reverse().join("\n"))).toEqual({ scope: "all", count, idsHash: hash, contentHash: other, statuses });
  });
}
test("uniform decisions stay short and pending decisions cannot be encoded", () => {
  for (const status of ["approved", "rejected"]) {
    const parts = codec.encode("architecture", hash, other, Array(20000).fill(status));
    expect(parts).toHaveLength(1);
    expect(parts[0]!.length).toBeLessThan(160);
    expect(codec.decode(parts[0]!).statuses.every((s) => s === status)).toBe(true);
  }
  expect(() => codec.encode("all", hash, other, ["pending"])).toThrow();
  expect(() => codec.encode("all", hash, other, [])).toThrow();
});
test("missing, duplicate, mixed, corrupt and unsupported codes fail", () => {
  const decisions = Array.from({ length: 10000 }, (_, i) => i % 2 ? "approved" : "rejected");
  const parts = codec.encode("all", hash, other, decisions);
  const different = codec.encode("all", other, hash, decisions);
  expect(parts.length).toBeGreaterThan(1);
  expect(() => codec.decode(parts.slice(1).join("\n"))).toThrow(/Missing/);
  expect(() => codec.decode([...parts, parts[0]!].join("\n"))).toThrow(/Duplicate/);
  expect(() => codec.decode([parts[0]!, ...different.slice(1)].join("\n"))).toThrow(/mixed/);
  expect(() => codec.decode(parts.join("\n").replace(/.$/, "!"))).toThrow();
  const code = codec.encode("all", hash, other, ["approved"])[0]!;
  expect(() => codec.decode(code.replace("CR1", "CR2"))).toThrow();
  expect(() => codec.decode(code.slice(0, -1))).toThrow();
});

test("partial decisions round-trip with pending positions and complete 980-character segments", () => {
  const statuses = Array.from({ length: 10000 }, (_, i) => (["approved", "pending", "rejected"] as const)[i % 3]!);
  const browser = runInContext(`(${createReviewCodeCodec.toString()})()`, createContext({})) as ReturnType<typeof createReviewCodeCodec>;
  const parts = browser.encode("all", hash, other, statuses);
  expect(parts.every(part => part.length <= 980)).toBe(true);
  expect(codec.decode(parts.join("\n")).statuses).toEqual(statuses);
  expect(() => codec.decode(parts.slice(1).join("\n"))).toThrow();
});
