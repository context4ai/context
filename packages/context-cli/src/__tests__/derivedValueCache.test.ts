import { expect, test } from "bun:test";
import { DerivedValueCache } from "../project/derivedValueCache.js";
import { reuseCommandValue, withCommandReadCache } from "../project/commandReadCache.js";

test("nested workflow steps share pure values, while independent commands do not", async () => {
  let calls = 0;
  await withCommandReadCache(async () => {
    for (let step = 0; step < 2; step++) await withCommandReadCache(async () => {
      for (let i = 0; i < 128; i++) expect(reuseCommandValue(`page-${i}`, () => { calls++; return i; })).toBe(i);
    });
    expect(calls).toBe(128);
  });
  await withCommandReadCache(async () => {
    expect(reuseCommandValue("page-0", () => { calls++; return 0; })).toBe(0);
  });
  expect(calls).toBe(129);
});

test("concurrent command scopes remain isolated", async () => {
  await Promise.all([1, 2].map(value => withCommandReadCache(async () => {
    expect(reuseCommandValue("same-key", () => value)).toBe(value);
    await Promise.resolve();
    expect(reuseCommandValue("same-key", () => 99)).toBe(value);
  })));
});

test("entry eviction retains recently used values", () => {
  const cache = new DerivedValueCache();
  for (let i = 0; i < 512; i++) cache.get(String(i), () => i);
  expect(cache.get("0", () => -1)).toBe(0);
  cache.get("new", () => 513);
  expect(cache.get("0", () => -1)).toBe(0);
  expect(cache.get("1", () => -1)).toBe(-1);
});

test("payload eviction and oversize bypass do not retain unbounded results", () => {
  const cache = new DerivedValueCache();
  for (let i = 0; i < 400; i++) cache.get(String(i), () => "x".repeat(30000));
  expect(cache.get("0", () => "evicted")).toBe("evicted");
  const huge = "x".repeat(9 * 1024 * 1024);
  expect(cache.get("huge", () => huge)).toBe(huge);
  expect(cache.get("huge", () => "fresh")).toBe("fresh");
});

test("failed and non-serializable computations cannot poison later calls", () => {
  const cache = new DerivedValueCache();
  expect(() => cache.get("error", () => { throw new Error("failed"); })).toThrow("failed");
  expect(cache.get("error", () => 42)).toBe(42);
  expect(cache.get("bigint", () => 1n)).toBe(1n);
  expect(cache.get("bigint", () => 2n)).toBe(2n);
  expect(cache.get("undefined", () => undefined)).toBeUndefined();
  expect(cache.get("undefined", () => 42)).toBe(42);
});
