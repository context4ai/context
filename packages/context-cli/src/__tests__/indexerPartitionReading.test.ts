import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { indexerProtocolDigest, type IndexerAuthorizedWorksetView, type IndexerMainWorkset } from "@c4a/context";
import { buildIndexerTaskReading, renderIndexerWorksetReading } from "../project/indexerAgentReading.js";
import { renderIndexerBatchReading } from "../project/indexerBatchReading.js";
import { prepareIndexerWorksetReadings } from "../project/indexerAgentReadingResources.js";
import { readingItems } from "./indexerReading.fixture.js";
import { planIndexerReadingFiles } from "../project/indexerReadingFiles.js";

function fixture(index: number) {
  const digest = indexerProtocolDigest(index);
  const declaration = "/** Default is false. Keep ` and ``` literally. */\n{ enabled?: boolean; }\n";
  const payload = { name: "Options", typeAnnotation: declaration,
    initializer: "function make() {\n  return { enabled: false };\n}",
    members: [{ name: "enabled", optional: true, readonly: false, doc: "Keep all conditions" }],
    payload_digest: "business-field", extra: { signature_digest: "business-signature", nullable: null } };
  const item = (ref: string, category: string, value: unknown) => ({ ref, category, value,
    item_digest: digest, provenance: { protocol: "fixture", container_ref: "source:common", digest } });
  const ref = "adapter-fact:options";
  const carrier = { fact_ref: ref, payload_digest: digest, denominator: "symbol", kind: "code-symbol",
    locator: { source_ref: "repo:sample", normalized_path: "src/options.ts", signature_digest: digest }, payload };
  const view = { protocol: "context.indexer.authorized-workset-view/v1", stage: "partition", operation: "main-index",
    source_ref: "repo:sample", module_ref: null, workset_digest: digest, execution_request_digest: digest,
    view_digest: digest, projection_input_digests: [], items: [
      item("requirement:common", "index-requirement", { purpose: "Use the supported public API", exclusions: ["unrelated examples"] }),
      item("authority:common", "partition-authority", { available_artifact_intents: ["source/guide/use/content"],
        available_templates: [{ id: "guide" }], base_subject_key: { namespace: "sample", kind: "capability" } }),
      item(ref, "consumer-anchor", carrier),
      item("adapter-file:options", "parser-file", { file_ref: "adapter-file:options", normalized_path: "src/options.ts", fact_count: 7 }),
      item(`extension:${index}`, "extension-note", { payload_digest: digest, detail: `unique ${index}` }),
    ] } as unknown as IndexerAuthorizedWorksetView;
  const workset = { stage: "partition", source_ref: "repo:sample", workset_digest: digest,
    reader_question_refs: [], allowed_question_target_refs: [] } as unknown as IndexerMainWorkset;
  return { view, workset, task_key: `task-00${index + 1}`, payload, carrier };
}

