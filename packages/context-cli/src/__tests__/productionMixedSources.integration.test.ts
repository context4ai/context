import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { productionPlanningRequest, submitProductionPlan } from "../project/productionPlanning.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { productionSourceFile, productionStageDirectory, readProductionStage } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { approveProductionReport, productionReportRevision } from "../project/productionReport.js";
import { completeProductionSubmission } from "../project/productionSubmission.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("code plus two documents share reader topics across skills and batches through repair, Review and delivery", async () => {
  const parent = resolve(".tmp/production-mixed-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const code = join(root, "fixture-source");
  await mkdir(join(code, "src"), { recursive: true });
  await writeFile(join(code, "src/limit.ts"), "export const retryLimit = 3;\n");
  await writeFile(join(code, "src/route.ts"), "export const retryRoute = '/retry';\n");
  await mkdir(join(code, "src/deprecated"), { recursive: true });
  await writeFile(join(code, "src/deprecated/old.ts"), "export const retiredRetry = true;\n");
  for (const args of [["init", "-q"], ["config", "user.email", "fixture@example.test"], ["config", "user.name", "Fixture"],
    ["add", "src"], ["commit", "-qm", "fixture"]]) execFileSync("git", args, { cwd: code });
  const ref = execFileSync("git", ["rev-parse", "HEAD"], { cwd: code, encoding: "utf8" }).trim();
  await mkdir(join(root, "sources/repo/20260913"), { recursive: true });
  await symlink(code, join(root, "sources/repo/20260913/service"));
  await writeFile(join(root, "sources/repo/index.yaml"), YAML.stringify({ sources: [{ name: "20260913", modules: [{
    name: "service", local: code, materializedAt: "sources/repo/20260913/service", git: { remote: "https://example.test/service.git", ref },
  }] }] }));
  const docs = ["manual", "runbook"];
  for (const name of docs) {
    const directory = join(outer, name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "guide.md"), name === "manual"
      ? "# Retry guide\nUse the retry endpoint for transient failures.\n## Limits\nStop after three attempts.\n"
      : "# Recovery\nInspect the error before retrying.\n## Escalation\nAsk the service owner after the final attempt.\n");
    await runCliInDir(root, ["source", "add", "file", "20260913", "--module", name, "--local", directory, "--format", "json"]);
  }
  await writeFile(join(root, "src/index.ts"), [
    'import { captureFile, defineProject, kbPackage, source } from "@c4a/context";',
    'const service = source("20260913", "service");',
    ...docs.map(name => `const ${name} = source("20260913", "${name}", { type: "file" });`),
    'export default defineProject({ sources: [service, manual, runbook], phases: [captureFile({source: manual}), captureFile({source: runbook})],',
    'packages: [kbPackage({name: "retry-guide", template: {path: "src/package-templates/kb", vars: {}}})] });',
  ].join("\n"));
  for (const name of docs) await runCliInDir(root, ["run", `capture:file:20260913/${name}`, "--format", "json"]);
  const sources = ["repo:20260913/service", ...docs.map(name => `file:20260913/${name}`)];
  const requirements = YAML.stringify({ requirements: [{ id: "retry", purpose: "Explain retry behavior and operational recovery",
    target_scope: { targets: sources.map(source_ref => ({ source_ref })) },
    exclusions: [{ scope: { targets: [{ source_ref: sources[0] }] }, paths: ["src/deprecated"], reason: "User requests only current APIs" }] }] });
  await writeFile(join(root, "src/indexers.yaml"), requirements);
  await prepareCurrentProductionStage({ projectRoot: root, revision: (await productionPlanningRequest(root))!.revision });
  const initial = (await readProductionStage(root))!;
  expect(initial.gaps).toEqual([]);
  const shared = (source: string) => readFile(join(root, productionStageDirectory(initial.id), productionSourceFile(source)), "utf8");
  expect(await shared(sources[0]!)).toContain("src/route.ts");
  expect(await shared(sources[0]!)).not.toContain("src/deprecated/old.ts");
  expect(await readFile(join(code, "src/deprecated/old.ts"), "utf8")).toContain("retiredRetry");
  // The captured source is directly readable; no separate material-expansion
  // receipt, symbol inventory or provider identity is required to inspect it.
  expect(await readFile(join(root, "sources/repo/20260913/service/src/route.ts"), "utf8"))
    .toContain("'/retry'");
  expect(await shared(sources[1]!)).toContain("## Limits");
  expect(await shared(sources[2]!)).toContain("## Escalation");
  const documentPaths = await Promise.all(sources.slice(1).map(async source => {
    const path = /^File: (.+)$/mu.exec(await shared(source))?.[1];
    if (!path) throw new Error("Document skeleton did not expose a captured file path");
    return path;
  }));
  const agent = join(root, productionAgentDirectory(initial.id));
  await mkdir(join(agent, "submissions"), { recursive: true });
  const skills = ["code-api", "code-configuration", "document-guide"];
  const plan = { stage: initial.id, capabilities: { multi_agent: true, skills: skills.map(name => ({ name })) },
    indexer_usage: [{ scopes: [sources[0]], skills: skills.slice(0, 2), purpose: "Inspect the route and retry limit in the same module" },
      { scopes: sources.slice(1), skills: [skills[2]], purpose: "Combine usage and recovery under the retry topic" }],
    articles: [{ path: "architecture/retry.md", question: "Which retry behavior does the service expose?", sources: [sources[0]], batch: "code" },
      { path: "faq/retry.md", question: "When should an operator retry and escalate?", sources, batch: "documents" }] };
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify(plan));
  await submitProductionPlan({ projectRoot: root, stage: initial.id, path: "submissions/plan.yaml" });
  const planned = (await readProductionStage(root))!;
  expect(planned.tasks.every(task => task.status === "pending")).toBe(true);
  await writeFile(join(agent, "submissions/report.yaml"), YAML.stringify({ stage: planned.id, decision: "approved" }));
  await approveProductionReport({ projectRoot: root, stage: planned.id, revision: productionReportRevision(planned),
    path: "submissions/report.yaml", multiAgent: true });
  const issued = (await readProductionStage(root))!;
  expect(issued.tasks.map(task => task.status)).toEqual(["issued", "issued"]);
  const bodies = ["The retry route has a limit of three attempts.", "Inspect failures, retry transient errors and escalate after three attempts."];
  const refs = [sources.slice(0, 1).map(source_ref => ({ source_ref, locator: { path: "src/limit.ts", start_line: 1, end_line: 1 } })),
    sources.map((source_ref, index) => ({ source_ref, locator: { path: index ? documentPaths[index - 1]! : "src/limit.ts", start_line: 1, end_line: index ? 4 : 1 } }))];
  for (const [index, task] of issued.tasks.entries()) {
    await writeFile(join(agent, `submissions/${index}.md`), `---\ntitle: ${task.question}\ndescription: Retry behavior and recovery\n---\n\n<!-- context:section id="answer" -->\n${bodies[index]}\n<!-- /context:section -->\n`);
    await writeFile(join(agent, `submissions/${index}.refs.yaml`), YAML.stringify({ sections: [{ id: "answer",
      references: index ? [{ source_ref: sources[0], locator: { path: "../outside.ts", start_line: 1, end_line: 1 } }] : refs[index] }] }));
  }
  await writeFile(join(agent, "submissions/ready.yaml"), YAML.stringify({ stage: issued.id, tasks: issued.tasks.map((task, index) => ({
    task: task.id, input: task.input, content: `submissions/${index}.md`, references: `submissions/${index}.refs.yaml`,
  })) }));
  const first = await completeProductionSubmission({ projectRoot: root, stage: issued.id, path: "submissions/ready.yaml" });
  expect(first.failed.filter(failure => failure.task !== issued.tasks[1]!.id)).toEqual([]);
  expect(first.accepted).toHaveLength(1);
  expect(first.failed).toMatchObject([{ task: issued.tasks[1]!.id, file: "submissions/1.refs.yaml" }]);
  const retained = (await readCandidateRecords(root))[0]!;
  await writeFile(join(agent, "submissions/1.refs.yaml"), YAML.stringify({ sections: [{ id: "answer",
    references: refs[1]!.map(reference => ({ ...reference, locator: { ...reference.locator, end_line: 999 } })),
  }] }));
  await writeFile(join(agent, "submissions/ready.yaml"), YAML.stringify({ stage: issued.id,
    tasks: [{ task: issued.tasks[1]!.id, input: issued.tasks[1]!.input,
      content: "submissions/1.md", references: "submissions/1.refs.yaml" }] }));
  const invalidRange = await completeProductionSubmission({ projectRoot: root, stage: issued.id, path: "submissions/ready.yaml" });
  expect(invalidRange.accepted).toEqual([]);
  expect(invalidRange.failed).toMatchObject([{ task: issued.tasks[1]!.id, section: "answer" }]);
  expect(await readCandidateRecords(root)).toEqual([retained]);
  await writeFile(join(agent, "submissions/repair.yaml"), YAML.stringify({ edits: [{ replace: ["answer"], with: [{ id: "answer", references: refs[1] }] }] }));
  await writeFile(join(agent, "submissions/ready.yaml"), YAML.stringify({ stage: issued.id,
    tasks: [{ task: issued.tasks[1]!.id, input: issued.tasks[1]!.input, edits: "submissions/repair.yaml" }] }));
  const repaired = await completeProductionSubmission({ projectRoot: root, stage: issued.id, path: "submissions/ready.yaml" });
  expect(repaired.failed).toEqual([]);
  expect(repaired.stage_state).toBe("ended");
  const candidates = await readCandidateRecords(root);
  expect(candidates.find(candidate => candidate.article_id === retained.article_id)).toEqual(retained);
  expect(candidates.find(candidate => candidate.path === "faq/retry.md")!.source_refs).toHaveLength(3);
  await approveCandidates(root, candidates);
  expect((await closeProjectWorkspace(root)).verifyErrors).toBe(0);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildFixturePackages(root);
  const formal = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
  expect(formal.articles).toHaveLength(2);
  expect(JSON.stringify(formal)).not.toMatch(/indexer_id|indexer_usage|provider|code-api/u);
  expect(await readFile(join(root, "knowledge/faq/retry.md"), "utf8")).toContain(bodies[1]!);
  expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).toBe(requirements);
}, 60_000);
