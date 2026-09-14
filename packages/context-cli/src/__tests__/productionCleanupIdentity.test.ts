import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { clearCompletedProduction } from "../project/productionCleanup.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { productionStageDirectory, PRODUCTION_STAGES_ROOT } from "../project/productionStageStore.js";
import { validateProductionStage } from "../project/productionStage.js";
import { TASK_PREPARATION_PATH } from "../project/taskResumption.js";

test("stale cleanup preserves the current pointer, old drafts and task gate", async () => {
  const parent = resolve(".tmp/cleanup-identity-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  try {
    const stage = validateProductionStage({ id: "old", purpose: "Explain", scopes: [], tasks: [], pending_scopes: [] });
    const directory = join(root, productionStageDirectory(stage.id));
    const agent = join(root, productionAgentDirectory(stage.id));
    await mkdir(directory, { recursive: true });
    await mkdir(agent, { recursive: true });
    await writeFile(join(directory, "manifest.json"), JSON.stringify(stage));
    await writeFile(join(agent, "draft.md"), "Retain draft");
    const pointer = join(root, PRODUCTION_STAGES_ROOT, "current.json");
    await writeFile(pointer, '{"stage":"new"}');
    const gate = join(root, TASK_PREPARATION_PATH);
    await mkdir(join(gate, ".."), { recursive: true });
    await writeFile(gate, "Retain current task");
    await expect(clearCompletedProduction(root, stage)).rejects.toThrow("stage changed");
    expect(await readFile(pointer, "utf8")).toBe('{"stage":"new"}');
    expect(await readFile(join(agent, "draft.md"), "utf8")).toBe("Retain draft");
    expect(await readFile(gate, "utf8")).toBe("Retain current task");
  } finally { await rm(root, { recursive: true, force: true }); }
});
