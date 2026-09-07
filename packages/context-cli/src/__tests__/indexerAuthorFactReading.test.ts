import { describe, expect, test } from "bun:test";
import { buildIndexerTaskReading, renderIndexerWorksetReading } from "../project/indexerAgentReading.js";
import { projectIndexerAuthorFactReading } from "../project/indexerAuthorFactReading.js";
import { renderIndexerBatchReading } from "../project/indexerBatchReading.js";
import { planIndexerCurrentBatch } from "../project/indexerCurrentBatchPlanner.js";
import { authorReadingFixture } from "./indexerBatchReading.fixture.js";

function fixture(index = 0) {
  const input = authorReadingFixture(index, 0);
  const path = `src/component-${index}.ts`;
  const source = input.view.items.find((item) => item.category === "source-text")!;
  (source.value as Record<string, unknown>).read_path = `/captured/${path}`;
  const add = (ref: string, kind: string, payload: unknown) => input.view.items.push({
    ...source, ref, category: "fact", value: { fact_ref: ref, kind, payload,
      payload_digest: "sha256:parser-record", locator: { source_ref: input.view.source_ref, module_ref: null,
        normalized_path: path, qualified_item_path: `${kind}:${ref}`, signature_digest: "sha256:locator" } },
  });
  for (let i = 0; i < 240; i += 1) add(`call:${i}`, "code-relation", {
    type: "calls", from: `expect(component${index}).toHaveStyle(${i})`, to: "toHaveStyle", line: 1,
    file: path, isExternal: false, source: "ast", confidence: 1,
  });
  for (let i = 0; i < 120; i += 1) add(`config:${i}`, "config-value", {
    key_path: `options.${i}`, value_type: "string", value_digest: "sha256:config", config_ref: "config:package",
  });
  add("symbol:public", "code-symbol", { name: `component${index}`, kind: "function", file: path,
    line: 1, endLine: 1, visibility: "exported", signature: `component${index}(): void` });
  add("import:public", "code-relation", { type: "imports", from: path, to: "./shared", line: 1,
    file: path, isExternal: false, source: "ast", confidence: 1 });
  return { input, add };
}

describe("source-first Author reading", () => {
  test("retains source bodies and navigation without repeating parser bookkeeping", () => {
    const { input } = fixture();
    const before = JSON.stringify(input.view);
    const reading = renderIndexerWorksetReading(input);
    expect(reading).toContain(input.text);
    expect(reading).toContain("/captured/src/component-0.ts");
    expect(reading).toContain("component0(): void");
    expect(reading).toContain("./shared");
    expect(reading).not.toContain("toHaveStyle");
    expect(reading).not.toContain("sha256:config");
    expect(Buffer.byteLength(reading)).toBeLessThan(Buffer.byteLength(before) / 8);
    expect(JSON.stringify(input.view)).toBe(before);
  });

  test("preserves unknown Provider fields, foreign-source facts and unavailable bodies", () => {
    const { input, add } = fixture();
    add("custom:relation", "code-relation", { type: "calls", from: "custom", to: "runtime", behavior: "Provider-specific guarantee" });
    add("foreign:relation", "code-relation", { type: "calls", from: "foreign", to: "runtime", line: 1 });
    const foreign = input.view.items.at(-1)!.value as { locator: { source_ref: string } };
    foreign.locator.source_ref = "repo:foreign";
    expect(renderIndexerWorksetReading(input)).toContain("Provider-specific guarantee");
    const projected = projectIndexerAuthorFactReading(input.view);
    expect(projected.omitted.has("foreign:relation")).toBe(false);
    delete (input.view.items.find((item) => item.category === "source-text")!.value as Record<string, unknown>).read_path;
    const partial = projectIndexerAuthorFactReading(input.view);
    expect(partial.omitted.has("call:0")).toBe(false);
    expect(partial.omitted.has("config:0")).toBe(false);
    expect(partial.omitted.has("symbol:public")).toBe(true);
  });

  test("packs four full pages with noisy parser catalogs under the unchanged budget", () => {
    const tasks = Array.from({ length: 4 }, (_, i) => fixture(i).input);
    const readings = tasks.map(buildIndexerTaskReading);
    const candidates = tasks.map((input, index) => ({ workset: input.workset, instruction_identity: "instructions",
      input_bytes: renderIndexerBatchReading([readings[index]!]).input_bytes,
      output_reserve_bytes: 32 * 1024, view_item_count: input.view.items.length }));
    const byWorkset = new Map(tasks.map((task, i) => [task.workset.workset_digest, readings[i]!]));
    const batch = planIndexerCurrentBatch({ candidates, shared_instruction_bytes: 20 * 1024,
      measure_reading: (selected) => renderIndexerBatchReading(selected.map((task) => byWorkset.get(task.workset.workset_digest)!)) });
    expect(batch.candidates).toHaveLength(4);
    const markdown = renderIndexerBatchReading(readings).markdown;
    for (const task of tasks) expect(markdown).toContain(task.text);
  });
});
