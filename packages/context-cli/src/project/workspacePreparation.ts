import { TASK_PREPARATION_PATH, taskPreparationRecord } from "./taskResumption.js";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest, type IndexerProjectFileTarget } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { recoverDurableMultiFileTransactions, runDurableMultiFileTransaction, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import { CANDIDATE_SNAPSHOT_ROOT, INDEXER_RUNTIME_ROOT, LIFECYCLE_ROOT, REVIEW_ACTION_ROOT, REVIEW_RUNTIME_ROOT, STRUCTURE_REPORT_ROOT } from "./lifecyclePaths.js";
import { MAINTENANCE_ROOT } from "./maintenanceStorage.js";
import { LEGACY_REVIEW_DECISIONS_FILE } from "./reviewDecisions.js";

// Only Context-owned task state. Never own .tmp/repo, reports outside runtime,
// source snapshots, approved pages, package output, locks or transaction journals.
// The legacy decisions file is the sole obsolete knowledge metadata exception.
export const PREPARATION_ROOTS = [LIFECYCLE_ROOT, INDEXER_RUNTIME_ROOT, MAINTENANCE_ROOT,
  REVIEW_RUNTIME_ROOT, REVIEW_ACTION_ROOT, STRUCTURE_REPORT_ROOT, CANDIDATE_SNAPSHOT_ROOT,
  LEGACY_REVIEW_DECISIONS_FILE];
const KIND = "prepare-workspace";
const previewCommand = "context task prepare --format json";
const applyCommand = (revision: string) => `${previewCommand} --apply --plan-digest '${revision}'`;

function failure(reason: string, message: string, next: string): never {
  throw new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid, reason_code: reason, next,
  });
}

async function entries(root: string, path: string): Promise<string[]> {
  await safeProjectTarget(root, path);
  let stat;
  try { stat = await lstat(join(root, path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  if (stat.isSymbolicLink()) failure("preparation-symlink", `Refusing to clean linked task state: ${path}`, "Inspect and relocate the link without deleting its target, then preview again.");
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) failure("preparation-file-type", `Unsupported task-state file: ${path}`, "Inspect this file before preparing the workspace.");
  const result: string[] = [];
  for (const name of (await readdir(join(root, path))).sort()) result.push(...await entries(root, join(path, name)));
  return result;
}

async function pendingJournals(root: string) {
  const files = await entries(root, ".tmp/context-runtime/transactions");
  const result: Array<{ path: string; kind?: string; proposal_digest?: string }> = [];
  for (const path of files.filter(path => path.endsWith("/journal.json") || path.endsWith(".journal.json"))) {
    try { result.push({ ...JSON.parse(await readFile(join(root, path), "utf8")), path }); }
    catch { result.push({ path }); }
  }
  return result;
}

export async function assertPreparationComplete(root: string): Promise<void> {
  const journal = (await pendingJournals(root)).find(item => item.kind === KIND);
  if (journal?.proposal_digest) failure("preparation-interrupted", "Task-state cleanup is unfinished; resume it before evaluating production.", applyCommand(journal.proposal_digest));
}

/** Ends task state only; source readiness and Git operations belong to the Agent.
 * The existing durable delete transaction lives outside the cleanup scope, so
 * an interrupted apply can finish without relying on deleted worksets. */
export async function prepareWorkspace(input: { projectRoot: string; apply?: boolean; plan_digest?: string }) {
  await safeProjectTarget(input.projectRoot, ".tmp/context-runtime/locks");
  return withProjectWriteLock(input.projectRoot, KIND, async () => {
    const pending = await pendingJournals(input.projectRoot);
    if (pending.length) {
      const own = pending.length === 1 && pending[0]?.kind === KIND && pending[0]?.proposal_digest;
      if (!own) failure("preparation-pending-transaction", "An unfinished write must be recovered before discarding task state.", "Inspect context status --format json and complete its transaction recovery; then preview preparation again.");
      if (!input.apply) return { action: "resume-required", revision: own, next: applyCommand(own) };
      if (input.plan_digest !== own) failure("preparation-stale", "An interrupted preparation has a different revision.", applyCommand(own));
      await recoverDurableMultiFileTransactions(input.projectRoot);
      return prepared(own);
    }
    const targets: IndexerProjectFileTarget[] = [];
    for (const directory of PREPARATION_ROOTS) for (const path of await entries(input.projectRoot, directory)) {
      const bytes = await readFile(join(input.projectRoot, path));
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { failure("preparation-binary-state", `Unexpected binary task state: ${path}`, "Inspect and preserve this file outside the task-state directory, then preview again."); }
      targets.push({ path, operation: "delete", base_digest: durableContentDigest(content), target_digest: null });
    }
    const markerContent = JSON.stringify(taskPreparationRecord("cleared"));
    let oldMarker: string | undefined;
    try { oldMarker = await readFile(join(input.projectRoot, TASK_PREPARATION_PATH), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (oldMarker !== markerContent) targets.push({ path: TASK_PREPARATION_PATH, operation: "write",
      base_digest: oldMarker === undefined ? null : durableContentDigest(oldMarker),
      target_digest: durableContentDigest(markerContent), content: markerContent });
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const revision = indexerProtocolDigest({ kind: KIND, targets });
    if (!input.apply) return { action: "preview", revision,
      discard_files: targets.filter(target => target.operation === "delete").map(target => target.path), file_count: targets.filter(target => target.operation === "delete").length,
      preserves: ["approved knowledge", "source records and snapshots", "configuration", "repository checkouts", "other .tmp files", "existing output (not revalidated)"],
      next: applyCommand(revision) };
    if (input.plan_digest !== revision) failure("preparation-stale", "Task state changed since the preparation preview; nothing was discarded.", previewCommand);
    if (targets.length) await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: KIND, proposal_digest: revision, targets });
    return prepared(revision);
  });
}

function prepared(revision: string) {
  return { action: "task-state-cleared", revision, source_readiness: "not-checked",
    resume_command: "context task resume --format json",
    next: "Use the workspace preparation guide to inspect and restore registered sources. Stop when ready for the next user task; do not run production merely because status offers an Author route." };
}
