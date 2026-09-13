import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { collectProjectStatus } from "../project/status.js";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { beginKnowledgeUpdate, completeKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { readApprovedRevision } from "../project/approvedRevision.js";
import { readProductionStage, productionStageDirectory } from "../project/productionStageStore.js";
import { readSourceStatus } from "../project/statusReaders.js";
import { resumeWorkspaceTask } from "../project/taskResumption.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function workspace() {
  const parent = resolve(".tmp/saved-source-production-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const { projectRoot: root } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await writeFile(join(root, "src/index.ts"), `import { defineProject, kbPackage } from "@c4a/context";
export default defineProject({ sources: [], phases: [], packages: [
  kbPackage({ name: "service-kb", template: { path: "src/package-templates/kb", vars: {} } })
] });\n`);
  return root;
}
function readerArticle(source: string, path = "architecture/service.md") {
  return { path, question: "What is the service boundary?", sources: [source],
    markdown: '---\ntitle: Service boundary\ndescription: Explain the independent service.\n---\n\n<!-- context:section id="boundary" -->\nThe service remains independent.\n<!-- /context:section -->\n',
    references: { sections: [{ id: "boundary", references: [{ source_ref: source,
      locator: { path: "decision.md", start_line: 2, end_line: 2 } }] }] } };
}
async function deliver(root: string) {
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildProjectPackages(root);
}
async function initialKnowledge() {
  const root = await workspace();
  const saved = await importManagedDocument(root, { type: "note", name: "20260913/decision.md",
    markdown: "# Decision\nThe service remains independent.\n" });
  const requirement = { id: "service", purpose: "Explain the service boundary",
    target_scope: { targets: [{ source_ref: saved.source_ref }] } };
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ requirements: [requirement] }));
  await produceFixtureArticles(root, [readerArticle(saved.source_ref)]);
  await deliver(root);
  expect(await readProductionStage(root)).toBeUndefined();
  return { root, requirement, source: saved.source_ref };
}

test("a selected saved source without reader requirements asks for scope and purpose, not a skill owner", async () => {
  const root = await workspace();
  await importManagedDocument(root, { type: "sessions", name: "20260913/discussion.md",
    markdown: "# Discussion\nOnly registered services appear in the picker." });
  await writeFile(join(root, "src/index.ts"), `import { defineProject, source } from "@c4a/context";
export default defineProject({ sources: [source("20260913/discussion.md", { type: "sessions" })], phases: [], packages: [] });\n`);
  const result = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
  expect(result.workflow.current?.node).toBe("configure-production-requirements");
  expect(result.workflow.current?.configuration?.file).toBe("src/indexers.yaml");
  expect(await readProductionStage(root)).toBeUndefined();
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
});

test("new session writing reuses formal topic navigation and preserves existing articles", async () => {
  const { root, requirement } = await initialKnowledge();
  const formalPath = join(root, "knowledge/architecture/service.md");
  const before = await readFile(formalPath, "utf8");
  const archive = await importManagedDocument(root, { type: "sessions", name: "20260913/archive.md",
    markdown: "# Archive\nSaved for later reference only." });
  const saved = await importManagedDocument(root, { type: "sessions", name: "20260913/picker.md",
    markdown: "# Picker\nOnly registered services appear in the picker.\n" });
  expect((await readSourceStatus(root)).documentSources.map(source => `${source.type}:${source.name}`))
    .not.toContain(saved.source_ref);
  await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
  expect(await readProductionStage(root)).toBeUndefined();
  const requirements = YAML.stringify({ requirements: [requirement, { id: "picker", purpose: "Explain picker availability",
    target_scope: { targets: [{ source_ref: saved.source_ref }] } }] });
  await writeFile(join(root, "src/indexers.yaml"), requirements);
  await resumeWorkspaceTask(root);
  expect((await collectProjectStatus(root)).workflow.current?.node).toBe("prepare-production-planning");
  await produceFixtureArticles(root, [{ path: "architecture/picker.md", question: "Which services appear in the picker?",
    sources: [saved.source_ref],
    markdown: '---\ntitle: Service picker\ndescription: Explain the service selection boundary.\n---\n\n<!-- context:section id="picker" -->\nOnly registered services appear in the picker.\n<!-- /context:section -->\n',
    references: { sections: [{ id: "picker", references: [{ source_ref: saved.source_ref,
      locator: { path: "picker.md", start_line: 2, end_line: 2 } }] }] } }]);
  const stage = (await readProductionStage(root))!;
  expect(stage.scopes.map(scope => scope.scope)).not.toContain(archive.source_ref);
  const topics = await readFile(join(root, productionStageDirectory(stage.id), "guidance/existing-articles-1.md"), "utf8");
  expect(topics).toContain("Service boundary");
  expect(topics).toContain("knowledge/architecture/service.md");
  expect(stage.tasks.map(task => task.path)).toEqual(["architecture/picker.md"]);
  expect(await readKnowledgeUpdate(root)).toBeUndefined();
  await deliver(root);
  expect(await readFile(formalPath, "utf8")).toBe(before);
  expect(await readFile(join(root, "knowledge/architecture/picker.md"), "utf8")).toContain("Only registered services");
  const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  expect(structure.articles.map((article: { path: string }) => article.path).sort())
    .toEqual(["architecture/picker.md", "architecture/service.md"]);
  expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).toBe(requirements);
  expect(await readProductionStage(root)).toBeUndefined();
}, 60_000);

test("explicit supporting-note update selects existing articles without skill ownership or old ledgers", async () => {
  const { root, requirement, source } = await initialKnowledge();
  const saved = await importManagedDocument(root, { type: "note", name: "20260913/support.md",
    markdown: "# Operations\nThe service owner handles access requests.\n" });
  const requirements = YAML.stringify({ requirements: [{ ...requirement,
    evidence_source_scope: { targets: [{ source_ref: saved.source_ref }] } }] });
  await writeFile(join(root, "src/indexers.yaml"), requirements);
  const retired = join(root, ".tmp/context-runtime/indexer/main-index");
  await mkdir(retired, { recursive: true });
  await writeFile(join(retired, "current.json"), "Invalid retired process state");
  await beginKnowledgeUpdate(root, { scopes: [source, saved.source_ref].map(source_ref => ({
    requirement_ref: requirement.id, source_ref })) });
  const request = (await readKnowledgeUpdate(root))!;
  expect(request.scopes.map(scope => scope.source_ref)).toEqual([source, saved.source_ref]);
  expect(request.candidates.map(candidate => candidate.path)).toEqual(["architecture/service.md"]);
  expect((await collectProjectStatus(root)).workflow.current?.node).toBe("inspect-source-update");
  expect(await readProductionStage(root)).toBeUndefined();
  const result = await completeKnowledgeUpdate({ projectRoot: root, revision: request.revision,
    decisions: [{ path: "architecture/service.md", instruction: "Explain who handles access requests.",
      supporting_sources: [saved.source_ref] }], scope_summary: "Clarify operations for the existing service.",
    new_topics: [] });
  expect(result.outcome).toBe("revisions-prepared");
  const revision = (await readApprovedRevision(root))!;
  expect(revision.program_blocks).toBeUndefined();
  expect(revision.target.source_refs).toEqual(expect.arrayContaining([source, saved.source_ref]));
  expect(await readProductionStage(root)).toBeUndefined();
  expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).toBe(requirements);
}, 60_000);
