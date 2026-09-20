import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { withProjectWriteLock } from "./writeLock.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { recoverDurableMultiFileTransactions, runDurableMultiFileTransaction, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { CANDIDATE_LEDGER_FILE, candidateRecordsContent, knowledgeTargetPathKey, parseCandidateLine, type CandidateRecord } from "./candidateLedger.js";
import { currentScopeSourceVersion } from "./processedScopeStorage.js";
import { prepareProductionArticle, prefetchProductionArticleSources } from "./productionArticle.js";
import { productionApprovedTargetsIndex, readProductionArticleTarget } from "./productionArticleTarget.js";
import { readProductionSubmission, type FixedProductionFile } from "./productionSubmissionFiles.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { productionStageDirectory, readProductionStage, readProductionStageSnapshot, prepareNextProductionStage } from "./productionStageStore.js";
import { dispatchProductionStage, productionCapabilitiesSchema, type ProductionStage } from "./productionStage.js";
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

/** One fixed-file read, independent task validation, then one transaction for
 * the successful subset. Neither
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
    const snapshot = await readProductionStageSnapshot(input.projectRoot);
    let stage = snapshot?.stage;
    if (!stage || stage.id !== input.stage) throw submissionStateError("stale-production-stage", "Task stage no longer exists. Start a new production run; do not reuse a stale submission.");
    if (!stage.report_approved) throw submissionStateError("production-report-approval-required", "Present the planned report and apply context.gate.work_start_scope before submitting bulk writing.");
    if (stage.delivery) throw submissionStateError("production-delivery-paused", "Writing is paused for delivery. Finish Review and build, or run context run --resume-writing --format json; existing task inputs remain valid.");
    if ((await readMaintenance(input.projectRoot)).active) throw submissionStateError("production-maintenance-active", "Finish or cancel the active maintenance task before submitting production articles; existing task inputs remain valid.");
    await assertProductionPlanRequirementsCurrent(input.projectRoot, stage);
    const fixed = await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: "production.submit.read" },
      () => readProductionSubmission(input));
    const taskIds = new Set(stage.tasks.map(task => task.id));
    if (fixed.tasks.some(task => !taskIds.has(task.task))) throw submissionStateError("unknown-production-task", "Submission contains an unknown task; no tasks were saved. Use the current stage manifest.");
    // Use exactly the bytes checked by the transaction as the parsed baseline;
    // a second read could otherwise bind a newer file to an older candidate set.
    const ledgerText = await maybeRead(input.projectRoot, CANDIDATE_LEDGER_FILE);
    const candidates = (ledgerText ?? "").split(/\r?\n/u).flatMap((line, index) =>
      line.trim().length ? [parseCandidateLine(line, index + 1)] : []);
    const byPath = new Map<string, CandidateRecord[]>();
    const byArticle = new Map<string, CandidateRecord[]>();
    for (const candidate of candidates) {
      const key = knowledgeTargetPathKey(candidate.path);
      byPath.set(key, [...(byPath.get(key) ?? []), candidate]);
      byArticle.set(candidate.article_id, [...(byArticle.get(candidate.article_id) ?? []), candidate]);
    }
    const manifestPath = join(productionStageDirectory(stage.id), "manifest.json");
    const manifestText = snapshot!.content;
    const baselines = new Map<string, Promise<string>>();
    let sourceReader: Awaited<ReturnType<typeof registeredArticleSourceReader>> | undefined;
    let approvedTargets: ReturnType<typeof productionApprovedTargetsIndex> | undefined;
    const result: ProductionSubmissionResult = { accepted: [], failed: [], stage_state: "active" };
    const tasksById = new Map(stage.tasks.map(task => [task.id, task]));
    const pending = new Map<string, { candidate: CandidateRecord; digest: string }>();
    // Check only currently issued submitted inputs. Independent source checks
    // may overlap; per-task failures and acceptance remain in submission order.
    // Settle errors as values so an unused failed source cannot reject a batch.
    const scopes = [...new Set(fixed.tasks.flatMap(files => {
      const task = tasksById.get(files.task)!;
      return task.status === "issued" && task.input === files.input ? task.sources.map(source => source.scope) : [];
    }))];
    const checked = new Map<string, PromiseSettledResult<string>>();
    for (let offset = 0; offset < scopes.length; offset += 8) {
      const chunk = scopes.slice(offset, offset + 8);
      const results = await Promise.allSettled(chunk.map(scope => productionSourceBaseline(input.projectRoot, scope)));
      chunk.forEach((scope, index) => checked.set(scope, results[index]!));
    }
    const readable = fixed.tasks.flatMap(files => {
      const task = tasksById.get(files.task)!;
      return task.status === "issued" && task.input === files.input && task.sources.every(source => {
        const observed = checked.get(source.scope);
        return observed?.status === "fulfilled" && observed.value === source.baseline;
      }) ? [{ task, files }] : [];
    });
    if (readable.length) {
      try { sourceReader = await registeredArticleSourceReader(input.projectRoot); }
      catch { /* Preserve per-task registration diagnostics in compilation. */ }
      if (sourceReader) await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: "production.submit.prefetch" },
        () => prefetchProductionArticleSources(readable, sourceReader!));
    }
    for (const files of fixed.tasks) {
      const task = tasksById.get(files.task)!;
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
          if (!baselines.has(source.scope)) {
            const observed = checked.get(source.scope)!;
            if (observed.status === "rejected") throw observed.reason;
            baselines.set(source.scope, Promise.resolve(observed.value));
          }
          if (await baselines.get(source.scope) !== source.baseline) throw new TypeError(`Source changed: ${source.scope}. Refresh the affected task with context action prepare-current --revision ${stage.id} --format json; unrelated tasks remain valid.`);
        }
        const related = [...new Set([...(byPath.get(knowledgeTargetPathKey(task.path)) ?? []), ...(byArticle.get(task.article_id) ?? [])])];
        const target = await readProductionArticleTarget({ projectRoot: input.projectRoot, task, candidates: related,
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
        // Make successful proposals visible to subsequent conflict checks,
        // without exposing any acceptance until their joint transaction saves.
        const key = knowledgeTargetPathKey(candidate.path);
        byPath.set(key, [...(byPath.get(key) ?? []).filter(item => item.article_id !== task.article_id), candidate]);
        byArticle.set(candidate.article_id, [candidate]);
        pending.set(task.id, { candidate, digest: contentDigest });
      } catch (error) {
        const detail = error && typeof error === "object" && "detail" in error
          ? error.detail as Record<string, unknown> | undefined : undefined;
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
    if (pending.size) {
      const changedArticles = new Set([...pending.values()].map(proposal => proposal.candidate.article_id));
      const nextCandidates = [...candidates.filter(candidate => !changedArticles.has(candidate.article_id)),
        ...[...pending.values()].map(proposal => proposal.candidate)];
      const nextStage: ProductionStage = { ...stage, tasks: stage.tasks.map(task => {
        const proposal = pending.get(task.id);
        return proposal ? { ...task, status: "accepted", accepted: {
          content_digest: proposal.digest, receipt: proposal.candidate.candidate_id,
        } } : task;
      }) };
      try {
        await measureContextDebugOperation({ projectRoot: input.projectRoot, operation: "production.submit.save" },
          () => runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "production-article",
            proposal_digest: indexerProtocolDigest([...pending].map(([task, proposal]) => ({ task, digest: proposal.digest }))),
            targets: [writeTarget(CANDIDATE_LEDGER_FILE, ledgerText, candidateRecordsContent(nextCandidates)!),
              writeTarget(manifestPath, manifestText, `${JSON.stringify(nextStage)}\n`)]
              .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }));
        stage = nextStage;
        for (const [task, proposal] of pending) result.accepted.push({ task, receipt: proposal.candidate.candidate_id });
      } catch (error) {
        // A durable journal may already exist. Recover it before observing
        // receipts; never report an in-memory proposal as accepted.
        await recoverDurableMultiFileTransactions(input.projectRoot);
        stage = (await readProductionStage(input.projectRoot, input.stage))!;
        const recovered = new Map(stage.tasks.map(task => [task.id, task.accepted]));
        for (const [task, proposal] of pending) {
          const receipt = recovered.get(task);
          if (receipt?.content_digest === proposal.digest) result.accepted.push({ task, receipt: receipt.receipt });
          else result.failed.push({ task, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    const submissionOrder = new Map(fixed.tasks.map((task, index) => [task.task, index]));
    result.accepted.sort((a, b) => submissionOrder.get(a.task)! - submissionOrder.get(b.task)!);
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
