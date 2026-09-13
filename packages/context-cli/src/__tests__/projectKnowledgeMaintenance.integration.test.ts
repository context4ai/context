import { withContextRuntimeEventDelivery, type ContextRuntimeEventBatch } from "../runtimeEvents.js";
import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { maintenanceProductionWorkspace, submitMaintenanceProductionArticle } from "./maintenanceProduction.fixture.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace, readProjectCloseStatus } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { collectProjectStatus } from "../project/status.js";
import { readApprovedRevision } from "../project/approvedRevision.js";
import { readMaintenance } from "../project/maintenanceStorage.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { requestProductionDelivery, resumeProductionWriting } from "../project/productionDelivery.js";
import { registerKnowledgeMaintenance, advanceKnowledgeMaintenance, maintenanceRevision, cancelKnowledgeMaintenance } from "../project/knowledgeMaintenance.js";

async function captureRuntimeEvents(work: () => Promise<unknown>) {
  const events: ContextRuntimeEventBatch["events"] = [];
  await withContextRuntimeEventDelivery(work, {
    sink: { schema: "context.runtime-event-sink.v1", transport: "command", command: "test-sink", args: [] },
    contextVersion: "test",
    dispatch: async (_sink, batch) => {
      events.push(...batch.events);
      return { schema: "context.runtime-event-delivery-result.v1", status: "sent", event_count: batch.events.length };
    },
  });
  return events;
}

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const deliveryWorkspace = () => maintenanceProductionWorkspace(roots);

async function advance(root: string) {
  const status = await collectProjectStatus(root, { managed: true });
  expect(status.workflow.status).not.toBe("complete");
  expect(status.workflow.current?.node).toBe("advance-knowledge-maintenance");
  return advanceKnowledgeMaintenance(root, status.workflow.current!.revision);
}

test("priority repairs a current Candidate and returns to its early delivery without consuming queued maintenance", async () => {
  const { root, views } = await deliveryWorkspace();
  await buildProjectPackages(root);
  await submitMaintenanceProductionArticle(root, "architecture/examples.md");
  await requestProductionDelivery(root);
  await resumeProductionWriting(root);
  const candidates = await readCandidateRecords(root);
  expect(candidates.length).toBeGreaterThan(0);
  const target = candidates[0]!;
  const before = (await readProductionStage(root))!;
  const unfinished = before.tasks.filter(task => task.status === "issued");
  expect(unfinished).toHaveLength(1);
  await registerKnowledgeMaintenance(root, { id: "later-approved-revision", operation: "revise", timing: "priority",
    targets: [{ path: views[0]!.path, instruction: "Clarify an already delivered page." }] });
  const queue = await readMaintenance(root);
  const instruction = "Correct the reader's API names; preserve the other explanations.";
  await expect(beginDocumentRevision({ projectRoot: root, selector: target.path, instruction, regenerate: true }))
    .rejects.toMatchObject({ detail: { reason_code: "current-candidate-requires-repair",
      next_action: { command: expect.stringContaining("context revise ") } } });
  expect(await readProductionStage(root)).toEqual(before);
  expect(await readCandidateRecords(root)).toEqual(candidates);
  const result = JSON.parse(await runCliInDir(root, ["revise", `./knowledge/${target.path}`,
    "--instruction", instruction, "--timing", "priority", "--format", "json"]));
  expect(result).toMatchObject({ status: "production-revision-prepared", path: target.path });
  expect(await readMaintenance(root)).toEqual(queue);
  const repairing = (await readProductionStage(root))!;
  expect(repairing.tasks.filter(task => task.status === "issued")).toHaveLength(2);
  expect(await readCandidateRecords(root)).toEqual(candidates);
  await submitMaintenanceProductionArticle(root, target.path, "Corrected public API: answer is exported with value 42.");
  const repaired = await readCandidateRecords(root);
  expect(repaired.map(candidate => candidate.path).sort()).toEqual(candidates.map(candidate => candidate.path).sort());
  expect((await readProductionStage(root))!.tasks.filter(task => task.status === "issued")).toEqual(unfinished);
  await requestProductionDelivery(root);
  expect((await collectProjectStatus(root, { managed: true })).workflow.current?.node).toBe("review-current-batch");
  expect(await readMaintenance(root)).toEqual(queue);
}, 60_000);

