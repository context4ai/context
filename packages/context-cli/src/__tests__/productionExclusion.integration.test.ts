import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionPlanningRequest, submitProductionPlan } from "../project/productionPlanning.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { approveProductionReport, productionReportRevision } from "../project/productionReport.js";
import { dispatchProductionStage, productionCapabilitiesSchema } from "../project/productionStage.js";
import { productionSourceBaseline } from "../project/productionSubmission.js";
import { collectProjectStatus } from "../project/status.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("confirmed exclusion settles unfinished scope, retains accepted work and survives cleanup; revocation reopens investigation", async () => {
  const parent = resolve(".tmp/production-exclusion-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const first = await importManagedDocument(root, { type: "note", name: "20260913/current.md", markdown: "# Current\nCurrent decision.\n" });
  const retired = await importManagedDocument(root, { type: "note", name: "20260913/retired.md", markdown: "# Retired\nOld decision.\n" });
  const targets = [first, retired].map(source => ({ source_ref: source.source_ref }));
  const requirement = { id: "decisions", purpose: "Explain the requested decisions", target_scope: { targets } };
  const config = join(root, "src/indexers.yaml");
  const original = YAML.stringify({ requirements: [requirement] });
  await writeFile(config, original);
  await produceFixtureArticles(root, [{ path: "decision/current.md", question: "What is the current decision?", sources: [first.source_ref],
    markdown: '---\ntitle: Current decision\ndescription: Current decision\n---\n\n<!-- context:section id="answer" -->\nCurrent decision.\n<!-- /context:section -->\n',
    references: { sections: [{ id: "answer", references: [{ source_ref: first.source_ref,
      locator: { path: "current.md", start_line: 2, end_line: 2 } }] }] } }]);
  const accepted = await readCandidateRecords(root);
  const before = (await readProductionStage(root))!;
  await writeFile(join(root, productionAgentDirectory(before.id), "submissions/amend.yaml"), YAML.stringify({ stage: before.id,
    capabilities: {}, articles: [{ path: "decision/retired.md", question: "Explain the retired decision", sources: [retired.source_ref], batch: "retired" }] }));
  await submitProductionPlan({ projectRoot: root, stage: before.id, path: "submissions/amend.yaml" });
  const oldTask = (await readProductionStage(root))!.tasks.at(-1)!;
  expect(oldTask.status).toBe("issued");
  // This models the existing Agent edit after explicit user scope feedback,
  // not an automatically approved exclusion inferred from a failed read.
  const excluded = YAML.stringify({ requirements: [{ ...requirement, exclusions: [{
    scope: { targets: [{ source_ref: retired.source_ref }] }, reason: "User no longer requests retired decisions",
  }] }] });
  await writeFile(config, excluded);
  await prepareCurrentProductionStage({ projectRoot: root, revision: before.id });
  const refreshed = (await readProductionStage(root))!;
  expect(refreshed.scopes.map(source => source.scope)).toEqual([first.source_ref]);
  expect(refreshed.tasks.find(task => task.id === oldTask.id)!.status).toBe("replaced");
  expect(refreshed.tasks[0]).toEqual(before.tasks[0]);
  expect(await readCandidateRecords(root)).toEqual(accepted);
  expect(refreshed.report_approved).toBe(false);
  const directory = join(root, productionAgentDirectory(refreshed.id), "submissions");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "plan.yaml"), YAML.stringify({ stage: refreshed.id, capabilities: {}, articles: [] }));
  await submitProductionPlan({ projectRoot: root, stage: refreshed.id, path: "submissions/plan.yaml" });
  const planned = (await readProductionStage(root))!;
  await writeFile(join(directory, "report.yaml"), YAML.stringify({ stage: planned.id, decision: "approved" }));
  await approveProductionReport({ projectRoot: root, stage: planned.id, revision: productionReportRevision(planned), path: "submissions/report.yaml" });
  expect(dispatchProductionStage((await readProductionStage(root))!, productionCapabilitiesSchema.parse({})).state).toBe("ended");
  expect(await readCandidateRecords(root)).toEqual(accepted);
  await rm(join(root, ".tmp"), { recursive: true, force: true });
  await prepareCurrentProductionStage({ projectRoot: root, revision: (await productionPlanningRequest(root))!.revision });
  const fresh = (await readProductionStage(root))!;
  expect(fresh.scopes.map(source => source.scope)).toEqual([first.source_ref]);
  expect(fresh.tasks).toEqual([]);
  expect(await readFile(config, "utf8")).toBe(excluded);
  await writeFile(config, original);
  await prepareCurrentProductionStage({ projectRoot: root, revision: fresh.id });
  const revoked = (await readProductionStage(root))!;
  expect(revoked.pending_scopes).toEqual(targets.map(target => target.source_ref));
  expect(revoked.gaps).toEqual([]);
  expect(revoked.report_approved).toBe(false);
  expect(await readFile(join(root, "sources/note/20260913/retired.md"), "utf8")).toContain("Old decision.");
});

