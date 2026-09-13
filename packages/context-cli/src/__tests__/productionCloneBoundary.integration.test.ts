import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionPlanningRequest } from "../project/productionPlanning.js";
import { completeProductionSubmission } from "../project/productionSubmission.js";

test("a copy without temporary process files starts fresh from formal knowledge, never restores accepted drafts", async () => {
  const parent = resolve(".tmp/production-clone-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-"));
  try {
    const { projectRoot: root } = await initContextProject({ cwd: outer, projectDir: "original", dev: true });
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const note = await importManagedDocument(root, { type: "note", name: "20260913/boundary.md",
      markdown: "# Boundary\nThe service owns its public interface.\n" });
    const requirements = YAML.stringify({ requirements: [{ id: "boundary", purpose: "Explain the service boundary",
      target_scope: { targets: [{ source_ref: note.source_ref }] } }] });
    await writeFile(join(root, "src/indexers.yaml"), requirements);
    await cp(resolve(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("import { defineProject }", "import { defineProject, kbPackage }")
      .replace("packages: []", 'packages: [kbPackage({ name: "boundary", template: { path: "src/package-templates/kb" } })]'));
    const article = (name: string) => ({ path: `architecture/${name}.md`, question: `Explain ${name}`,
      sources: [note.source_ref], markdown: `---\ntitle: ${name}\ndescription: Service boundary\n---\n\n<!-- context:section id="boundary" -->\nThe service owns its public interface.\n<!-- /context:section -->\n`,
      references: { sections: [{ id: "boundary", references: [{ source_ref: note.source_ref,
        locator: { path: "boundary.md", start_line: 2, end_line: 2 } }] }] } });
    await produceFixtureArticles(root, [article("approved")]);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildFixturePackages(root);
    const formal = await readFile(join(root, "knowledge/architecture/approved.md"), "utf8");
    const structure = await readFile(join(root, "knowledge/structure.yaml"), "utf8");
    await produceFixtureArticles(root, [article("unfinished")]);
    expect(await readCandidateRecords(root)).toHaveLength(1);
    const oldStage = (await readProductionStage(root))!;
    const clone = join(outer, "clone");
    await cp(root, clone, { recursive: true, filter: path => ![".tmp", "dist", ".git"].includes(relative(root, path).split("/")[0]!) });
    expect(await readCandidateRecords(clone)).toEqual([]);
    expect(await readProductionStage(clone)).toBeUndefined();
    expect(await readFile(join(clone, "knowledge/architecture/approved.md"), "utf8")).toBe(formal);
    expect(await readFile(join(clone, "knowledge/structure.yaml"), "utf8")).toBe(structure);
    expect(await readFile(join(clone, "src/indexers.yaml"), "utf8")).toBe(requirements);
    await expect(readFile(join(clone, "knowledge/architecture/unfinished.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(completeProductionSubmission({ projectRoot: clone, stage: oldStage.id, path: "submissions/articles.yaml" })).rejects.toMatchObject({
      detail: { reason_code: "stale-production-stage", next_action: { command: "context status --format json" }, input_schema: { type: "object" } },
    });
    expect(await productionPlanningRequest(clone)).toBeDefined();
    await produceFixtureArticles(clone, [article("fresh")]);
    expect((await readCandidateRecords(clone)).map(candidate => candidate.path)).toEqual(["architecture/fresh.md"]);
    expect((await readCandidateRecords(root)).map(candidate => candidate.path)).toEqual(["architecture/unfinished.md"]);
    expect(await readFile(join(clone, "knowledge/architecture/approved.md"), "utf8")).toBe(formal);
  } finally { await rm(outer, { recursive: true, force: true }); }
}, 30_000);
