import { expect, test } from "bun:test";
import { extendsWaveMaterial } from "../project/indexerWaveReceiptBinding.js";
import type { MainRunSpec } from "../project/indexerMainRunStoreRecords.js";

function spec() {
  return { request: { workset: { stage: "author", indexer_id: "test", source_binding_digest: "old",
    group_dependency_view_digest: "old", workset_digest: "old", group_key: "a" } },
    validation: { expected_subject_key: { local_key: "a" }, dependency_view: {
      positive_nodes: [{ kind: "source-span", content_digest: "source" }], negative_nodes: [] },
      canonical_inventory_members: ["a"] } } as unknown as MainRunSpec;
}
test("wave lineage allows additive material and repair but rejects changed evidence, ownership or membership", () => {
  const original = spec();
  const next = spec();
  Object.assign(next.request.workset, { source_binding_digest: "new", group_dependency_view_digest: "new", workset_digest: "new", repair_intent: { instruction: "fix" } });
  const view = next.validation.dependency_view as { positive_nodes: unknown[] };
  view.positive_nodes.push({ kind: "source-span", content_digest: "more" });
  expect(extendsWaveMaterial(original, next)).toBe(true);
  next.validation.canonical_inventory_members = ["other"];
  expect(extendsWaveMaterial(original, next)).toBe(false);
  next.validation.canonical_inventory_members = ["a"];
  view.positive_nodes.shift();
  expect(extendsWaveMaterial(original, next)).toBe(false);
  expect(extendsWaveMaterial(original, { ...original, validation: { ...original.validation, expected_subject_key: { local_key: "other" } } })).toBe(false);
});
