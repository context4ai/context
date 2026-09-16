import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { readWorkspaceChangelog } from "./workspaceChangelog.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { withProjectWriteLock } from "./writeLock.js";
import { inspectProductionRequirements } from "./productionRequirements.js";
import { readProductionStage } from "./productionStageStore.js";
import { recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";

export const TASK_PREPARATION_PATH = ".tmp/context-runtime/task-preparation.json";
type PreparationState = "cleared" | "resume-requested";
export function taskPreparationRecord(state: PreparationState) {
  return { protocol: "context.task-preparation/v1", state };
}
export async function readTaskPreparation(root: string): Promise<PreparationState | undefined> {
  let text: string;
  try { text = await readFile(join(root, TASK_PREPARATION_PATH), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Formal knowledge/history survives a clone or discarded local caches.
    const existing = (await readKnowledgeStructure(root)).articles || (await readWorkspaceChangelog(root)).length;
    if (existing && !await readProductionStage(root)) return "cleared";
    return undefined;
  }
  const record = JSON.parse(text);
  if (record.protocol !== "context.task-preparation/v1" || !["cleared", "resume-requested"].includes(record.state)) {
    throw new TypeError("Invalid task preparation record; preserve the workspace for recovery");
  }
  return record.state;
}

/** Explicit user intent starts new production from formal results and sources. */
export async function resumeWorkspaceTask(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "resume-workspace-task", async () => {
    const { assertPreparationComplete } = await import("./workspacePreparation.js");
    await assertPreparationComplete(projectRoot);
    await recoverDurableMultiFileTransactions(projectRoot);
    const requirements = await inspectProductionRequirements(projectRoot);
    if (await readProductionStage(projectRoot)) return { action: "task-already-present", next: "context status --format json" };
    await atomicWriteFile(await safeProjectTarget(projectRoot, TASK_PREPARATION_PATH), JSON.stringify(taskPreparationRecord("resume-requested")));
    return { action: "task-resume-requested", preserves: ["approved articles and references", "captured sources", "long-term requirements", "existing build"],
      progress: !requirements ? "Confirm long-term reader requirements through the current route before fresh investigation."
        : "Begin fresh investigation from current authorized sources and existing articles. Previous temporary plans, candidates and skill declarations are not restored.",
      next: "context status --format json" };
  });
}
