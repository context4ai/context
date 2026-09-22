import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { productionWorkflowRoute } from "../project/productionWorkflowRoute.js";
import { readProductionStage, productionStageDirectory, productionSourceFile } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { collectProjectStatus } from "../project/status.js";
import { submitProductionPlan } from "../project/productionPlanning.js";
import { approveProductionReport, productionReportRevision } from "../project/productionReport.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { productionPlanningRequest } from "../project/productionPlanning.js";
import { completeProductionSubmission } from "../project/productionSubmission.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { closeProjectWorkspace } from "../project/close.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const cli = resolve(import.meta.dir, "../cli.ts");
function command(root: string, args: string[]) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args, "--format", "json"], {
    cwd: root, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, encoding: "utf8", timeout: 20_000,
  }));
}
test("confirmed project sources reach requirement setup without Provider configuration", async () => {
  const parent = resolve(".tmp/production-planning-entry-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "requirements-")); roots.push(outer);
  const { projectRoot } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  const note = await importManagedDocument(projectRoot, { type: "note", name: "20260913/selected.md", markdown: "# Selected\nA saved decision." });
  // A durable registration does not require restoring an unrelated checkout.
  await mkdir(join(projectRoot, "sources/repo"), { recursive: true });
  await writeFile(join(projectRoot, "sources/repo/index.yaml"), YAML.stringify({ sources: [{
    name: "20260913", modules: [{ name: "unrelated", git: {
      remote: "https://git.example.com/unrelated.git", ref: "a".repeat(40),
    } }],
  }] }));
  await importManagedDocument(projectRoot, { type: "note", name: "20260913/unselected.md", markdown: "# Unselected\nNot authorized for production." });
  await writeFile(join(projectRoot, "src/index.ts"), `import { defineProject, source } from "@c4a/context";
export default defineProject({ sources: [source("20260913/selected.md", { type: "note" })], phases: [], packages: [] });\n`);
  const before = await collectProjectStatus(projectRoot);
  expect(before.workflow.current?.node).toBe("configure-production-requirements");
  expect(before.workflow.current?.configuration?.file).toBe("src/indexers.yaml");
  expect(before.workflow.current?.commands).toEqual([]);
  expect(before.workflow.current?.resources.required.some(resource => resource.id === "context.source-boundary")).toBe(true);
  expect(await readProductionStage(projectRoot)).toBeUndefined();
  await writeFile(join(projectRoot, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "decisions", purpose: "Explain the selected decision",
    target_scope: { targets: [{ source_ref: note.source_ref }] } }] }));
  const retiredCompile = join(projectRoot, ".tmp/context-runtime/indexer/candidate-compile");
  await mkdir(retiredCompile, { recursive: true });
  await writeFile(join(retiredCompile, "current.json"), "retired invalid Provider compile state");
  const configured = await collectProjectStatus(projectRoot);
  expect(configured.workflow.current?.node).toBe("prepare-production-planning");
  command(projectRoot, ["action", "prepare-current", "--revision", configured.workflow.current!.revision]);
  const stage = (await readProductionStage(projectRoot))!;
  expect(stage.scopes.map(item => item.scope)).toEqual([note.source_ref]);
  expect(stage.gaps).toEqual([]);
  expect(stage.indexer_usage).toEqual([]);
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("plan-production-stage");
});

