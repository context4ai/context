import { afterEach, expect, test } from "bun:test";
import { readFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { maintenanceProductionWorkspace, submitMaintenanceProductionArticle } from "./maintenanceProduction.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { resumeProductionWriting } from "../project/productionDelivery.js";
import { prepareApprovedRevision, completeApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { loadReviewCandidateAuthority } from "../project/reviewCandidateAuthority.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { clearCompletedLifecycle } from "../project/lifecycleCleanup.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("independent revision Review preserves unfinished production without a maintenance queue", async () => {
  const { root, views } = await maintenanceProductionWorkspace(roots);
  await resumeProductionWriting(root);
  const before = await readProductionStage(root);
  await expect(loadReviewCandidateAuthority(root)).rejects.toThrow("Complete the current production stage");
  const path = views[0]!.path;
  await prepareApprovedRevision({ projectRoot: root, selector: path, instruction: "Clarify the exported answer." });
  const revision = (await readApprovedRevision(root))!;
  await expect(clearCompletedLifecycle(root)).rejects.toThrow("Production still has unfinished work");
  expect(await readProductionStage(root)).toEqual(before);
  expect(await readApprovedRevision(root)).toEqual(revision);
  await expect(loadReviewCandidateAuthority(root)).rejects.toThrow("Complete the current article revision");
  await completeApprovedRevision({ projectRoot: root, revision: revision.revision,
    markdown: revision.target.markdown.replace("public entry point", "documented public entry point") });
  const candidates = await readCandidateRecords(root);
  const authority = await loadReviewCandidateAuthority(root);
  expect([...authority.keys()]).toEqual(candidates.map(candidate => candidate.candidate_id));
  await approveCandidates(root, candidates);
  await closeProjectWorkspace(root);
  const entry = join(root, "src/index.ts");
  const savedEntry = join(root, ".tmp/retry-entry.ts");
  await rename(entry, savedEntry);
  try {
    await expect(buildFixturePackages(root)).rejects.toThrow();
    expect(await readProductionStage(root)).toEqual(before);
    expect(await readApprovedRevision(root)).toBeDefined();
  } finally {
    await rename(savedEntry, entry);
  }
  await buildFixturePackages(root);
  expect(await readFile(join(root, "knowledge", path), "utf8")).toContain("documented public entry point");
  expect(await readProductionStage(root)).toEqual(before);
  expect(await readApprovedRevision(root)).toBeUndefined();
  const pending = before!.tasks.find(task => task.status === "issued")!;
  await submitMaintenanceProductionArticle(root, pending.path);
  expect((await readProductionStage(root))!.tasks.find(task => task.id === pending.id)?.status).toBe("accepted");
}, 60_000);

test("unchanged independent revision resumes production without cleanup or duplicate candidates", async () => {
  const { root, views } = await maintenanceProductionWorkspace(roots);
  await resumeProductionWriting(root);
  const before = await readProductionStage(root);
  await prepareApprovedRevision({ projectRoot: root, selector: views[0]!.path, instruction: "Check whether this explanation needs changes." });
  const revision = (await readApprovedRevision(root))!;
  await completeApprovedRevision({ projectRoot: root, revision: revision.revision, markdown: revision.target.markdown });
  expect(await readApprovedRevision(root)).toBeUndefined();
  expect(await readProductionStage(root)).toEqual(before);
  expect(await readCandidateRecords(root)).toEqual([]);
  await submitMaintenanceProductionArticle(root, before!.tasks.find(task => task.status === "issued")!.path);
}, 60_000);
