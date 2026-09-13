import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { withProjectWriteLock } from "./writeLock.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { recoverDurableMultiFileTransactions, runDurableMultiFileTransaction, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { CANDIDATE_LEDGER_FILE, candidateRecordsContent, readCandidateRecords } from "./candidateLedger.js";
import { currentScopeSourceVersion } from "./processedScopeStorage.js";
import { prepareProductionArticle } from "./productionArticle.js";
import { productionApprovedTargetsIndex, readProductionArticleTarget } from "./productionArticleTarget.js";
import { readProductionSubmission, type FixedProductionFile } from "./productionSubmissionFiles.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { productionStageDirectory, readProductionStage, prepareNextProductionStage } from "./productionStageStore.js";
import { dispatchProductionStage, productionCapabilitiesSchema, validateProductionStage, type ProductionStage } from "./productionStage.js";
import { measureContextDebugOperation } from "./debugTrace.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { readProductionRepairDraft, retainProductionRepairDraft } from "./productionRepairDraft.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

function submissionStateError(reason: string, message: string, command = "context status --format json") {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid, reason_code: reason,
    next_action: { command }, input_schema: { type: "object", properties: {}, additionalProperties: false },
  });
}

export async function productionSourceBaseline(root: string, scope: string): Promise<string> {
  return indexerProtocolDigest({ source: scope, version: await currentScopeSourceVersion(root, scope) });
}