test("actual commands prepare fresh investigation and submit a plan before the unskippable report", async () => {
  const parent = resolve(".tmp/production-planning-entry-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const { projectRoot } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  const note = await importManagedDocument(projectRoot, { type: "note", name: "20260913/decisions.md", markdown: "# Decision\n\n## Scope\nThe service is independent." });
  const requirements = YAML.stringify({ requirements: [{ id: "service", purpose: "Explain service decisions",
    target_scope: { targets: [{ source_ref: note.source_ref }] } }] });
  await writeFile(join(projectRoot, "src/indexers.yaml"), requirements);
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("prepare-production-planning");
  const first = (await productionWorkflowRoute({ projectRoot, authorities: [] }))!;
  expect(first.node).toBe("prepare-production-planning");
  command(projectRoot, ["action", "prepare-current", "--revision", first.revision]);
  const stage = (await readProductionStage(projectRoot))!;
  expect(stage.planning_complete).toBe(false);
  const retiredCompile = join(projectRoot, ".tmp/context-runtime/indexer/candidate-compile");
  await mkdir(retiredCompile, { recursive: true });
  await writeFile(join(retiredCompile, "current.json"), "retired invalid compile state");
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("plan-production-stage");
  expect(await readFile(join(projectRoot, productionStageDirectory(stage.id), "guidance/existing-articles.md"), "utf8")).toContain("Articles: 0");
  const planRoute = (await productionWorkflowRoute({ projectRoot, authorities: [] }))!;
  expect(planRoute.node).toBe("plan-production-stage");
  expect(await readFile(planRoute.resources.required.find(resource => resource.kind === "context-view")!.path!, "utf8")).toContain(note.source_ref);
  const output = join(projectRoot, productionAgentDirectory(stage.id), "submissions/plan.yaml");
  await mkdir(join(projectRoot, productionAgentDirectory(stage.id), "submissions"), { recursive: true });
  await writeFile(output, YAML.stringify({ stage: stage.id, capabilities: { skills: [{ name: "context-note-indexer" }] },
    articles: [{ path: "decision/service.md", question: "Why is the service independent?", sources: [note.source_ref], batch: "service" }],
    indexer_usage: [{ scopes: [note.source_ref], skills: ["context-note-indexer"], purpose: "Interpret saved decisions" }] }));
  await writeFile(join(projectRoot, "src/indexers.yaml"), requirements.replace("Explain service decisions", "Explain a changed purpose"));
  await expect(submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/plan.yaml" })).rejects.toThrow("requirements changed");
  expect((await readProductionStage(projectRoot))!.planning_complete).toBe(false);
  await writeFile(join(projectRoot, "src/indexers.yaml"), requirements);
  expect(command(projectRoot, ["action", "complete-current", "--revision", stage.id, "--input", output]).stage_state).toBe("waiting-user");
  const planned = (await readProductionStage(projectRoot))!;
  expect(planned.tasks).toHaveLength(1);
  expect(planned.tasks[0]!.status).toBe("pending");
  expect(planned.report_approved).toBe(false);
  expect(await readFile(join(projectRoot, productionStageDirectory(stage.id), "skills.md"), "utf8")).toContain("context-note-indexer");
  const report = (await productionWorkflowRoute({ projectRoot, authorities: ["context.knowledge-review"] }))!;
  expect(report.node).toBe("confirm-production-report");
  expect(report.gate?.delegatable).toBe(false);
  const status = await collectProjectStatus(projectRoot, { managed: true });
  expect(status.workflow.current?.node).toBe("confirm-production-report");
  const revisedPlan = (await readFile(output, "utf8")).replace("Why is the service independent?", "What boundary protects the service?");
  await writeFile(output, revisedPlan);
  expect(command(projectRoot, ["action", "complete-current", "--revision", stage.id, "--input", output]).stage_state).toBe("waiting-user");
  const revised = (await readProductionStage(projectRoot))!;
  expect(revised.tasks[0]!.article_id).toBe(planned.tasks[0]!.article_id);
  expect(revised.tasks[0]!.question).toBe("What boundary protects the service?");
  expect(revised.report_approved).toBe(false);
  expect((await productionWorkflowRoute({ projectRoot, authorities: [] }))!.revision).not.toBe(report.revision);
  expect(await readFile(join(projectRoot, "src/indexers.yaml"), "utf8")).toBe(requirements);
  await writeFile(join(projectRoot, "src/indexers.yaml"), requirements.replace("Explain service decisions", "Explain the revised service purpose"));
  await writeFile(join(projectRoot, productionAgentDirectory(stage.id), "submissions/report.yaml"), YAML.stringify({ stage: stage.id, decision: "approved" }));
  await expect(approveProductionReport({ projectRoot, stage: stage.id, revision: productionReportRevision(revised),
    path: "submissions/report.yaml" })).rejects.toMatchObject({ detail: { reason_code: "production-planning-refresh-required" } });
  expect((await readProductionStage(projectRoot))!.report_approved).toBe(false);
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("prepare-production-planning");
  command(projectRoot, ["action", "prepare-current", "--revision", stage.id]);
  const refreshed = (await readProductionStage(projectRoot))!;
  expect(refreshed.id).not.toBe(stage.id);
  expect(refreshed.purpose).toBe("Explain the revised service purpose");
  expect(refreshed.planning_complete).toBe(false);
  expect(refreshed.report_approved).toBe(false);
  expect(refreshed.tasks).toEqual([]);
  expect(await readFile(output, "utf8")).toBe(revisedPlan);
  await expect(submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/plan.yaml" })).rejects.toThrow("Plan replacement");
  await rm(join(projectRoot, ".tmp"), { recursive: true, force: true });
  expect(await readProductionStage(projectRoot)).toBeUndefined();
  expect((await productionWorkflowRoute({ projectRoot, authorities: [] }))!.node).toBe("prepare-production-planning");
});

test("writing amendments append once, preserve issued work and explicitly replace dependent plans", async () => {
  const parent = resolve(".tmp/production-planning-entry-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "amendment-")); roots.push(outer);
  const { projectRoot } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  const note = await importManagedDocument(projectRoot, { type: "note", name: "20260913/decisions.md", markdown: "# Decisions\nService boundaries and failure behavior." });
  await writeFile(join(projectRoot, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "service", purpose: "Explain service decisions",
    target_scope: { targets: [{ source_ref: note.source_ref }] } }] }));
  await prepareCurrentProductionStage({ projectRoot, revision: (await productionPlanningRequest(projectRoot))!.revision });
  const stage = (await readProductionStage(projectRoot))!;
  const agent = join(projectRoot, productionAgentDirectory(stage.id));
  await mkdir(join(agent, "submissions"), { recursive: true });
  const article = { path: "decision/service.md", question: "Explain the service boundary", sources: [note.source_ref], batch: "service" };
  const plan = { stage: stage.id, capabilities: { multi_agent: false, skills: [] }, articles: [article] };
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify({ ...plan, pending_scopes: [note.source_ref] }));
  await submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/plan.yaml" });
  const planned = (await readProductionStage(projectRoot))!;
  await writeFile(join(agent, "submissions/report.yaml"), YAML.stringify({ stage: stage.id, decision: "approved" }));
  await approveProductionReport({ projectRoot, stage: stage.id, revision: productionReportRevision(planned), path: "submissions/report.yaml" });
  const issued = (await readProductionStage(projectRoot))!.tasks[0]!;
  const amendmentPath = join(agent, "submissions/amendment.yaml");
  await writeFile(amendmentPath, YAML.stringify({ ...plan, articles: [{ ...article, path: "decision/failures.md", batch: "failures", after: [issued.id] }] }));
  const args = ["action", "complete-current", "--revision", stage.id, "--input", amendmentPath];
  expect(command(projectRoot, args).stage_state).toBe("active");
  const appended = (await readProductionStage(projectRoot))!;
  expect(appended.tasks).toHaveLength(2);
  expect(appended.pending_scopes).toEqual([note.source_ref]);
  expect(appended.tasks[0]).toEqual(issued);
  expect(appended.tasks[1]!.status).toBe("pending");
  expect(command(projectRoot, args).stage_state).toBe("active");
  expect((await readProductionStage(projectRoot))!.tasks).toEqual(appended.tasks);
  const replacement = { ...plan, replaces: [issued.id], articles: [{ ...article, path: "decision/revised.md" }] };
  await writeFile(amendmentPath, YAML.stringify(replacement));
  await expect(submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/amendment.yaml" })).rejects.toThrow("dependent plans together");
  expect((await readProductionStage(projectRoot))!.tasks).toEqual(appended.tasks);
  await writeFile(amendmentPath, YAML.stringify({ ...replacement, pending_scopes: [], replaces: appended.tasks.map(task => task.id) }));
  expect(command(projectRoot, args).stage_state).toBe("active");
  expect((await readProductionStage(projectRoot))!.tasks.map(task => task.status)).toEqual(["replaced", "replaced", "issued"]);
  expect((await readProductionStage(projectRoot))!.pending_scopes).toEqual([]);
});

test("rejected prose follows the actual route through section repair, repeated Review and close", async () => {
  const parent = resolve(".tmp/production-planning-entry-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "review-repair-")); roots.push(outer);
  const { projectRoot } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  const note = await importManagedDocument(projectRoot, { type: "note", name: "20260913/decision.md", markdown: "# Decision\nThe service is independent.\n" });
  await writeFile(join(projectRoot, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "service", purpose: "Explain the service boundary",
    target_scope: { targets: [{ source_ref: note.source_ref }] } }] }));
  await prepareCurrentProductionStage({ projectRoot, revision: (await productionPlanningRequest(projectRoot))!.revision });
  const stage = (await readProductionStage(projectRoot))!;
  const agent = join(projectRoot, productionAgentDirectory(stage.id));
  await mkdir(join(agent, "submissions"), { recursive: true });
  const article = { path: "decision/service.md", question: "Why is the service independent?", sources: [note.source_ref], batch: "service" };
  const plan = { stage: stage.id, capabilities: { skills: [] }, articles: [article] };
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify(plan));
  await submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/plan.yaml" });
  await writeFile(join(agent, "submissions/report.yaml"), YAML.stringify({ stage: stage.id, decision: "approved" }));
  await approveProductionReport({ projectRoot, stage: stage.id, revision: productionReportRevision((await readProductionStage(projectRoot))!), path: "submissions/report.yaml" });
  const original = (await readProductionStage(projectRoot))!.tasks[0]!;
  await writeFile(join(agent, "submissions/article.md"), "---\ntitle: Service boundary\ndescription: The service isolation decision\n---\n\n<!-- context:section id=\"boundary\" -->\nAn independent service.\n<!-- /context:section -->\n");
  await writeFile(join(agent, "submissions/references.yaml"), YAML.stringify({ sections: [{ id: "boundary", references: [{ source_ref: note.source_ref,
    locator: { path: "decision.md", start_line: 2, end_line: 2 } }] }] }));
  await writeFile(join(agent, "submissions/ready.yaml"), YAML.stringify({ stage: stage.id, tasks: [{ task: original.id, input: original.input,
    content: "submissions/article.md", references: "submissions/references.yaml" }] }));
  const submit = () => completeProductionSubmission({ projectRoot, stage: stage.id, path: "submissions/ready.yaml" });
  expect((await submit()).failed).toEqual([]);
  const review = async (status: "approved" | "rejected") => {
    const candidates = await readCandidateRecords(projectRoot);
    const ids = candidates.map(candidate => candidate.candidate_id).sort();
    return applyReviewDecisions({ projectRoot, payload: { scope: { kind: "all", count: ids.length,
      visible_candidate_ids: ids, ids_sha256: candidateIdsHash(ids), candidates_sha256: candidateSetHash(candidates) },
      decisions: ids.map(candidate_id => ({ candidate_id, status })) } });
  };
  const initial = (await readCandidateRecords(projectRoot))[0]!;
  await review("rejected");
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("repair-production-articles");
  await writeFile(join(agent, "submissions/plan-amendment.yaml"), YAML.stringify(plan));
  expect(command(projectRoot, ["action", "complete-current", "--revision", stage.id,
    "--input", join(agent, "submissions/plan-amendment.yaml")]).stage_state).toBe("active");
  const revision = (await readProductionStage(projectRoot))!.tasks.find(task => task.status === "issued")!;
  expect(revision.article_id).toBe(original.article_id);
  expect(revision.id).not.toBe(original.id);
  const taskRoot = join(projectRoot, productionStageDirectory(stage.id), "batches", revision.batch, "tasks", revision.id);
  expect(await readFile(join(taskRoot, "base.md"), "utf8")).toBe(initial.body);
  const retained = YAML.parse(await readFile(join(taskRoot, "base-references.yaml"), "utf8"));
  expect(retained.sections[0].references).toEqual(initial.indexer_candidate.sections[0]!.references);
  await writeFile(join(agent, "submissions/edits.yaml"), YAML.stringify({ edits: [{ replace: ["boundary"],
    with: [{ id: "boundary", markdown: "The service has an independent boundary." }] }] }));
  await writeFile(join(agent, "submissions/ready.yaml"), YAML.stringify({ stage: stage.id,
    tasks: [{ task: revision.id, input: revision.input, edits: "submissions/edits.yaml" }] }));
  expect((await submit()).failed).toEqual([]);
  const repaired = (await readCandidateRecords(projectRoot))[0]!;
  expect(repaired.article_id).toBe(initial.article_id);
  expect(repaired.indexer_candidate.sections.map(({ section_ref, references }) => ({ section_ref, references })))
    .toEqual(initial.indexer_candidate.sections.map(({ section_ref, references }) => ({ section_ref, references })));
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("review-current-batch");
  await review("approved");
  expect((await closeProjectWorkspace(projectRoot)).verifyErrors).toBe(0);
  expect(await readFile(join(projectRoot, "knowledge", article.path), "utf8")).toContain("The service has an independent boundary.");
});