function restoredCarrier(markdown: string) {
  const carrier = structuredClone(readingItems(markdown, "consumer-anchor")[0]!.value) as {
    payload: Record<string, unknown>;
  };
  for (const match of markdown.matchAll(/Verbatim payload\.(\w+) for adapter-fact:options:\n\n(`{3,})\n([\s\S]*?)\n\2/g)) {
    carrier.payload[match[1]!] = match[3]!;
  }
  return carrier;
}

test("Partition presentation preserves semantic fields and exact declarations without mutating the View", () => {
  const input = fixture(0);
  const before = JSON.stringify(input);
  const markdown = renderIndexerWorksetReading(input);
  const { fact_ref: _ref, payload_digest: _digest, ...expected } = structuredClone(input.carrier);
  void _ref; void _digest;
  delete (expected.locator as { signature_digest?: string }).signature_digest;
  expect(restoredCarrier(markdown)).toEqual(expected);
  expect(readingItems(markdown, "parser-file")[0]).toEqual({ ref: "adapter-file:options",
    value: { normalized_path: "src/options.ts", fact_count: 7 } });
  expect(readingItems(markdown, "extension-note")[0]!.value).toEqual({ payload_digest: indexerProtocolDigest(0), detail: "unique 0" });
  expect(JSON.stringify(input)).toBe(before);
  expect(markdown.indexOf("Use the supported public API")).toBeLessThan(markdown.indexOf("### consumer-anchor"));
});

test("unknown anchor carriers and non-duplicate file references remain intact", () => {
  const input = fixture(0);
  const anchor = input.view.items.find((item) => item.category === "consumer-anchor")!;
  anchor.value = { fact_ref: "different-reference", payload: input.payload, payload_digest: "not-a-carrier" };
  const file = input.view.items.find((item) => item.category === "parser-file")!;
  file.value = { file_ref: "different-file-reference", extension: { nullable: null } };
  const markdown = renderIndexerWorksetReading(input);
  expect(readingItems(markdown, "consumer-anchor")[0]!.value).toEqual(anchor.value);
  expect(readingItems(markdown, "parser-file")[0]!.value).toEqual(file.value);
  for (const value of [null, "plain content", ["array content"]]) {
    anchor.value = value; file.value = value;
    const rendered = renderIndexerWorksetReading(input);
    // Read the actual JSON envelope: the legacy helper treats null as absent.
    for (const category of ["consumer-anchor", "parser-file"]) {
      const block = rendered.split(`### ${category}\n\n`)[1]!.match(/```json\n([\s\S]*?)\n```/)![1]!;
      expect(JSON.parse(block).value).toEqual(value);
    }
  }
  for (const locator of [null, "custom locator", ["custom locator"]]) {
    anchor.value = { ...input.carrier, locator };
    expect(restoredCarrier(renderIndexerWorksetReading(input))).toMatchObject({ locator });
  }
});

test("large declarations move to complete optional files without removing members or reducing Author material", () => {
  const input = fixture(0);
  input.payload.typeAnnotation = Array.from({ length: 200 }, (_, i) =>
    `/** Detailed supported meaning for property ${i}. */\nproperty${i}?: string | number;`).join("\n");
  input.payload.members = Array.from({ length: 200 }, (_, i) => ({
    name: `property${i}`, optional: true, readonly: false, doc: "All constraints stay in the detail file.".repeat(8),
  }));
  const original = JSON.stringify(input.view);
  const compact = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  const full = renderIndexerWorksetReading(input);
  expect(compact.details).toHaveLength(1);
  expect(restoredCarrier(compact.details[0]!.markdown).payload).toEqual(input.payload);
  expect(readingItems(compact.readings[0]!.markdown, "consumer-anchor overview")[0]!.value).toMatchObject({
    payload: { members: input.payload.members.map(({ doc: _doc, ...member }) => { void _doc; return member; }) },
  });
  expect(compact.input_bytes).toBeLessThan(Buffer.byteLength(full) / 2);
  expect(JSON.stringify(input.view)).toBe(original);
  console.info(JSON.stringify({ fixture: "200-members", full_bytes: Buffer.byteLength(full), default_reading_bytes: compact.input_bytes,
    detail_bytes: Buffer.byteLength(compact.details[0]!.markdown), members: 200 }));
  const author = structuredClone(input);
  author.workset.stage = "author";
  author.view.stage = "author";
  expect(planIndexerReadingFiles([buildIndexerTaskReading(author)]).details).toHaveLength(0);
});

test("shares only exact same-origin Partition material with task applicability and standalone retry", () => {
  const inputs = [fixture(0), fixture(1), fixture(2)];
  inputs[2]!.view.items.find((item) => item.category === "consumer-anchor")!.provenance.container_ref = "source:other";
  const batch = renderIndexerBatchReading(inputs.map(buildIndexerTaskReading));
  expect(readingItems(batch.markdown, "index-requirement")).toHaveLength(1);
  expect(readingItems(batch.markdown, "consumer-anchor overview")).toHaveLength(2);
  expect(batch.markdown).toContain("Applies to: task-001, task-002 — Task facts");
  expect(batch.input_bytes).toBeLessThan(inputs.reduce((sum, input) => sum + Buffer.byteLength(renderIndexerWorksetReading(input)), 0));
  const retry = renderIndexerWorksetReading(inputs[1]!);
  expect(restoredCarrier(retry).payload).toEqual(inputs[1]!.payload);
  expect(retry).not.toContain("task-001");
  // Equal IDs and provenance are insufficient if the semantic content differs.
  inputs[1]!.carrier.payload.extra.signature_digest = "changed meaning";
  expect(readingItems(renderIndexerBatchReading(inputs.map(buildIndexerTaskReading)).markdown, "consumer-anchor overview")).toHaveLength(3);
});

