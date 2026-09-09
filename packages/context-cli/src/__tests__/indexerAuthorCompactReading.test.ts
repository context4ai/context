import { expect, test } from "bun:test";
import { buildIndexerTaskReading } from "../project/indexerAgentReading.js";
import { planIndexerReadingFiles } from "../project/indexerReadingFiles.js";
import { authorReadingFixture } from "./indexerBatchReading.fixture.js";

test("compact facts retain semantic extensions and foreign members, with lossless details", () => {
  const input = authorReadingFixture(0, 0);
  const base = input.view.items[0]!;
  const add = (ref: string, kind: string, payload: unknown) => input.view.items.push({ ...base, ref, category: "fact",
    value: { fact_ref: ref, kind, payload_digest: "carrier-digest", payload,
      locator: { source_ref: input.view.source_ref, module_ref: null, normalized_path: "src/component-0.ts", signature_digest: "position-digest" } } } as typeof base);
  add("fact:props", "code-symbol", { name: "Options", kind: "interface", file: "src/component-0.ts", line: 1,
    contractResolution: { status: "partial", reason: "external base" }, propsType: "Options", publicEntrypoints: ["index.ts"],
    typeAnnotation: "Options & Base", members: [{ name: "enabled", defaultValue: "true", file: "src/component-0.ts" },
      { name: "base", file: "src/base.ts", type: "string" }], signature_digest: "business-digest" });
  add("fact:style", "style-selector", { selector_ref: "selector:active", selector_digest: "style-digest",
    class_names: ["active"], pseudo_classes: ["focus-visible"], extension: { selector_ref: "business-ref" } });
  const before = JSON.stringify(input.view);
  const files = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  const reading = files.readings[0]!.markdown;
  for (const text of ["fact:props", "fact:style", "external base", "Options & Base", "true", "src/base.ts", "business-digest", "business-ref", "focus-visible"]) expect(reading).toContain(text);
  expect(reading).not.toContain("carrier-digest");
  expect(reading).not.toContain("style-digest");
  expect(files.details.map(file => file.markdown).join("\n")).toContain("style-digest");
  expect(JSON.stringify(input.view)).toBe(before);
  for (const detail of files.details) expect(reading).toContain(`./${detail.digest.slice(7)}.md`);
});

test("large source is navigable and lossless, with no silent excerpt truncation", () => {
  const input = authorReadingFixture(0, 0);
  const source = input.view.items.find(item => item.category === "source-text")!;
  const text = Array.from({ length: 1500 }, (_, i) => `export const value${i} = ${i};`).join("\n");
  const value = source.value as { spans: { source_span_refs: string[] }[] };
  value.spans = [{ ...value.spans[0]!, start_line: 1, end_line: 1500, text } as typeof value.spans[number]];
  const files = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  expect(files.readings[0]!.markdown).toContain(source.ref);
  expect(files.readings[0]!.markdown).not.toContain("export const value1499");
  expect(files.details.some(file => file.markdown.includes(text))).toBe(true);
  expect(files.input_bytes).toBeLessThan(Buffer.byteLength(text));
});

test("only an exact same-source multiline declaration becomes a source pointer", () => {
  const input = authorReadingFixture(0, 0);
  const source = input.view.items.find(item => item.category === "source-text")!;
  const sourceValue = source.value as { spans: { text: string }[] };
  const declaration = `{\n${"  enabled?: boolean;\n".repeat(40)}}`;
  sourceValue.spans[0]!.text = `export type Options = ${declaration};`;
  const fact = { ...source, ref: "fact:options", category: "fact", value: {
    kind: "code-symbol", payload: { name: "Options", kind: "type-alias", typeAnnotation: declaration, contractResolution: { status: "partial" } },
    locator: { source_ref: input.view.source_ref, module_ref: null, normalized_path: "src/component-0.ts" },
  } };
  input.view.items.push(fact as typeof source);
  const files = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  expect(files.readings[0]!.markdown).toContain(`"declaration_source":"${source.ref}"`);
  expect(files.readings[0]!.markdown).toContain(declaration);
  expect(files.details.map(file => file.markdown).join("\n")).toContain('"typeAnnotation"');
  fact.value.locator.source_ref = "repo:other";
  const foreign = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  expect(foreign.readings[0]!.markdown).not.toContain('"declaration_source"');
  expect(foreign.readings[0]!.markdown).toContain('"typeAnnotation"');
});

