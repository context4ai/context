import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { productionPlanningRequest } from "../project/productionPlanning.js";
import { prepareKnownProductionTasks } from "../project/productionKnownTasks.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionWorkflowRoute } from "../project/productionWorkflowRoute.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { productionReportRevision } from "../project/productionReport.js";
import { completeCurrentProductionAction } from "../project/productionAction.js";

async function runCliInDir(root: string, args: string[]): Promise<string> {
  return execFileSync("node", [resolve(import.meta.dir, "../../dist/cli.js"), ...args], {
    cwd: root, encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" },
  });
}

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const parent = resolve(".tmp/known-production-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const saved = await importManagedDocument(root, { type: "note", name: "20260913/access.md", markdown: "# Access\nAsk the owner for access.\n" });
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "access", purpose: "Explain access",
    target_scope: { targets: [{ source_ref: saved.source_ref }] } }] }));
  const path = ".tmp/agent-work/known.yaml";
  await mkdir(join(root, ".tmp/agent-work"), { recursive: true });
  const plan = { capabilities: { skills: [{ name: "context-note-indexer" }] }, articles: [{ path: "faq/access.md",
    question: "How do I obtain access?", sources: [saved.source_ref], batch: "access" }] };
  await writeFile(join(root, path), YAML.stringify(plan));
  return { root, path, plan, source: saved.source_ref, revision: (await productionPlanningRequest(root))!.revision };
}

test("known 1:1 work reaches the report with one preparation command and no separate plan submission", async () => {
  const f = await fixture();
  const command = ["action", "prepare-current", "--revision", f.revision, "--input", f.path, "--format", "json"];
  const started = performance.now();
  await runCliInDir(f.root, command);
  const stage = (await readProductionStage(f.root))!;
  expect(stage.planning_complete).toBe(true);
  expect(stage.report_approved).toBe(false);
  expect(stage.tasks.map(task => task.status)).toEqual(["pending"]);
  expect((await productionWorkflowRoute({ projectRoot: f.root, authorities: [] }))!.node).toBe("confirm-production-report");
  await runCliInDir(f.root, command);
  expect((await readProductionStage(f.root))!.tasks).toEqual(stage.tasks);
  const agent = join(f.root, productionAgentDirectory(stage.id), "submissions");
  await mkdir(agent, { recursive: true });
  await writeFile(join(agent, "report.yaml"), YAML.stringify({ stage: stage.id, decision: "approved" }));
  await runCliInDir(f.root, ["action", "complete-current", "--revision", productionReportRevision(stage),
    "--input", join(agent, "report.yaml"), "--format", "json"]);
  const task = (await readProductionStage(f.root))!.tasks[0]!;
  expect(task.status).toBe("issued");
  await writeFile(join(agent, "article.md"), "---\ntitle: Access\ndescription: How to get access\n---\n\n<!-- context:section id=\"access\" -->\nAsk the owner for access.\n<!-- /context:section -->\n");
  await writeFile(join(agent, "references.yaml"), YAML.stringify({ sections: [{ id: "access",
    references: [{ source_ref: f.source, locator: { path: "access.md", start_line: 2, end_line: 2 } }] }] }));
  await writeFile(join(agent, "ready.yaml"), YAML.stringify({ stage: stage.id,
    tasks: [{ task: task.id, input: task.input, content: "submissions/article.md", references: "submissions/references.yaml" }] }));
  const result = JSON.parse(await runCliInDir(f.root, ["action", "complete-current", "--revision", stage.id,
    "--input", join(agent, "ready.yaml"), "--format", "json"]));
  expect(result.accepted).toHaveLength(1);
  expect(result.failed).toEqual([]);
  expect(result.stage_state).toBe("ended");
  expect(YAML.parse(await readFile(join(f.root, "src/indexers.yaml"), "utf8"))).not.toHaveProperty("articles");
  // Measured fixture timing, not a claim about model reading/writing latency.
  console.info(`Known-task CLI fixture (including one idempotency retry): ${(performance.now() - started).toFixed(0)}ms`);
});

test.each(["json", "yaml"] as const)("large file-submission diagnostics remain complete in temporary output (%s)", async format => {
  const f = await fixture();
  await runCliInDir(f.root, ["action", "prepare-current", "--revision", f.revision, "--input", f.path, "--format", "json"]);
  const stage = (await readProductionStage(f.root))!;
  const directory = join(f.root, productionAgentDirectory(stage.id), "submissions");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "report.yaml"), YAML.stringify({ stage: stage.id, decision: "approved" }));
  await runCliInDir(f.root, ["action", "complete-current", "--revision", productionReportRevision(stage),
    "--input", join(directory, "report.yaml"), "--format", "json"]);
  const tasks = (await readProductionStage(f.root))!.tasks;
  await writeFile(join(directory, "article.md"), '---\ntitle: Access\ndescription: Access help\n---\n\n<!-- context:section id="access" -->\nAsk the owner.\n<!-- /context:section -->\n');
  await writeFile(join(directory, "references.yaml"), YAML.stringify({ sections: [{ id: "access",
    references: Array.from({ length: 500 }, (_, index) => ({ source_ref: f.source,
      locator: { path: "../outside-" + index + ".md", start_line: 1, end_line: 1 } })),
  }] }));
  await writeFile(join(directory, "ready.yaml"), YAML.stringify({ stage: stage.id, tasks: [{ task: tasks[0]!.id,
    input: tasks[0]!.input, content: "submissions/article.md", references: "submissions/references.yaml" }] }));
  const raw = await runCliInDir(f.root, ["action", "complete-current", "--revision", stage.id,
    "--input", join(directory, "ready.yaml"), "--format", format]);
  const summary = YAML.parse(raw);
  expect(Buffer.byteLength(raw)).toBeLessThan(16 * 1024);
  expect(summary).toMatchObject({ accepted_count: 0, failed_count: 1 });
  expect(summary.details.startsWith(join(f.root, ".tmp/"))).toBe(true);
  const full = JSON.parse(await readFile(summary.details, "utf8"));
  expect(full.failed).toMatchObject([{ task: tasks[0]!.id, file: "submissions/references.yaml" }]);
  expect(full.failed[0].reason.length).toBeGreaterThan(16 * 1024);
  expect(full.failed[0].reason).toContain("499");
  expect(summary.next).toEqual(full.next);
  expect((await readProductionStage(f.root))!.tasks).toEqual(tasks);
});

