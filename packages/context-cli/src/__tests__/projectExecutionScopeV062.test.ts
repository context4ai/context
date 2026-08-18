import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionScope } from "../project/workflow/executionScope.js";
import { WorkspaceExecutionRuntime } from "../project/workflow/workflowExecutionRuntime.js";
import { createWorkflowInProcessExecutor } from "../project/workflow/workflowInProcessActions.js";

describe("Context workspace execution runtime", () => {
  test("releases runtime resources once in reverse registration order", async () => {
    const released: string[] = [];
    const scope = new ExecutionScope("test-scope");
    const first = scope.defer("first", () => {
      released.push("first");
    });
    scope.defer("second", () => {
      released.push("second");
    });

    expect(await first.release()).toEqual({ label: "first", state: "released" });
    expect(await first.release()).toEqual({ label: "first", state: "released" });
    const receipt = await scope.close();
    expect(released).toEqual(["first", "second"]);
    expect(receipt).toEqual({
      name: "test-scope",
      resources: [
        { label: "second", state: "released" },
        { label: "first", state: "released" },
      ],
      releaseErrors: 0,
    });
    expect(await scope.close()).toEqual(receipt);
  });

  test("isolates one runtime to one workspace and restores captured process output", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-execution-runtime-"));
    const originalWrite = process.stdout.write;
    let calls = 0;
    const runtime = new WorkspaceExecutionRuntime({
      projectRoot: root,
      cliEntryPath: join(root, "unused.mjs"),
      inProcess: {
        supports: () => true,
        execute: async () => {
          calls += 1;
          process.stdout.write("deterministic output");
        },
      },
    });
    try {
      const receipt = await runtime.execute({
        cwd: root,
        command: "context --workflow-revision 'sha256:test' close --format json",
        effect: "write",
      });
      expect(calls).toBe(1);
      expect(receipt.exitCode).toBe(0);
      expect(receipt.stdout.bytes).toBe(Buffer.byteLength("deterministic output"));
      expect(process.stdout.write).toBe(originalWrite);
      await expect(runtime.execute({
        cwd: join(root, "other"),
        command: "context close --format json",
        effect: "write",
      })).rejects.toThrow("cannot cross roots");
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps external actions in a child process", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-external-runtime-"));
    const entry = join(root, "external.mjs");
    await writeFile(entry, "process.stdout.write('external output')\n", "utf8");
    let inProcessCalls = 0;
    const runtime = new WorkspaceExecutionRuntime({
      projectRoot: root,
      cliEntryPath: entry,
      inProcess: {
        supports: () => true,
        execute: async () => {
          inProcessCalls += 1;
        },
      },
    });
    try {
      const receipt = await runtime.execute({
        cwd: root,
        command: "context external-action",
        effect: "external",
      });
      expect(receipt.exitCode).toBe(0);
      expect(receipt.stdout.bytes).toBe(Buffer.byteLength("external output"));
      expect(inProcessCalls).toBe(0);
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restores process output and reports failure when an in-process action throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-failed-runtime-"));
    const originalWrite = process.stdout.write;
    const runtime = new WorkspaceExecutionRuntime({
      projectRoot: root,
      cliEntryPath: join(root, "unused.mjs"),
      inProcess: {
        supports: () => true,
        execute: async () => {
          process.stdout.write("partial output");
          throw new Error("action failed");
        },
      },
    });
    try {
      const receipt = await runtime.execute({
        cwd: root,
        command: "context --workflow-revision 'sha256:test' close --format json",
        effect: "write",
      });
      expect(receipt.exitCode).toBe(1);
      expect(receipt.stdout.bytes).toBe(Buffer.byteLength("partial output"));
      expect(receipt.stderr.tail).toContain("action failed");
      expect(process.stdout.write).toBe(originalWrite);
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts only exact revision-bound command shapes for in-process execution", () => {
    const executor = createWorkflowInProcessExecutor();
    const revision = ["--workflow-revision", "sha256:test"];
    expect(executor.supports({
      cwd: "/workspace",
      args: [...revision, "close", "--format", "json"],
      effect: "write",
    })).toBe(true);
    expect(executor.supports({
      cwd: "/workspace",
      args: [...revision, "run", "extract:module:codegraph", "--format", "json"],
      effect: "write",
    })).toBe(true);
    expect(executor.supports({
      cwd: "/workspace",
      args: [...revision, "close", "--force", "--format", "json"],
      effect: "write",
    })).toBe(false);
    expect(executor.supports({
      cwd: "/workspace",
      args: [...revision, "package", "template", "accept", "--all", "unexpected"],
      effect: "write",
    })).toBe(false);
    expect(executor.supports({
      cwd: "/workspace",
      args: [...revision, "run", "capture:document", "--format", "json"],
      effect: "external",
    })).toBe(false);
  });
});
