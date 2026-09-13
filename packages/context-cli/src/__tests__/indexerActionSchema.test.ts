import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSchemaDocument } from "@c4a/agent-graph";
import { validateIndexerCurrentActionInput } from "@c4a/context";
import { indexerCurrentActionJsonSchema } from "../../scripts/indexerActionSchema.js";

test("the shipped maintenance schema is generated from current runtime definitions", async () => {
  const path = join(import.meta.dir, "../../context-workflow/schemas/indexer-agent-step-result.schema.json");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(indexerCurrentActionJsonSchema());
  const valid = [
    { stage: "structure-review", decision: "approved" },
    { stage: "structure-review", decision: "request-adjustment", feedback: "Separate the reader topics." },
    { stage: "approved-revision", markdown: "Revised article" },
    { stage: "approved-revision", sections: [{ section_id: "overview", content: [{ markdown: "Updated explanation" }] }] },
    { stage: "source-update", decisions: [], scope_summary: "No articles are affected", new_topics: [] },
  ];
  for (const value of valid) {
    expect(() => validateSchemaDocument(indexerCurrentActionJsonSchema(), value, "current input")).not.toThrow();
    expect(() => validateIndexerCurrentActionInput(value)).not.toThrow();
  }
  for (const value of [{ stage: "structure-review", decision: "request-adjustment" },
    { stage: "approved-revision", sections: [{ section_id: "overview" }] }]) {
    // Zod refinements are runtime checks, not representable by the input-only export.
    expect(() => validateIndexerCurrentActionInput(value)).toThrow();
  }
  for (const value of [{ stage: "approved-revision", sections: [{ content: [] }] },
    { stage: "source-update", decisions: [] }]) {
    expect(() => validateSchemaDocument(indexerCurrentActionJsonSchema(), value, "current input")).toThrow();
    expect(() => validateIndexerCurrentActionInput(value)).toThrow();
  }
});

test("current CLI schema does not advertise retired production envelopes", () => {
  for (const stage of ["partition", "author", "post-author", "provider-selection", "provider-resolution", "provider-program-authorization", "layout-confirmation"]) {
    expect(() => validateSchemaDocument(indexerCurrentActionJsonSchema(), { stage, results: [], decision: "approved" }, "retired input")).toThrow();
  }
});
