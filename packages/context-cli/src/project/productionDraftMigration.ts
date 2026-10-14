import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { indexerProtocolDigest } from "@c4a/context";
import { productionAgentDirectory } from "./productionSubmissionFiles.js";
import { readProductionRepairDraft } from "./productionRepairDraft.js";
import { safeProjectTarget, runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import type { ProductionStage, ProductionTask } from "./productionStage.js";

/** The projected edits skeleton carries no Agent work. */
function emptyEdits(text: string): boolean {
  try { const value = YAML.parse(text); return Array.isArray(value?.edits) && value.edits.length === 0 && Object.keys(value).length === 1; }
  catch { return false; }
}

export interface DraftMigration { from: string; to: string; outcome: "copied" | "kept" | "rebase-required" }
/** Called under the planning write lock. A repair draft is not the task.base
 * snapshot; never attach its edits to a different editing base. */
export async function migrateProductionDrafts(root: string, stage: ProductionStage, tasks: readonly ProductionTask[], replaces: readonly string[]): Promise<DraftMigration[]> {
  const result: DraftMigration[] = [];
  const read = async (path: string) => {
    try { return await readFile(await safeProjectTarget(root, path), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  };
  for (const task of tasks) {
    const previous = stage.tasks.filter(old => replaces.includes(old.id) && old.article_id === task.article_id && old.path === task.path);
    if (previous.length !== 1) continue;
    const old = previous[0]!;
    const from = join(productionAgentDirectory(stage.id), "batches", old.batch, old.id);
    const to = join(productionAgentDirectory(stage.id), "batches", task.batch, task.id);
    const names = ["edits.yaml", "article.md", "references.yaml"];
    const draftsIn = async (directory: string) => (await Promise.all(names.map(async name => ({ name, content: await read(join(directory, name)) }))))
      .filter((item): item is { name: string; content: string } => item.content !== undefined && !(item.name === "edits.yaml" && emptyEdits(item.content)));
    const drafts = await draftsIn(from);
    if (!drafts.length) continue;
    // A retained failed draft has no validated digest. Its editing provenance
    // cannot be transferred just because the formal target is unchanged.
    const repair = await readProductionRepairDraft({ projectRoot: root, stage: stage.id, task: old });
    if (old.base !== task.base || (repair && drafts.some(item => item.name === "edits.yaml"))) {
      result.push({ from, to, outcome: "rebase-required" }); continue;
    }
    if ((await draftsIn(to)).length) { result.push({ from, to, outcome: "kept" }); continue; }
    const targets = await Promise.all(drafts.map(async item => {
      const existing = await read(join(to, item.name));
      return { path: join(to, item.name), operation: "write" as const, base_digest: existing === undefined ? null : durableContentDigest(existing),
        target_digest: durableContentDigest(item.content), content: item.content };
    }));
    await runDurableMultiFileTransaction({ projectRoot: root, kind: "production-draft-migration",
      proposal_digest: indexerProtocolDigest({ from, to, drafts }), targets });
    result.push({ from, to, outcome: "copied" });
  }
  return result;
}
