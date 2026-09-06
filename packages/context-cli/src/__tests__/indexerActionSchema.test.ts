import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSchemaDocument } from "@c4a/agent-graph";
import { validateIndexerCurrentActionInput } from "@c4a/context";
import { indexerCurrentActionJsonSchema } from "../../scripts/indexerActionSchema.js";

const schemaPath = join(import.meta.dir, "../../context-workflow/schemas/indexer-agent-step-result.schema.json");
const author = {
  stage: "author", group_key: "public-api", outcome: "publish",
  title: "Public API", summary: "How to use the public entry point.",
  sections: [{ key: "usage", heading: "Usage", markdown: "Call start().", source_items: ["src/index.ts"] }],
  member_dispositions: [{ item: "entry:start", state: "covered", section: "usage" }],
};
const batch = (stage: string, result: unknown) => ({
  stage, results: [{ task_key: "task-001", result }],
});
const publish = (changes: Record<string, unknown>) => batch("author", { ...author, ...changes });
const valid = [
  publish({}),
  batch("author", { stage: "author", group_key: "public-api", outcome: "catalog-only", member_dispositions: [{ item: "entry:start", state: "catalog-only" }] }),
  batch("partition", { stage: "partition", outcome: "complete", groups: [] }),
  batch("partition", { stage: "partition", outcome: "failed", failure: { code: "invalid-input", message: "No identity", unassigned: [] } }),
  batch("post-author", { stage: "post-author", outcome: "complete" }),
  batch("post-author", { stage: "post-author", outcome: "failed", diagnostics: [{ code: "missing-source", message: "Source absent" }] }),
  { stage: "provider-resolution", result: { handler: "host-handler" } },
  { stage: "provider-program-authorization", decision: "approved" },
  { stage: "structure-review", decision: "approved" },
  { stage: "structure-review", decision: "request-adjustment", feedback: "Split the two reader topics" },
  { stage: "layout-confirmation", decision: "approved", paths: [{ artifact_ref: "artifact:start", output_path: "codeindex/start.md" }] },
  { stage: "layout-confirmation", decision: "rejected", feedback: "Use readable paths" },
];
const invalid = [
  publish({ title: undefined }), publish({ summary: undefined }), publish({ sections: [] }),
  publish({ target_resolutions: [{ target: "target:1", disposition: "request-material" }] }),
  publish({ sections: [{ ...author.sections[0], facts: [{ fact_ref: "fact:start" }] }] }),
  batch("partition", { stage: "partition", outcome: "failed" }),
  batch("post-author", { stage: "post-author", outcome: "failed" }),
  batch("post-author", { stage: "post-author", outcome: "failed", diagnostics: [] }),
  batch("post-author", { stage: "post-author", outcome: "complete", fragments: [] }),
  { stage: "structure-review", decision: "request-adjustment" },
  { stage: "layout-confirmation", decision: "rejected" },
  { stage: "layout-confirmation", decision: "rejected", feedback: "No", paths: [{ artifact_ref: "artifact:start", output_path: "start.md" }] },
];

describe("current Action delivered input contract", () => {
  test("is generated from the runtime definitions, not a second field list", async () => {
    expect(JSON.parse(await readFile(schemaPath, "utf8"))).toEqual(indexerCurrentActionJsonSchema());
  });
  test("agrees with runtime on stage inputs, defaults and conditional requirements", () => {
    const schema = indexerCurrentActionJsonSchema();
    for (const value of valid) {
      expect(() => validateSchemaDocument(schema, value, "current input")).not.toThrow();
      expect(() => validateIndexerCurrentActionInput(value)).not.toThrow();
    }
    for (const raw of invalid) {
      const value = JSON.parse(JSON.stringify(raw));
      expect(() => validateSchemaDocument(schema, value, "current input")).toThrow();
      expect(() => validateIndexerCurrentActionInput(value)).toThrow();
    }
  });
});
