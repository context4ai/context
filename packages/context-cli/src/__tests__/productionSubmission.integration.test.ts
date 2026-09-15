import { afterEach, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { execFileSync, spawnSync } from "node:child_process";
import { completeProductionSubmission, productionSourceBaseline } from "../project/productionSubmission.js";
import { productionTaskInput, validateProductionStage } from "../project/productionStage.js";
import { materializeProductionStage, productionStageDirectory, readProductionStage, saveProductionStage } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { CANDIDATE_LEDGER_FILE, readCandidateRecords } from "../project/candidateLedger.js";
import { initContextProject } from "../project/workspace.js";
import { productionArticleTargetDigest } from "../project/productionArticleTarget.js";
import { createArticleSourceReference } from "@c4a/context";
import { durableContentDigest } from "../project/durableSingleFileTransaction.js";
import { approveProductionReport, productionReportRevision } from "../project/productionReport.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { submitProductionPlan } from "../project/productionPlanning.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { readProductionReviewCandidates } from "../project/productionReviewCandidates.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { productionWorkflowRoute } from "../project/productionWorkflowRoute.js";
import { clearCompletedLifecycle } from "../project/lifecycleCleanup.js";
import { readTaskPreparation, resumeWorkspaceTask } from "../project/taskResumption.js";
import { collectProjectStatus } from "../project/status.js";
import { productionDeliverableArticles } from "../project/productionDeliveryScope.js";
import { requestProductionDelivery, resumeProductionWriting } from "../project/productionDelivery.js";
import { registerKnowledgeMaintenance, observeKnowledgeMaintenance, maintenanceRevision,
  advanceKnowledgeMaintenance, cancelKnowledgeMaintenance } from "../project/knowledgeMaintenance.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(initialize = false) {
  const parent = resolve(".tmp/production-submission-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-"));
  roots.push(outer);
  const root = initialize ? (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot : outer;
  await mkdir(join(root, "sources/note/20260913"), { recursive: true });
  for (const id of ["a", "b"]) await writeFile(join(root, `sources/note/20260913/${id}.md`), `# ${id}\nThe ${id} behavior.\n`);
  const scopes = await Promise.all(["a", "b"].map(async id => {
    const scope = `note:20260913/${id}.md`;
    return { scope, baseline: await productionSourceBaseline(root, scope) };
  }));
  const tasks = ["one", "two"].map(id => {
    const task = { id, article_id: `article:${id}`, path: `architecture/${id}.md`, question: `Explain ${id}`,
      sources: scopes, base: null, batch: id, after: [], status: "issued" as const };
    return { ...task, input: productionTaskInput(task) };
  });
  const stage = validateProductionStage({ id: "writing-01", purpose: "Combine source knowledge", scopes,
    tasks, pending_scopes: [], report_approved: true });
  await saveProductionStage(root, stage);
  const requirements = YAML.stringify({ requirements: [{ id: "behavior", purpose: stage.purpose,
    target_scope: { targets: scopes.map(source => ({ source_ref: source.scope })) }, exclusions: [] }] });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/indexers.yaml"), requirements);
  await mkdir(join(root, productionStageDirectory(stage.id), "shared"), { recursive: true });
  await writeFile(join(root, productionStageDirectory(stage.id), "shared/requirements.md"), requirements);
  const directory = join(root, productionAgentDirectory(stage.id));
  await mkdir(join(directory, "submissions"), { recursive: true });
  for (const task of tasks) {
    await mkdir(join(directory, task.id), { recursive: true });
    await writeFile(join(directory, task.id, "article.md"), `---\ntitle: ${task.id}\ndescription: Source-grounded explanation\n---\n\n# ${task.id}\n\n<!-- context:section id="behavior" -->\nCombined behavior.\n<!-- /context:section -->\n`);
    await writeFile(join(directory, task.id, "references.yaml"), YAML.stringify({ sections: [{ id: "behavior",
      references: scopes.map((source, index) => ({ source_ref: source.scope,
        locator: { path: `${index === 0 ? "a" : "b"}.md`, start_line: 2, end_line: 2 } })) }] }));
  }
  const manifest = { stage: stage.id, tasks: tasks.map(task => ({ task: task.id, input: task.input,
    content: `${task.id}/article.md`, references: `${task.id}/references.yaml` })) };
  const path = "submissions/ready.yaml";
  await writeFile(join(directory, path), YAML.stringify(manifest));
  return { root, stage, directory, manifest, input: { projectRoot: root, stage: stage.id, path } };
}

test.each([
  ["architecture/Entry.md", "architecture/entry.md"],
  ["architecture/café.md", "architecture/CAFE\u0301.md"],
])("case and Unicode path aliases cannot accept two different articles: %s / %s", async (first, second) => {
  const f = await fixture();
  for (const [index, path] of [first, second].entries()) {
    const task = f.stage.tasks[index]!;
    task.path = path;
    task.input = productionTaskInput(task);
    f.manifest.tasks[index]!.input = task.input;
  }
  await saveProductionStage(f.root, f.stage);
  await writeFile(join(f.directory, f.input.path), YAML.stringify(f.manifest));
  const result = await completeProductionSubmission(f.input);
  expect(result.accepted.map(item => item.task)).toEqual(["one"]);
  expect(result.failed.map(item => item.task)).toEqual(["two"]);
  expect((await readCandidateRecords(f.root)).map(candidate => candidate.path)).toEqual([first]);
  expect((await readProductionStage(f.root))!.tasks[1]!.status).not.toBe("accepted");
});

