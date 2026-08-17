import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

const LOCK_ROOT = join(".tmp", "context-runtime", "locks");
const PROJECT_WRITE_LOCK = "project-write.lock";

export async function withProjectWriteLock<T>(
  projectRoot: string,
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const relPath = join(LOCK_ROOT, PROJECT_WRITE_LOCK);
  const lockPath = join(projectRoot, relPath);
  await mkdir(dirname(lockPath), { recursive: true });

  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new ContextError(ExitCode.WorkspaceStateError, `context project write lock is already held: ${relPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        lock: relPath,
        operation: name,
        next: "Wait for the running context command to finish, then retry.",
      });
    }
    throw error;
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