test("identical selected templates and requirements are shared, task ownership stays distinct", () => {
  const tasks = [authorReadingFixture(0, 0), authorReadingFixture(1, 0)];
  for (const task of tasks) {
    const requirement = task.view.items.find(item => item.category === "index-requirement")!;
    requirement.ref = "requirement:shared";
    requirement.value = { purpose: "Use the public package" };
    const authority = task.view.items.find(item => item.category === "author-authority")!;
    authority.value = { page_plan: { title: task.task_key }, page_template: { id: "public", sections: ["overview"] } };
  }
  const files = planIndexerReadingFiles(tasks.map(buildIndexerTaskReading));
  const shared = files.shared.map(file => file.markdown).join("\n");
  expect(shared).toContain("Use the public package");
  expect(shared).toContain('"overview"');
  expect(files.readings[0]!.markdown).toContain("task-001");
  expect(files.readings[0]!.markdown).not.toContain("task-002");
});


test("shared instruction identity survives batch changes and isolates changed content and sources", () => {
  const make = (index: number) => {
    const input = authorReadingFixture(index, 0);
    const requirement = input.view.items.find(item => item.category === "index-requirement")!;
    requirement.ref = "requirement:stable";
    requirement.value = { purpose: "Stable public goal" };
    const authority = input.view.items.find(item => item.category === "author-authority")!;
    authority.value = { page_plan: { title: input.task_key }, page_template: { id: "public", sections: ["overview"] } };
    return input;
  };
  const a = make(0), b = make(1), c = make(2);
  const files = (...inputs: ReturnType<typeof make>[]) => planIndexerReadingFiles(inputs.map(buildIndexerTaskReading));
  const shared = (plan: ReturnType<typeof files>) => plan.shared.filter(file =>
    file.markdown.includes("Stable public goal") || file.markdown.includes("Selected page template"));
  const first = shared(files(a, b));
  expect(first).toHaveLength(2);
  expect(shared(files(a, c))).toEqual(first);
  expect(shared(files(a))).toEqual(first);
  const changed = structuredClone(a);
  changed.view.items.find(item => item.category === "index-requirement")!.value = { purpose: "Changed goal" };
  expect(files(changed).shared.some(file => file.digest === first.find(item => item.markdown.includes("Stable public goal"))!.digest)).toBe(false);
  const foreign = structuredClone(a);
  foreign.view.source_ref = "repo:foreign";
  expect(shared(files(foreign)).every(file => !first.some(old => old.digest === file.digest))).toBe(true);
});

test("800-line boundary applies even to tiny lines and to excerpts of a larger file", () => {
  for (const [lineCount, oversized] of [[800, false], [801, true], [2000, true]] as const) {
    const input = authorReadingFixture(0, 0);
    const source = input.view.items.find(item => item.category === "source-text")!;
    const value = source.value as { line_count: number; read_path: string; spans: { text: string; start_line: number; end_line: number }[] };
    value.line_count = lineCount;
    value.read_path = "/captured/source file.ts";
    const text = lineCount === 2000 ? "selected_excerpt" : Array.from({length: lineCount}, (_,i) => `x${i}`).join("\n");
    value.spans = [{ ...value.spans[0]!, text, start_line: 1, end_line: lineCount === 2000 ? 1 : lineCount }];
    const before = JSON.stringify(input);
    const task = buildIndexerTaskReading(input);
    const files = planIndexerReadingFiles([task]);
    const material = task.material.find(block => block.section === "Source material" && block.markdown.includes(source.ref))!;
    expect(material.markdown.includes(text)).toBe(!oversized);
    if (oversized) {
      expect(material.markdown).toContain("[Open captured source](</captured/source file.ts>)");
      expect(files.details.some(file => file.markdown.includes(text))).toBe(true);
    }
    expect(JSON.stringify(input)).toBe(before);
  }
});