test("accepts cross-source cross-batch subset, repairs only failures and replays original receipts", async () => {
  const f = await fixture();
  const secondRefPath = join(f.directory, "two/references.yaml");
  const correct = await readFile(secondRefPath, "utf8");
  await writeFile(secondRefPath, correct.replaceAll("end_line: 2", "end_line: 99"));
  const first = await completeProductionSubmission(f.input);
  expect(first.failed).toMatchObject([{ task: "two", section: "behavior", file: "two/references.yaml" }]);
  expect(first.accepted.map(item => item.task)).toEqual(["one"]);
  expect((await readCandidateRecords(f.root))[0]!.source_refs).toHaveLength(2);
  const before = (await readProductionStage(f.root))!;
  expect(before.tasks[1]!.input).toBe(f.stage.tasks[1]!.input);
  await writeFile(secondRefPath, correct);
  const repaired = await completeProductionSubmission(f.input);
  expect(repaired.failed).toEqual([]);
  expect(repaired.accepted[0]).toEqual(first.accepted[0]);
  expect(repaired.stage_state).toBe("ended");
  expect(await readCandidateRecords(f.root)).toHaveLength(2);
  const ledger = await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8");
  expect((await completeProductionSubmission(f.input)).accepted).toEqual(repaired.accepted);
  expect(await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8")).toBe(ledger);
});

test("partial delivery selection requires formal approval and complete local reader links", async () => {
  const f = await fixture(true);
  await completeProductionSubmission(f.input);
  expect(await productionDeliverableArticles(f.root)).toEqual([]);
  const candidates = await readCandidateRecords(f.root);
  const ids = candidates.map(candidate => candidate.candidate_id).sort();
  const first = candidates.find(candidate => candidate.article_id === "article:one")!;
  await applyReviewDecisions({ projectRoot: f.root, payload: {
    scope: { kind: "all", count: ids.length, visible_candidate_ids: ids,
      ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
    decisions: [{ candidate_id: first.candidate_id, status: "approved" }],
  } });
  const selected = [{ path: "architecture/one.md", article_id: "article:one" }];
  expect(await productionDeliverableArticles(f.root)).toEqual(selected);
  const path = join(f.root, "knowledge/architecture/one.md");
  const original = await readFile(path, "utf8");
  const stage = await readProductionStage(f.root);
  const pending = await readCandidateRecords(f.root);
  await writeFile(path, original + "\n[Related behavior](two.md)\n");
  await expect(productionDeliverableArticles(f.root)).rejects.toThrow("linked approved article");
  expect(await requestProductionDelivery(f.root)).toBe(true);
  expect((await readProductionStage(f.root))!.delivery).toEqual(["one", "two"]);
  await expect(productionDeliverableArticles(f.root)).rejects.toThrow("linked approved article");
  await resumeProductionWriting(f.root);
  await writeFile(path, original + "\n[Missing guide](missing.md)\n");
  await expect(productionDeliverableArticles(f.root)).rejects.toThrow("linked approved article");
  await writeFile(path, original);
  expect(await productionDeliverableArticles(f.root)).toEqual(selected);
  expect(await readProductionStage(f.root)).toEqual(stage);
  expect(await readCandidateRecords(f.root)).toEqual(pending);
  await writeFile(path, original + "\n[Related behavior](two.md)\n");
  await saveProductionStage(f.root, { ...stage!, pending_scopes: [stage!.scopes[0]!.scope] });
  expect(await requestProductionDelivery(f.root)).toBe(true);
  const remainingIds = pending.map(candidate => candidate.candidate_id).sort();
  await applyReviewDecisions({ projectRoot: f.root, payload: {
    scope: { kind: "all", count: remainingIds.length, visible_candidate_ids: remainingIds,
      ids_sha256: candidateIdsHash(remainingIds), candidates_sha256: candidateSetHash(pending) },
    decisions: pending.map(candidate => ({ candidate_id: candidate.candidate_id, status: "approved" })),
  } });
  expect(await productionDeliverableArticles(f.root)).toHaveLength(2);
  expect((await readProductionStage(f.root))!.pending_scopes).toEqual([stage!.scopes[0]!.scope]);
});

test("partial delivery pauses writes, retains failed builds and resumes unchanged unfinished tasks", async () => {
  const f = await fixture(true);
  execFileSync("git", ["init", "--quiet"], { cwd: f.root });
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[0]] }));
  await completeProductionSubmission(f.input);
  const before = (await readProductionStage(f.root))!;
  const command = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"),
    "run", ...args, "--format", "json"], { cwd: f.root, encoding: "utf8",
    env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, timeout: 20_000 }));
  command("--deliver", "--dry-run");
  expect(await readProductionStage(f.root)).toEqual(before);
  expect(command("--deliver").workflow.current.node).toBe("review-current-batch");
  const paused = (await readProductionStage(f.root))!;
  expect(paused.delivery).toEqual(["one"]);
  expect(paused.tasks).toEqual(before.tasks);
  expect(command("--deliver").workflow.current.node).toBe("review-current-batch");
  expect(await readProductionStage(f.root)).toEqual(paused);
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[1]] }));
  await expect(completeProductionSubmission(f.input)).rejects.toThrow("paused for delivery");
  await expect(clearCompletedLifecycle(f.root)).rejects.toThrow("retain the production stage");
  const candidates = await readCandidateRecords(f.root);
  const ids = candidates.map(candidate => candidate.candidate_id).sort();
  await applyReviewDecisions({ projectRoot: f.root, payload: { scope: { kind: "all", count: ids.length,
    visible_candidate_ids: ids, ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
    decisions: ids.map(candidate_id => ({ candidate_id, status: "approved" })) } });
  await closeProjectWorkspace(f.root);
  await cp(resolve(import.meta.dir, "../../../context/templates/package-templates/kb"), join(f.root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(f.root, "src/index.ts");
  const entry = (await readFile(entryPath, "utf8")).replace("import { defineProject }", "import { defineProject, kbPackage }")
    .replace("packages: []", 'packages: [kbPackage({ name: "partial-kb", template: { path: "src/package-templates/kb", vars: {} } })]');
  await writeFile(entryPath, entry);
  await acceptStarterPackageTemplates({ projectRoot: f.root });
  await writeFile(entryPath, "throw new Error('controlled partial build failure');\n");
  await expect(buildFixturePackages(f.root)).rejects.toThrow();
  expect(await readProductionStage(f.root)).toEqual(paused);
  await writeFile(entryPath, entry);
  await buildFixturePackages(f.root);
  const resumed = (await readProductionStage(f.root))!;
  expect(resumed.delivery).toBeUndefined();
  expect(resumed.tasks).toEqual(before.tasks);
  expect(await readFile(join(f.root, "knowledge/architecture/one.md"), "utf8")).toContain("Combined behavior.");
  await registerKnowledgeMaintenance(f.root, { id: "clarify-one", operation: "revise", timing: "priority",
    targets: [{ path: "architecture/one.md", instruction: "Clarify the approved explanation." }] });
  expect((await observeKnowledgeMaintenance(f.root)).action).toBe("advance");
  await advanceKnowledgeMaintenance(f.root, (await maintenanceRevision(f.root)).revision);
  expect((await readProductionStage(f.root))!.tasks).toEqual(before.tasks);
  await expect(completeProductionSubmission(f.input)).rejects.toThrow("active maintenance");
  await cancelKnowledgeMaintenance(f.root, "clarify-one", (await maintenanceRevision(f.root)).revision);
  expect((await readProductionStage(f.root))!.tasks).toEqual(before.tasks);
  expect((await completeProductionSubmission(f.input)).accepted.map(item => item.task)).toEqual(["two"]);
  expect(await readCandidateRecords(f.root)).toHaveLength(1);
});

test("an explicit resume cancels only the delivery pause", async () => {
  const f = await fixture(true);
  await completeProductionSubmission(f.input);
  await requestProductionDelivery(f.root);
  const before = (await readProductionStage(f.root))!;
  const candidates = await readCandidateRecords(f.root);
  execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"), "run", "--resume-writing", "--format", "json"], {
    cwd: f.root, encoding: "utf8", env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, timeout: 20_000,
  });
  expect((await readProductionStage(f.root))!.delivery).toBeUndefined();
  expect((await readProductionStage(f.root))!.tasks).toEqual(before.tasks);
  expect(await readCandidateRecords(f.root)).toEqual(candidates);
});