test("content exclusion survives temporary cleanup but changed material reopens planning without rewriting the decision", async () => {
  const parent = resolve(".tmp/production-exclusion-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "content-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const note = await importManagedDocument(root, { type: "note", name: "20260913/decision.md", markdown: "# Decision\nDuplicate observation.\n" });
  const scope = { targets: [{ source_ref: note.source_ref }] };
  const stored = YAML.stringify({ requirements: [{ id: "decisions", purpose: "Explain independent decisions", target_scope: scope,
    exclusions: [{ scope, reason: "This snapshot duplicates an existing decision",
      source_baselines: { [note.source_ref]: await productionSourceBaseline(root, note.source_ref) } }] }] });
  const path = join(root, "src/indexers.yaml");
  await writeFile(path, stored);
  await prepareCurrentProductionStage({ projectRoot: root, revision: (await productionPlanningRequest(root))!.revision });
  expect((await readProductionStage(root))!.scopes).toEqual([]);
  const excludedStage = (await readProductionStage(root))!;
  const submissions = join(root, productionAgentDirectory(excludedStage.id), "submissions");
  await mkdir(submissions, { recursive: true });
  await writeFile(join(submissions, "plan.yaml"), YAML.stringify({ stage: excludedStage.id, capabilities: {}, articles: [] }));
  await submitProductionPlan({ projectRoot: root, stage: excludedStage.id, path: "submissions/plan.yaml" });
  const plan = (await readProductionStage(root))!;
  await writeFile(join(submissions, "report.yaml"), YAML.stringify({ stage: plan.id, decision: "approved" }));
  await approveProductionReport({ projectRoot: root, stage: plan.id, revision: productionReportRevision(plan), path: "submissions/report.yaml" });
  expect(dispatchProductionStage((await readProductionStage(root))!, productionCapabilitiesSchema.parse({})).state).toBe("ended");
  expect((await collectProjectStatus(root)).workflow.current?.node).not.toBe("run-indexer-lifecycle");
  expect(await readCandidateRecords(root)).toEqual([]);
  await rm(join(root, ".tmp"), { recursive: true, force: true });
  await prepareCurrentProductionStage({ projectRoot: root, revision: (await productionPlanningRequest(root))!.revision });
  const fresh = (await readProductionStage(root))!;
  expect(fresh.scopes).toEqual([]);
  await importManagedDocument(root, { type: "note", name: "20260913/decision.md", base_digest: note.digest,
    markdown: "# Decision\nNew independent decision.\n" });
  const changed = (await productionPlanningRequest(root))!;
  expect(changed.reassess).toEqual([note.source_ref]);
  await prepareCurrentProductionStage({ projectRoot: root, revision: fresh.id });
  const reopened = (await readProductionStage(root))!;
  expect(reopened.pending_scopes).toEqual([note.source_ref]);
  expect(reopened.gaps).toEqual([]);
  expect(reopened.report_approved).toBe(false);
  expect(await readFile(path, "utf8")).toBe(stored);
  expect(await readCandidateRecords(root)).toEqual([]);
});
