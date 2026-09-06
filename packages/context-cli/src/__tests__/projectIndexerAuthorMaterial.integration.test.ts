import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { indexerAgentStepInputSchema, type IndexerInventoryMember } from "@c4a/context";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { projectCurrentIndexerWorkflowRoute, resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { prepareIndexerAuthorMaterial } from "../project/indexerAuthorMaterial.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { validateProjectIndexerMainRun } from "../project/indexerMainRunValidationActions.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { createDocumentRevisionWorkspace, documentRevisionOuterIndexerRoute } from "./projectDocumentRevisionV074.fixture.js";
import { readingObjects } from "./indexerReading.fixture.js";
import { renderIndexerWorksetReading } from "../project/indexerAgentReading.js";

const roots: string[] = [];
const authorities = contextWorkflowAuthorities({ managed: true });
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function route(root: string) {
  const result = await projectCurrentIndexerWorkflowRoute({ projectRoot: root,
    route: documentRevisionOuterIndexerRoute(), managed: true, authorities });
  if (!result) throw new Error("missing current route");
  return result;
}

async function authorFixture() {
  const root = await createDocumentRevisionWorkspace();
  roots.push(root);
  await advanceCurrentIndexerLifecycle(root);
  const current = await resolveCurrentIndexerAgentContext(root);
  if (!current || current.descriptor.stage !== "partition") throw new Error("expected Partition");
  const results = [];
  for (const descriptor of current.descriptor.tasks) {
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: descriptor.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "partition") throw new Error("expected Partition task");
    const members = task.spec.validation.canonical_inventory_members as IndexerInventoryMember[];
    results.push({ task_key: descriptor.task_key, result: {
      stage: "partition", outcome: "complete", groups: [{
        key: descriptor.task_key, title: `Public constants ${descriptor.task_key}`, subject: descriptor.task_key,
        subject_intent: "primary", reader_task: "Find the exported constant and its value.",
        members: members.map((member) => member.member_id), questions: workset.reader_question_refs,
        question_targets: workset.allowed_question_target_refs.map((target) => ({ target, role: "primary-carrier" })),
        outline: ["Exports"],
      }], excluded: [], unsupported: [],
    } });
  }
  await completeCurrentIndexerAction({ cwd: root, revision: (await route(root)).revision,
    managed: true, authorities, value: { stage: "partition", results } });
  await completeCurrentIndexerAction({ cwd: root, revision: (await route(root)).revision,
    managed: true, authorities, value: { stage: "structure-review", decision: "approved" } });
  const author = await resolveCurrentIndexerAgentContext(root);
  if (!author || author.descriptor.stage !== "author") throw new Error("expected Author");
  const tasks = await Promise.all(author.descriptor.tasks.map((descriptor) => loadCurrentIndexerBatchTask({
    projectRoot: root, descriptor: author.descriptor, taskKey: descriptor.task_key,
  })));
  return { root, author, tasks };
}

type Task = Awaited<ReturnType<typeof loadCurrentIndexerBatchTask>>;
function materialRequest(task: Task, hints: string[]) {
  const workset = task.spec.request.workset;
  if (workset.stage !== "author") throw new Error("expected Author");
  return { task_key: task.descriptor.task_key, result: {
    stage: "author", group_key: workset.group_key, outcome: "request-material",
    material_gaps: [{ question: "Need the dependency declaration to explain the public API.", source_hints: hints }],
    member_dispositions: (task.spec.validation.canonical_inventory_members as IndexerInventoryMember[])
      .map((member) => ({ item: member.member_id, state: "catalog-only", reason_code: "missing-source-body" })),
  } };
}

