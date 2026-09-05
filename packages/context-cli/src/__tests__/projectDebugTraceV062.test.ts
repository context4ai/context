import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProjectStatus } from "../project/statusTypes.js";
import { runWorkflowUntilBlockedOrComplete } from "../project/workflow/workflowRun.js";
import { measureContextDebugOperation } from "../project/debugTrace.js";

const CLI_MODULE = resolve(import.meta.dir, "..", "cli.ts");

async function runCli(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutPath = join(cwd, `.stdout-${crypto.randomUUID()}.log`);
  const stderrPath = join(cwd, `.stderr-${crypto.randomUUID()}.log`);
  const processHandle = Bun.spawn([process.execPath, CLI_MODULE, ...args], {
    cwd,
    stdout: Bun.file(stdoutPath),
    stderr: Bun.file(stderrPath),
  });
  const code = await processHandle.exited;
  const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
  const stderr = await readFile(stderrPath, "utf8").catch(() => "");
  return { code, stdout, stderr };
}

function events(projectRoot: string): Array<Record<string, unknown>> {
  const path = join(projectRoot, ".tmp", "context-runtime", "debug", "events.jsonl");
  return readFileSync(path, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) =>
    JSON.parse(line) as Record<string, unknown>
  );
}

describe("Context observational debug trace", () => {
  test("records local performance measurements without changing action results", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-debug-performance-"));
    try {
      await Bun.write(join(root, "package.json"), `${JSON.stringify({
        name: "debug-performance-fixture",
        private: true,
        context: { project: true, entry: "src/index.ts", debug: true },
      }, null, 2)}\n`);
      const result = await measureContextDebugOperation({
        projectRoot: root,
        operation: "fixture.operation",
        counters: { fixture_count: 1 },
        data: { phase: "warm" },
      }, async () => "unchanged-result");

      expect(result).toBe("unchanged-result");
      const measurement = events(root).find((event) =>
        event.kind === "performance.measurement"
      );
      expect(measurement?.data).toMatchObject({
        operation: "fixture.operation",
        outcome: "success",
        counters: { fixture_count: 1 },
        detail: { phase: "warm" },
      });
      expect(
        (measurement?.data as { duration_ms?: number } | undefined)?.duration_ms,
      ).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stays disabled by default and does not create trace files", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-debug-default-"));
    try {
      const result = await runCli(root, ["init", "workspace", "--dev"]);
      expect(result.code).toBe(0);
      const projectRoot = join(root, "workspace");
      const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
        context: { debug?: boolean };
      };
      expect(packageJson.context.debug).toBeUndefined();
      expect((await runCli(projectRoot, ["status", "--format", "json", "--view", "summary"])).code).toBe(0);
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "debug"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("init --debug records CLI and Agent Graph events and exports replay data", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-debug-enabled-"));
    try {
      const initialized = await runCli(root, ["init", "workspace", "--dev", "--debug"]);
      expect(initialized.code).toBe(0);
      const projectRoot = join(root, "workspace");
      const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
        context: { debug?: boolean };
      };
      expect(packageJson.context.debug).toBe(true);
      expect(events(projectRoot).map((event) => event.kind)).toContain("debug.enabled");

      const status = await runCli(projectRoot, ["status", "--format", "json", "--view", "summary"]);
      expect(status.code).toBe(0);
      const recorded = events(projectRoot);
      expect(recorded.map((event) => event.kind)).toContain("cli.invoked");
      expect(recorded.map((event) => event.kind)).toContain("agent-graph.evaluated");
      expect(recorded.map((event) => event.kind)).toContain("cli.completed");
      expect(recorded.every((event, index) => event.sequence === index + 1)).toBe(true);
      const graphEvent = recorded.find((event) => event.kind === "agent-graph.evaluated");
      expect(graphEvent?.data).toMatchObject({
        graph: { provider: "c4a/context", graph: "workspace", entry: "context" },
        current: { revision: expect.stringContaining("sha256:") },
        transition: { changed: true },
      });

      const exported = await runCli(projectRoot, ["debug", "export", "--format", "json"]);
      expect(exported.code).toBe(0);
      const receipt = JSON.parse(exported.stdout) as { output: string; event_count: number; transition_count: number };
      expect(receipt.output).toBe(".tmp/context-runtime/debug/replay.json");
      expect(receipt.event_count).toBeGreaterThan(0);
      expect(receipt.transition_count).toBeGreaterThan(0);
      const replay = JSON.parse(readFileSync(join(projectRoot, receipt.output), "utf8")) as {
        schema: string;
        events: unknown[];
        transitions: unknown[];
      };
      expect(replay.schema).toBe("context.debug.replay.v1");
      expect(replay.events.length).toBe(receipt.event_count);
      expect(replay.transitions.length).toBe(receipt.transition_count);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("later enable and disable update package.json without deleting prior trace", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-debug-toggle-"));
    try {
      expect((await runCli(root, ["init", "workspace", "--dev"])).code).toBe(0);
      const projectRoot = join(root, "workspace");
      expect((await runCli(projectRoot, ["debug", "enable", "--format", "json"])).code).toBe(0);
      let packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
        context: { debug?: boolean };
      };
      expect(packageJson.context.debug).toBe(true);
      expect((await runCli(projectRoot, ["debug", "disable", "--format", "json"])).code).toBe(0);
      packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
        context: { debug?: boolean };
      };
      expect(packageJson.context.debug).toBeUndefined();
      const countAfterDisable = events(projectRoot).length;
      expect(events(projectRoot).map((event) => event.kind)).toContain("debug.disabled");
      expect((await runCli(projectRoot, ["debug", "status", "--format", "json"])).code).toBe(0);
      expect(events(projectRoot)).toHaveLength(countAfterDisable);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("records managed action receipts without changing workflow execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-debug-managed-"));
    try {
      await Bun.write(join(root, "package.json"), `${JSON.stringify({
        name: "debug-fixture",
        private: true,
        context: { project: true, entry: "src/index.ts", debug: true },
      }, null, 2)}\n`);
      const routeStatus = {
        projectRoot: root,
        workflow: {
          protocol: "context.workflow.status.v1",
          revision: "sha256:before",
          status: "actionable",
          alternatives: [],
          diagnostics: [],
          current: {
            protocol: "context.workflow.route.v1",
            id: "route.fixture",
            revision: "sha256:before",
            node: "fixture-action",
            reason_code: "route.fixture-action",
            availability: "immediate",
            commands: [{
              command: "context close --format json",
              effect: "write",
              availability: "immediate",
              managed_execution: "automatic",
            }],
            resources: { required: [], recommended: [] },
            after_action: { evaluate: true },
          },
        },
      } as unknown as ProjectStatus;
      const completeStatus = {
        projectRoot: root,
        workflow: {
          protocol: "context.workflow.status.v1",
          revision: "sha256:after",
          status: "complete",
          alternatives: [],
          diagnostics: [],
        },
      } as unknown as ProjectStatus;
      let observations = 0;
      const result = await runWorkflowUntilBlockedOrComplete({
        observe: async () => observations++ === 0 ? routeStatus : completeStatus,
        execute: async () => ({
          exitCode: 0,
          signal: null,
          durationMs: 12,
          timedOut: false,
          stdout: { bytes: 2, sha256: "a".repeat(64) },
          stderr: { bytes: 0, sha256: "b".repeat(64) },
        }),
        maxSteps: 5,
        dryRun: false,
      });
      expect(result.state).toBe("complete");
      const recorded = events(root);
      expect(recorded.map((event) => event.kind)).toEqual([
        "workflow.action-started",
        "workflow.action-completed",
      ]);
      expect(recorded[1]?.data).toMatchObject({
        outcome: "success",
        receipt: { durationMs: 12, stdout: { bytes: 2 } },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