async function maybeRead(root: string, path: string): Promise<string | undefined> {
  try { return await readFile(await safeProjectTarget(root, path), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

function writeTarget(path: string, previous: string | undefined, content: string) {
  return { path, operation: "write" as const, base_digest: previous === undefined ? null : durableContentDigest(previous),
    target_digest: durableContentDigest(content), content };
}

export interface ProductionSubmissionResult {
  accepted: Array<{ task: string; receipt: string }>;
  failed: Array<{ task: string; reason: string; file?: string; section?: string }>;
  stage_state: "active" | "waiting-user" | "blocked" | "ended";
  next?: { directory: string; submission?: string; mode: "single-agent" | "multi-agent" };
  next_preparation?: { outcome: "failed"; message: string; command: string };
}

/** One fixed-file read followed by independent task transactions. Neither
 * candidates nor deduplication records escape .tmp. A new machine starts fresh.
 * The caller may materialize newly eligible work without a full status query. */
export async function completeProductionSubmission(input: {
  projectRoot: string;
  stage: string;
  path: string;
  manifest?: FixedProductionFile;
  multiAgent?: boolean;
  prepareNext?: (stage: ProductionStage) => Promise<Awaited<ReturnType<typeof prepareNextProductionStage>> | void>;
}): Promise<ProductionSubmissionResult> {
  return withProjectWriteLock(input.projectRoot, "production-submit", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    let stage = await readProductionStage(input.projectRoot);
    if (!stage || stage.id !== input.stage) throw submissionStateError("stale-production-stage", "Task stage no longer exists. Start a new production run; do not reuse a stale submission.");
    if (!stage.report_approved) throw submissionStateError("production-report-approval-required", "Present the planned report and wait for user feedback before submitting bulk writing.");
    if (stage.delivery) throw submissionStateError("production-delivery-paused", "Writing is paused for delivery. Finish Review and build, or run context run --resume-writing --format json; existing task inputs remain valid.");
    if ((await readMaintenance(input.projectRoot)).active) throw submissionStateError("production-maintenance-active", "Finish or cancel the active maintenance task before submitting production articles; existing task inputs remain valid.");
    await assertProductionPlanRequirementsCurrent(input.projectRoot, stage);
    const fixed = await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: "production.submit.read" },
      () => readProductionSubmission(input));
    const taskIds = new Set(stage.tasks.map(task => task.id));
    if (fixed.tasks.some(task => !taskIds.has(task.task))) throw submissionStateError("unknown-production-task", "Submission contains an unknown task; no tasks were saved. Use the current stage manifest.");
    let candidates = await readCandidateRecords(input.projectRoot);
    let ledgerText = await maybeRead(input.projectRoot, CANDIDATE_LEDGER_FILE);
    const manifestPath = join(productionStageDirectory(stage.id), "manifest.json");
    let manifestText = await maybeRead(input.projectRoot, manifestPath);
    const baselines = new Map<string, Promise<string>>();
    let sourceReader: Awaited<ReturnType<typeof registeredArticleSourceReader>> | undefined;
    let approvedTargets: ReturnType<typeof productionApprovedTargetsIndex> | undefined;
    const result: ProductionSubmissionResult = { accepted: [], failed: [], stage_state: "active" };
    for (const files of fixed.tasks) {
      const task = stage.tasks.find(task => task.id === files.task)!;
      const contentDigest = indexerProtocolDigest({ content: files.content?.digest ?? null,
        references: files.references?.digest ?? null, edits: files.edits?.digest ?? null });
      let retainDraft = false;
      try {
        if (task.input !== files.input) throw new TypeError("Task input changed; read the current task before resubmitting.");
        if (task.status === "accepted") {
          if (task.accepted?.content_digest !== contentDigest) throw new TypeError("This task was accepted with different content. Create an explicit revision task instead of overwriting it.");
          result.accepted.push({ task: task.id, receipt: task.accepted.receipt });
          continue;
        }
        if (task.status !== "issued") throw new TypeError(`Task is ${task.status}, not currently issued; use the current stage directory.`);
        for (const source of task.sources) {
          if (!baselines.has(source.scope)) baselines.set(source.scope, productionSourceBaseline(input.projectRoot, source.scope));
          if (await baselines.get(source.scope) !== source.baseline) throw new TypeError(`Source changed: ${source.scope}. Refresh the affected task with context action prepare-current --revision ${stage.id} --format json; unrelated tasks remain valid.`);
        }
        const target = await readProductionArticleTarget({ projectRoot: input.projectRoot, task, candidates,
          readApproved: async () => approvedTargets ??= productionApprovedTargetsIndex(await readApprovedKnowledgeMetadataIndex(input.projectRoot)) });
        sourceReader ??= await registeredArticleSourceReader(input.projectRoot);
        let base = target.base;
        if (files.edits) {
          // A rejected complete replacement is the current repair base even
          // when a prior formal/candidate version also exists.
          base = await readProductionRepairDraft({ projectRoot: input.projectRoot, stage: stage.id, task }) ?? base;
        }
        retainDraft = !!files.content && !!files.references;
        const candidate = await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: "production.submit.validate" },
          () => prepareProductionArticle({ projectRoot: input.projectRoot, task, files,
            sourceReader: sourceReader!,
            approvedBaseDigest: target.approvedBaseDigest,
            ...(base ? { base } : {}),
            visibility: target.visibility }));
        const nextCandidates = [...candidates.filter(item => item.article_id !== task.article_id), candidate];
        const nextStage = validateProductionStage({ ...stage, tasks: stage.tasks.map(item => item.id === task.id
          ? { ...item, status: "accepted", accepted: { content_digest: contentDigest, receipt: candidate.candidate_id } } : item) });
        const nextLedger = candidateRecordsContent(nextCandidates)!;
        const nextManifest = `${JSON.stringify(nextStage)}\n`;
        await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: "production.submit.save" },
          () => runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "production-article",
            proposal_digest: contentDigest, targets: [writeTarget(CANDIDATE_LEDGER_FILE, ledgerText, nextLedger),
              writeTarget(manifestPath, manifestText, nextManifest)].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }));
        candidates = nextCandidates;
        ledgerText = nextLedger;
        manifestText = nextManifest;
        stage = nextStage;
        result.accepted.push({ task: task.id, receipt: candidate.candidate_id });
      } catch (error) {
        const detail = error && typeof error === "object" && "detail" in error
          ? error.detail as Record<string, unknown> | undefined : undefined;
        // A failed transaction must be recovered before another independent
        // write; never continue with an in-memory pre-transaction snapshot.
        await recoverDurableMultiFileTransactions(input.projectRoot);
        stage = (await readProductionStage(input.projectRoot, input.stage))!;
        candidates = await readCandidateRecords(input.projectRoot);
        ledgerText = await maybeRead(input.projectRoot, CANDIDATE_LEDGER_FILE);
        manifestText = await maybeRead(input.projectRoot, manifestPath);
        const recovered = stage.tasks.find(item => item.id === task.id)?.accepted;
        if (recovered?.content_digest === contentDigest) {
          result.accepted.push({ task: task.id, receipt: recovered.receipt });
        } else {
          let reason = error instanceof Error ? error.message : String(error);
          if (retainDraft) {
            try { await retainProductionRepairDraft({ projectRoot: input.projectRoot, stage: stage.id, task, files }); }
            catch { reason += " The temporary repair draft could not be retained; resubmit the complete draft."; }
          }
          result.failed.push({ task: task.id, reason,
            ...(typeof detail?.file === "string" ? { file: detail.file } : {}),
            ...(typeof detail?.section === "string" ? { section: detail.section } : {}) });
        }
      }
    }
    result.stage_state = dispatchProductionStage(stage, productionCapabilitiesSchema.parse({})).state;
    try {
      const next = await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: "production.submit.prepare-next" },
        async () => input.prepareNext ? input.prepareNext(stage) : prepareNextProductionStage({
          projectRoot: input.projectRoot, stage, multiAgent: input.multiAgent === true,
        }));
      if (next) result.next = { directory: next.directory, ...(next.submission ? { submission: next.submission } : {}), mode: next.mode };
    } catch (error) {
      result.next_preparation = { outcome: "failed", message: `Accepted tasks remain saved. Only next preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        command: `context action prepare-current --revision ${stage.id}${input.multiAgent ? " --multi-agent" : ""} --format json` };
    }
    return result;
  });
}
