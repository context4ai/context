import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { ExecutionScope } from "./workflow/executionScope.js";
import { recordWorkflowExecutionScope } from "./debugTrace.js";

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
  const scope = new ExecutionScope(`project-write:${name}`);
  scope.defer("project-write-lock", () => rm(lockPath, { recursive: true, force: true }));
  await recordWorkflowExecutionScope({
    projectRoot,
    phase: "opened",
    data: { executor: "project-write", operation: name },
  });
  let result: T | undefined;
  let actionError: unknown;
  try {
    // The scope owns only the lock. Durable mutations inside the action retain
    // their existing revision checks and atomic commit semantics.
    result = await action();
  } catch (error) {
    actionError = error;
  }
  const receipt = await scope.close();
  await recordWorkflowExecutionScope({
    projectRoot,
    phase: "closed",
    data: {
      executor: "project-write",
      operation: name,
      resources: receipt.resources,
      release_errors: receipt.releaseErrors,
    },
  });
  if (actionError !== undefined) throw actionError;
  if (receipt.releaseErrors > 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, "context project write lock could not be released", {
      category: ErrorCategory.WorkspaceStateInvalid,
      lock: relPath,
      operation: name,
      next: "Inspect the workspace runtime lock and retry after it is released.",
    });
  }
  return result as T;
}
