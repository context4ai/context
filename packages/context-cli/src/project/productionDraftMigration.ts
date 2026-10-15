import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { productionAgentDirectory } from "./productionSubmissionFiles.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import type { ProductionStage, ProductionTask } from "./productionStage.js";

/** The projected edits skeleton carries no Agent work. */
function emptyEdits(text: string): boolean {
  try { const value = YAML.parse(text); return Array.isArray(value?.edits) && value.edits.length === 0 && Object.keys(value).length === 1; }
  catch { return false; }
}

export interface PreviousDraft { task: string; from: string; to: string }
/** Drafts of replaced tasks for the same article are reported, never copied:
 * only the Agent can judge whether that work still fits. Derived from the saved
 * stage, so every preparation and replay reports them again. */
export async function previousProductionDrafts(root: string, stage: ProductionStage, tasks: readonly ProductionTask[] = stage.tasks): Promise<PreviousDraft[]> {
  const result: PreviousDraft[] = [];
  for (const task of tasks) {
    if (task.status === "replaced") continue;
    for (const old of stage.tasks.filter(old => old.status === "replaced" && old.article_id === task.article_id && old.path === task.path)) {
      const from = join(productionAgentDirectory(stage.id), "batches", old.batch, old.id);
      for (const name of ["edits.yaml", "article.md", "references.yaml"]) {
        let content: string;
        try { content = await readFile(await safeProjectTarget(root, join(from, name)), "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        if (name === "edits.yaml" && emptyEdits(content)) continue;
        result.push({ task: task.id, from, to: join(productionAgentDirectory(stage.id), "batches", task.batch, task.id) });
        break;
      }
    }
  }
  return result;
}
