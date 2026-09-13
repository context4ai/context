import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withProjectWriteLock } from "./writeLock.js";
import { readProductionStage, saveProductionStage, prepareNextProductionStage } from "./productionStageStore.js";
import { productionTaskInput, reviseProductionPlan } from "./productionStage.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { productionApprovedTargetsIndex, productionArticleTargetDigest, readProductionArticleTarget } from "./productionArticleTarget.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { productionSourceBaseline } from "./productionSubmission.js";
import { safeProjectTarget, recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { withProductionFeedback } from "./productionFeedback.js";

/** A selected article already has a known boundary. Reopen its writing task
 * directly; do not ask the Agent to rediscover or submit a partition plan. */
export async function beginProductionRevision(input: {
  projectRoot: string; selector: string; instruction: string; move_to?: string;
}) {
  return withProductionFeedback({ operation: "revision" }, () => withProjectWriteLock(input.projectRoot, "production-revision", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const stage = await readProductionStage(input.projectRoot);
    if (!stage) return undefined;
    if ((await readMaintenance(input.projectRoot)).active) return undefined;
    const candidates = await readCandidateRecords(input.projectRoot);
    const selector = input.selector.normalize("NFC").replace(/^\.\//u, "").replace(/^knowledge\//u, "").toLocaleLowerCase();
    const selected = candidates.filter(candidate => [candidate.path, candidate.candidate_id, candidate.review.title]
      .some(alias => alias.normalize("NFC").toLocaleLowerCase() === selector));
    const paths = new Set([...selected.map(candidate => candidate.path), ...stage.tasks.filter(task =>
      [task.path, task.article_id].some(alias => alias.toLocaleLowerCase() === selector)).map(task => task.path)]);
    if (!paths.size) return undefined;
    const invalid = (message: string) => new ContextError(ExitCode.UserError, message, {
      category: ErrorCategory.UserInputInvalid, reason_code: "production-revision-unavailable",
      next_action: { command: "context status --format json" },
      input_schema: { type: "object", properties: { selector: { type: "string" }, instruction: { type: "string" } }, required: ["selector", "instruction"] },
    });
    if (paths.size !== 1) throw invalid("Select one exact article path; this title identifies multiple current articles.");
    if (!stage.report_approved || stage.delivery || input.move_to) throw invalid("Finish the current report or delivery before revising; article moves use the structure-aware revision after this production run.");
    await assertProductionPlanRequirementsCurrent(input.projectRoot, stage);
    const path = [...paths][0]!;
    const owner = [...stage.tasks].reverse().find(task => task.path === path && !["excluded", "replaced"].includes(task.status));
    if (!owner) throw invalid("The selected article has no current production task. Read the current workflow before revising.");
    const unfinished = !["accepted", "excluded", "replaced"].includes(owner.status);
    let updated = stage;
    if (!unfinished || owner.question !== input.instruction || owner.status === "blocked") {
      const approved = productionApprovedTargetsIndex(await readApprovedKnowledgeMetadataIndex(input.projectRoot));
      const prior = candidates.find(candidate => candidate.path === path);
      const formal = approved.byPath.get(path);
      if (!prior && !formal) throw invalid("Write the current task first; there is no article draft to revise yet.");
      const markdown = prior?.body ?? await readFile(await safeProjectTarget(input.projectRoot, join("knowledge", path)), "utf8");
      const sections = prior?.indexer_candidate.sections.map(section => ({ id: section.section_key, references: section.references })) ?? formal?.sections;
      const sources = [];
      for (const source of owner.sources) {
        const current = stage.scopes.find(item => item.scope === source.scope);
        if (!current?.baseline || stage.gaps.some(gap => gap.scope === source.scope) ||
            await productionSourceBaseline(input.projectRoot, source.scope) !== current.baseline) {
          throw invalid("The selected article's source changed. Refresh its materials through the current preparation route before revising.");
        }
        sources.push({ scope: source.scope, baseline: current.baseline });
      }
      const task = { id: randomUUID(), article_id: owner.article_id, path, question: input.instruction,
        sources, batch: owner.batch, after: [], status: "pending" as const,
        base: productionArticleTargetDigest({ markdown, sections, visibility: prior?.visibility ?? formal!.visibility }) };
      const complete = { ...task, input: productionTaskInput(task) };
      await readProductionArticleTarget({ projectRoot: input.projectRoot, task: complete, candidates, readApproved: async () => approved });
      updated = reviseProductionPlan({ stage, tasks: [complete], replaces: unfinished ? [owner.id] : [] });
      await saveProductionStage(input.projectRoot, updated);
    }
    try {
      const next = await prepareNextProductionStage({ projectRoot: input.projectRoot, stage: updated, multiAgent: false });
      return { status: "production-revision-prepared" as const, path, stage: stage.id,
        ...(next ? { next: { directory: next.directory, submission: next.submission, mode: next.mode } } : {}),
        next_action: { command: "context status --format json" } };
    } catch (error) {
      return { status: "production-revision-prepared" as const, path, stage: stage.id,
        next_preparation: { outcome: "failed" as const, message: error instanceof Error ? error.message : String(error),
          command: `context action prepare-current --revision ${stage.id} --format json` } };
    }
  }));
}
