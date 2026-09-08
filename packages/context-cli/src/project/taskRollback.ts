import { revisionStoragePath } from "./maintenanceStorage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { indexerProtocolDigest, type IndexerProjectFileTarget } from "@c4a/context";
import { readJsonMaybe, currentLedger } from "./indexerMainRunStoreRecords.js";
import { CANDIDATE_LEDGER_FILE, readCandidateRecords } from "./candidateLedger.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

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
}).strict();
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
    const current = await contents(input.projectRoot, await revisionStoragePath(input.projectRoot));
    const candidateBytes = await contents(input.projectRoot, CANDIDATE_LEDGER_FILE);
    const revision = indexerProtocolDigest({ value, targets, candidateBytes: candidateBytes ?? null,
      current: current ?? null, ledger: ledger ?? null });
    if (!input.apply) return { action: "preview", revision, summary: value.summary, changes,
      discarded_candidates: candidates.map((candidate) => candidate.candidate_id),
      discarded_tasks: ledger?.entries.length ?? 0,
      next: `context task rollback --input <same-file> --apply --plan-digest '${revision}' --format json` };
    if (input.plan_digest !== revision) throw new TypeError("Rollback preview is missing or stale; preview the same explicit input again before applying.");
    const state = { protocol: "context.task-rollback/v1", revision, summary: value.summary,
      files: targets.map(({ path, target_digest }) => ({ path, target_digest })) };
    const body = `${JSON.stringify(state)}\n`;
    targets.push({ path: await revisionStoragePath(input.projectRoot), operation: "write",
      base_digest: current === undefined ? null : durableContentDigest(current),
      target_digest: durableContentDigest(body), content: body });
    if (candidateBytes !== undefined) targets.push({ path: CANDIDATE_LEDGER_FILE, operation: "delete",
      base_digest: durableContentDigest(candidateBytes), target_digest: null });
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "rollback-current-task",
      proposal_digest: revision, targets });
    return { action: "applied", revision, changed_files: changes.map((change) => change.path),
      next: "context status --format json" };
  });
}

export async function finishTaskRollback(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "finish-task-rollback", async () => {
    if (!await readTaskRollback(projectRoot)) return { action: "already-finished", next: "context status --format json" };
    const { readProjectCloseStatus } = await import("./close.js");
    const { collectPackageFreshness } = await import("./packageBuilder.js");
    const { loadContextProjectModule } = await import("./workspace.js");
    const loaded = await loadContextProjectModule(projectRoot);
    if ((await readProjectCloseStatus(projectRoot)).state !== "ready" ||
        (await collectPackageFreshness(projectRoot, loaded.project.packages)).some((item) => item.state !== "ready")) {
      throw new TypeError("Rollback files are saved but close/build is unfinished. Follow context status; do not repeat the rollback writes.");
    }
    const { clearCompletedLifecycle } = await import("./lifecycleCleanup.js");
    await clearCompletedLifecycle(projectRoot);
    return { action: "finished", next: "context status --format json" };
  });
}
