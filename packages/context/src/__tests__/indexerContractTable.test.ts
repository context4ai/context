import { expect, test } from "bun:test";
import { renderIndexerDeterministicFacts } from "../indexerContentLayers.js";

test("API tables retain unions, multiline declarations and literal markup", () => {
  const rendered = renderIndexerDeterministicFacts({ renderer: "multi-column-table", facts: [{
    fact_ref: "fact:api", fact_kind: "public-contract-table", evidence_refs: ["evidence:source"],
    subject_key: { protocol: "context.subject-key/v1", namespace: "sample", kind: "component", local_key: "view" },
    value: { columns: ["Name", "Type"], rows: [["value", "A | B\nArray<T>"], ["label", "&text"]] },
  }] });
  expect(rendered).toContain("A &#124; B<br>Array&lt;T&gt;");
  expect(rendered).toContain("&amp;text");
  expect(rendered).not.toContain("fact:api");
});
