import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { beginKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { readApprovedRevision, reopenApprovedRevision, type ApprovedRevision } from "../project/approvedRevision.js";
import { collectProjectStatus } from "../project/status.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const scope = { requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] };

async function complete(root: string, value: unknown) {
  const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
  return completeCurrentIndexerAction({ cwd: root, revision: route.revision, managed: true, value });
}

async function initialKnowledge() {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
    join(root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(root, "src/index.ts");
  const entry = await readFile(entryPath, "utf8");
  await writeFile(entryPath, entry.replace("defineProject, source", "defineProject, kbPackage, source")
    .replace("packages: []", 'packages: [kbPackage({ name: "revision-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
  await completePartitionStage(root);
  const structure = (await currentIndexerStructureReview(root))!;
  await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
    value: { stage: "structure-review", decision: "approved" } });
  await completeAuthorStage(root);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildProjectPackages(root);
  return root;
}

async function reviewedCurrentPage() {
  const root = await initialKnowledge();
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const update = (await readKnowledgeUpdate(root))!;
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path, instruction: "Clarify this explanation." })),
    scope_summary: "Both related pages need clarification.", new_topics: [] });
  for (let index = 0; index < 2; index++) {
    const request = (await readApprovedRevision(root))!;
    await complete(root, { stage: "approved-revision", markdown: request.target.markdown.replace("public entry point", "updated public entry point") });
  }
  const request = (await readApprovedRevision(root))!;
  const candidates = await readCandidateRecords(root);
  const current = candidates.find((item) => item.path === request.target.path)!;
  await applyReviewDecisions({ projectRoot: root, payload: { collection: current.collection,
    scope: { kind: "collection", collection: current.collection, count: candidates.length,
      ids_sha256: candidateIdsHash(candidates.map((item) => item.candidate_id).sort()), candidates_sha256: candidateSetHash(candidates) },
    decisions: [{ candidate_id: current.candidate_id, status: "approved" }] } });
  expect(await readCandidateRecords(root)).toHaveLength(1);
  return { root, request };
}

async function changeSource(root: string) {
  const source = join(root, "fixture-source");
  await writeFile(join(source, "src/index.ts"), "export const answer = 43;\n");
  execFileSync("git", ["add", "src/index.ts"], { cwd: source });
  execFileSync("git", ["commit", "-qm", "update answer"], { cwd: source });
  const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const path = join(root, "sources/repo/index.yaml");
  const registry = YAML.parse(await readFile(path, "utf8"));
  registry.sources[0].modules[0].git.ref = version;
  await writeFile(path, YAML.stringify(registry));
  return version;
}

test("adjusting a partially reviewed batch resumes from its already approved current page", async () => {
  const { root, request } = await reviewedCurrentPage();
  const approved = await readFile(join(root, "knowledge", request.target.path), "utf8");
  const adjustment = { scopes: [{ source_ref: scope.source_ref }], instruction: "Recheck both explanations against the new source version." };
  await adjustCurrentTaskSources(root, adjustment);
  const version = await changeSource(root);
  await adjustCurrentTaskSources(root, { ...adjustment, refresh: true });
  for (const managed of [false, true]) {
    const route = (await collectProjectStatus(root, { managed })).workflow.current!;
    const input = route.action?.input as { stage: string; target: ApprovedRevision["target"] };
    expect(input.stage).toBe("approved-revision");
    expect(input.target.markdown).toContain("updated public entry point");
  }
  expect(await readFile(join(root, "knowledge", request.target.path), "utf8")).toBe(approved);
  const refreshed = (await readApprovedRevision(root))!;
  expect(refreshed.target.base_digest).not.toBe(request.target.base_digest);
  expect(refreshed.pending_targets).toHaveLength(1);
  for (let index = 0; index < 2; index++) {
    const current = (await readApprovedRevision(root))!;
    await complete(root, { stage: "approved-revision", markdown: current.target.markdown + "\nChecked against the updated source.\n" });
  }
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(await readApprovedRevision(root)).toBeUndefined();
  expect(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")).processed_scopes[0].processed_version).toBe(version);
}, 45_000);

test("source adjustment does not adopt external edits as the accepted revision base", async () => {
  const { root, request } = await reviewedCurrentPage();
  const page = join(root, "knowledge", request.target.path);
  const original = await readFile(page, "utf8");
  await writeFile(page, original + "\nAn external change outside this review.\n");
  const adjustment = { scopes: [{ source_ref: scope.source_ref }], instruction: "Use the new source." };
  await adjustCurrentTaskSources(root, adjustment);
  await changeSource(root);
  await expect(adjustCurrentTaskSources(root, { ...adjustment, refresh: true })).rejects.toThrow("Approved page changed");
  expect(await readFile(page, "utf8")).toBe(original + "\nAn external change outside this review.\n");
}, 45_000);

test("revising the already approved current page keeps its unfinished batch peer", async () => {
  const { root, request } = await reviewedCurrentPage();
  const pending = await readCandidateRecords(root);
  await reopenApprovedRevision({ projectRoot: root, selector: request.target.path, instruction: "Add the newly confirmed detail." });
  const reopened = (await readApprovedRevision(root))!;
  expect(reopened.target.base_digest).not.toBe(request.target.base_digest);
  expect(reopened.target.markdown).toContain("updated public entry point");
  expect(await readCandidateRecords(root)).toEqual(pending);
  await complete(root, { stage: "approved-revision", markdown: reopened.target.markdown + "\nNewly confirmed detail.\n" });
  expect(await readCandidateRecords(root)).toHaveLength(2);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root); await buildProjectPackages(root);
  expect(await readApprovedRevision(root)).toBeUndefined();
}, 45_000);

test.each([{ modules: ["module:public-entry"] }, { modules: [] as string[] }])("a confirmed module scope adjustment replaces the obsolete update boundary (%j)", async ({ modules }) => {
  const root = await initialKnowledge();
  await beginKnowledgeUpdate(root, { scopes: [scope] });
  const path = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(path, "utf8"));
  for (const boundary of ["target_scope", "evidence_source_scope"]) {
    registry.requirements[0][boundary].targets[0].module_refs = modules;
  }
  await writeFile(path, YAML.stringify(registry));
  const adjustment = { scopes: [{ ...scope, module_refs: modules }],
    instruction: "Use the explicitly corrected module identity for this same source." };
  await adjustCurrentTaskSources(root, adjustment);
  await adjustCurrentTaskSources(root, { ...adjustment, refresh: true });
  const update = (await readKnowledgeUpdate(root))!;
  expect(update.scopes[0]?.module_refs).toEqual(modules.length ? [...modules] : undefined);
  await complete(root, { stage: "source-update", decisions: update.candidates.map(({ path }) => ({ path })),
    scope_summary: "The module identity changed; its approved explanations remain correct.", new_topics: [] });
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
  expect(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")).processed_scopes[0].module_refs)
    .toEqual(modules.length ? [...modules] : undefined);
}, 45_000);