test.each([0, 1, 2])("partial delivery with %i approvals preserves rejected work or finally cleans the stage", async approvedCount => {
  const f = await fixture(true);
  execFileSync("git", ["init", "--quiet"], { cwd: f.root });
  await completeProductionSubmission(f.input);
  await requestProductionDelivery(f.root);
  const candidates = await readCandidateRecords(f.root);
  const ids = candidates.map(candidate => candidate.candidate_id).sort();
  await applyReviewDecisions({ projectRoot: f.root, payload: { scope: { kind: "all", count: ids.length,
    visible_candidate_ids: ids, ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
    decisions: ids.map((candidate_id, index) => ({ candidate_id, status: index < approvedCount ? "approved" : "rejected" })) } });
  if (approvedCount === 0) {
    expect((await collectProjectStatus(f.root)).workflow.status).not.toBe("complete");
    await expect(closeProjectWorkspace(f.root)).rejects.toThrow("No reviewed articles");
    expect((await readProductionStage(f.root))!.delivery).toHaveLength(2);
    await resumeProductionWriting(f.root);
    expect((await collectProjectStatus(f.root)).workflow.current?.node).toBe("repair-production-articles");
    expect(await readCandidateRecords(f.root)).toHaveLength(2);
    return;
  }
  await closeProjectWorkspace(f.root);
  await cp(resolve(import.meta.dir, "../../../context/templates/package-templates/kb"), join(f.root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(f.root, "src/index.ts");
  const entry = (await readFile(entryPath, "utf8")).replace("import { defineProject }", "import { defineProject, kbPackage }")
    .replace("packages: []", 'packages: [kbPackage({ name: "reviewed-subset", template: { path: "src/package-templates/kb", vars: {} } })]');
  await writeFile(entryPath, entry);
  await acceptStarterPackageTemplates({ projectRoot: f.root });
  await buildFixturePackages(f.root);
  const status = await collectProjectStatus(f.root);
  expect(status.approvedPages).toBe(approvedCount);
  expect(await readCandidateRecords(f.root)).toHaveLength(2 - approvedCount);
  if (approvedCount === 2) {
    expect(await readProductionStage(f.root)).toBeUndefined();
    expect(status.workflow.current?.node).toBe("reopen-cleared-task");
  } else {
    expect((await readProductionStage(f.root))!.delivery).toBeUndefined();
    expect(status.workflow.current?.node).toBe("repair-production-articles");
  }
});

test("changed long-term scope blocks pending acceptance without discarding accepted work", async () => {
  const f = await fixture(true);
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[0]] }));
  expect((await completeProductionSubmission(f.input)).accepted.map(item => item.task)).toEqual(["one"]);
  const candidates = await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8");
  const stage = await readProductionStage(f.root);
  const requirementsPath = join(f.root, "src/indexers.yaml");
  const original = await readFile(requirementsPath, "utf8");
  const changed = YAML.parse(original);
  changed.requirements[0].target_scope.targets.pop();
  await writeFile(requirementsPath, YAML.stringify(changed));
  await writeFile(join(f.directory, f.input.path), YAML.stringify(f.manifest));
  await expect(completeProductionSubmission(f.input)).rejects.toMatchObject({ detail: {
    reason_code: "production-planning-refresh-required",
  } });
  expect(await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8")).toBe(candidates);
  expect(await readProductionStage(f.root)).toEqual(stage);
  expect((await collectProjectStatus(f.root)).workflow.current?.node).toBe("prepare-production-planning");
  await prepareCurrentProductionStage({ projectRoot: f.root, revision: f.stage.id });
  const refreshed = (await readProductionStage(f.root))!;
  expect(refreshed.id).not.toBe(f.stage.id);
  expect(refreshed.tasks[0]).toEqual(stage!.tasks[0]);
  expect(refreshed.tasks[1]!.status).toBe("replaced");
  expect(refreshed.report_approved).toBe(false);
  expect(refreshed.scopes.map(scope => scope.scope)).toEqual([f.stage.scopes[0]!.scope]);
  expect(await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8")).toBe(candidates);
  await expect(completeProductionSubmission(f.input)).rejects.toThrow("Task stage no longer exists");
  const agent = join(f.root, productionAgentDirectory(refreshed.id));
  await mkdir(join(agent, "submissions"), { recursive: true });
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify({ stage: refreshed.id,
    capabilities: { multi_agent: false, skills: [] }, articles: [{ path: "architecture/two.md",
      question: "Explain the remaining authorized source", sources: [refreshed.scopes[0]!.scope], batch: "remaining", after: [refreshed.tasks[0]!.id] }] }));
  await submitProductionPlan({ projectRoot: f.root, stage: refreshed.id, path: "submissions/plan.yaml" });
  const planned = (await readProductionStage(f.root))!;
  expect(planned.tasks[0]).toEqual(stage!.tasks[0]);
  expect(planned.tasks[2]!.status).toBe("pending");
  expect((await collectProjectStatus(f.root)).workflow.current?.node).toBe("confirm-production-report");
  await expect(completeProductionSubmission({ ...f.input, stage: refreshed.id })).rejects.toThrow("wait for user feedback");
  await writeFile(join(agent, "submissions/report.yaml"), YAML.stringify({ stage: refreshed.id, decision: "approved" }));
  await expect(approveProductionReport({ projectRoot: f.root, stage: refreshed.id, revision: productionReportRevision(stage!),
    path: "submissions/report.yaml" })).rejects.toThrow("plan changed");
  await approveProductionReport({ projectRoot: f.root, stage: refreshed.id, revision: productionReportRevision(planned), path: "submissions/report.yaml" });
  expect((await readProductionStage(f.root))!.tasks[2]!.status).toBe("issued");
  expect(await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8")).toBe(candidates);
  await writeFile(join(agent, "article.md"), await readFile(join(f.directory, "two/article.md"), "utf8"));
  await writeFile(join(agent, "references.yaml"), YAML.stringify({ sections: [{ id: "behavior", references: [{
    source_ref: refreshed.scopes[0]!.scope, locator: { path: "a.md", start_line: 2, end_line: 2 },
  }] }] }));
  await writeFile(join(agent, "submissions/ready.yaml"), YAML.stringify({ stage: refreshed.id,
    tasks: [{ task: planned.tasks[2]!.id, input: planned.tasks[2]!.input, content: "article.md", references: "references.yaml" }] }));
  expect((await completeProductionSubmission({ projectRoot: f.root, stage: refreshed.id, path: "submissions/ready.yaml" })).stage_state).toBe("ended");
  expect(await readCandidateRecords(f.root)).toHaveLength(2);
  expect((await readProductionStage(f.root))!.tasks[0]).toEqual(stage!.tasks[0]);
});

test("accepted production reaches actual Review apply without a Provider compile or revision batch", async () => {
  const f = await fixture(true);
  // Isolate formal version discovery from the parent repository's ignored .tmp.
  execFileSync("git", ["init", "--quiet"], { cwd: f.root });
  await expect(readProductionReviewCandidates(f.root)).rejects.toThrow("Complete the current production stage");
  await expect(closeProjectWorkspace(f.root)).rejects.toMatchObject({ detail: { reason_code: "production-not-complete" } });
  expect((await completeProductionSubmission(f.input)).stage_state).toBe("ended");
  await expect(clearCompletedLifecycle(f.root)).rejects.toThrow("Review and close");
  expect(await readProductionStage(f.root)).toBeDefined();
  const candidates = await readCandidateRecords(f.root);
  const ids = candidates.map(candidate => candidate.candidate_id).sort();
  const ledger = await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8");
  await writeFile(join(f.root, CANDIDATE_LEDGER_FILE), ledger.replaceAll("Combined behavior.", "Altered after acceptance."));
  await expect(readProductionReviewCandidates(f.root)).rejects.toThrow("content changed");
  await writeFile(join(f.root, CANDIDATE_LEDGER_FILE), ledger);
  await applyReviewDecisions({ projectRoot: f.root, payload: { scope: { kind: "all", count: ids.length,
    visible_candidate_ids: ids, ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
    decisions: ids.map(candidate_id => ({ candidate_id, status: "approved" })) } });
  for (const candidate of candidates) {
    const markdown = await readFile(join(f.root, "knowledge", candidate.path), "utf8");
    expect(markdown).toContain("Combined behavior.");
    expect(YAML.parse(markdown.split("---")[1]!).type).toBeDefined();
  }
  expect((await readProductionReviewCandidates(f.root))!.candidates).toHaveLength(0);
  const closed = await closeProjectWorkspace(f.root);
  expect(closed.articles).toBe(2);
  expect(closed.verifyErrors).toBe(0);
  await cp(resolve(import.meta.dir, "../../../context/templates/package-templates/kb"), join(f.root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(f.root, "src/index.ts");
  const entry = (await readFile(entryPath, "utf8")).replace("import { defineProject }", "import { defineProject, kbPackage }")
    .replace("packages: []", 'packages: [kbPackage({ name: "production-kb", template: { path: "src/package-templates/kb", vars: {} } })]');
  await writeFile(entryPath, entry);
  await acceptStarterPackageTemplates({ projectRoot: f.root });
  await chmod(f.directory, 0o500);
  try {
    await expect(buildFixturePackages(f.root)).rejects.toMatchObject({ code: "EACCES" });
    expect((await readProductionStage(f.root))?.id).toBe(f.stage.id);
    expect(await readTaskPreparation(f.root)).not.toBe("cleared");
  } finally {
    await chmod(f.directory, 0o700);
  }
  const built = await buildProjectPackages(f.root);
  expect(built.packages.map(pkg => pkg.name)).toEqual(["production-kb"]);
  const packageRoot = join(f.root, built.packages[0]!.outDir);
  const inventory = JSON.parse(await readFile(join(packageRoot, "context-build-inventory.json"), "utf8")) as {
    approved_knowledge: { files: Array<{ approved_path: string; dist_path: string }> };
  };
  expect(inventory.approved_knowledge.files).toHaveLength(2);
  for (const article of inventory.approved_knowledge.files) {
    expect(article.approved_path).toMatch(/architecture\/(?:one|two)\.md$/u);
    expect(await readFile(join(packageRoot, article.dist_path), "utf8")).toContain("Combined behavior.");
  }
  expect(await readProductionStage(f.root)).toBeUndefined();
  expect(await readCandidateRecords(f.root)).toEqual([]);
  await expect(readFile(join(f.directory, "one/article.md"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readTaskPreparation(f.root)).toBe("cleared");
  expect((await collectProjectStatus(f.root)).workflow.current?.node).toBe("reopen-cleared-task");
  expect((await resumeWorkspaceTask(f.root)).action).toBe("task-resume-requested");
  expect((await collectProjectStatus(f.root)).workflow.current?.node).toBe("prepare-production-planning");
  expect(await readProductionStage(f.root)).toBeUndefined();
  for (const candidate of candidates) expect(await readFile(join(f.root, "knowledge", candidate.path), "utf8")).toContain("Combined behavior.");
});

test("Review rejection does not silently close planned production responsibilities", async () => {
  const f = await fixture(true);
  await completeProductionSubmission(f.input);
  const candidates = await readCandidateRecords(f.root);
  const ids = candidates.map(candidate => candidate.candidate_id).sort();
  await applyReviewDecisions({ projectRoot: f.root, payload: { scope: { kind: "all", count: ids.length,
    visible_candidate_ids: ids, ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
    decisions: ids.map(candidate_id => ({ candidate_id, status: "rejected" })) } });
  await expect(closeProjectWorkspace(f.root)).rejects.toMatchObject({ detail: {
    reason_code: "production-articles-need-repair", paths: candidates.map(candidate => candidate.path),
  } });
  expect((await readCandidateRecords(f.root)).every(candidate => candidate.status === "rejected")).toBe(true);
  const route = (await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!;
  expect(route.node).toBe("repair-production-articles");
  expect(route.commands[0]!.command).toContain("submissions/plan-amendment.yaml");
  const repair = route.resources.required.find(resource => resource.id.endsWith("/repair"))!;
  const material = await readFile(repair.path!, "utf8");
  for (const candidate of candidates) expect(material).toContain(candidate.path);
});

test("changed requirements cannot bypass replanning through Review apply or close after writing ended", async () => {
  const f = await fixture(true);
  await completeProductionSubmission(f.input);
  const candidates = await readCandidateRecords(f.root);
  const ids = candidates.map(candidate => candidate.candidate_id).sort();
  const original = await readFile(join(f.root, "src/indexers.yaml"), "utf8");
  await writeFile(join(f.root, "src/indexers.yaml"), original.replace(f.stage.purpose, "Explain a changed reader purpose"));
  const expected = { detail: { reason_code: "production-planning-refresh-required" } };
  await expect(readProductionReviewCandidates(f.root)).rejects.toMatchObject(expected);
  await expect(applyReviewDecisions({ projectRoot: f.root, payload: { scope: { kind: "all", count: ids.length,
    visible_candidate_ids: ids, ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
    decisions: ids.map(candidate_id => ({ candidate_id, status: "approved" })) } })).rejects.toMatchObject(expected);
  await expect(closeProjectWorkspace(f.root)).rejects.toMatchObject(expected);
  expect(await readCandidateRecords(f.root)).toEqual(candidates);
  expect((await collectProjectStatus(f.root)).workflow.current?.node).toBe("prepare-production-planning");
  for (const candidate of candidates) await expect(readFile(join(f.root, "knowledge", candidate.path))).rejects.toMatchObject({ code: "ENOENT" });
});

test("submitting the issued batch prepares the next directory without querying whole-workspace status", async () => {
  const f = await fixture();
  const pending = { ...f.stage, tasks: f.stage.tasks.map(task => ({ ...task, status: "pending" as const })) };
  await saveProductionStage(f.root, pending);
  const first = await materializeProductionStage({ projectRoot: f.root, stage: pending,
    capabilities: { multi_agent: false, skills: [] }, materials: { requirements: await readFile(join(f.root, "src/indexers.yaml"), "utf8"),
      sources: new Map(f.stage.scopes.map(source => [source.scope, `Read ${source.scope}`])) } });
  expect(first.batches.map(batch => batch.id)).toEqual(["one"]);
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[0]] }));
  const result = await completeProductionSubmission(f.input);
  expect(result.failed).toEqual([]);
  expect(result.next_preparation).toBeUndefined();
  expect(result.next).toMatchObject({ directory: first.directory, mode: "single-agent" });
  expect(YAML.parse(await readFile(join(f.root, result.next!.submission!), "utf8")).tasks.map((task: { task: string }) => task.task)).toEqual(["two"]);
  expect((await readProductionStage(f.root))!.tasks.map(task => task.status)).toEqual(["accepted", "issued"]);
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[1]] }));
  const final = await completeProductionSubmission(f.input);
  expect(final.stage_state).toBe("ended");
  expect(final.next).toBeUndefined();
});

test("the actual preparation command retries directory failure without repeating accepted production", async () => {
  const f = await fixture(true);
  const pending = { ...f.stage, report_approved: false, tasks: f.stage.tasks.map(task => ({ ...task, status: "pending" as const })) };
  await saveProductionStage(f.root, pending);
  const requirements = YAML.stringify({ requirements: [{ id: "behavior", purpose: pending.purpose,
    target_scope: { targets: pending.scopes.map(source => ({ source_ref: source.scope })) } }] });
  await writeFile(join(f.root, "src/indexers.yaml"), requirements);
  const materials = { requirements,
    sources: new Map(f.stage.scopes.map(source => [source.scope, `Read ${source.scope}`])) };
  const first = await materializeProductionStage({ projectRoot: f.root, stage: pending,
    capabilities: { multi_agent: false, skills: [] }, materials });
  expect(first.batches).toEqual([]);
  const reportPath = join(f.directory, "submissions/report.yaml");
  await writeFile(reportPath, YAML.stringify({ stage: pending.id, decision: "approved" }));
  const approved = execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"), "action", "complete-current",
    "--revision", productionReportRevision(pending), "--input", reportPath, "--managed", "--format", "json"], {
    cwd: f.root, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, encoding: "utf8", timeout: 20_000,
  });
  expect(JSON.parse(approved)).toMatchObject({ stage_state: "active", next: { directory: first.directory, mode: "single-agent" } });
  const blockedDirectory = join(f.root, first.directory, "batches/two");
  await writeFile(blockedDirectory, "Prevent materializing the next batch directory.\n");
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[0]] }));
  const accepted = await completeProductionSubmission(f.input);
  expect(accepted.accepted.map(item => item.task)).toEqual(["one"]);
  expect(accepted.next_preparation?.command).toContain("action prepare-current");
  expect((await readProductionStage(f.root))!.tasks.map(task => task.status)).toEqual(["accepted", "pending"]);
  await rm(blockedDirectory);
  const before = await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8");
  const output = execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"), "action", "prepare-current",
    "--revision", f.stage.id, "--format", "json"], { cwd: f.root,
    env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, encoding: "utf8", timeout: 20_000 });
  expect(JSON.parse(output)).toMatchObject({ stage_state: "active", mode: "single-agent", next: { directory: first.directory } });
  expect((await readProductionStage(f.root))!.tasks.map(task => task.status)).toEqual(["accepted", "issued"]);
  expect(await readFile(join(f.root, CANDIDATE_LEDGER_FILE), "utf8")).toBe(before);
}, 30_000);

