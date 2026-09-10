import { expect, test } from "bun:test";
import { inheritAuthorTaskGroup } from "../project/indexerAuthorTaskDefaults.js";
import { authorReadingFixture } from "./indexerBatchReading.fixture.js";
import { indexerCurrentActionJsonSchema } from "../../scripts/indexerActionSchema.js";

const task = { spec: { request: { workset: authorReadingFixture(0, 0).workset } } } as Parameters<typeof inheritAuthorTaskGroup>[1];
test("current task supplies only missing group identity for all semantic outcomes", () => {
  for (const outcome of ["publish", "catalog-only", "request-material", "unsupported"]) {
    const original = { stage: "author", outcome };
    expect(inheritAuthorTaskGroup(original, task)).toEqual({ ...original, group_key: "component-0" });
    expect(original).not.toHaveProperty("group_key");
  }
  const explicit = { group_key: "component-0" };
  expect(inheritAuthorTaskGroup(explicit, task)).toBe(explicit);
  for (const group_key of ["other", "", null, 42]) expect(() => inheritAuthorTaskGroup({ group_key }, task)).toThrow("group_key");
  for (const malformed of [null, 1, [], "invalid"]) expect(inheritAuthorTaskGroup(malformed, task)).toBe(malformed);
});

test("published CLI batch schema exposes group inheritance without weakening other required fields", () => {
  const schema = indexerCurrentActionJsonSchema();
  let groups = 0;
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as { properties?: Record<string, unknown>; required?: string[] };
    if (node.properties?.group_key) {
      groups++;
      expect(node.required).not.toContain("group_key");
      expect(node.required).toContain("stage");
      expect(node.required).toContain("outcome");
    }
    Object.values(value).forEach(visit);
  };
  visit(schema.$defs.authorBatch);
  expect(groups).toBeGreaterThan(0);
});
