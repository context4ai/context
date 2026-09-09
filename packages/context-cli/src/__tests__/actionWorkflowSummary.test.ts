import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionWorkflowSummary } from "../project/actionWorkflowSummary.js";
import { saveMaintenance, MAINTENANCE_ROOT, type MaintenanceState } from "../project/maintenanceStorage.js";
import { prepareActionCompletionOutput } from "../project/actionCompletionOutput.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), "context-completion-")); roots.push(value); return value; }

test("completion scope is registered work and absent maintenance is observed without creating state", async () => {
  const projectRoot = await root();
  const summary = await actionWorkflowSummary(projectRoot, "complete");
  expect(summary.status).toBe("complete");
  expect(summary.scope).toBe("registered-workflow");
  expect(summary.maintenance).toEqual({ active: null, pending_count: 0, pending: [], pending_omitted: 0 });
  await expect(readFile(join(projectRoot, MAINTENANCE_ROOT, "current.json"))).rejects.toThrow();
});

test("summary preserves Graph status and reports actual bounded maintenance targets", async () => {
  const projectRoot = await root();
  const request = (id: string) => ({ input: { id, operation: "regenerate" as const, timing: "priority" as const,
    targets: Array.from({ length: 7 }, (_, i) => ({ path: `guide/${id}-${i}.md`, instruction: "Refresh the API." })) },
    targets: Array.from({ length: 7 }, (_, i) => ({ path: `guide/${id}-${i}.md`, view_ref: `view:${id}/${i}` })), delivered_before: "previous" });
  const state: MaintenanceState = { protocol: "context.maintenance/v1", active: { ...request("active"), phase: "running" },
    pending: Array.from({ length: 7 }, (_, i) => request(`pending-${i}`)), completed: [] };
  await saveMaintenance(projectRoot, state);
  const before = await readFile(join(projectRoot, MAINTENANCE_ROOT, "current.json"), "utf8");
  const summary = await actionWorkflowSummary(projectRoot, "blocked");
  expect(summary.status).toBe("blocked");
  expect(summary.maintenance.active?.operation).toBe("regenerate");
  expect(summary.maintenance.active?.target_count).toBe(7);
  expect(summary.maintenance.active?.targets).toHaveLength(5);
  expect(summary.maintenance.active?.targets_omitted).toBe(2);
  expect(summary.maintenance.pending_count).toBe(7);
  expect(summary.maintenance.pending).toHaveLength(5);
  expect(summary.maintenance.pending_omitted).toBe(2);
  expect(await readFile(join(projectRoot, MAINTENANCE_ROOT, "current.json"), "utf8")).toBe(before);
});

test("compact completion retains terminal context and empty Composer counts", async () => {
  const projectRoot = await root();
  const workflow = await actionWorkflowSummary(projectRoot, "complete");
  const result = { protocol: "context.indexer.current-action-completion/v2", stage: "post-author", next: null,
    progress: { scopes: { overall: { planning: { unit: "task", completed: 20, total: 70 } }, wave: null, slice: null } },
    submitted_slice: { scope: "submitted-slice", stage: "post-author", unit: "task", completed: 3, total: 3 },
    workflow_summary: workflow, composer_result: { accepted_tasks: 3, proposals: 0 },
    outcomes: Array.from({ length: 3 }, (_, i) => ({ task_key: `task-${i}`, outcome: "accepted", committed: true })) };
  const compact = await prepareActionCompletionOutput({ projectRoot, result, format: "json" }) as Record<string, unknown>;
  expect(compact.progress).toEqual(result.progress);
  expect(compact.submitted_slice).toEqual(result.submitted_slice);
  expect(compact.workflow_summary).toEqual(workflow);
  expect(compact.composer_result).toEqual({ accepted_tasks: 3, proposals: 0 });
  expect(compact.next_route).toBeNull();
  expect(JSON.parse(await readFile(compact.result_file as string, "utf8"))).toEqual(result);
});

for (const wrapper of ["workflow", "continuation"] as const) {
  test(`compact completion retains the Route nested in ${wrapper}`, async () => {
    const projectRoot = await root();
    const route = { protocol: "context.workflow.route.v1", revision: "sha256:current", node: "run-indexer-agent-step", commands: [] };
    const result = { protocol: "context.indexer.current-action-completion/v2", stage: "structure-review",
      [wrapper]: wrapper === "workflow" ? { current: route } : { next: route } };
    const compact = await prepareActionCompletionOutput({ projectRoot, result, format: "json" }) as { next_route: { file: string }; result_file: string };
    expect(JSON.parse(await readFile(compact.next_route.file, "utf8"))).toEqual(route);
    expect(JSON.parse(await readFile(compact.result_file, "utf8"))).toEqual(result);
  });
}