test("the CLI rejects a named pipe before any generic input reader can block", async () => {
  const f = await fixture(true);
  const pipe = join(f.directory, "submissions/pipe.yaml");
  execFileSync("mkfifo", [pipe]);
  const result = spawnSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"),
    "action", "complete-current", "--revision", f.stage.id, "--input", pipe, "--format", "json"],
    { cwd: f.root, encoding: "utf8", env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, timeout: 5000 });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain("regular file");
  expect(await readCandidateRecords(f.root)).toEqual([]);
  expect(await readProductionStage(f.root)).toEqual(f.stage);
});

test("a saved result survives next preparation failure but rejects a different successful payload", async () => {
  const f = await fixture();
  const result = await completeProductionSubmission({ ...f.input, prepareNext: async () => { throw new Error("next preparation unavailable"); } });
  expect(result.failed).toEqual([]);
  expect(result.accepted).toHaveLength(2);
  expect(result.next_preparation?.outcome).toBe("failed");
  const bodyPath = join(f.directory, "one/article.md");
  await writeFile(bodyPath, (await readFile(bodyPath, "utf8")).replace("Combined behavior.", "Changed behavior."));
  const retry = await completeProductionSubmission(f.input);
  expect(retry.accepted.map(item => item.task)).toEqual(["two"]);
  expect(retry.failed[0]!.reason).toContain("explicit revision");
  expect((await readCandidateRecords(f.root)).find(item => item.article_id === "article:one")!.body).toContain("Combined behavior.");
});

