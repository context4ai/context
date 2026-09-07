import { afterEach, expect, spyOn, test } from "bun:test";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { indexerProtocolDigest, type IndexerInventoryMember } from "@c4a/context";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import * as reading from "../project/indexerAgentReading.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { projectCurrentIndexerWorkflowRoute, resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { ensureRepoSources } from "../project/repoSources.js";
import { createDocumentRevisionWorkspace, documentRevisionOuterIndexerRoute } from "./projectDocumentRevisionV074.fixture.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function workspace(sourceCount = 2) {
  const root = await createDocumentRevisionWorkspace({ sourceCount });
  roots.push(root);
  return root;
}
const route = (projectRoot: string) => projectCurrentIndexerWorkflowRoute({ projectRoot,
  route: documentRevisionOuterIndexerRoute(), managed: true,
  authorities: contextWorkflowAuthorities({ managed: true }) });

async function currentTask(root: string) {
  await advanceCurrentIndexerLifecycle(root);
  const current = (await resolveCurrentIndexerAgentContext(root))!;
  const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor,
    taskKey: current.descriptor.tasks[0]!.task_key });
  const workset = task.spec.request.workset;
  if (workset.stage !== "partition") throw new Error("expected partition");
  const validation = task.spec.validation as {
    canonical_inventory_members: IndexerInventoryMember[];
    required_question_target_refs?: string[];
  };
  const authority = task.view.items.find((item) => item.category === "partition-authority")!.value as {
    available_artifact_intents: string[]; available_templates: { id: string }[];
  };
  const result = { stage: "partition", outcome: "complete", groups: [{
    key: "public-guide", title: "Public guide", reader_task: "Use the public capability",
    subject: { namespace: workset.partition_subject_key.namespace, kind: workset.partition_subject_key.kind,
      local_key: "public-guide" }, subject_intent: "primary",
    members: validation.canonical_inventory_members.map((member) => member.member_id),
    questions: workset.reader_question_refs, question_targets: (validation.required_question_target_refs ?? [])
      .map((target) => ({ target, role: "primary-carrier" })), outline: ["Overview"],
    artifact_intent: authority.available_artifact_intents[0]!, template_id: authority.available_templates[0]!.id,
  }], excluded: [], unsupported: [] };
  return { task, result };
}

test("complete-current accepts the page intent and template advertised by its own View", async () => {
  const root = await workspace();
  const { task, result } = await currentTask(root);
  const current = (await route(root))!;
  const completion = await completeCurrentIndexerAction({ cwd: root, revision: current.revision,
    managed: true, authorities: contextWorkflowAuthorities({ managed: true }),
    value: { stage: "partition", results: [{ task_key: task.descriptor.task_key, result }] } });
  expect(completion).toMatchObject({ outcomes: expect.arrayContaining([
    expect.objectContaining({ task_key: task.descriptor.task_key, outcome: "accepted", committed: true }),
  ]) });
}, 30_000);

test("skipping an oversized middle candidate keeps task and View numbering aligned and repairs old descriptors", async () => {
  const root = await workspace(4);
  const render = reading.renderIndexerWorksetReading;
  const renderSpy = spyOn(reading, "renderIndexerWorksetReading").mockImplementation((input) =>
    render(input) + (input.task_key === "task-002" ? "oversized ".repeat(40_000) : ""));
  try {
    await advanceCurrentIndexerLifecycle(root);
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    expect(current.descriptor.tasks.length).toBeGreaterThan(1);
    expect(current.descriptor.tasks.length).toBeLessThan(4);
    const before = await currentLedger(root);
    const next = (await route(root))!;
    expect(next.action?.input).toMatchObject({ stage: "partition" });
    // Emulate an old valid-digest descriptor with a mismatched resource number.
    const path = join(root, ".tmp/context-runtime/lifecycle/current-indexer-batch.json");
    const descriptor = JSON.parse(await readFile(path, "utf8"));
    const request = descriptor.tasks[1].view_request;
    delete request.request_digest;
    request.resource_id = "authorized-indexer-workset-view/task-003";
    request.request_digest = indexerProtocolDigest(request);
    delete descriptor.descriptor_digest;
    descriptor.descriptor_digest = indexerProtocolDigest(descriptor);
    await writeFile(path, JSON.stringify(descriptor));
    expect((await route(root))?.action?.input).toMatchObject({ stage: "partition" });
    expect((await currentLedger(root))?.ledger_digest).toBe(before?.ledger_digest);
  } finally { renderSpy.mockRestore(); }
}, 30_000);

test.each(["json", "yaml"] as const)("large completion output retains full diagnostics and the next Route (%s)", async (format) => {
  // Exercise the real CLI route, including checkout readiness. macOS temporary
  // paths can have /var and /private/var aliases; use the canonical checkout.
  const root = await realpath(await workspace(12));
  expect((await ensureRepoSources({ projectRoot: root })).every((item) => item.ready)).toBe(true);
  const { task, result } = await currentTask(root);
  result.groups[0]!.artifact_intent = "not-advertised";
  const status = JSON.parse(await runCliInDir(root, ["status", "--managed", "--view", "summary", "--format", "json"]));
  const current = status.workflow.current;
  expect(current.node).toBe("run-indexer-agent-step");
  const input = join(root, ".tmp/submission.json");
  await writeFile(input, JSON.stringify({ stage: "partition", results: [{ task_key: task.descriptor.task_key, result }] }));
  const raw = await runCliInDir(root, ["--workflow-managed", "action", "complete-current", "--revision", current.revision,
    "--managed", "--input", input, "--format", format]);
  const summary = YAML.parse(raw);
  expect(summary.protocol).toBe("context.action.completion-summary/v1");
  expect(Buffer.byteLength(raw)).toBeLessThan(16 * 1024);
  const full = JSON.parse(await readFile(summary.result_file, "utf8"));
  expect(full.protocol).toBe("context.indexer.current-action-completion/v2");
  expect(summary.result_bytes).toBe(Buffer.byteLength(await readFile(summary.result_file, "utf8")));
  expect(full.outcomes[0].message).toContain("unknown page intent");
  expect(full.revision_advanced).toBe(false);
  const next = JSON.parse(await readFile(summary.next_route.file, "utf8"));
  expect(next).toEqual(full.next);
  expect(next.revision).toBe(current.revision);
}, 30_000);
