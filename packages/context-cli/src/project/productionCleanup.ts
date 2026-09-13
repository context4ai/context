import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type IndexerProjectFileTarget } from "@c4a/context";
import { productionAgentDirectory } from "./productionSubmissionFiles.js";
import { PRODUCTION_STAGES_ROOT, productionStageDirectory } from "./productionStageStore.js";
import type { ProductionStage } from "./productionStage.js";
import { safeProjectTarget, runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { TASK_PREPARATION_PATH, taskPreparationRecord } from "./taskResumption.js";

/** Called under the build write lock, after reviewed delivery and current
 * candidate cleanup. Keep the current manifest until all working files are
 * gone, then atomically switch to the existing explicit-new-task gate. */
export async function clearCompletedProduction(root: string, stage: ProductionStage): Promise<void> {
  const directory = productionStageDirectory(stage.id);
  const remove = async (path: string) => rm(await safeProjectTarget(root, path), { recursive: true, force: true });
  await remove(productionAgentDirectory(stage.id));
  const entries = await readdir(await safeProjectTarget(root, directory));
  for (const entry of entries) if (entry !== "manifest.json") await remove(join(directory, entry));
  const targets: IndexerProjectFileTarget[] = [];
  for (const path of [join(directory, "manifest.json"), join(PRODUCTION_STAGES_ROOT, "current.json")]) {
    const content = await readFile(await safeProjectTarget(root, path), "utf8");
    targets.push({ path, operation: "delete", base_digest: durableContentDigest(content), target_digest: null });
  }
  let previous: string | undefined;
  try { previous = await readFile(await safeProjectTarget(root, TASK_PREPARATION_PATH), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const content = JSON.stringify(taskPreparationRecord("cleared"));
  targets.push({ path: TASK_PREPARATION_PATH, operation: "write", content,
    base_digest: previous === undefined ? null : durableContentDigest(previous), target_digest: durableContentDigest(content) });
  await runDurableMultiFileTransaction({ projectRoot: root, kind: "production-cleanup",
    proposal_digest: durableContentDigest(JSON.stringify(stage)),
    targets: targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
}