test("unsafe later paths reject the whole manifest before the first candidate is saved", async () => {
  const f = await fixture();
  f.manifest.tasks[1]!.content = "../outside.md";
  await writeFile(join(f.directory, f.input.path), YAML.stringify(f.manifest));
  await expect(completeProductionSubmission(f.input)).rejects.toThrow("stage-relative");
  expect(await readCandidateRecords(f.root)).toEqual([]);
});

test("duplicate and foreign task identities save nothing; stale input and omitted peers remain independently recoverable", async () => {
  const f = await fixture();
  const file = join(f.directory, f.input.path);
  await writeFile(file, YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[0], f.manifest.tasks[0]] }));
  await expect(completeProductionSubmission(f.input)).rejects.toMatchObject({ detail: { reason_code: "invalid-production-file" } });
  expect(await readCandidateRecords(f.root)).toEqual([]);
  expect(await readProductionStage(f.root)).toEqual(f.stage);
  await writeFile(file, YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[0], { ...f.manifest.tasks[1], task: "foreign" }] }));
  await expect(completeProductionSubmission(f.input)).rejects.toMatchObject({ detail: { reason_code: "unknown-production-task" } });
  expect(await readCandidateRecords(f.root)).toEqual([]);
  expect(await readProductionStage(f.root)).toEqual(f.stage);
  await writeFile(file, YAML.stringify({ ...f.manifest, tasks: [{ ...f.manifest.tasks[0], input: "outdated" }] }));
  const stale = await completeProductionSubmission(f.input);
  expect(stale.accepted).toEqual([]);
  expect(stale.failed.map(item => item.task)).toEqual(["one"]);
  expect((await readProductionStage(f.root))!.tasks[1]).toEqual(f.stage.tasks[1]);
  await writeFile(file, YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[0]] }));
  const subset = await completeProductionSubmission(f.input);
  expect(subset.accepted.map(item => item.task)).toEqual(["one"]);
  expect(subset.failed).toEqual([]);
  expect((await readProductionStage(f.root))!.tasks[1]).toEqual(f.stage.tasks[1]);
  await writeFile(file, YAML.stringify({ ...f.manifest, tasks: [f.manifest.tasks[1]] }));
  const peer = await completeProductionSubmission(f.input);
  expect(peer.accepted.map(item => item.task)).toEqual(["two"]);
  expect(peer.stage_state).toBe("ended");
});

