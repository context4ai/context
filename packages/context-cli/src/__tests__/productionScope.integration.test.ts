import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { prepareKnownProductionTasks } from "../project/productionKnownTasks.js";
import { productionPlanningRequest, productionRequirementsAreCurrent, submitProductionPlan } from "../project/productionPlanning.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { refreshProductionStageSources } from "../project/productionStageRefresh.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { approveProductionReport, productionReportRevision } from "../project/productionReport.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readProductionReviewCandidates } from "../project/productionReviewCandidates.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { closeProjectWorkspace } from "../project/close.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(missing = true) {
  const parent = resolve(".tmp/scoped-production-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const note = await importManagedDocument(root, { type: "note", name: "20260924/new.md", markdown: "# New\nKeep interaction simple.\n" });
  const reference = await importManagedDocument(root, { type: "note", name: "20260924/reference.md", markdown: "# Reference\nKeep the existing context.\n" });
  const old = await importManagedDocument(root, { type: "note", name: "20260924/old.md", markdown: "# Old\nOld independent work.\n" });
  const requirements = { requirements: [{ id: "guide", purpose: "Explain interaction",
    target_scope: { targets: [{ source_ref: note.source_ref }, { source_ref: old.source_ref }] },
    evidence_source_scope: { targets: [{ source_ref: reference.source_ref }] } }] };
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify(requirements));
  if (missing) for (const name of ["old", "reference"]) await rename(join(root, `sources/note/20260924/${name}.md`), join(outer, `${name}.md`));
  const path = ".tmp/agent-work/known.yaml";
  await mkdir(join(root, ".tmp/agent-work"), { recursive: true });
  const plan = { capabilities: { skills: [] }, articles: [{ path: "sop/new.md", question: "How should interaction work?", sources: [note.source_ref], batch: "notes" }] };
  await writeFile(join(root, path), YAML.stringify(plan));
  return { root, outer, note, reference, old, requirements, path, plan };
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
  await prepareKnownProductionTasks({ projectRoot: f.root, cwd: f.root, revision: (await productionPlanningRequest(f.root))!.revision, path: f.path });
  return (await readProductionStage(f.root))!;
}

test("a bounded note ignores unavailable historical targets and references through review and close", async () => {
  const f = await fixture();
  await produceFixtureArticles(f.root, [{ ...f.plan.articles[0]!, markdown: "---\ntitle: Simple interaction\ndescription: A design principle\n---\n\n<!-- context:section id=\"principle\" -->\nKeep interaction simple.\n<!-- /context:section -->\n",
    references: { sections: [{ id: "principle", references: [{ source_ref: f.note.source_ref, locator: { path: "new.md", start_line: 2, end_line: 2 } }] }] } }]);
  const stage = (await readProductionStage(f.root))!;
  expect(stage.scopes.map(source => source.scope)).toEqual([f.note.source_ref]);
  expect(stage.pending_scopes).toEqual([]);
  expect(stage.gaps).toEqual([]);
  expect((await readProductionReviewCandidates(f.root))!.candidates).toHaveLength(1);
  await approveCandidates(f.root, await readCandidateRecords(f.root));
  expect((await closeProjectWorkspace(f.root)).verifyErrors).toBe(0);
}, 30_000);

test("investigation must select current work instead of defaulting to all configured targets", async () => {
  const f = await fixture();
  const revision = (await productionPlanningRequest(f.root))!.revision;
  await expect(prepareCurrentProductionStage({ projectRoot: f.root, revision })).rejects.toMatchObject({ detail: { reason_code: "production-scope-required" } });
  expect(await readProductionStage(f.root)).toBeUndefined();
  await prepareCurrentProductionStage({ projectRoot: f.root, revision, sources: [f.note.source_ref] });
  expect((await readProductionStage(f.root))!.pending_scopes).toEqual([f.note.source_ref]);
});

