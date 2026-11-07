import { lstat, mkdir, readFile, readdir, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

const lockRelative = ".tmp/context-runtime/locks/project-write.lock";
const command = "context task recover --operation writer-lock --format json";

export async function inspectWriterLock(root: string) {
  const path = await safeProjectTarget(root, lockRelative);
  let stat;
  try { stat = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Writer lock must be a real directory.");
  const ownerPath = await safeProjectTarget(root, `${lockRelative}/owner.json`);
  const bytes = await readFile(ownerPath, "utf8");
  const owner = JSON.parse(bytes) as { protocol?: string; pid?: number };
  if (owner.protocol !== "context.project-write-lock.v1" || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0) {
    throw new Error("Writer lock owner is invalid; preserve the lock for diagnosis.");
  }
  let processState: "running" | "not-running" | "unknown" = "running";
  try { process.kill(owner.pid!, 0); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    processState = code === "ESRCH" ? "not-running" : code === "EPERM" ? "running" : "unknown";
  }
  const digest = `sha256:${createHash("sha256").update(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${bytes}`).digest("hex")}`;
  return { ...owner, process_state: processState, digest, path: lockRelative };
}

/** Explicit maintenance only: callers must quiesce all workspace writers first.
 * The guard is inside the old lock; it is archived with that lock so a competing
 * recovery cannot release a replacement lock. No source or journal is removed. */
export async function recoverWriterLock(input: { projectRoot: string; managed?: boolean; apply?: boolean; plan_digest?: string }) {
  const before = await inspectWriterLock(input.projectRoot);
  if (!before) return { action: "writer-lock-absent", next: `context task recover${input.managed ? " --managed" : ""} --format json` };
  if (before.process_state !== "not-running") throw new Error("Writer is running or cannot be identified as stopped; keep the lock.");
  const { recoveryJournals } = await import("./taskRecovery.js");
  const journals = await recoveryJournals(input.projectRoot);
  const revision = journals.length ? `sha256:${createHash("sha256").update(JSON.stringify({ lock: before.digest, journals })).digest("hex")}` : before.digest;
  if (!input.apply) return { action: "preview", operation: "writer-lock", revision, owner: before,
    journal_files: journals.map(journal => journal.path),
    effect: "Archive this orphan lock, finish already journaled writes and observe the next Route. Before applying, stop new workspace commands and confirm no surviving child writer or other host/container uses this workspace.",
    next: `${command}${input.managed ? " --managed" : ""} --apply --plan-digest '${revision}'` };
  if (input.plan_digest !== revision) throw new Error("Writer lock or transactions changed; preview recovery again.");
  const path = join(input.projectRoot, lockRelative);
  const guard = join(path, ".recovery");
  await mkdir(guard); // EEXIST deliberately blocks competing or interrupted repair.
  let archived = false;
  try {
    const current = await inspectWriterLock(input.projectRoot);
    if (current?.digest !== before.digest || current.process_state !== "not-running") throw new Error("Writer lock changed or owner resumed; keep the lock.");
    const names = await readdir(path);
    if (names.some(name => name !== "owner.json" && name !== ".recovery")) throw new Error("Unexpected lock contents; preserve for diagnosis.");
    const archive = `.tmp/context-runtime/locks/recovered-write-${randomUUID()}.lock`;
    await rename(path, join(input.projectRoot, archive));
    archived = true;
    const receipts = await withProjectWriteLock(input.projectRoot, "recover-writer-transactions", async () => {
      if (JSON.stringify(await recoveryJournals(input.projectRoot)) !== JSON.stringify(journals)) {
        throw new Error("Transaction inventory changed after lock recovery; preview context task recover --operation transactions --format json.");
      }
      const { recoverTaskTransactionJournals } = await import("./taskRecovery.js");
      return recoverTaskTransactionJournals(input.projectRoot);
    });
    return { action: "writer-lock-recovered", archived_lock: archive, receipts, next: `context status${input.managed ? " --managed" : ""} --format json` };
  } finally {
    if (!archived) await rmdir(guard);
  }
}