test("actual source change invalidates pending tasks without producing candidate content", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "sources/note/20260913/a.md"), "# Changed source\nDifferent behavior.\n");
  const result = await completeProductionSubmission(f.input);
  expect(result.accepted).toEqual([]);
  expect(result.failed.every(item => item.reason.includes("Source changed"))).toBe(true);
  expect(await readCandidateRecords(f.root)).toEqual([]);
});

test("explicit fragment revision replaces only its candidate and replays without changing untouched articles", async () => {
  const f = await fixture();
  await completeProductionSubmission(f.input);
  const before = await readCandidateRecords(f.root);
  const original = before.find(item => item.article_id === "article:one")!;
  const current = (await readProductionStage(f.root))!;
  const revision = { ...f.stage.tasks[0]!, id: "revise-one", base: productionArticleTargetDigest({ markdown: original.body,
    visibility: original.visibility, sections: original.indexer_candidate!.sections.map(section => ({ id: section.section_key, references: section.references })) }),
    status: "issued" as const, after: ["one"], question: "Clarify the existing fragment" };
  const task = { ...revision, input: productionTaskInput(revision) };
  await saveProductionStage(f.root, { ...current, tasks: [...current.tasks, task] });
  await writeFile(join(f.directory, "edits.yaml"), YAML.stringify({ edits: [
    { replace: ["behavior"], with: [{ id: "behavior", markdown: "Clarified behavior." }] },
  ] }));
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ stage: f.stage.id,
    tasks: [{ task: task.id, input: task.input, edits: "edits.yaml" }] }));
  const result = await completeProductionSubmission(f.input);
  expect(result.failed).toEqual([]);
  expect(result.accepted).toHaveLength(1);
  const after = await readCandidateRecords(f.root);
  expect(after).toHaveLength(2);
  expect(after.find(item => item.article_id === "article:two")).toEqual(before.find(item => item.article_id === "article:two"));
  const revised = after.find(item => item.article_id === "article:one")!;
  expect(revised.body).toBe(original.body.replace("Combined behavior.", "Clarified behavior."));
  expect(revised.indexer_candidate!.sections[0]!.references).toEqual(original.indexer_candidate!.sections[0]!.references);
  expect(revised.approved_revision!.base_digest).toBeNull();
  expect((await completeProductionSubmission(f.input)).accepted).toEqual(result.accepted);
});