test("an initially unavailable source does not block independent writing and is investigated after restoration", async () => {
  const parent = resolve(".tmp/production-planning-entry-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "partial-")); roots.push(outer);
  const { projectRoot } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  const sources: Array<Awaited<ReturnType<typeof importManagedDocument>>> = [];
  for (const name of ["first", "later"]) sources.push(await importManagedDocument(projectRoot, { type: "note",
    name: `20260913/${name}.md`, markdown: `# ${name}\nAn independent observation.\n` }));
  await writeFile(join(projectRoot, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "observations", purpose: "Explain both observations",
    target_scope: { targets: sources.map(source => ({ source_ref: source.source_ref })) } }] }));
  const initiallyMissing = join(projectRoot, "sources/note/20260913/later.md");
  const heldInitialSource = join(outer, "held-later.md");
  await rename(initiallyMissing, heldInitialSource);
  await prepareCurrentProductionStage({ projectRoot, revision: (await productionPlanningRequest(projectRoot))!.revision });
  const stage = (await readProductionStage(projectRoot))!;
  expect(stage.scopes.find(source => source.scope === sources[1]!.source_ref)?.baseline).toBeNull();
  expect(stage.gaps.map(gap => gap.scope)).toEqual([sources[1]!.source_ref]);
  expect(stage.pending_scopes).toContain(sources[1]!.source_ref);
  const agent = join(projectRoot, productionAgentDirectory(stage.id));
  await mkdir(join(agent, "submissions"), { recursive: true });
  const plan = { stage: stage.id, capabilities: { skills: [] }, pending_scopes: [sources[1]!.source_ref],
    articles: [{ path: "decision/first.md", question: "What was first observed?", sources: [sources[0]!.source_ref], batch: "first" }] };
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify({ ...plan, pending_scopes: [] }));
  await expect(submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/plan.yaml" })).rejects.toMatchObject({ detail: {
    reason_code: "production-planning-refresh-required",
    missing_pending_scopes: [sources[1]!.source_ref],
    source_summary: { stage_source_count: 2, pending_scope_count: 2, unavailable_source_count: 1,
      pending_without_read_failure_count: 1, planned_article_count: 0,
      unavailable_sources: [{ scope: sources[1]!.source_ref, reason: expect.any(String) }] },
  } });
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify({ ...plan,
    articles: [{ ...plan.articles[0]!, sources: [sources[1]!.source_ref] }] }));
  await expect(submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/plan.yaml" })).rejects.toThrow("unavailable material");
  expect((await readProductionStage(projectRoot))!.tasks).toEqual([]);
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify(plan));
  expect((await submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/plan.yaml" })).stage_state).toBe("waiting-user");
  const planned = (await readProductionStage(projectRoot))!;
  expect(planned.pending_scopes).toEqual([sources[1]!.source_ref]);
  await writeFile(join(agent, "submissions/report.yaml"), YAML.stringify({ stage: stage.id, decision: "approved" }));
  await approveProductionReport({ projectRoot, stage: stage.id, revision: productionReportRevision(planned), path: "submissions/report.yaml" });
  const first = (await readProductionStage(projectRoot))!.tasks[0]!;
  await writeFile(join(agent, "submissions/article.md"), "---\ntitle: First observation\ndescription: Explain the first observation\n---\n\n<!-- context:section id=\"observation\" -->\nAn independent observation.\n<!-- /context:section -->\n");
  await writeFile(join(agent, "submissions/references.yaml"), YAML.stringify({ sections: [{ id: "observation", references: [{ source_ref: sources[0]!.source_ref,
    locator: { path: "first.md", start_line: 2, end_line: 2 } }] }] }));
  await writeFile(join(agent, "submissions/ready.yaml"), YAML.stringify({ stage: stage.id, tasks: [{ task: first.id, input: first.input,
    content: "submissions/article.md", references: "submissions/references.yaml" }] }));
  const result = await completeProductionSubmission({ projectRoot, stage: stage.id, path: "submissions/ready.yaml" });
  expect(result.failed).toEqual([]);
  expect(result.stage_state).toBe("active");
  const accepted = (await readProductionStage(projectRoot))!.tasks[0]!;
  expect((await productionWorkflowRoute({ projectRoot, authorities: [] }))!.node).toBe("resolve-production-gap");
  await expect(closeProjectWorkspace(projectRoot)).rejects.toMatchObject({ detail: { reason_code: "production-not-complete" } });
  await rename(heldInitialSource, initiallyMissing);
  await writeFile(join(agent, "submissions/restored-plan.yaml"), YAML.stringify({ ...plan,
    articles: [{ path: "decision/later.md", question: "Explain restored material", sources: [sources[1]!.source_ref], batch: "later" }] }));
  await expect(submitProductionPlan({ projectRoot, stage: stage.id, path: "submissions/restored-plan.yaml" }))
    .rejects.toMatchObject({ detail: { reason_code: "production-planning-refresh-required",
      next_action: { command: `context action prepare-current --revision ${stage.id} --format json` } } });
  await prepareCurrentProductionStage({ projectRoot, revision: stage.id });
  const initialRestored = (await readProductionStage(projectRoot))!;
  expect(initialRestored.gaps).toEqual([]);
  expect(initialRestored.scopes.find(source => source.scope === sources[1]!.source_ref)?.baseline).toMatch(/^sha256:/u);
  expect(initialRestored.tasks[0]).toEqual(accepted);
  expect(initialRestored.pending_scopes).toEqual([sources[1]!.source_ref]);
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("continue-production-investigation");
  await writeFile(join(agent, "submissions/plan-amendment.yaml"), YAML.stringify({ ...plan, pending_scopes: [], articles: [
    { path: "decision/later.md", question: "What was later observed?", sources: [sources[1]!.source_ref], batch: "later" }] }));
  command(projectRoot, ["action", "complete-current", "--revision", stage.id, "--input", join(agent, "submissions/plan-amendment.yaml")]);
  const extended = (await readProductionStage(projectRoot))!;
  expect(extended.pending_scopes).toEqual([]);
  expect(extended.tasks[0]).toEqual(accepted);
  expect(extended.tasks[1]!.status).toBe("issued");
  expect(extended.report_approved).toBe(true);
  expect((await readCandidateRecords(projectRoot)).map(candidate => candidate.candidate_id)).toEqual([accepted.accepted!.receipt]);
  const unaffectedPath = join(projectRoot, productionStageDirectory(stage.id), productionSourceFile(sources[0]!.source_ref));
  const unaffected = await readFile(unaffectedPath, "utf8");
  await importManagedDocument(projectRoot, { type: "note", name: "20260913/later.md", markdown: "# Later updated\nThe later observation changed.\n",
    base_digest: sources[1]!.digest });
  command(projectRoot, ["action", "prepare-current", "--revision", stage.id]);
  const refreshed = (await readProductionStage(projectRoot))!;
  expect(refreshed.tasks[0]).toEqual(accepted);
  expect(refreshed.tasks[1]!.status).toBe("blocked");
  expect(refreshed.pending_scopes).toEqual([sources[1]!.source_ref]);
  expect(await readFile(unaffectedPath, "utf8")).toBe(unaffected);
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("continue-production-investigation");
  await writeFile(join(agent, "submissions/plan-amendment.yaml"), YAML.stringify({ ...plan, pending_scopes: [],
    replaces: [refreshed.tasks[1]!.id], articles: [{ path: "decision/later.md", question: "What changed in the later observation?",
      sources: [sources[1]!.source_ref], batch: "later" }] }));
  command(projectRoot, ["action", "complete-current", "--revision", stage.id, "--input", join(agent, "submissions/plan-amendment.yaml")]);
  const replanned = (await readProductionStage(projectRoot))!;
  expect(replanned.tasks.map(task => task.status)).toEqual(["accepted", "replaced", "issued"]);
  expect(replanned.tasks[0]).toEqual(accepted);
  expect(replanned.tasks[2]!.sources[0]!.baseline).not.toBe(extended.tasks[1]!.sources[0]!.baseline);
  const missingPath = join(projectRoot, "sources/note/20260913/later.md");
  const heldPath = join(agent, "submissions/held-source.md");
  await rename(missingPath, heldPath);
  command(projectRoot, ["action", "prepare-current", "--revision", stage.id]);
  const missing = (await readProductionStage(projectRoot))!;
  expect(missing.gaps.map(gap => gap.scope)).toEqual([sources[1]!.source_ref]);
  expect(missing.tasks[0]).toEqual(accepted);
  expect(missing.scopes).toEqual(replanned.scopes);
  const recovery = (await productionWorkflowRoute({ projectRoot, authorities: [] }))!;
  expect(recovery.node).toBe("resolve-production-gap");
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("resolve-production-gap");
  expect(recovery.commands[0]!.command).toBe(`context action prepare-current --revision ${stage.id} --format json`);
  expect(recovery.commands[0]!.availability).toBe("after-human-confirmation");
  await rename(heldPath, missingPath);
  command(projectRoot, ["action", "prepare-current", "--revision", stage.id]);
  const restored = (await readProductionStage(projectRoot))!;
  expect(restored.gaps).toEqual([]);
  expect(restored.pending_scopes).toEqual([sources[1]!.source_ref]);
  expect(restored.tasks[0]).toEqual(accepted);
  expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("continue-production-investigation");
});
