import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { submitProductionPlan } from "../project/productionPlanning.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { assertSourceInputMutable } from "../project/sourceInputMutation.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("same-task source adjustment preserves accepted content and independent source tasks", async () => {
  const parent = resolve(".tmp/production-source-adjustment-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const saved = [];
  for (const name of ["first", "peer"]) saved.push(await importManagedDocument(root, {
    type: "note", name: `20260913/${name}.md`, markdown: `# ${name}\nOriginal decision.\n`,
  }));
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "decisions", purpose: "Explain both decisions",
    target_scope: { targets: saved.map(source => ({ source_ref: source.source_ref })) } }] }));
  await produceFixtureArticles(root, saved.map((source, index) => ({ path: `decision/${index}.md`, question: `Explain decision ${index}`,
    sources: [source.source_ref], markdown: `---\ntitle: Decision ${index}\ndescription: Explain the decision\n---\n\n<!-- context:section id="decision" -->\nOriginal decision.\n<!-- /context:section -->\n`,
    references: { sections: [{ id: "decision", references: [{ source_ref: source.source_ref,
      locator: { path: index === 0 ? "first.md" : "peer.md", start_line: 2, end_line: 2 } }] }] },
  })));
  const original = (await readProductionStage(root))!;
  const candidates = await readCandidateRecords(root);
  const plan = join(root, productionAgentDirectory(original.id), "submissions/amend.yaml");
  await writeFile(plan, YAML.stringify({ stage: original.id, capabilities: { multi_agent: true },
    articles: saved.map((source, index) => ({ path: `faq/${index}.md`, question: `Explain follow-up ${index}`,
      sources: [source.source_ref], batch: `followup-${index}` })) }));
  await submitProductionPlan({ projectRoot: root, stage: original.id, path: "submissions/amend.yaml" });
  const before = (await readProductionStage(root))!;
  expect(before.tasks.filter(task => task.status === "issued")).toHaveLength(2);
  const requirements = await readFile(join(root, "src/indexers.yaml"), "utf8");
  await expect(adjustCurrentTaskSources(root, { instruction: "Read another source", scopes: [{ source_ref: "repo:outside" }] })).rejects.toThrow("authorized");
  expect(await readProductionStage(root)).toEqual(before);
  const result = await adjustCurrentTaskSources(root, { instruction: "Refresh the first decision", scopes: [
    { source_ref: saved[0]!.source_ref, module_refs: ["a-reading-focus-not-a-path-map"] },
  ] });
  expect(result).toMatchObject({ action: "adjusted", affected_tasks: 1, retained_candidates: 2 });
  const adjusted = (await readProductionStage(root))!;
  expect(adjusted.tasks.find(task => task.path === "faq/0.md")!.status).toBe("blocked");
  expect(adjusted.tasks.find(task => task.path === "faq/1.md")).toEqual(before.tasks.find(task => task.path === "faq/1.md"));
  expect(await readCandidateRecords(root)).toEqual(candidates);
  await importManagedDocument(root, { type: "note", name: "20260913/first.md", base_digest: saved[0]!.digest,
    markdown: "# first\nUpdated decision.\n" });
  await prepareCurrentProductionStage({ projectRoot: root, revision: original.id });
  const refreshed = (await readProductionStage(root))!;
  expect(refreshed.tasks.find(task => task.path === "faq/1.md")).toEqual(before.tasks.find(task => task.path === "faq/1.md"));
  expect(await readCandidateRecords(root)).toEqual(candidates);
  expect(await beginDocumentRevision({ projectRoot: root, selector: "decision/0.md", instruction: "Revise against the updated decision" }))
    .toMatchObject({ status: "production-revision-prepared" });
  const revised = (await readProductionStage(root))!;
  const refreshedBaseline = refreshed.scopes[0]!.baseline;
  if (refreshedBaseline === null) throw new Error("Expected the refreshed captured source baseline");
  expect(revised.tasks.at(-1)!.sources[0]!.baseline).toBe(refreshedBaseline);
  expect(revised.tasks.at(-1)!.sources[0]!.baseline).not.toBe(original.tasks[0]!.sources[0]!.baseline);
  expect(await readFile(join(root, "src/indexers.yaml"), "utf8")).toBe(requirements);
  await rm(join(root, ".tmp"), { recursive: true, force: true });
  const retired = join(root, ".tmp/context-runtime/indexer/main-index");
  await mkdir(retired, { recursive: true });
  await writeFile(join(retired, "current.json"), "Invalid retired Provider ledger");
  await expect(assertSourceInputMutable(root, saved[0]!.source_ref)).resolves.toBeUndefined();
  await expect(adjustCurrentTaskSources(root, { instruction: "Start a new adjustment", scopes: [{ source_ref: saved[0]!.source_ref }] }))
    .rejects.toMatchObject({ detail: { reason_code: "no-current-source-adjustment", next_action: { command: "context status --format json" } } });
});