test("a failed new article can repair only one fragment using the fixed temporary draft", async () => {
  const f = await fixture();
  const correct = YAML.parse(await readFile(join(f.directory, "two/references.yaml"), "utf8"));
  await writeFile(join(f.directory, "two/references.yaml"), YAML.stringify(correct).replaceAll("end_line: 2", "end_line: 99"));
  const first = await completeProductionSubmission(f.input);
  expect(first.accepted.map(item => item.task)).toEqual(["one"]);
  expect(first.failed).toHaveLength(1);
  // The Agent-owned original is no longer the fixed rejected input.
  await writeFile(join(f.directory, "two/article.md"), "Unrelated later draft, not submitted.");
  await writeFile(join(f.directory, "repair.yaml"), YAML.stringify({ edits: [{ replace: ["behavior"],
    with: [{ id: "behavior", references: correct.sections[0].references }] }] }));
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ stage: f.stage.id,
    tasks: [{ task: "two", input: f.stage.tasks[1]!.input, edits: "repair.yaml" }] }));
  const repaired = await completeProductionSubmission(f.input);
  expect(repaired.failed).toEqual([]);
  expect(repaired.accepted.map(item => item.task)).toEqual(["two"]);
  expect((await readCandidateRecords(f.root)).find(item => item.article_id === "article:two")!.body).toContain("Combined behavior.");
});

