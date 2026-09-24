import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { collectProjectStatus } from "../project/status.js";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workspace() {
  const parent = resolve(".tmp/production-bootstrap-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-"));
  roots.push(outer);
  const { projectRoot: root } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
  const note = await importManagedDocument(root, { type: "note", name: "20260913/decision.md",
    markdown: "# Decision\nThe service remains independent.\n" });
  await writeFile(join(root, "src/index.ts"), `import { defineProject, source } from "@c4a/context";
export default defineProject({ sources: [source("20260913/decision.md", { type: "note" })], phases: [], packages: [] });\n`);
  const requirementsPath = join(root, "src/indexers.yaml");
  const requirements = YAML.stringify({ requirements: [{ id: "service", purpose: "Explain the service boundary",
    target_scope: { targets: [{ source_ref: note.source_ref }] } }] });
  return { root, requirementsPath, requirements, source: note.source_ref };
}

describe("Production bootstrap follows the workspace Graph", () => {
  for (const managed of [false, true]) {
    const flags = managed ? ["--managed"] : [];
    test(`missing requirements exposes only long-term configuration (managed=${managed})`, async () => {
      const { root } = await workspace();
      const before = await collectProjectStatus(root, { managed });
      const summary = JSON.parse(await runCliInDir(root, ["status", ...flags, "--format", "json", "--view", "summary"]));
      expect(JSON.parse(await readFile(summary.next_route.file, "utf8"))).toEqual(before.workflow.current);
      const output = JSON.parse(await runCliInDir(root, ["run", ...flags, "--format", "json"]));
      expect(output.workflow).toEqual(before.workflow);
      expect(output.workflow.current).toMatchObject({ node: "configure-production-requirements",
        commands: [], configuration: { file: "src/indexers.yaml" } });
      expect(output).not.toHaveProperty("advanced");
      expect(await readProductionStage(root)).toBeUndefined();
      for (const resource of before.workflow.current!.resources.required) {
        if (resource.path) expect((await readFile(resource.path, "utf8")).length).toBeGreaterThan(0);
      }
    });

    test(`plain and dry run preserve an unprepared plan (managed=${managed})`, async () => {
      const { root, requirementsPath, requirements } = await workspace();
      await writeFile(requirementsPath, requirements);
      for (const dryRun of [false, true]) {
        const output = await runCurrentIndexerLifecycle({ projectRoot: root, managed, authorities: [], dryRun });
        expect(output.workflow.current?.node).toBe("prepare-production-planning");
        expect(output).not.toHaveProperty("advanced");
        expect(output).not.toHaveProperty("protocol");
        expect(await readProductionStage(root)).toBeUndefined();
        expect(await readFile(requirementsPath, "utf8")).toBe(requirements);
      }
    });

    test(`execution waits for source selection then stops for planning and report approval (managed=${managed})`, async () => {
      const { root, requirementsPath, requirements, source } = await workspace();
      const args = ["run", ...flags, "--until", "blocked-or-complete", "--format", "json", "--verbose"];
      const missing = JSON.parse(await runCliInDir(root, args));
      expect(missing).toMatchObject({ state: "blocked", steps: [],
        stop: { reasonCode: "workflow.until.configuration-required" } });
      await writeFile(requirementsPath, requirements);
      const selection = JSON.parse(await runCliInDir(root, args));
      expect(selection.steps).toEqual([]);
      expect(selection.workflow.current.node).toBe("prepare-production-planning");
      expect(await readProductionStage(root)).toBeUndefined();
      await runCliInDir(root, ["action", "prepare-current", "--revision", selection.workflow.current.revision,
        "--source", source, "--format", "json"]);
      const prepared = JSON.parse(await runCliInDir(root, args));
      expect(prepared.workflow.current.node).toBe("plan-production-stage");
      const stage = (await readProductionStage(root))!;
      expect(stage.planning_complete).toBe(false);
      expect(stage.tasks).toEqual([]);
      expect(stage.indexer_usage).toEqual([]);
      expect((JSON.parse(await runCliInDir(root, args))).steps).toEqual([]);
      expect(await readProductionStage(root)).toEqual(stage);
      const agent = join(root, productionAgentDirectory(stage.id), "submissions");
      await mkdir(agent, { recursive: true });
      const plan = join(agent, "plan.yaml");
      await writeFile(plan, YAML.stringify({ stage: stage.id, capabilities: { skills: [] },
        articles: [{ path: "decision/service.md", question: "Why is the service independent?",
          sources: [source], batch: "service" }] }));
      await runCliInDir(root, ["action", "complete-current", "--revision", stage.id,
        ...flags, "--input", plan, "--format", "json"]);
      const waiting = JSON.parse(await runCliInDir(root, args));
      expect(waiting.workflow.current.node).toBe("confirm-production-report");
      expect(waiting.workflow.current.gate.delegatable).toBe(false);
      const planned = (await readProductionStage(root))!;
      expect(planned.report_approved).toBe(false);
      expect(planned.tasks.map(task => task.status)).toEqual(["pending"]);
      expect((await runCurrentIndexerLifecycle({ projectRoot: root, managed, authorities: [] })).workflow.current?.node)
        .toBe("confirm-production-report");
      expect(await readProductionStage(root)).toEqual(planned);
      expect(await readFile(requirementsPath, "utf8")).toBe(requirements);
    }, 60_000);
  }

  test("invalid requirements remain an error without creating production state", async () => {
    const { root, requirementsPath } = await workspace();
    await writeFile(requirementsPath, "requirements: [invalid\n");
    const result = await runCurrentIndexerLifecycle({ projectRoot: root, managed: true, authorities: [] });
    expect(result.state).toBe("failed");
    expect(result.workflow.current).toMatchObject({ node: "repair-workspace-state",
      reason_code: "route.workspace.state-invalid" });
    expect(result.workflow.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error", message: expect.stringContaining("src/indexers.yaml"),
    }));
    expect(result.workflow.current!.commands.length).toBeGreaterThan(0);
    expect(await readProductionStage(root)).toBeUndefined();
    expect(await readFile(requirementsPath, "utf8")).toBe("requirements: [invalid\n");
  });
});
