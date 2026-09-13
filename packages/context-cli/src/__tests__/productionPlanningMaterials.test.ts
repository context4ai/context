import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { productionDocumentSkeleton, prepareProductionPlanningMaterials } from "../project/productionPlanningMaterials.js";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import type { ProductionRequirements } from "../project/productionRequirements.js";
import YAML from "yaml";
import { productionPlanningRequest } from "../project/productionPlanning.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { readProductionStage } from "../project/productionStageStore.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("document skeleton recognizes reader headings, not frontmatter, code or HTML examples", () => {
  const markdown = ["---", "description: |", "  ## YAML example", "---", "# **Handbook**", "",
    "Overview", "--------", "", "### [Usage](./usage.md) ###", "", "```md", "## Code example", "```", "",
    "<div>", "## HTML example", "</div>", "", "    ## Indented example", "", "#### Detail"].join("\r\n");
  const output = productionDocumentSkeleton("handbook.md", markdown);
  expect(output.startsWith("# Handbook\n")).toBe(true);
  const outline = output.split("## Complete H2/H3 outline\n")[1]!;
  expect(outline).toContain("line 7: ## Overview");
  expect(outline).toContain("line 10: ### Usage");
  expect(outline).not.toMatch(/example|Detail/u);
});

test("opening stays bounded while headings after long text remain discoverable", () => {
  const output = productionDocumentSkeleton("guide.md", `# Guide\n${"x".repeat(5000)}\n\n## Later\n### End\n`);
  expect(output).not.toContain("x".repeat(1201));
  expect(output).toContain("line 4: ## Later");
  expect(output).toContain("line 5: ### End");
  expect(output).toContain("Opening excerpt ends");
});

test("saved material planning honors shared scope and explicit exclusions without a Provider", async () => {
  const parent = resolve(".tmp/production-planning-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const { projectRoot } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  const note = await importManagedDocument(projectRoot, { type: "note", name: "20260913/observations.md", markdown: "# Observation\n\n## Behavior\nAn observation." });
  const scope = { targets: [{ source_ref: note.source_ref }] };
  const requirements: ProductionRequirements = { requirements: [
    { id: "excluded", purpose: "Exclude from one purpose", target_scope: scope, exclusions: [{ scope, reason: "Not relevant here" }] },
    { id: "included", purpose: "Explain this observation", target_scope: scope },
  ] };
  const shared = await prepareProductionPlanningMaterials({ projectRoot, requirements });
  expect(shared.gaps).toEqual([]);
  expect(shared.materials.sources.get(note.source_ref)).toContain("## Behavior");
  const moduleExclusion = { scope: { targets: [{ source_ref: note.source_ref, module_refs: ["module:other"] }] },
    reason: "Exclude another module", paths: ["observations.md"] };
  for (const module_refs of [undefined, ["module:selected"], ["module:other", "module:selected"]]) {
    const scoped = await prepareProductionPlanningMaterials({ projectRoot, requirements: { requirements: [
      { id: "scoped", purpose: "Keep the selected scope visible", target_scope: { targets: [{ source_ref: note.source_ref, module_refs }] },
        exclusions: [moduleExclusion] },
    ] } });
    expect(scoped.materials.sources.get(note.source_ref)).toContain("## Behavior");
  }
  const matching = await prepareProductionPlanningMaterials({ projectRoot, requirements: { requirements: [
    { id: "matching", purpose: "Exclude the selected module path", target_scope: { targets: [{ source_ref: note.source_ref, module_refs: ["module:other"] }] },
      exclusions: [moduleExclusion] },
  ] } });
  expect(matching.materials.sources.get(note.source_ref)).not.toContain("## Behavior");
  const labelOnly = await prepareProductionPlanningMaterials({ projectRoot, requirements: { requirements: [
    { id: "label-only", purpose: "A module name does not identify excluded directories",
      target_scope: { targets: [{ source_ref: note.source_ref, module_refs: ["module:other"] }] },
      exclusions: [{ scope: moduleExclusion.scope, reason: "Unresolved directory guidance" }] },
  ] } });
  expect(labelOnly.gaps).toEqual([]);
  expect(labelOnly.materials.sources.get(note.source_ref)).toContain("## Behavior");
  const excluded = await prepareProductionPlanningMaterials({ projectRoot, requirements: { requirements: [requirements.requirements[0]!] } });
  expect(excluded.gaps).toEqual([]);
  expect(excluded.materials.sources.get(note.source_ref)).not.toContain("## Behavior");
  expect(excluded.materials.sources.get(note.source_ref)).toContain("explicitly excluded");
  const missing = await prepareProductionPlanningMaterials({ projectRoot, requirements: { requirements: [
    { id: "missing", purpose: "Investigate unavailable input", target_scope: { targets: [{ source_ref: "repo:missing" }] } },
  ] } });
  expect(missing.gaps).toHaveLength(1);
  expect(missing.materials.sources.get("repo:missing")).toContain("Investigation incomplete");
  const unavailableScope = { targets: [{ source_ref: "repo:missing" }] };
  const ignored = await prepareProductionPlanningMaterials({ projectRoot, requirements: { requirements: [
    { id: "excluded-unavailable", purpose: "Do not produce from this source", target_scope: unavailableScope,
      exclusions: [{ scope: unavailableScope, reason: "Explicitly out of scope" }] },
  ] } });
  expect(ignored.gaps).toEqual([]);
  expect(ignored.materials.sources.get("repo:missing")).toContain("no investigation was performed");
  await writeFile(join(projectRoot, "src/indexers.yaml"), YAML.stringify({ requirements: [
    { id: "exclude-unavailable", purpose: "Leave excluded input alone", target_scope: unavailableScope,
      exclusions: [{ scope: unavailableScope, reason: "Explicitly out of scope" }] },
    requirements.requirements[1],
  ] }));
  await prepareCurrentProductionStage({ projectRoot, revision: (await productionPlanningRequest(projectRoot))!.revision });
  const stage = (await readProductionStage(projectRoot))!;
  expect(stage.scopes.map(source => source.scope)).toEqual([note.source_ref]);
  expect(stage.pending_scopes).toEqual([note.source_ref]);
  expect(stage.gaps).toEqual([]);
});