test("two approved revisions share delivery and resume untouched production tasks", async () => {
  const { root, views } = await deliveryWorkspace();
  const input = { id: "clarify", operation: "revise", targets: views.slice(0, 2).map(view => ({ path: `knowledge/${view.path}`, instruction: "Clarify the public entry point." })) };
  await registerKnowledgeMaintenance(root, input);
  expect((await registerKnowledgeMaintenance(root, input)).outcome).toBe("already-registered");
  expect((await maintenanceRevision(root)).action).toBeUndefined();
  await buildProjectPackages(root);
  const ledger = await readProductionStage(root);
  expect(ledger).toBeDefined();
  await advance(root);
  const acceptedBodies: string[] = [];
  for (let index = 0; index < 2; index++) {
    const request = (await readApprovedRevision(root))!;
    const markdown = request.target.markdown.replace("public entry point", "documented public entry point");
    acceptedBodies.push(request.target.path);
    const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    expect(route.reason_code).toBe("route.indexer.approved-revision");
    const payload = join(root, ".tmp/maintenance-revision.json");
    await writeFile(payload, JSON.stringify({ stage: "approved-revision", markdown }));
    await runCliInDir(root, ["action", "complete-current", "--revision", route.revision,
      "--input", payload, "--managed", "--format", "json"]);
  }
  expect(await readCandidateRecords(root)).toHaveLength(2);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await buildProjectPackages(root);
  expect(await readProductionStage(root)).toEqual(ledger);
  expect((await readMaintenance(root)).active).toBeUndefined();
  expect((await registerKnowledgeMaintenance(root, input)).outcome).toBe("already-completed");
  for (const path of acceptedBodies) expect(await readFile(join(root, "knowledge", path), "utf8")).toContain("documented public entry point");
  const next = await collectProjectStatus(root, { managed: true });
  expect(next.workflow.current).toBeDefined();
  expect(next.workflow.current?.reason_code).not.toBe("route.indexer.approved-revision");
  for (const task of ledger!.tasks.filter(task => task.status === "issued")) await submitMaintenanceProductionArticle(root, task.path);
  const remaining = await readCandidateRecords(root);
  expect(remaining).toHaveLength(2);
  await approveCandidates(root, remaining); await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(await readProductionStage(root)).toBeUndefined();
  for (const path of acceptedBodies) expect(await readFile(join(root, "knowledge", path), "utf8")).toContain("documented public entry point");
  const final = await collectProjectStatus(root, { managed: true });
  expect(final.close.state).toBe("not-checked");
  expect((await readProjectCloseStatus(root)).state).toBe("ready");
  expect(final.packages.every(item => item.state === "ready")).toBe(true);
  expect(final.workflow.current?.node).toBe("reopen-cleared-task");
  expect(final.workflow.current?.commands.every(command => command.availability === "after-human-confirmation")).toBe(true);
// Complete the outstanding work after the two-article maintenance delivery.
}, 180_000);

test("same-version regeneration supplies current program blocks without advancing source baselines", async () => {
  const { root, views } = await deliveryWorkspace();
  const registered = JSON.parse(await runCliInDir(root, ["revise", `knowledge/${views[0]!.path}`, "--regenerate",
    "--instruction", "Regenerate this page's API from the existing fixed source.", "--format", "json"]));
  expect(registered.status).toBe("maintenance-registered");
  expect((await readMaintenance(root)).pending[0]?.input.operation).toBe("regenerate");
  await buildProjectPackages(root);
  const before = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")).processed_scopes;
  await advance(root);
  const request = (await readApprovedRevision(root))!;
  expect(request.program_blocks!.length).toBeGreaterThan(0);
  const block = request.program_blocks![0]!;
  const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
  await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true,
    value: { stage: "approved-revision", markdown: request.target.markdown + `\n<!-- context:section id="api" -->\n${block.token}\n<!-- /context:section -->\n` } });
  expect((await readCandidateRecords(root))[0]!.body).toContain(block.markdown);
  await approveCandidates(root, await readCandidateRecords(root)); await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")).processed_scopes).toEqual(before);
}, 60_000);

test("approved-output rebuild does not finish or clear production", async () => {
  const { root } = await deliveryWorkspace();
  await buildProjectPackages(root);
  const ledger = await readProductionStage(root);
  expect(ledger).toBeDefined();
  await registerKnowledgeMaintenance(root, { id: "repack", operation: "rebuild" });
  const inspected = JSON.parse(await runCliInDir(root, ["task", "maintenance-status", "--format", "json"]));
  expect(inspected.state.pending[0].input.id).toBe("repack");
  const events = await captureRuntimeEvents(() => advance(root));
  expect(events.map(event => event.kind)).toEqual(["package.build.completed"]);
  expect(events[0]!.properties).toMatchObject({ package_count: 1, created_count: 0, updated_count: 0, unchanged_count: 1 });
  expect(await readProductionStage(root)).toEqual(ledger);
  expect((await readMaintenance(root)).completed.map(item => item.id)).toContain("repack");
}, 60_000);

