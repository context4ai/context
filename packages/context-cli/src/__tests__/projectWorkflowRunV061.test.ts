import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createApprovedProject,
  runCliInDir,
} from "./projectBuildVerifyV060Helpers.js";
import type { ProjectStatus } from "../project/statusTypes.js";
import {
  runWorkflowUntilBlockedOrComplete,
  selectAutomaticWorkflowCommand,
} from "../project/workflow/workflowRun.js";

function statusWithCommand(command: {
  command: string;
  effect: "read" | "write" | "external";
  managed_execution: "automatic" | "agent-required";
}, required: Array<{
  id: string;
  read_state: "read-required" | "current";
}> = []): ProjectStatus {
  return {
    projectRoot: "/workspace",
    workflow: {
      protocol: "context.workflow.status.v1",
      revision: "sha256:revision",
      status: "actionable",
      alternatives: [],
      diagnostics: [],
      current: {
        protocol: "context.workflow.route.v1",
        id: "route",
        revision: "sha256:revision",
        node: "current-action",
        reason_code: "route.current-action",
        availability: "immediate",
        commands: [{
          ...command,
          availability: "immediate",
        }],
        resources: { required, recommended: [] },
        after_action: { evaluate: true },
      },
    },
  } as unknown as ProjectStatus;
}

function completeStatus(): ProjectStatus {
  return {
    projectRoot: "/workspace",
    workflow: {
      protocol: "context.workflow.status.v1",
      revision: "sha256:complete",
      status: "complete",
      alternatives: [],
      diagnostics: [],
    },
  } as unknown as ProjectStatus;
}

