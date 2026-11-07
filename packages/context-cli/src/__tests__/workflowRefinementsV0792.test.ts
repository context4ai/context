import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { runReviewApplyCommand, runReviewApproveAllCommand } from "../project/review.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { readConfirmedReviewScope } from "../project/reviewReportScope.js";
import { reviewSiteBaselineHash } from "../project/reviewSiteModel.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { registerKnowledgeMaintenance } from "../project/knowledgeMaintenance.js";
import { readMaintenance, saveMaintenance } from "../project/maintenanceStorage.js";
import { knowledgeMaintenanceRoute } from "../project/knowledgeMaintenanceRoute.js";
import type { ContextResolvedWorkflowRoute } from "../project/workflow/workflowTypes.js";
import { collectProjectStatus } from "../project/status.js";
import { formatProjectStatus } from "../project/statusRender.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("managed approval keeps a report with the exact pre-approval candidates and baseline", async () => {
  const root = await prepareRevisionKnowledge(roots);
  const rows = await readCandidateRecords(root);
  const baseline = await reviewSiteBaselineHash(root, rows.map(row => row.path));
  await expect(runReviewApproveAllCommand({ cwd: root, all: true, format: "json" })).rejects.toThrow("requires explicit");
  expect(await readCandidateRecords(root)).toEqual(rows);
  let output = "";
  const stdout = spyOn(process.stdout, "write").mockImplementation(chunk => { output += String(chunk); return true; });
  try { await runReviewApproveAllCommand({ cwd: root, all: true, managed: true, format: "json" }); }
  finally { stdout.mockRestore(); }
  const result = JSON.parse(output);
  expect(result).toMatchObject({ approved: rows.length, decision_source: "managed-session" });
  const report = await readFile(result.report_path, "utf8");
  for (const row of rows) expect(report).toContain(row.candidate_id);
  expect(report).toContain("value 42");
  const scope = await readConfirmedReviewScope(root, "all");
  expect(scope.baseline_hash).toBe(baseline);
  expect(scope.scope.candidates_sha256).toBe(candidateSetHash(rows));
  expect(scope.scope.visible_candidate_ids).toEqual(rows.map(row => row.candidate_id).sort());
  expect((await readCandidateRecords(root)).filter(row => row.status === "draft")).toEqual([]);
}, 60_000);

test("maintenance priority only changes queued timing and keeps active input stable", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-maintenance-priority-")); roots.push(root);
  await registerKnowledgeMaintenance(root, { id: "first", operation: "rebuild" });
  await registerKnowledgeMaintenance(root, { id: "second", operation: "rebuild" });
  const original = (await readMaintenance(root)).pending[1]!;
  expect((await registerKnowledgeMaintenance(root, { id: "second", operation: "rebuild", timing: "priority" })).outcome).toBe("priority-updated");
  let state = await readMaintenance(root);
  expect(state.pending.map(request => request.input.id)).toEqual(["second", "first"]);
  expect({ ...state.pending[0], input: original.input }).toEqual(original);
  await expect(registerKnowledgeMaintenance(root, { id: "second", operation: "revise", timing: "priority",
    targets: [{ path: "guide.md", instruction: "Clarify" }] })).rejects.toThrow("different input");
  state.active = { ...state.pending.shift()!, phase: "running" }; await saveMaintenance(root, state);
  await expect(registerKnowledgeMaintenance(root, { id: "second", operation: "rebuild", timing: "after-batch" })).rejects.toThrow("different input");
  expect(await readMaintenance(root)).toEqual(state);
});

test("maintenance can advance after clearing production without bypassing an actual gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-maintenance-cleared-")); roots.push(root);
  await registerKnowledgeMaintenance(root, { id: "rebuild", operation: "rebuild" });
  const route = { node: "reopen-cleared-task" } as ContextResolvedWorkflowRoute;
  const result = await knowledgeMaintenanceRoute({ projectRoot: root, authorities: [], managed: true, route });
  expect(result?.node).toBe("advance-knowledge-maintenance");
  expect(result?.commands[0]?.command).toContain("task advance-maintenance");
  expect(await knowledgeMaintenanceRoute({ projectRoot: root, authorities: [], managed: false,
    route: { ...route, node: "confirm-knowledge-requirements" } })).toBeUndefined();
});

test("default status collapses ready sources but retains anomalies and a full view", async () => {
  const root = await prepareRevisionKnowledge(roots);
  const status = await collectProjectStatus(root);
  status.phases = ["capture:fixture-a", "capture:fixture-b"];
  status.sources[0]!.ready = true; status.sources[0]!.diagnostics = [];
  status.sources[0]!.agent_hints = [];
  const short = formatProjectStatus(status);
  expect(short).toContain("phases: 2");
  expect(short).toContain("All sources are ready.");
  expect(short).not.toContain(`source ${status.sources[0]!.name}:`);
  expect(short).toContain("context status --view full");
  expect(formatProjectStatus(status, { full: true })).toContain("capture:fixture-a, capture:fixture-b");
  expect(formatProjectStatus(status, { full: true })).toContain(`source ${status.sources[0]!.name}:`);
  status.sources[0]!.diagnostics = ["The registered revision is unavailable"];
  expect(formatProjectStatus(status)).toContain("The registered revision is unavailable");
}, 60_000);

test("the managed Route apply entry preserves the pre-approval HTML report", async () => {
  const root = await prepareRevisionKnowledge(roots);
  const rows = await readCandidateRecords(root);
  const payload = join(root, ".tmp/review-decisions.jsonl");
  await writeFile(payload, JSON.stringify({ schema: "context.review.decisions.v1", scope: { kind: "all", visible_candidate_ids: rows.map(row => row.candidate_id).sort(), count: rows.length,
    ids_sha256: candidateIdsHash(rows.map(row => row.candidate_id).sort()), candidates_sha256: candidateSetHash(rows) }, default: "approved" }) + "\n");
  let output = ""; const stdout = spyOn(process.stdout, "write").mockImplementation(chunk => { output += String(chunk); return true; });
  try { await runReviewApplyCommand({ cwd: root, payloadInput: payload, format: "json" }); } finally { stdout.mockRestore(); }
  const result = JSON.parse(output);
  expect(result.approved).toBe(rows.length);
  const report = await readFile(result.report_path, "utf8");
  for (const row of rows) expect(report).toContain(row.candidate_id);
  expect(report).toContain("value 42");
  expect((await readCandidateRecords(root)).filter(row => row.status === "draft")).toEqual([]);
}, 60_000);