test("failed preparation retains a cancellable request and rejects stale transitions", async () => {
  const { root, views } = await deliveryWorkspace();
  await registerKnowledgeMaintenance(root, { id: "obsolete-path", operation: "revise", targets: [{ path: views[0]!.path, instruction: "Clarify." }] });
  await buildProjectPackages(root);
  const next = await maintenanceRevision(root);
  await expect(advanceKnowledgeMaintenance(root, `sha256:${"0".repeat(64)}`)).rejects.toThrow("route changed");
  const path = join(root, "knowledge/structure.yaml");
  const structure = YAML.parse(await readFile(path, "utf8"));
  structure.articles[0].path = "guides/moved.md";
  await writeFile(path, YAML.stringify(structure));
  await expect(advanceKnowledgeMaintenance(root, next.revision)).rejects.toThrow("changed identity");
  expect((await maintenanceRevision(root)).action).toBe("advance");
  await cancelKnowledgeMaintenance(root, "obsolete-path");
  expect((await readMaintenance(root)).active).toBeUndefined();
  expect(await readProductionStage(root)).toBeDefined();
}, 60_000);

test("priority requests early delivery; explicit draft cancellation leaves production and approved prose intact", async () => {
  const { root, views } = await deliveryWorkspace();
  await registerKnowledgeMaintenance(root, { id: "cancel-draft", operation: "revise", targets: [{ path: views[0]!.path, instruction: "Clarify." }] });
  await buildProjectPackages(root);
  const ledger = await readProductionStage(root);
  const original = await readFile(join(root, "knowledge", views[0]!.path), "utf8");
  await advance(root);
  const before = await maintenanceRevision(root);
  const request = (await readApprovedRevision(root))!;
  const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
  await completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true,
    value: { stage: "approved-revision", markdown: request.target.markdown.replace("public entry point", "unreviewed entry point") } });
  await expect(cancelKnowledgeMaintenance(root, "cancel-draft", before.revision)).rejects.toThrow("explicit discard");
  await cancelKnowledgeMaintenance(root, "cancel-draft", (await maintenanceRevision(root)).revision);
  expect(await readProductionStage(root)).toEqual(ledger);
  expect(await readFile(join(root, "knowledge", views[0]!.path), "utf8")).toBe(original);
  expect(await readCandidateRecords(root)).toHaveLength(0);
  await submitMaintenanceProductionArticle(root, "architecture/examples.md");
  await registerKnowledgeMaintenance(root, { id: "urgent", operation: "revise", timing: "priority", targets: [{ path: views[0]!.path, instruction: "Clarify next." }] });
  // Current candidates must be reviewed before the queue can trigger delivery.
  expect((await maintenanceRevision(root)).action).toBeUndefined();
  await requestProductionDelivery(root);
  expect((await maintenanceRevision(root)).action).toBeUndefined();
  expect((await collectProjectStatus(root, { managed: true })).workflow.current).toBeDefined();
}, 60_000);

test("a rebuild blocked by missing outputs returns the existing package Gate instead of a retry loop", async () => {
  const { root } = await deliveryWorkspace();
  await buildProjectPackages(root);
  const ledger = await readProductionStage(root);
  const path = join(root, "src/index.ts");
  await writeFile(path, (await readFile(path, "utf8")).replace(/packages: \[kbPackage\([^\n]+\)\]/u, "packages: []"));
  await registerKnowledgeMaintenance(root, { id: "repack-without-output", operation: "rebuild" });
  const events = await captureRuntimeEvents(async () => {
    await expect(advanceKnowledgeMaintenance(root, (await maintenanceRevision(root)).revision)).rejects.toThrow("no packages");
  });
  expect(events).toEqual([]);
  const status = await collectProjectStatus(root);
  expect(status.workflow.current?.node).toBe("choose-package-output");
  expect(status.workflow.current?.availability).toBe("requires-user");
  expect(await readProductionStage(root)).toEqual(ledger);
  await cancelKnowledgeMaintenance(root, "repack-without-output");
}, 60_000);
