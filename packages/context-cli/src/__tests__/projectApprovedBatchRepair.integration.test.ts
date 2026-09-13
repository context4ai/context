import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { completeProductionSubmission } from "../project/productionSubmission.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function revise(root: string, path: string, section: string, markdown: string) {
  await beginDocumentRevision({ projectRoot: root, selector: path, instruction: "Apply the review feedback to this article." });
  const stage = (await readProductionStage(root))!;
  const task = stage.tasks.find(task => task.path === path && task.status === "issued")!;
  const agent = join(root, productionAgentDirectory(stage.id), "submissions");
  await writeFile(join(agent, "revision-edits.yaml"), YAML.stringify({ edits: [{ replace: [section], with: [{ id: section, markdown }] }] }));
  await writeFile(join(agent, "revision-submit.yaml"), YAML.stringify({ stage: stage.id,
    tasks: [{ task: task.id, input: task.input, edits: "submissions/revision-edits.yaml" }] }));
  const result = await completeProductionSubmission({ projectRoot: root, stage: stage.id, path: "submissions/revision-submit.yaml" });
  expect(result.failed).toEqual([]);
  expect(result.accepted).toHaveLength(1);
}

async function partlyApproved() {
  const root = await prepareRevisionKnowledge(roots);
  await revise(root, "architecture/overview.md", "overview", "# Overview\nThe public entry point exports answer.\n\n[Related API](usage.md)\n");
  const candidates = await readCandidateRecords(root);
  const approved = candidates.find(candidate => candidate.path === "architecture/overview.md")!;
  const rejected = candidates.find(candidate => candidate.path === "architecture/usage.md")!;
  await applyReviewDecisions({ projectRoot: root, payload: { collection: approved.collection,
    scope: { kind: "collection", collection: approved.collection, count: candidates.length,
      ids_sha256: candidateIdsHash(candidates.map(candidate => candidate.candidate_id).sort()), candidates_sha256: candidateSetHash(candidates) },
    decisions: candidates.map(candidate => ({ candidate_id: candidate.candidate_id,
      status: candidate.path === approved.path ? "approved" : "rejected" })) } });
  return { root, approved, rejected };
}

test("repairing an approved page's link preserves the rejected peer's unfinished responsibility", async () => {
  const { root, approved, rejected } = await partlyApproved();
  const before = await readFile(join(root, "knowledge", approved.path), "utf8");
  await expect(closeProjectWorkspace(root)).rejects.toThrow();
  await revise(root, approved.path, "overview", "# Overview\nThe public entry point exports answer without requiring another page.\n");
  expect(await readFile(join(root, "knowledge", approved.path), "utf8")).toBe(before);
  const candidates = await readCandidateRecords(root);
  expect(candidates.find(candidate => candidate.path === rejected.path)?.status).toBe("rejected");
  const repaired = candidates.find(candidate => candidate.path === approved.path)!;
  expect(repaired.article_id).toBe(approved.article_id);
  expect(repaired.body).not.toContain("[Related API]");
  await approveCandidates(root, [repaired]);
  await expect(closeProjectWorkspace(root)).rejects.toThrow();
  await revise(root, rejected.path, "usage", "# Usage\nRead the exported answer from the public entry point.\n");
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildFixturePackages(root);
  expect(await readProductionStage(root)).toBeUndefined();
  expect(await readFile(join(root, "knowledge", approved.path), "utf8")).not.toContain("[Related API]");
}, 60_000);

test("an external edit to a partly approved page becomes the revision base, not the old accepted draft", async () => {
  const { root, approved } = await partlyApproved();
  const path = join(root, "knowledge", approved.path);
  const changed = (await readFile(path, "utf8")).replace("public entry point", "user-corrected public entry point");
  await writeFile(path, changed);
  await beginDocumentRevision({ projectRoot: root, selector: approved.path, instruction: "Keep the correction and remove invalid navigation." });
  const stage = (await readProductionStage(root))!;
  const task = stage.tasks.find(task => task.path === approved.path && task.status === "issued")!;
  const base = join(root, ".tmp/context-runtime/production-stages", stage.id, "batches", task.batch, "tasks", task.id, "base.md");
  expect(await readFile(base, "utf8")).toBe(changed);
  expect(await readFile(path, "utf8")).toBe(changed);
  expect((await readCandidateRecords(root)).some(candidate => candidate.path === approved.path)).toBe(false);
});
