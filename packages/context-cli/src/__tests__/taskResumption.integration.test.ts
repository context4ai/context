import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { readTaskPreparation, resumeWorkspaceTask, TASK_PREPARATION_PATH, taskPreparationRecord } from "../project/taskResumption.js";
import { collectProjectStatus } from "../project/status.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { readCandidateRecords } from "../project/candidateLedger.js";

for (const retainedMarker of [false, true]) test(`new production uses long-term requirements without restoring Provider state (marker=${retainedMarker})`, async () => {
  const parent = resolve(".tmp/task-resumption-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-"));
  try {
    const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
    await mkdir(join(root, "sources/note/20260913"), { recursive: true });
    const source = "sources/note/20260913/decision.md";
    await writeFile(join(root, source), "# Decision\nKeep the source of a decision explicit.\n");
    await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ requirements: [{ id: "decisions", purpose: "Explain decisions",
      target_scope: { targets: [{ source_ref: "note:20260913/decision.md" }] }, exclusions: [] }] }));
    const before = await readFile(join(root, source), "utf8");
    if (retainedMarker) {
      await mkdir(join(root, ".tmp/context-runtime"), { recursive: true });
      await writeFile(join(root, TASK_PREPARATION_PATH), JSON.stringify(taskPreparationRecord("cleared")));
      expect((await collectProjectStatus(root)).workflow.current?.node).toBe("reopen-cleared-task");
    } else {
      expect(await readTaskPreparation(root)).toBeUndefined();
      expect((await collectProjectStatus(root)).workflow.current?.node).toBe("prepare-production-planning");
    }
    expect((await resumeWorkspaceTask(root)).action).toBe("task-resume-requested");
    expect(await readTaskPreparation(root)).toBe("resume-requested");
    const route = (await collectProjectStatus(root)).workflow.current!;
    expect(route.node).toBe("prepare-production-planning");
    await prepareCurrentProductionStage({ projectRoot: root, revision: route.revision });
    const stage = (await readProductionStage(root))!;
    expect(stage.tasks).toEqual([]);
    expect(stage.report_approved).toBe(false);
    expect(stage.indexer_usage).toEqual([]);
    expect(await readCandidateRecords(root)).toEqual([]);
    expect((await resumeWorkspaceTask(root)).action).toBe("task-already-present");
    expect(await readProductionStage(root)).toEqual(stage);
    // A prior delivery must not hide a still-present new production stage.
    await writeFile(join(root, "changelog.yaml"), YAML.stringify({ entries: [{ version: "0.1.0", date: "2026-01-01T00:00:00.000Z", title: "Delivery", changes: ["Guide"], triggers: [{kind: "initial", description: "Request"}] }] }));
    await rm(join(root, TASK_PREPARATION_PATH));
    expect(await readTaskPreparation(root)).toBeUndefined();
    expect(await readProductionStage(root)).toEqual(stage);
    expect(await readFile(join(root, source), "utf8")).toBe(before);
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});
