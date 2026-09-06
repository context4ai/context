import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { buildIndexerTaskReading, renderIndexerWorksetReading } from "../project/indexerAgentReading.js";
import { renderIndexerBatchReading } from "../project/indexerBatchReading.js";
import { prepareIndexerWorksetReadings } from "../project/indexerAgentReadingResources.js";
import { planIndexerCurrentBatch, restoreIndexerCurrentBatch } from "../project/indexerCurrentBatchPlanner.js";
import { authorReadingFixture } from "./indexerBatchReading.fixture.js";
import { readingObjects } from "./indexerReading.fixture.js";

describe("Author batch reading", () => {
  test("shares complete common payloads while preserving each task's full source and goals", () => {
    const inputs = Array.from({ length: 4 }, (_, i) => authorReadingFixture(i));
    const before = JSON.stringify(inputs);
    const readings = inputs.map(buildIndexerTaskReading);
    const batch = renderIndexerBatchReading(readings);
    const separateBytes = inputs.reduce((sum, input) => sum + Buffer.byteLength(renderIndexerWorksetReading(input)), 0);
    expect(batch.input_bytes).toBeLessThan(separateBytes / 2);
    expect(batch.input_bytes).toBe(Buffer.byteLength(batch.markdown));
    for (const input of inputs) {
      expect(batch.markdown).toContain(input.text);
      expect(batch.markdown).toContain(`Use component ${inputs.indexOf(input)}`);
      expect(batch.markdown).toContain(`Special behavior ${inputs.indexOf(input)}`);
      expect(batch.markdown).toContain(input.task_key);
    }
    const facts = readingObjects(batch.markdown).filter((item) => String(item.ref).startsWith("fact:"));
    expect(facts).toHaveLength(inputs[0]!.factValues.length);
    for (const fact of inputs[0]!.factValues) {
      expect(facts.find((item) => item.ref === fact.fact_ref)?.value).toMatchObject({ payload: fact.payload });
    }
    expect(batch.markdown).not.toContain("source_span_node_refs");
    expect(JSON.stringify(inputs)).toBe(before);
    expect(renderIndexerBatchReading(readings)).toEqual(batch);
  });

  test("uses actual shared reading size to pack four tasks without increasing limits", () => {
    const inputs = Array.from({ length: 4 }, (_, i) => authorReadingFixture(i));
    const readings = inputs.map(buildIndexerTaskReading);
    const candidates = inputs.map((input, index) => ({
      workset: input.workset, instruction_identity: indexerProtocolDigest("instructions"),
      input_bytes: renderIndexerBatchReading([readings[index]!]).input_bytes,
      output_reserve_bytes: 20 * 1024, view_item_count: input.view.items.length,
    }));
    const measure = (selected: readonly (typeof candidates)[number][]) => renderIndexerBatchReading(
      selected.map((candidate) => readings[candidates.indexOf(candidate)]!),
    );
    const planned = planIndexerCurrentBatch({ candidates, shared_instruction_bytes: 20 * 1024, measure_reading: measure });
    expect(planned.candidates).toHaveLength(4);
    expect(planned.input_bytes).toBe(20 * 1024 + measure(candidates).input_bytes);
    expect(planned.view_item_count).toBe(measure(candidates).view_item_count);
    expect(planIndexerCurrentBatch({ candidates, shared_instruction_bytes: 20 * 1024 }).candidates.length).toBeLessThan(4);
    // New reading budgets must not change the membership of an in-flight batch.
    expect(restoreIndexerCurrentBatch({ candidates, shared_instruction_bytes: 500_000, measure_reading: measure }).candidates)
      .toEqual(candidates);
  });

  test("does not share different payloads or provenance, and labels subset-only material", () => {
    const inputs = Array.from({ length: 4 }, (_, i) => authorReadingFixture(i, 1));
    const third = inputs[2]!.view.items.find((item) => item.category === "fact")!;
    third.value = { ...(third.value as object), payload: { meaning: "Different contract" } };
    const fourth = inputs[3]!.view.items.find((item) => item.category === "fact")!;
    fourth.provenance = { ...fourth.provenance, container_ref: "file:other-origin" };
    const markdown = renderIndexerBatchReading(inputs.map(buildIndexerTaskReading)).markdown;
    expect(readingObjects(markdown).filter((item) => item.ref === "fact:shared-0")).toHaveLength(3);
    expect(markdown).toContain("Applies to: task-001, task-002 — Task facts");
    expect(markdown).toContain("Different contract");
  });

  test("keeps partial-retry files standalone, including formerly shared sources and document bodies", () => {
    const first = authorReadingFixture(0, 2);
    const second = authorReadingFixture(1, 2);
    const source = first.view.items.find((item) => item.category === "source-text")!;
    const dependencies = first.view.items.filter((item) => item.category === "dependency");
    second.view.items.push(source, ...dependencies);
    const shared = renderIndexerBatchReading([first, second].map(buildIndexerTaskReading));
    expect(shared.markdown.split(first.text)).toHaveLength(2);
    const retry = renderIndexerBatchReading([buildIndexerTaskReading(second)]).markdown;
    expect(retry).toContain(first.text);
    expect(retry).not.toContain("task-001");
    const doc = { ...source, ref: "document:guide", category: "document", value: {
      path: `src/component-0.ts`, source_ref: first.view.source_ref, content: "# Guide\n\nUse the public component.\n```example```",
    } };
    first.view.items = first.view.items.filter((item) => item.category !== "source-text");
    first.view.items.push(doc);
    const reading = renderIndexerBatchReading([buildIndexerTaskReading(first)]).markdown;
    expect(readingObjects(reading).some((item) => item.content === doc.value.content)).toBe(true);
  });

  test("materializes one file behind existing task resources, with stable reuse and safe partial recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-batch-reading-"));
    try {
      const inputs = [authorReadingFixture(0, 2), authorReadingFixture(1, 2)];
      const ready = await Promise.all(inputs.map(async (input, i) => {
        const path = join(root, `${i}.json`);
        await writeFile(path, JSON.stringify(input.view));
        return { ...input, ready: { path, digest: indexerProtocolDigest(input.view) } };
      }));
      const files = await prepareIndexerWorksetReadings(ready);
      expect(new Set(files.map((file) => file.path)).size).toBe(1);
      const content = await readFile(files[0]!.path, "utf8");
      const timestamp = (await stat(files[0]!.path)).mtimeMs;
      expect(await prepareIndexerWorksetReadings(ready)).toEqual(files);
      expect((await stat(files[0]!.path)).mtimeMs).toBe(timestamp);
      for (const input of inputs) expect(content).toContain(input.text);
      const retried = await prepareIndexerWorksetReadings([ready[1]!]);
      expect(await readFile(retried[0]!.path, "utf8")).not.toContain("task-001");
      expect(await readFile(retried[0]!.path, "utf8")).toContain("fact:shared-0");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