test("Partition Route resources isolate tasks and reuse common material without changing canonical inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-partition-reading-"));
  try {
    const inputs = [fixture(0), fixture(1)];
    const ready = await Promise.all(inputs.map(async (input, i) => {
      const path = join(root, `${i}.json`);
      await writeFile(path, JSON.stringify(input.view));
      return { ...input, ready: { path, digest: indexerProtocolDigest(input.view) } };
    }));
    const files = await prepareIndexerWorksetReadings(ready);
    expect(files[0]!.path).not.toBe(files[1]!.path);
    expect(files[0]!.common).toEqual(files[1]!.common);
    const shared = await Promise.all(files[0]!.common.map((file) => readFile(file.path, "utf8")));
    const detailName = shared.join("\n").match(/\.\/([a-f0-9]{64}\.md)/)![1]!;
    const detail = await readFile(join(dirname(files[0]!.path), detailName), "utf8");
    expect(restoredCarrier(detail).payload).toEqual(inputs[0]!.payload);
    expect(shared.join("\n")).not.toContain(inputs[0]!.payload.initializer);
    expect(readingItems(shared.join("\n"), "consumer-anchor overview")[0]!.value).toMatchObject({ payload: { members: [{ name: "enabled", optional: true, readonly: false }] } });
    expect(await prepareIndexerWorksetReadings(ready)).toEqual(files);
    const text = await readFile(files[0]!.path, "utf8");
    expect(Buffer.byteLength(text)).toBeLessThan(inputs.reduce((sum, input) => sum + Buffer.byteLength(renderIndexerWorksetReading(input)), 0));
    for (const item of ready) expect(JSON.parse(await readFile(item.ready.path, "utf8"))).toEqual(item.view);
    const retry = await prepareIndexerWorksetReadings([ready[1]!]);
    const retryText = await readFile(retry[0]!.path, "utf8");
    const retryShared = await Promise.all(retry[0]!.common.map(file => readFile(file.path, "utf8")));
    const retryDetail = [retryText, ...retryShared].join("\n").match(/Detailed [^\n]+: \.\/([a-f0-9]{64}\.md)/)![1]!;
    expect(restoredCarrier(await readFile(join(dirname(retry[0]!.path), retryDetail), "utf8")).payload).toEqual(inputs[1]!.payload);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Partition navigation shares fields without dropping tasks or extensions", async () => {
  const { compactPartitionNavigation } = await import("../project/indexerPartitionOverview.js");
  const tasks = Array.from({ length: 120 }, (_, i) => ({ source: "repo:example", module: null,
    subject: { namespace: "library", kind: "component" }, family: `component-${i}`, members: i,
    ...(i === 119 ? { extension: false } : {}) }));
  const value = { tasks, guidance: "Keep every task" };
  const before = JSON.stringify(value);
  const compact = compactPartitionNavigation(value);
  const groups = (compact.tasks as { groups: { common: object; columns: string[]; rows: unknown[][] }[] }).groups;
  const restored = groups.flatMap(group => group.rows.map(row => ({ ...group.common,
    ...Object.fromEntries(group.columns.map((column, i) => [column, row[i]])) })));
  expect(restored).toEqual(tasks);
  expect(JSON.stringify(value)).toBe(before);
  expect(JSON.stringify(compact).length).toBeLessThan(before.length / 2);
});

test("Partition style reading preserves the entire payload in compact JSON", () => {
  const input = fixture(0);
  const anchor = input.view.items.find(item => item.category === "consumer-anchor")!;
  const value = anchor.value as Record<string, unknown>;
  value.kind = "style-selector";
  value.payload = { name: "focus", selector: ".button:focus-visible", declarations: { outline: "2px solid" },
    extension: { absent: null, literal: "\\n and ```" } };
  const before = JSON.stringify(input);
  const markdown = renderIndexerWorksetReading(input);
  expect((readingItems(markdown, "consumer-anchor")[0]!.value as Record<string, unknown>).payload).toEqual(value.payload);
  expect(JSON.stringify(input)).toBe(before);
});
