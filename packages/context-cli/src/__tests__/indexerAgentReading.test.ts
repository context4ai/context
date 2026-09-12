import { describe, expect, test } from "bun:test";
import { buildIndexerAuthorDependencyView, type IndexerAuthorizedWorksetView, type IndexerMainWorkset } from "@c4a/context";
import { buildIndexerAuthorSourceItems } from "../project/indexerAuthorSourceItems.js";
import { renderIndexerInstructionsReading, renderIndexerWorksetReading } from "../project/indexerAgentReading.js";
import { readingObjects } from "./indexerReading.fixture.js";

const digest = `sha256:${"a".repeat(64)}`;
function fixture() {
  const dependency = buildIndexerAuthorDependencyView({
    source_ref: "repo:sample", module_ref: null, logical_unit_ref: "node:sample",
    positive_nodes: [...[1, 3].map((line) => ({
      kind: "source-span" as const, evidence_ref: `evidence:range-${line}`,
      source_ref: "repo:sample", module_ref: null,
      locator: { path: "src/main.ts", start_line: line, end_line: line },
      content_digest: digest, targets: [],
    })), { kind: "logical-unit", logical_unit_ref: "node:sample", group_projection_digest: digest,
      targets: [{ level: "logical-unit" }] }],
    negative_nodes: [{ kind: "group-input-set", scope_ref: "node:sample", set_digest: digest,
      targets: [{ level: "logical-unit" }] }],
  });
  const item = (ref: string, category: string, value: unknown) => ({
    ref, category, value, item_digest: digest, provenance: { protocol: "sample", digest },
  });
  const spans = dependency.positive_nodes.filter((node) => node.kind === "source-span");
  const text = "// first line\n``` nested fence\nexport const label = '完整';\n";
  const view = {
    protocol: "context.indexer.authorized-workset-view/v1", stage: "author", operation: "main-index",
    source_ref: "repo:sample", module_ref: null, workset_digest: digest,
    execution_request_digest: digest, view_digest: digest, projection_input_digests: [digest],
    items: [
      item("fact:config", "fact", { fact_ref: "fact:config", payload_digest: digest,
        kind: "config", payload: { signature_digest: "business-value", required: true } }),
      ...dependency.positive_nodes.map((node) => item(node.node_ref, "dependency", node)),
      ...dependency.negative_nodes.map((node) => item(node.node_ref, "dependency", node)),
      item("source-text:main", "source-text", { path: "src/main.ts", source_ref: "repo:sample", module_ref: null,
        spans: [{ start_line: 1, end_line: 3, text, source_span_refs: spans.map((node) => node.node_ref) }] }),
      item("requirement:sample", "index-requirement", { reader_goals: ["Use the public API"], exclusions: ["Do not invent defaults"] }),
      item("authority:sample", "author-authority", { allowed_artifact_intents: ["content", "contract"].map((kind) => ({
        source_role: "authoritative-source", document_kind: "code-reference", reader_goal: "understand-capability", artifact_kind: kind,
      })) }),
      item("inventory:main", "inventory-member", { member_id: "fact:config", member_kind: "code-fact" }),
      item("custom:note", "extension-note", { message: "Retain complete unknown Provider payloads", detail: "x".repeat(2000) }),
      item("custom:payload", "extension-note", { payload: "Keep this", payload_digest: "business-digest" }),
      item("custom:text", "extension-note", "Retain non-object material too"),
    ],
  } as unknown as IndexerAuthorizedWorksetView;
  const workset = { stage: "author", source_ref: "repo:sample", group_key: "public-api", workset_digest: digest } as IndexerMainWorkset;
  return { view, workset, dependency, text };
}

describe("Agent task reading and Author source references", () => {
  test("source navigation describes captured ranges without expanding them into fact or evidence IDs", () => {
    const { view } = fixture();
    const index = buildIndexerAuthorSourceItems({ view });
    expect(index.choices).toEqual([{ ref: "source-text:main", source_ref: "repo:sample",
      path: "src/main.ts", ranges: [{ start_line: 1, end_line: 3 }] }]);
    view.items.push({ ...view.items[0]!, ref: "document:other", category: "document",
      value: { source_ref: "repo:other", path: "src/main.ts", spans: [
        { start_line: 1, end_line: 1 }, { start_line: 3, end_line: 3 },
      ] } });
    expect(buildIndexerAuthorSourceItems({ view }).choices).toContainEqual({
      ref: "document:other", source_ref: "repo:other", path: "src/main.ts",
      ranges: [{ start_line: 1, end_line: 1 }, { start_line: 3, end_line: 3 }],
    });
  });

  test("renders goals first and preserves complete source and Provider payloads", () => {
    const { view, workset, text } = fixture();
    const markdown = renderIndexerWorksetReading({ view, workset, task_key: "task-001" });
    expect(markdown.indexOf("Use the public API")).toBeLessThan(markdown.indexOf("## Source material"));
    expect(markdown).toContain(text);
    expect(markdown).toContain("x".repeat(2000));
    expect(readingObjects(markdown).find((value) => value.ref === "fact:config")?.value)
      .toMatchObject({ payload: { signature_digest: "business-value", required: true } });
    expect(markdown).not.toContain('"item_digest"');
    expect(markdown).toContain('"payload_digest": "business-digest"');
    expect(markdown).not.toContain(`"payload_digest": "${digest}"`);
    expect(markdown).toContain("Retain non-object material too");
    expect(readingObjects(markdown).find(item => item.ref === "authority:sample")?.allowed_artifact_intents)
      .toContainEqual({ source_role: "authoritative-source", document_kind: "code-reference", reader_goal: "understand-capability", artifact_kind: "content" });
    const choices = readingObjects(markdown).filter(value => Array.isArray(value.available_ranges));
    expect(choices).toContainEqual({ source_ref: "repo:sample", path: "src/main.ts",
      available_ranges: [{ start_line: 1, end_line: 3 }] });
    expect(markdown).not.toContain('"source_items"');
    expect(markdown).not.toContain('"evidence_ref"');
    expect(renderIndexerWorksetReading({ view, workset, task_key: "task-001" })).toBe(markdown);
  });

  test("instruction delivery retains every body without exposing receipt hashes", () => {
    const markdown = renderIndexerInstructionsReading({ provider_fingerprint: digest,
      resources: [{ path: "rules.md", content: "# Rules\n\nRead the actual material." }, { content: "Last guidance." }] });
    expect(markdown).toContain("# Rules\n\nRead the actual material.");
    expect(markdown).toContain("Last guidance.");
    expect(markdown).not.toContain(digest);
  });
});
