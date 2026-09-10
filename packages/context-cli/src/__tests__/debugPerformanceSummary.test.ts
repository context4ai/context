import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DebugPerformanceSummary } from "../project/debugPerformanceSummary.js";

describe("debug performance aggregation", () => {
  test("totals retain counts/cache modes and leave slow/error samples immediate", () => {
    const summary = new DebugPerformanceSummary();
    for (let i = 0; i < 1_000; i++) expect(summary.add({ projectRoot: "/fixture",
      operation: "parser.cache-access", durationMs: 2, outcome: "success",
      counters: { parser_cache_read_count: 1, parser_cache_hit_count: 1 },
      data: { read_mode: "source-slice", cache_outcome: "hit", request_digest: `ignored-${i}` },
    })).toBe(true);
    expect(summary.snapshot()).toEqual([{ operation: "parser.cache-access", count: 1_000,
      duration_ms: 2_000, max_duration_ms: 2,
      counters: { parser_cache_read_count: 1_000, parser_cache_hit_count: 1_000 },
      detail: { read_mode: "source-slice", cache_outcome: "hit" } }]);
    expect(summary.add({ projectRoot: "/fixture", operation: "slow", durationMs: 1_000, outcome: "success" })).toBe(false);
    expect(summary.add({ projectRoot: "/fixture", operation: "failed", durationMs: 1, outcome: "error" })).toBe(false);
  });

  test("bounds summary memory and retains lock acquisition separately from hold time", () => {
    const summary = new DebugPerformanceSummary();
    summary.add({ projectRoot: "/fixture", operation: "project-write-lock", durationMs: 100,
      outcome: "success", data: { acquire_duration_ms: 0.1, requested_operation: "read" } });
    expect(summary.snapshot()[0]!.counters.acquire_duration_ms).toBe(0.1);
    for (let i = 1; i < 128; i++) expect(summary.add({ projectRoot: "/fixture", operation: `op-${i}`,
      durationMs: 1, outcome: "success" })).toBe(true);
    expect(summary.add({ projectRoot: "/fixture", operation: "overflow", durationMs: 1, outcome: "success" })).toBe(false);
    expect(summary.snapshot()).toHaveLength(128);
  });

  test("writes one summary on failure, keeping slow events and release failures visible before completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-debug-summary-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ context: { project: true, debug: true } }));
      const modulePath = resolve(import.meta.dir, "../project/debugTrace.ts");
      const script = `import { withDebugCliInvocation, recordContextDebugPerformance as metric,
        recordWorkflowExecutionScope as scope } from ${JSON.stringify(modulePath)};
        const projectRoot = process.cwd();
        try { await withDebugCliInvocation(["bun", "context", "fixture"], async () => {
          for (let i = 0; i < 100; i++) {
            await scope({projectRoot, phase: "opened", data: {executor: "project-write"}});
            await metric({projectRoot, operation: "fast", durationMs: 1, outcome: "success"});
            await scope({projectRoot, phase: "closed", data: {executor: "project-write", release_errors: 0}});
          }
          await metric({projectRoot, operation: "slow", durationMs: 2000, outcome: "success"});
          await scope({projectRoot, phase: "closed", data: {executor: "project-write", release_errors: 1}});
          await metric({projectRoot, operation: "failure", durationMs: 1, outcome: "error"});
          throw new Error("original-error");
        }); } catch (error) { if (error.message !== "original-error") throw error; }`;
      const child = Bun.spawn([process.execPath, "-e", script], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const stderr = await new Response(child.stderr).text();
      expect([await child.exited, stderr]).toEqual([0, ""]);
      const events = (await readFile(join(root, ".tmp/context-runtime/debug/events.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(events.map((event) => event.kind)).toEqual([
        "cli.invoked", "performance.measurement", "workflow.scope-closed", "performance.measurement", "cli.completed",
      ]);
      expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
      const schema = JSON.parse(await readFile(resolve(import.meta.dir, "../../docs/context-debug-event-v1.schema.json"), "utf8"));
      expect(events.every((event) => schema.properties.kind.enum.includes(event.kind))).toBe(true);
      expect(events.at(-1).data).toMatchObject({ outcome: "error", error: "original-error",
        performance: [{ operation: "fast", count: 100, duration_ms: 100 }] });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
