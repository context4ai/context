import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { inspectProductionRequirements, validateProductionRequirements } from "../project/productionRequirements.js";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { readSourceStatus } from "../project/statusReaders.js";
import { productionWorkflowRoute } from "../project/productionWorkflowRoute.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { resumeWorkspaceTask, readTaskPreparation } from "../project/taskResumption.js";
import { collectProjectStatus } from "../project/status.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(initialize = false) {
  const parent = resolve(".tmp/production-requirements-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = initialize ? (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot : outer;
  await mkdir(join(root, "src"), { recursive: true });
  return root;
}
const target = { source_ref: "repo:service", module_refs: ["module:service/api"] };
const configured = { requirements: [{ id: "service", purpose: "Explain the service API",
  reader_goals: ["understand-api"], target_scope: { targets: [target] },
  exclusions: [{ scope: { targets: [target] }, reason: "Generated artifacts do not need articles", paths: ["generated"] }],
}] };

test("current requirements preserve reader obligations without creating a second configuration or process file", async () => {
  const root = await fixture();
  const path = join(root, "src/indexers.yaml");
  const content = YAML.stringify(configured);
  await writeFile(path, content);
  expect((await inspectProductionRequirements(root))!.requirements).toEqual(configured);
  expect(await readFile(path, "utf8")).toBe(content);
  expect(await readdir(join(root, "src"))).toEqual(["indexers.yaml"]);
  await rm(join(root, ".tmp"), { recursive: true, force: true });
  expect((await inspectProductionRequirements(root))!.requirements).toEqual(configured);
});

test("invalid fields and unsafe exclusions report the configuration without silently rewriting it", async () => {
  const root = await fixture();
  const path = join(root, "src/indexers.yaml");
  const content = YAML.stringify({ requirements: [{ ...configured.requirements[0], custom_reader_rules: "Must preserve this decision" }] });
  await writeFile(path, content);
  await expect(inspectProductionRequirements(root)).rejects.toMatchObject({ detail: {
    reason_code: "invalid-production-requirements", configuration: { file: "src/indexers.yaml" },
  } });
  expect(await readFile(path, "utf8")).toBe(content);
  expect(() => validateProductionRequirements({ ...configured, indexers: [] })).toThrow();
  expect(() => validateProductionRequirements({ requirements: [{ ...configured.requirements[0], exclusions: [
    { scope: { targets: [target] }, reason: "Invalid path", paths: ["../outside"] },
  ] }] })).toThrow("source-relative");
});

test("saved note discovery uses confirmed scope without loading or retaining an Indexer", async () => {
  const root = await fixture(true);
  const selected = await importManagedDocument(root, { type: "note", name: "20260913/selected.md", markdown: "# Selected\nAn authorized observation." });
  await importManagedDocument(root, { type: "note", name: "20260913/saved-only.md", markdown: "# Saved only\nNot selected for production." });
  const requirements = { requirements: [{ id: "observations", purpose: "Explain the selected observation",
    target_scope: { targets: [{ source_ref: selected.source_ref }] } }] };
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify(requirements));
  const sources = await readSourceStatus(root);
  expect(sources.diagnostics).toEqual([]);
  expect(sources.documentSources.map(source => `${source.type}:${source.name}`)).toEqual([selected.source_ref]);
  expect((await inspectProductionRequirements(root))!.requirements).toEqual(requirements);
});

test("resume and full status go directly to current planning without a migration step", async () => {
  const root = await fixture(true);
  const note = await importManagedDocument(root, { type: "note", name: "20260913/decision.md", markdown: "# Decision\nKeep the reader purpose." });
  const requirements = { requirements: [{ id: "decisions", purpose: "Explain the saved decision",
    target_scope: { targets: [{ source_ref: note.source_ref }] } }] };
  const path = join(root, "src/indexers.yaml");
  const content = YAML.stringify(requirements);
  await writeFile(path, content);
  const resumed = await resumeWorkspaceTask(root);
  expect(resumed.action).toBe("task-resume-requested");
  expect(resumed).not.toHaveProperty("requirement_set_digest");
  expect(resumed).not.toHaveProperty("request_digest");
  expect(await readTaskPreparation(root)).toBe("resume-requested");
  expect((await productionWorkflowRoute({ projectRoot: root, authorities: [] }))!.node).toBe("prepare-production-planning");
  expect((await collectProjectStatus(root)).workflow.current?.node).toBe("prepare-production-planning");
  expect(await readFile(path, "utf8")).toBe(content);
  expect(await readProductionStage(root)).toBeUndefined();
});
