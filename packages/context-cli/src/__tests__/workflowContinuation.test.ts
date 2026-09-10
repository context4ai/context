import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflowUntilBlockedOrComplete, selectAutomaticWorkflowCommand } from "../project/workflow/workflowRun.js";
import { evaluateContextWorkflow } from "../project/workflow/workflowProvider.js";
import type { ProjectStatus } from "../project/statusTypes.js";
import type { ContextResolvedWorkflowRoute } from "../project/workflow/workflowTypes.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";

async function observedStatus(
  managed: boolean,
  issues: { code: string; path: string; message: string }[],
  projectionRefreshIssues = 0,
) {
  const observation = { ...emptyObservation(), sourceCount: 1, approvedPages: 2,
    close: { state: "stale" as const, diagnostics: [] },
    verifyErrors: issues.length,
    projectionRefreshIssues,
    verifyIssues: issues.map((issue) => ({ ...issue, severity: "error" as const })),
  };
  const evaluated = await evaluateContextWorkflow({ observation,
    authorities: contextWorkflowAuthorities({ managed }),
  });
  return { projectRoot: observation.projectRoot, workflow: {
    revision: evaluated.route?.revision ?? "sha256:fixture",
    status: evaluated.evaluation.statusCode, current: evaluated.route,
    diagnostics: evaluated.rootDiagnostics,
  } } as ProjectStatus;
}

function status(root: string, node: string, changes: Partial<ContextResolvedWorkflowRoute> = {}): ProjectStatus {
  return { projectRoot: root, workflow: { revision: `sha256:${node}`, status: "actionable", diagnostics: [],
    current: { node, reason_code: node, availability: "immediate", resources: { required: [], recommended: [] },
      commands: [{ command: `context ${node} --format json`, effect: "write", availability: "immediate", managed_execution: "automatic" }],
      ...changes } } } as unknown as ProjectStatus;
}

describe("automatic continuation without implicit approval", () => {
  test.each([false, true])("closes and builds within one invocation, managed=%s", async (managed) => {
    const root = await mkdtemp(join(tmpdir(), "context-continuation-"));
    try {
      const states = [status(root, "close"), status(root, "build"), {
        projectRoot: root, workflow: { revision: "sha256:done", status: "complete", diagnostics: [] },
      } as unknown as ProjectStatus];
      const commands: string[] = [];
      let i = 0;
      const result = await runWorkflowUntilBlockedOrComplete({ managed, dryRun: false, maxSteps: 25,
        observe: async () => states[i++]!, execute: async ({ command }) => {
          commands.push(command);
          return { exitCode: 0, signal: null, timedOut: false, durationMs: 0,
            stdout: { bytes: 0, sha256: "" }, stderr: { bytes: 0, sha256: "" } };
        } });
      expect(result.managed).toBe(managed);
      expect(result.state).toBe("complete");
      expect(commands).toEqual(["context close --format json", "context build --format json"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("does not run a human gate or unread semantic task", () => {
    const gate = status("/fixture", "review", { availability: "requires-user" });
    expect(selectAutomaticWorkflowCommand(gate)).toMatchObject({ state: "blocked" });
    const unread = status("/fixture", "author", { resources: { required: [{ id: "reading", kind: "context-view",
      media_type: "text/markdown", read_state: "read-required" }], recommended: [] } });
    expect(selectAutomaticWorkflowCommand(unread)).toMatchObject({ state: "blocked" });
    const payload = status("/fixture", "author");
    payload.workflow.current!.commands[0]!.command = "context action complete-current --input -";
    expect(selectAutomaticWorkflowCommand(payload)).toMatchObject({ state: "blocked" });
  });

  test("the real Graph allows mechanical close but retains ordinary content review", async () => {
    const base = { ...emptyObservation(), sourceCount: 1, approvedPages: 1,
      close: { state: "stale" as const, diagnostics: [] } };
    const closing = await evaluateContextWorkflow({ observation: base, authorities: [] });
    expect(closing.route?.node).toBe("close-approved-knowledge");
    expect(closing.route?.resources.required).toEqual([]);
    const review = await evaluateContextWorkflow({ observation: { ...base, draftCandidates: 1,
      draftCollections: ["codeindex"] }, authorities: [] });
    expect(review.route?.availability).toBe("requires-user");
  });

  test.each([false, true])("repairs captured asset links without a diagnostic read round trip, managed=%s", async (managed) => {
    const current = await observedStatus(managed, [{
      code: "approved-resource-source-path-unprojected", path: "knowledge/faq.md",
      message: "Captured image links require projection.",
    }]);
    expect(current.workflow.current?.node).toBe("close-approved-knowledge");
    expect(current.workflow.current?.resources.required).toEqual([]);
    expect(current.workflow.diagnostics).toContainEqual(expect.objectContaining({
      code: "diagnostic.projection-stale", severity: "info",
    }));
    expect(current.workflow.diagnostics.some((item) => item.severity === "error")).toBe(false);
    // Even diagnostic detail must not override a legal Graph repair plan.
    current.workflow.diagnostics.push({ code: "diagnostic.verify-failed", severity: "error",
      message: "The current route repairs this observed state." });
    expect(selectAutomaticWorkflowCommand(current)).toMatchObject({
      command: { command: expect.stringContaining("close"), managed_execution: "automatic" },
    });
  });

  test.each([false, true])("real verification failures retain the repair gate, managed=%s", async (managed) => {
    const current = await observedStatus(managed, [
      { code: "approved-resource-source-path-unprojected", path: "knowledge/faq.md", message: "Project links." },
      { code: "resource-missing", path: "knowledge/assets/missing.png", message: "Missing image." },
    ], 1);
    expect(current.workflow.current?.node).toBe("repair-verification");
    expect(current.workflow.diagnostics).toContainEqual(expect.objectContaining({
      code: "diagnostic.verify-failed", severity: "error",
    }));
    expect(selectAutomaticWorkflowCommand(current)).toMatchObject({ state: "blocked" });
  });

  test("a diagnostic without a repair route remains blocked", () => {
    const current = status("/fixture", "repair");
    delete current.workflow.current;
    current.workflow.diagnostics.push({ code: "invalid-state", severity: "error", message: "Cannot resolve state." });
    expect(selectAutomaticWorkflowCommand(current)).toMatchObject({ state: "blocked",
      stop: { reasonCode: "workflow.until.diagnostic" } });
  });
});
