import { expect, test } from "bun:test";
import { kbPackage } from "../index.js";

test("website is opt-in and deployment paths are constrained", () => {
  const base = { name: "sample", template: "src/templates" };
  expect(kbPackage(base).site).toBeUndefined();
  expect(kbPackage({ ...base, site: {} }).site).toEqual({ base: "/", lang: "en-US" });
  expect(kbPackage({ ...base, site: { base: "/docs/" } }).site?.base).toBe("/docs/");
  expect(() => kbPackage({ ...base, site: { base: "../out" } })).toThrow();
});