test("losing a repair draft requires the complete article instead of guessing missing text", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "repair.yaml"), YAML.stringify({ edits: [{ replace: ["behavior"],
    with: [{ id: "behavior", markdown: "Only a fragment" }] }] }));
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ stage: f.stage.id,
    tasks: [{ task: "two", input: f.stage.tasks[1]!.input, edits: "repair.yaml" }] }));
  const result = await completeProductionSubmission(f.input);
  expect(result.accepted).toEqual([]);
  expect(result.failed).toMatchObject([{ task: "two", file: "repair.yaml" }]);
  expect(result.failed[0]!.reason).toContain("base is unavailable");
  expect(await readCandidateRecords(f.root)).toEqual([]);
});

test("formal revisions preserve visibility and reject identity or reference-only baseline changes", async () => {
  const f = await fixture();
  const markdown = await readFile(join(f.directory, "one/article.md"), "utf8");
  const sections = [{ id: "behavior", references: [createArticleSourceReference(f.stage.scopes[0]!.scope,
    { path: "a.md", start_line: 2, end_line: 2 }, "# a\nThe a behavior.\n")] }];
  const formal = { article_id: "article:one", path: "architecture/one.md", collection: "architecture",
    visibility: "private", sections };
  await mkdir(join(f.root, "knowledge/architecture"), { recursive: true });
  await writeFile(join(f.root, "knowledge/architecture/one.md"), markdown);
  const structurePath = join(f.root, "knowledge/structure.yaml");
  await writeFile(structurePath, YAML.stringify({ articles: [formal] }));
  const planned = { ...f.stage.tasks[0]!, base: productionArticleTargetDigest({ markdown, sections, visibility: "private" }) };
  const task = { ...planned, input: productionTaskInput(planned) };
  await saveProductionStage(f.root, { ...f.stage, tasks: [task, f.stage.tasks[1]!] });
  await writeFile(join(f.directory, "edits.yaml"), YAML.stringify({ edits: [{ replace: ["behavior"],
    with: [{ id: "behavior", markdown: "Revised formal answer." }] }] }));
  await writeFile(join(f.directory, f.input.path), YAML.stringify({ stage: f.stage.id,
    tasks: [{ task: task.id, input: task.input, edits: "edits.yaml" }] }));
  await writeFile(structurePath, YAML.stringify({ articles: [{ ...formal, article_id: "article:someone-else" }] }));
  expect((await completeProductionSubmission(f.input)).failed[0]!.reason).toContain("formal article identity");
  await writeFile(structurePath, YAML.stringify({ articles: [{ ...formal, sections: [{ id: "behavior", references: [] }] }] }));
  expect((await completeProductionSubmission(f.input)).failed[0]!.reason).toContain("references or visibility changed");
  await writeFile(structurePath, YAML.stringify({ articles: [formal] }));
  const result = await completeProductionSubmission(f.input);
  expect(result.failed).toEqual([]);
  const candidate = (await readCandidateRecords(f.root))[0]!;
  expect(candidate.visibility).toBe("private");
  expect(candidate.approved_revision!.base_digest).toBe(durableContentDigest(markdown));
  expect(candidate.indexer_candidate!.sections[0]!.references).toEqual(sections[0]!.references);
  expect(await readFile(join(f.root, "knowledge/architecture/one.md"), "utf8")).toBe(markdown);
});

test("lost temporary work expires the old submission instead of restoring a process from Git", async () => {
  const f = await fixture();
  await completeProductionSubmission(f.input);
  await rm(join(f.root, ".tmp"), { recursive: true, force: true });
  await expect(completeProductionSubmission(f.input)).rejects.toThrow("Start a new production run");
  expect(await readCandidateRecords(f.root)).toEqual([]);
  expect(await readFile(join(f.root, "sources/note/20260913/a.md"), "utf8")).toContain("The a behavior.");
});

test("the actual completion command accepts stage-relative file results and returns actionable short receipts", async () => {
  const f = await fixture(true);
  const stdout = execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"),
    "action", "complete-current", "--revision", f.stage.id,
    "--input", join(productionAgentDirectory(f.stage.id), f.input.path), "--format", "json"],
    { cwd: f.root, encoding: "utf8", env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, timeout: 20_000 });
  const value = JSON.parse(stdout);
  expect(value.accepted).toHaveLength(2);
  expect(value.failed).toEqual([]);
  expect(value.stage_state).toBe("ended");
  expect(value).not.toHaveProperty("result_file");
}, 30_000);