test("an unused reference remains adoptable by a later article and its real dependency is enforced", async () => {
  const f = await fixture(false);
  const stage = await prepare(f);
  const agent = join(f.root, productionAgentDirectory(stage.id), "submissions");
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "report.yaml"), YAML.stringify({ stage: stage.id, decision: "approved" }));
  await approveProductionReport({ projectRoot: f.root, stage: stage.id, revision: productionReportRevision(stage), path: "submissions/report.yaml" });
  const plan = { ...f.plan, stage: stage.id, articles: [{ ...f.plan.articles[0]!, path: "sop/reference.md", sources: [f.reference.source_ref], batch: "later" }] };
  await writeFile(join(agent, "later.yaml"), YAML.stringify(plan));
  await submitProductionPlan({ projectRoot: f.root, stage: stage.id, path: "submissions/later.yaml" });
  const expanded = (await readProductionStage(f.root))!;
  expect(expanded.tasks).toHaveLength(2);
  expect(expanded.scopes.map(source => source.scope)).toEqual([f.note.source_ref, f.reference.source_ref]);
  expect(expanded.pending_scopes).toEqual([]);
  expect(await productionRequirementsAreCurrent(f.root, expanded)).toBe(true);
  await rename(join(f.root, "sources/note/20260924/reference.md"), join(f.outer, "held.md"));
  const refreshed = await refreshProductionStageSources(f.root, expanded);
  expect(refreshed.tasks.find(task => task.path === "sop/reference.md")!.status).toBe("blocked");
  expect(refreshed.tasks.find(task => task.path === "sop/new.md")!.status).toBe("issued");
  expect(refreshed.gaps.map(gap => gap.scope)).toEqual([f.reference.source_ref]);
});

test("unrelated configuration and unavailable references neither invalidate nor refresh current work", async () => {
  const f = await fixture(false);
  const stage = await prepare(f);
  f.requirements.requirements[0]!.evidence_source_scope.targets.push({ source_ref: "repo:later-authorized" });
  await writeFile(join(f.root, "src/indexers.yaml"), YAML.stringify(f.requirements));
  expect(await productionRequirementsAreCurrent(f.root, stage)).toBe(true);
  await rename(join(f.root, "sources/note/20260924/reference.md"), join(f.outer, "held.md"));
  expect(await refreshProductionStageSources(f.root, stage)).toEqual(stage);
});

test("required missing references and explicit remaining investigation are not silently discarded", async () => {
  const f = await fixture();
  f.plan.articles[0]!.sources.push(f.reference.source_ref);
  await writeFile(join(f.root, f.path), YAML.stringify(f.plan));
  await expect(prepare(f)).rejects.toThrow();
  const stage = (await readProductionStage(f.root))!;
  expect(stage.gaps.map(gap => gap.scope)).toEqual([f.reference.source_ref]);
  expect(stage.tasks).toEqual([]);
  expect(stage.scopes.some(source => source.scope === f.old.source_ref)).toBe(false);
});


test("later work can reuse a completed task's source at its new version without a refresh loop", async () => {
  const f = await fixture(false);
  await produceFixtureArticles(f.root, [{ ...f.plan.articles[0]!, markdown: '---\ntitle: Original rule\ndescription: First delivery\n---\n\n<!-- context:section id="rule" -->\nKeep interaction simple.\n<!-- /context:section -->\n',
    references: { sections: [{ id: "rule", references: [{ source_ref: f.note.source_ref, locator: { path: "new.md", start_line: 2, end_line: 2 } }] }] } }]);
  const stage = (await readProductionStage(f.root))!;
  const accepted = stage.tasks[0]!;
  await importManagedDocument(f.root, { type: "note", name: "20260924/new.md", base_digest: f.note.digest,
    markdown: "# New\nKeep interaction simple and preserve context.\n" });
  const path = join(productionAgentDirectory(stage.id), "submissions/later.yaml");
  await writeFile(join(f.root, path), YAML.stringify({ ...f.plan, stage: stage.id,
    articles: [{ ...f.plan.articles[0]!, path: "sop/later.md" }] }));
  await submitProductionPlan({ projectRoot: f.root, stage: stage.id, path: "submissions/later.yaml" });
  const next = (await readProductionStage(f.root))!;
  expect(next.tasks[0]).toEqual(accepted);
  expect(next.tasks[1]!.sources[0]!.baseline).not.toBe(accepted.sources[0]!.baseline);
  expect(next.tasks[1]!.status).toBe("issued");
  expect(next.pending_scopes).toEqual([]);
});
