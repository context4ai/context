import { revisionStoragePath } from "./maintenanceStorage.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { indexerProtocolDigest, type IndexerProjectFileTarget } from "@c4a/context";
import { readJsonMaybe, currentLedger } from "./indexerMainRunStoreRecords.js";
import { CANDIDATE_LEDGER_FILE, readCandidateRecords } from "./candidateLedger.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import { REVISION_DELIVERY_FILE, readRevisionDelivery } from "./revisionDelivery.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const schema = z.object({
  summary: z.string().trim().min(1),
  discard_unfinished: z.literal(true),
  files: z.array(z.object({ path: z.string().min(1), base_digest: digest.nullable(),
    content: z.string().nullable() }).strict()),
}).strict();
const stateSchema = z.object({ protocol: z.literal("context.task-rollback/v1"),
  revision: digest, summary: z.string().min(1), files: z.array(z.object({
    path: z.string().min(1), target_digest: digest.nullable(),
  }).strict()),
  // The production stage present when the rollback was applied and whether the
  // rollback discards it (whole current task) or only the revision that
  // interrupted it (production resumes unchanged). null records that no stage
  // existed, so a stage prepared later is never discarded; absent in older states.
  production: z.object({ stage: z.string().min(1), discard: z.boolean() }).strict().nullable().optional(),
}).strict();

const UNFINISHED_TASK_STATUSES = new Set(["pending", "issued", "blocked"]);

/** What the rollback does to the current production stage: a page revision that
 * interrupted production rolls back alone and production resumes; otherwise the
 * whole current task, its unfinished tasks and Agent working files are discarded. */
async function productionScope(projectRoot: string) {
  const { readProductionStage } = await import("./productionStageStore.js");
  const stage = await readProductionStage(projectRoot);
  if (!stage) return undefined;
  const { readApprovedRevision } = await import("./approvedRevision.js");
  const discard = !await readApprovedRevision(projectRoot);
  const { productionAgentDirectory } = await import("./productionSubmissionFiles.js");
  return {
    stage: stage.id, discard,
    unfinished_tasks: stage.tasks.filter((task) => UNFINISHED_TASK_STATUSES.has(task.status)).length,
    working_directory: productionAgentDirectory(stage.id),
    digest: indexerProtocolDigest(stage),
  };
}
function describeProduction(production: Awaited<ReturnType<typeof productionScope>>) {
  if (!production) return null;
  return production.discard
    ? { stage: production.stage, effect: "discard-whole-task", unfinished_tasks: production.unfinished_tasks,
      deleted_working_directory: production.working_directory,
      note: "The whole current task is discarded: the production stage, its unfinished tasks and every unsubmitted file in the working directory." }
    : { stage: production.stage, effect: "keep", unfinished_tasks: production.unfinished_tasks,
      note: "Only the page revision that interrupted production is rolled back; production resumes unchanged." };
}
export async function readTaskRollback(projectRoot: string) {
  const raw = await readJsonMaybe(projectRoot, await revisionStoragePath(projectRoot));
  if (!raw || typeof raw !== "object" || !("protocol" in raw) || raw.protocol !== "context.task-rollback/v1") return undefined;
  return stateSchema.parse(raw);
}
async function contents(projectRoot: string, path: string): Promise<string | undefined> {
  try { return await readFile(join(projectRoot, path), "utf8"); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}
function allowedPath(path: string): boolean {
  if (path.split("/").some((part) => part === "." || part === ".." || !part) || path.includes("\\")) return false;
  return /^knowledge\/.+\.(md|yaml)$/u.test(path) || /^src\/.+\.(ts|yaml|json)$/u.test(path) ||
    /^sources\/(note|sessions|file|lark)\/.+\.(md|json|yaml)$/u.test(path) || path === "sources/repo/index.yaml";
}

/** Explicit rollback bytes come from a user-selected recoverable state, never
 * guessed from HEAD. The existing transaction commits those exact changes and
 * removes only current drafts; Graph still owns close/build before cleanup. */
export async function rollbackProjectTask(input: {
  projectRoot: string; value: unknown; apply?: boolean; plan_digest?: string;
}) {
  const value = schema.parse(input.value);
  return withProjectWriteLock(input.projectRoot, "rollback-current-task", async () => {
    const { readMaintenance } = await import("./maintenanceStorage.js");
    if ((await readMaintenance(input.projectRoot)).active) throw new TypeError("A maintenance batch is active. Use its current revision/Review, or cancel-maintenance with explicit draft discard; whole-task rollback would discard unrelated production.");
    const existing = await readTaskRollback(input.projectRoot);
    if (existing) {
      // An interrupted rollback may have saved its state before settling.
      const { settleJoinedMaintenance } = await import("./knowledgeMaintenance.js");
      await settleJoinedMaintenance(input.projectRoot, "cancelled");
      if (input.apply && input.plan_digest === existing.revision) return {
        action: "already-applied", revision: existing.revision, next: "context status --format json",
      };
      throw new TypeError("Rollback is already applied. Follow context status to finish close/build and cleanup before starting another task.");
    }
    if (new Set(value.files.map((file) => file.path)).size !== value.files.length) throw new TypeError("Rollback paths must be unique.");
    const targets: IndexerProjectFileTarget[] = [];
    const changes: Array<{ path: string; before: string | null; after: string | null }> = [];
    for (const file of value.files) {
      if (!allowedPath(file.path)) throw new TypeError(`Rollback does not own ${file.path}; select explicit workspace source/configuration/knowledge files, never a checkout or runtime directory.`);
      await safeProjectTarget(input.projectRoot, file.path);
      const before = await contents(input.projectRoot, file.path);
      if ((before === undefined ? null : durableContentDigest(before)) !== file.base_digest) {
        throw new TypeError(`Rollback base changed: ${file.path}. Read the current file and review the affected rollback scope again.`);
      }
      if ((before ?? null) === file.content) continue;
      changes.push({ path: file.path, before: before ?? null, after: file.content });
      targets.push(file.content === null
        ? { path: file.path, operation: "delete", base_digest: file.base_digest, target_digest: null }
        : { path: file.path, operation: "write", base_digest: file.base_digest,
          target_digest: durableContentDigest(file.content), content: file.content });
    }
    const candidates = await readCandidateRecords(input.projectRoot);
    const ledger = await currentLedger(input.projectRoot);
    const production = await productionScope(input.projectRoot);
    const current = await contents(input.projectRoot, await revisionStoragePath(input.projectRoot));
    const candidateBytes = await contents(input.projectRoot, CANDIDATE_LEDGER_FILE);
    // A partial delivery selected from the replaced revision cannot be closed
    // against the rollback; it is discarded with that revision.
    const delivery = await readRevisionDelivery(input.projectRoot);
    const deliveryBytes = await contents(input.projectRoot, REVISION_DELIVERY_FILE);
    const revision = indexerProtocolDigest({ value, targets, candidateBytes: candidateBytes ?? null,
      current: current ?? null, ledger: ledger ?? null, deliveryBytes: deliveryBytes ?? null,
      production: production ? { stage: production.digest, discard: production.discard } : null });
    if (!input.apply) return { action: "preview", revision, summary: value.summary, changes,
      discarded_candidates: candidates.map((candidate) => candidate.candidate_id),
      discarded_tasks: ledger?.entries.length ?? 0,
      discarded_revision_delivery: delivery?.partial.paths ?? [],
      // Disclose the production stage before approval: what is deleted with the task.
      production: describeProduction(production),
      next: `context task rollback --input <same-file> --apply --plan-digest '${revision}' --format json` };
    if (input.plan_digest !== revision) throw new TypeError("Rollback preview is missing or stale; preview the same explicit input again before applying.");
    const state = { protocol: "context.task-rollback/v1", revision, summary: value.summary,
      files: targets.map(({ path, target_digest }) => ({ path, target_digest })),
      production: production ? { stage: production.stage, discard: production.discard } : null };
    const body = `${JSON.stringify(state)}\n`;
    targets.push({ path: await revisionStoragePath(input.projectRoot), operation: "write",
      base_digest: current === undefined ? null : durableContentDigest(current),
      target_digest: durableContentDigest(body), content: body });
    if (deliveryBytes !== undefined) targets.push({ path: REVISION_DELIVERY_FILE, operation: "delete",
      base_digest: durableContentDigest(deliveryBytes), target_digest: null });
    if (candidateBytes !== undefined) targets.push({ path: CANDIDATE_LEDGER_FILE, operation: "delete",
      base_digest: durableContentDigest(candidateBytes), target_digest: null });
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "rollback-current-task",
      proposal_digest: revision, targets });
    // The rolled-back batch takes its joined maintenance requests with it.
    const { settleJoinedMaintenance } = await import("./knowledgeMaintenance.js");
    await settleJoinedMaintenance(input.projectRoot, "cancelled");
    return { action: "applied", revision, changed_files: changes.map((change) => change.path),
      next: "context status --format json" };
  });
}