async function publish(root: string, task: Task) {
  const workset = task.spec.request.workset;
  if (workset.stage !== "author") throw new Error("expected Author");
  const current = await route(root);
  const resource = current.resources.required.find((item) => item.id === `authorized-indexer-workset-view/${task.descriptor.task_key}`);
  if (!resource || !("path" in resource) || !resource.path) throw new Error("missing source material");
  const material = await readFile(resource.path, "utf8");
  const taskReading = renderIndexerWorksetReading({ task_key: task.descriptor.task_key, workset: task.spec.request.workset, view: task.view });
  const sourceItems = readingObjects(taskReading).flatMap((item) => Array.isArray(item.source_items) ? item.source_items as string[] : []);
  for (const ref of sourceItems) expect(material).toContain(ref);
  const validation = task.spec.validation as {
    allowed_artifact_intents: Array<{ source_role: string; document_kind: string; reader_goal: string; artifact_kind: string }>;
    artifact_policy_eligibility: { eligible_variants: Array<{ id: string }> };
    canonical_inventory_members: IndexerInventoryMember[];
    allowed_question_targets: Array<{ question_target_key: string }>;
  };
  const intent = validation.allowed_artifact_intents[0]!;
  return { task_key: task.descriptor.task_key, result: {
    stage: "author", group_key: workset.group_key, outcome: "publish",
    artifact_intent: [intent.source_role, intent.document_kind, intent.reader_goal, intent.artifact_kind].join("/"),
    policy: validation.artifact_policy_eligibility.eligible_variants[0]!.id,
    title: `Constants ${workset.group_key}`, summary: "Locate the public constant exports.",
    target_resolutions: (workset.target_resolution_view?.entries ?? []).map((entry) => ({ target: entry.query_ref,
      disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent" })),
    sections: [{ key: "exports", heading: "Exports", markdown: "Read the exported values in the entry point and dependency declaration.",
      source_items: sourceItems, facts: task.view.items.filter((item) => item.category === "fact").map((item) => item.ref),
      answers: validation.allowed_question_targets.map((target) => target.question_target_key) }],
    member_dispositions: validation.canonical_inventory_members.map((member) => ({ item: member.member_id, state: "covered", section: "exports" })),
    material_gaps: [], diagnostics: [],
  } };
}

describe("Author requests already captured dependency bodies", () => {
  test("expands the current task, preserves an accepted peer, and accepts source-only dependency citations", async () => {
    const { root, tasks } = await authorFixture();
    expect(tasks).toHaveLength(2);
    const task = tasks[0]!;
    const peer = tasks[1]!;
    const registryBefore = await readFile(join(root, "src/indexers.yaml"), "utf8");
    const sourcesBefore = await readFile(join(root, "sources/repo/index.yaml"), "utf8");
    const initialMembers = task.spec.validation.canonical_inventory_members;
    const oldFiles = (task.spec.validation.source_identity_inventory as { files: Array<{ normalized_path: string }> }).files;
    const missingPath = oldFiles.some((file) => file.normalized_path === "src/index.ts") ? "src/secondary.ts" : "src/index.ts";
    expect(oldFiles.some((file) => file.normalized_path === missingPath)).toBe(false);
    const result = await completeCurrentIndexerAction({ cwd: root, revision: (await route(root)).revision,
      managed: true, authorities, value: { stage: "author", results: [materialRequest(task, ["src", "src/missing.ts"]), await publish(root, peer)] } });
    if (!("outcomes" in result)) throw new Error("missing outcomes");
    expect(result.outcomes.find((item) => item.task_key === peer.descriptor.task_key)?.outcome).toBe("accepted");
    expect(result.outcomes.find((item) => item.task_key === task.descriptor.task_key)?.outcome).toBe("material-expanded");
    expect(result.outcomes.find((item) => item.task_key === task.descriptor.task_key)?.message).toContain("src/missing.ts");
    expect(result.revision_advanced).toBe(true);
    expect(indexerAgentStepInputSchema.parse(result.next?.action?.input).stage).toBe("author");
    const ledger = await currentLedger(root);
    expect(ledger?.entries.find((entry) => entry.workset_digest === peer.spec.request.workset.workset_digest)?.state).toBe("accepted");
    const current = await resolveCurrentIndexerAgentContext(root);
    expect(current?.descriptor.tasks).toHaveLength(1);
    const updated = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current!.descriptor, taskKey: current!.descriptor.tasks[0]!.task_key });
    expect(updated.spec.validation.canonical_inventory_members).toEqual(initialMembers);
    expect(updated.spec.validation.expected_subject_key).toEqual(task.spec.validation.expected_subject_key);
    const texts = updated.view.items.filter((item) => item.category === "source-text");
    expect(JSON.stringify(texts)).toContain("export const answer = 42");
    expect(JSON.stringify(texts)).toContain("export const secondaryAnswer = 84");
    const identity = updated.spec.validation.source_identity_inventory as { files: Array<{ normalized_path: string; facts: unknown[] }> };
    expect(identity.files.find((file) => file.normalized_path === missingPath)?.facts).toEqual([]);
    await expect(prepareIndexerAuthorMaterial({ projectRoot: root, spec: updated.spec,
      group_key: materialRequest(updated, []).result.group_key, source_hints: [missingPath] })).rejects.toThrow("already complete");
    for (const hint of ["../outside.ts", "/etc/passwd", "src/not-captured.ts"]) {
      await expect(prepareIndexerAuthorMaterial({ projectRoot: root, spec: updated.spec,
        group_key: materialRequest(updated, []).result.group_key, source_hints: [hint] })).rejects.toThrow();
    }
    expect(await currentLedger(root)).toEqual(ledger);
    const submission = await publish(root, updated);
    const runResult = buildIndexerAuthorRunResultFromSemantic({ request: updated.spec.request, view: updated.view,
      semantic: submission.result, validation: updated.spec.validation } as unknown as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]);
    await expect(validateProjectIndexerMainRun({ projectRoot: root, value: {
      protocol: "context.indexer.main-run-validation-input/v1", request: updated.spec.request,
      result: runResult, validation: updated.spec.validation,
    } })).resolves.toMatchObject({ graph_outcome: "completed" });
    const completed = await completeCurrentIndexerAction({ cwd: root, revision: (await route(root)).revision,
      managed: true, authorities, value: { stage: "author", results: [submission] } });
    if (!("outcomes" in completed)) throw new Error("missing outcomes");
    expect(completed.outcomes[0]?.outcome).toBe("accepted");
    expect((await currentLedger(root))?.entries.every((entry) => entry.state === "accepted")).toBe(true);
    expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).toBe(registryBefore);
    expect(await readFile(join(root, "sources/repo/index.yaml"), "utf8")).toBe(sourcesBefore);
  }, 30_000);
});
