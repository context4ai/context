import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { completeProductionSubmission } from "../project/productionSubmission.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { closeProjectWorkspace } from "../project/close.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function submitRevision(root: string, markdown: string) {
  const stage = (await readProductionStage(root))!;
  const task = stage.tasks.find(task => task.status === "issued")!;
  const directory = join(root, productionAgentDirectory(stage.id), "submissions");
  await writeFile(join(directory, "repair.yaml"), YAML.stringify({ edits: [
    { replace: ["overview"], with: [{ id: "overview", markdown }] },
  ] }));
  await writeFile(join(directory, "repair-submission.yaml"), YAML.stringify({ stage: stage.id,
    tasks: [{ task: task.id, input: task.input, edits: "submissions/repair.yaml" }] }));
  const result = await completeProductionSubmission({ projectRoot: root, stage: stage.id, path: "submissions/repair-submission.yaml" });
  expect(result.failed).toEqual([]);
  expect(result.accepted).toHaveLength(1);
}

test("a selected candidate reopens writing directly and preserves its peer and article identity", async () => {
  const root = await prepareRevisionKnowledge(roots);
  const before = await readCandidateRecords(root);
  const original = (await readProductionStage(root))!;
  const selected = before.find(candidate => candidate.path === "architecture/overview.md")!;
  const request = { projectRoot: root, selector: selected.candidate_id, instruction: "Clarify the exported value." };
  expect(await beginDocumentRevision(request)).toMatchObject({ status: "production-revision-prepared", path: selected.path });
  const pending = (await readProductionStage(root))!;
  expect(pending.id).toBe(original.id);
  expect(pending.report_approved).toBe(true);
  expect(pending.tasks).toHaveLength(original.tasks.length + 1);
  expect(pending.tasks.filter(task => task.status === "issued")).toHaveLength(1);
  expect(await readCandidateRecords(root)).toEqual(before);
  await beginDocumentRevision(request);
  expect((await readProductionStage(root))!.tasks).toEqual(pending.tasks);
  await submitRevision(root, "# Exported value\nThe public entry point exports answer with value 42.\n");
  const after = await readCandidateRecords(root);
  const revised = after.find(candidate => candidate.path === selected.path)!;
  expect(revised.article_id).toBe(selected.article_id);
  expect(revised.candidate_id).not.toBe(selected.candidate_id);
  expect(after.find(candidate => candidate.path !== selected.path)).toEqual(before.find(candidate => candidate.path !== selected.path));
  await approveCandidates(root, after);
  await closeProjectWorkspace(root);
  expect(await readFile(join(root, "knowledge", selected.path), "utf8")).toContain("# Exported value");
});

test("a production revision cannot silently move an article onto its peer", async () => {
  const root = await prepareRevisionKnowledge(roots);
  const before = await readCandidateRecords(root);
  const stage = await readProductionStage(root);
  const selected = before.find(candidate => candidate.path === "architecture/overview.md")!;
  const peer = before.find(candidate => candidate.path !== selected.path)!;
  await expect(beginDocumentRevision({ projectRoot: root, selector: selected.candidate_id,
    instruction: "Clarify this article", move_to: peer.path })).rejects.toThrow();
  expect(await readCandidateRecords(root)).toEqual(before);
  expect(await readProductionStage(root)).toEqual(stage);
});

test("a current formal article revision reads external edits and rejects a later conflicting write", async () => {
  const root = await prepareRevisionKnowledge(roots);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  const path = join(root, "knowledge/architecture/overview.md");
  const original = await readFile(path, "utf8");
  const edited = original.replace("public entry point", "user-corrected public entry point");
  await writeFile(path, edited);
  expect(await beginDocumentRevision({ projectRoot: root, selector: "architecture/overview.md",
    instruction: "Preserve the user correction and clarify the explanation." })).toMatchObject({ status: "production-revision-prepared" });
  expect(await readFile(path, "utf8")).toBe(edited);
  await writeFile(path, edited.replace("user-corrected", "newer-user-corrected"));
  const stage = (await readProductionStage(root))!;
  const task = stage.tasks.find(task => task.status === "issued")!;
  const directory = join(root, productionAgentDirectory(stage.id), "submissions");
  await writeFile(join(directory, "conflict.yaml"), YAML.stringify({ edits: [{ replace: ["overview"],
    with: [{ id: "overview", markdown: "A clarification based on the older draft." }] }] }));
  await writeFile(join(directory, "submit-conflict.yaml"), YAML.stringify({ stage: stage.id,
    tasks: [{ task: task.id, input: task.input, edits: "submissions/conflict.yaml" }] }));
  const result = await completeProductionSubmission({ projectRoot: root, stage: stage.id, path: "submissions/submit-conflict.yaml" });
  expect(result.accepted).toEqual([]);
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]!.reason).toContain("changed");
  expect(await readFile(path, "utf8")).toContain("newer-user-corrected");
});
