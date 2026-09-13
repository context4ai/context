import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { productionStageDirectory, writeProductionProjection } from "./productionStageStore.js";
import { productionReferencesSchema } from "./productionArticle.js";
import type { ProductionArticleBase } from "./productionArticleEdits.js";
import type { FixedProductionTask } from "./productionSubmissionFiles.js";
import type { ProductionTask } from "./productionStage.js";

const draftSchema = z.object({ input: z.string(), markdown: z.string(), references: z.string() }).strict();

function draftPath(stage: string, task: ProductionTask): string {
  // Task identities are validated by the stage schema before this module runs.
  return join(productionStageDirectory(stage), "repair-drafts", `${task.id}.json`);
}

/** Rejected complete inputs are scratch, not received Candidates. Preserve the
 * fixed text read by this submission so later edits never reopen a moving
 * Agent draft. Clearing .tmp deliberately removes this repair convenience. */
export async function retainProductionRepairDraft(input: {
  projectRoot: string; stage: string; task: ProductionTask; files: FixedProductionTask;
}): Promise<void> {
  if (!input.files.content || !input.files.references) return;
  await writeProductionProjection(input.projectRoot, draftPath(input.stage, input.task), JSON.stringify({
    input: input.task.input, markdown: input.files.content.text, references: input.files.references.text,
  }));
}

export async function readProductionRepairDraft(input: {
  projectRoot: string; stage: string; task: ProductionTask;
}): Promise<ProductionArticleBase | undefined> {
  let text: string;
  try { text = await readFile(await safeProjectTarget(input.projectRoot, draftPath(input.stage, input.task)), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const draft = draftSchema.parse(JSON.parse(text));
  if (draft.input !== input.task.input) throw new TypeError("Repair draft belongs to an older task input. Read the current task and submit a complete draft.");
  try {
    return { markdown: draft.markdown, sections: productionReferencesSchema.parse(YAML.parse(draft.references)).sections };
  } catch {
    throw new TypeError("The retained draft's reference file is structurally invalid. Submit the corrected complete draft and references.");
  }
}