describe("managed workflow run-to-completion", () => {
  test("blocks automatic writes until every required Agent resource is current", () => {
    const selected = selectAutomaticWorkflowCommand(statusWithCommand({
      command: "context build --format json",
      effect: "write",
      managed_execution: "automatic",
    }, [{ id: "procedure.close-and-build", read_state: "read-required" }]));
    expect(selected).toMatchObject({
      state: "blocked",
      stop: {
        reasonCode: "workflow.until.agent-context-required",
        message: expect.stringContaining("procedure.close-and-build"),
      },
    });
  });

  test("does not execute read-only routes that require Agent interpretation", () => {
    const selected = selectAutomaticWorkflowCommand(statusWithCommand({
      command: "context verify --format json",
      effect: "read",
      managed_execution: "agent-required",
    }));
    expect(selected).toMatchObject({
      state: "blocked",
      stop: {
        reasonCode: "workflow.until.agent-context-required",
      },
    });
  });

  test("does not execute external or stdin actions without automatic eligibility", () => {
    expect(selectAutomaticWorkflowCommand(statusWithCommand({
      command: "context source ensure --format json",
      effect: "external",
      managed_execution: "agent-required",
    }))).toMatchObject({
      state: "blocked",
      stop: { reasonCode: "workflow.until.agent-execution-required" },
    });
    expect(selectAutomaticWorkflowCommand(statusWithCommand({
      command: "context review maintain --input - --format json",
      effect: "write",
      managed_execution: "automatic",
    }))).toMatchObject({
      state: "blocked",
      stop: { reasonCode: "workflow.until.agent-input-required" },
    });
  });

  test("preserves the current external command when the host credential store is unavailable", async () => {
    const status = statusWithCommand({
      command: "context run capture:file:manual --format json",
      effect: "external",
      managed_execution: "automatic",
    });
    const result = await runWorkflowUntilBlockedOrComplete({
      observe: async () => status,
      execute: async () => ({
        exitCode: 2,
        signal: null,
        durationMs: 5,
        timedOut: false,
        stdout: { bytes: 0, sha256: "0".repeat(64) },
        stderr: {
          bytes: 54,
          sha256: "1".repeat(64),
          tail: "credential store unavailable: secure storage not initialized",
        },
      }),
      maxSteps: 2,
      dryRun: false,
    });
    expect(result).toMatchObject({
      state: "failed",
      stop: {
        reasonCode: "workflow.until.external-environment-required",
        command: "context run capture:file:manual --format json",
      },
    });
    expect(result.stop.message).toContain("credential-store");
  });

  test("chains deterministic writes after required resources are current", async () => {
    const statuses = [
      statusWithCommand({
        command: "context run compile:file:manual-a:guide --stage --format json",
        effect: "write",
        managed_execution: "automatic",
      }, [{ id: "procedure.prose-compile", read_state: "current" }]),
      statusWithCommand({
        command: "context run compile:file:manual-b:guide --stage --format json",
        effect: "write",
        managed_execution: "automatic",
      }, [{ id: "procedure.prose-compile", read_state: "current" }]),
      completeStatus(),
    ];
    let index = 0;
    const executed: string[] = [];
    const result = await runWorkflowUntilBlockedOrComplete({
      observe: async () => statuses[index]!,
      execute: async ({ command }) => {
        executed.push(command);
        index += 1;
        return {
          exitCode: 0,
          signal: null,
          durationMs: 1,
          timedOut: false,
          stdout: { bytes: 2, sha256: "a".repeat(64) },
          stderr: { bytes: 0, sha256: "b".repeat(64) },
        };
      },
      maxSteps: 4,
      dryRun: false,
    });
    expect(result).toMatchObject({ state: "complete" });
    expect(result.steps).toHaveLength(2);
    expect(executed).toEqual([
      "context run compile:file:manual-a:guide --stage --format json",
      "context run compile:file:manual-b:guide --stage --format json",
    ]);
  });

  test("plans and executes only deterministic routes before re-evaluating", async () => {
    const fixture = await createApprovedProject();
    try {
      const packagePath = join(fixture.project, "package.json");
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
        context: { debug?: boolean };
      };
      packageJson.context.debug = true;
      writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
      const unread = JSON.parse(await runCliInDir(fixture.project, [
        "run",
        "--managed",
        "--until",
        "blocked-or-complete",
        "--dry-run",
        "--format",
        "json",
      ])) as { state: string; stop: { reasonCode: string }; steps: unknown[] };
      expect(unread).toMatchObject({
        state: "blocked",
        stop: { reasonCode: "workflow.until.agent-context-required" },
        steps: [],
      });

      const status = JSON.parse(await runCliInDir(fixture.project, [
        "status",
        "--managed",
        "--format",
        "json",
      ])) as {
        workflow: {
          current: {
            resources: { required: Array<{ id: string; digest?: string }> };
          };
        };
      };
      const receiptPath = join(".tmp", "workflow-run-receipts.json");
      const receipts = status.workflow.current.resources.required.map((resource) => {
        if (resource.digest === undefined) throw new Error(`missing resource digest: ${resource.id}`);
        return { id: resource.id, digest: resource.digest };
      });
      mkdirSync(join(fixture.project, ".tmp"), { recursive: true });
      writeFileSync(join(fixture.project, receiptPath), `${JSON.stringify({
        schema: "agent-graph.resource-read-receipts.v1",
        provider: "c4a/context",
        receipts,
      })}\n`, "utf8");
      const receiptOption = [`--workflow-resource-receipts`, `@${receiptPath}`];
      const planned = JSON.parse(await runCliInDir(fixture.project, [
        ...receiptOption,
        "run",
        "--managed",
        "--until",
        "blocked-or-complete",
        "--dry-run",
        "--format",
        "json",
      ])) as {
        state: string;
        steps: Array<{ effect: string; command: string }>;
      };
      expect(planned).toMatchObject({
        state: "planned",
        steps: [{ effect: "write" }],
      });
      expect(planned.steps[0]?.command).toContain(
        "build --format json",
      );

      const completed = JSON.parse(await runCliInDir(fixture.project, [
        ...receiptOption,
        "run",
        "--managed",
        "--until",
        "blocked-or-complete",
        "--max-steps",
        "4",
        "--format",
        "json",
      ])) as {
        state: string;
        steps: Array<{
          command: string;
          receipt: { exitCode: number; stdout: { sha256: string } };
        }>;
        workflow: { status: string };
      };
      expect(completed.state).toBe("complete");
      expect(completed.workflow.status).toBe("complete");
      expect(completed.steps).toHaveLength(1);
      expect(completed.steps[0]?.command).toContain(
        "build --format json",
      );
      expect(completed.steps[0]?.receipt.exitCode).toBe(0);
      expect(completed.steps[0]?.receipt.stdout.sha256).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      const debugEvents = readFileSync(
        join(fixture.project, ".tmp", "context-runtime", "debug", "events.jsonl"),
        "utf8",
      ).trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {
        kind: string;
        data: Record<string, unknown>;
      });
      expect(debugEvents).toContainEqual(expect.objectContaining({
        kind: "workflow.scope-opened",
        data: expect.objectContaining({ executor: "in-process" }),
      }));
      expect(debugEvents).toContainEqual(expect.objectContaining({
        kind: "workflow.scope-closed",
        data: expect.objectContaining({ executor: "in-process", release_errors: 0 }),
      }));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("a complete workspace performs no additional action", async () => {
    const fixture = await createApprovedProject();
    try {
      await runCliInDir(fixture.project, ["build", "--format", "json"]);
      const complete = JSON.parse(await runCliInDir(fixture.project, [
        "run",
        "--managed",
        "--until",
        "blocked-or-complete",
        "--format",
        "json",
      ])) as { state: string; steps: unknown[] };
      expect(complete).toMatchObject({ state: "complete", steps: [] });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