export async function finishTaskRollback(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "finish-task-rollback", async () => {
    const rollback = await readTaskRollback(projectRoot);
    if (!rollback) return { action: "already-finished", next: "context status --format json" };
    const { readProjectCloseStatus } = await import("./close.js");
    const { collectPackageFreshness } = await import("./packageBuilder.js");
    const { loadContextProjectModule } = await import("./workspace.js");
    const loaded = await loadContextProjectModule(projectRoot);
    if ((await readProjectCloseStatus(projectRoot)).state !== "ready" ||
        (await collectPackageFreshness(projectRoot, loaded.project.packages)).some((item) => item.state !== "ready")) {
      throw new TypeError("Rollback files are saved but close/build is unfinished. Follow context status; do not repeat the rollback writes.");
    }
    const { settleJoinedMaintenance } = await import("./knowledgeMaintenance.js");
    await settleJoinedMaintenance(projectRoot, "cancelled");
    const { readProductionStage } = await import("./productionStageStore.js");
    const production = await readProductionStage(projectRoot);
    // Discard only the production stage this rollback disclosed as part of the
    // task. A rollback of a revision that interrupted production retires just its
    // own pointer, like a finished revision; production resumes unchanged. A
    // stage prepared after the rollback (none or another stage recorded) was
    // never approved for discard and is kept the same way. Older states without
    // the record discard the stage they were applied over.
    const recorded = rollback.production;
    if (production && recorded !== undefined && (recorded === null || !recorded.discard || recorded.stage !== production.id)) {
      await rm(join(projectRoot, await revisionStoragePath(projectRoot)), { force: true });
      return { action: "finished", production: recorded?.stage === production.id ? "resumed" : "kept",
        next: "context status --format json" };
    }
    const { clearCompletedLifecycle } = await import("./lifecycleCleanup.js");
    await clearCompletedLifecycle(projectRoot, { discardUnfinishedProduction: true });
    return { action: "finished", next: "context status --format json" };
  });
}