test("known tasks retain source authorization and reject unsafe files before creating a stage", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "outside.yaml"), YAML.stringify(f.plan));
  await symlink(join(f.root, "outside.yaml"), join(f.root, ".tmp/agent-work/link.yaml"));
  for (const path of ["outside.yaml", ".tmp/agent-work/link.yaml"]) {
    await expect(prepareKnownProductionTasks({ projectRoot: f.root, cwd: f.root, revision: f.revision, path })).rejects.toMatchObject({
      detail: { reason_code: "invalid-production-file" },
    });
    expect(await readProductionStage(f.root)).toBeUndefined();
  }
  await writeFile(join(f.root, f.path), YAML.stringify({ ...f.plan,
    articles: [{ ...f.plan.articles[0], sources: ["repo:not-authorized"] }] }));
  await expect(prepareKnownProductionTasks({ projectRoot: f.root, cwd: f.root, revision: f.revision, path: f.path })).rejects.toThrow("outside authorized");
  expect(await readProductionStage(f.root)).toBeUndefined();
});

test("the real action boundary returns actionable plan, report and syntax failures without altering tasks", async () => {
  const f = await fixture();
  await prepareKnownProductionTasks({ projectRoot: f.root, cwd: f.root, revision: f.revision, path: f.path });
  const stage = (await readProductionStage(f.root))!;
  const path = join(productionAgentDirectory(stage.id), "submissions/bad.yaml");
  const submit = (revision = stage.id) => completeCurrentProductionAction({ projectRoot: f.root, cwd: f.root,
    revision, submissionPath: path });
  await mkdir(join(f.root, productionAgentDirectory(stage.id), "submissions"), { recursive: true });
  await writeFile(join(f.root, path), YAML.stringify({ ...f.plan, stage: stage.id,
    articles: [{ ...f.plan.articles[0], question: false }] }));
  await expect(submit()).rejects.toMatchObject({ detail: { reason_code: "production-plan-failed",
    issues: [{ path: ["articles", 0, "question"] }], next_action: { command: "context status --format json" } } });
  await writeFile(join(f.root, path), YAML.stringify({ stage: stage.id, decision: "not-approved" }));
  await expect(submit(productionReportRevision(stage))).rejects.toMatchObject({ detail: { reason_code: "production-report-failed",
    issues: [{ path: ["decision"] }] } });
  await writeFile(join(f.root, path), "stage: [");
  await expect(submit()).rejects.toMatchObject({ detail: { reason_code: "production-action-failed", file: path } });
  expect(await readProductionStage(f.root)).toEqual(stage);
});

test("the same known article saves one real CLI round trip before writing without skipping report confirmation", async () => {
  const measurements = [];
  for (const direct of [false, true]) {
    const f = await fixture();
    let calls = 0, outputBytes = 0;
    const command = async (args: string[]) => {
      calls++;
      const output = await runCliInDir(f.root, [...args, "--format", "json"]);
      outputBytes += Buffer.byteLength(output);
      return output;
    };
    const started = performance.now();
    await command(["action", "prepare-current", "--revision", f.revision, ...(direct ? ["--input", f.path] : [])]);
    let stage = (await readProductionStage(f.root))!;
    const submissions = join(f.root, productionAgentDirectory(stage.id), "submissions");
    await mkdir(submissions, { recursive: true });
    if (!direct) {
      const file = join(submissions, "plan.yaml");
      await writeFile(file, YAML.stringify({ ...f.plan, stage: stage.id }));
      await command(["action", "complete-current", "--revision", stage.id, "--input", file]);
      stage = (await readProductionStage(f.root))!;
    }
    expect(stage.report_approved).toBe(false);
    expect(stage.tasks.map(task => task.status)).toEqual(["pending"]);
    const report = join(submissions, "report.yaml");
    await writeFile(report, YAML.stringify({ stage: stage.id, decision: "approved" }));
    await command(["action", "complete-current", "--revision", productionReportRevision(stage), "--input", report]);
    expect((await readProductionStage(f.root))!.tasks.map(task => task.status)).toEqual(["issued"]);
    measurements.push({ mode: direct ? "known-task" : "prepare-and-plan", calls, output_bytes: outputBytes,
      ready_for_writing_ms: Math.round(performance.now() - started) });
  }
  expect(measurements.map(item => item.calls)).toEqual([3, 2]);
  // Do not assert a wall-time ratio: these are local Node process timings,
  // excluding model reading, authoring and the human's report response time.
  console.info(`Same-article CLI comparison: ${JSON.stringify(measurements)}`);
});


test("known-task schema is available before a workspace or revision exists", async () => {
  const schema = JSON.parse(await runCliInDir(resolve(".tmp"), ["action", "prepare-current", "--schema", "--format", "json"]));
  expect(schema.properties.articles.items.properties.sources).toBeDefined();
  expect(schema.required).not.toContain("stage");
  expect(schema.properties.capabilities).toBeDefined();
});
