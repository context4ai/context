import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, join, resolve } from "node:path";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { ExecutionScope } from "./workflow/executionScope.js";
import {
  recordContextDebugPerformance,
  recordWorkflowExecutionScope,
} from "./debugTrace.js";

const LOCK_ROOT = join(".tmp", "context-runtime", "locks");
const PROJECT_WRITE_LOCK = "project-write.lock";
const PROJECT_WRITE_LOCK_OWNER = "owner.json";
const activeProjectWriteLocks = new AsyncLocalStorage<ReadonlySet<string>>();

interface ProjectWriteLockOwner {
  protocol: "context.project-write-lock.v1";
  pid: number;
  operation: string;
  started_at: string;
  workflow_revision?: string;
}

type OwnerProcessState = "running" | "not-running" | "unknown";

function currentWorkflowRevision(argv: readonly string[] = process.argv.slice(2)): string | undefined {
  const index = argv.indexOf("--workflow-revision");
  const revision = index < 0 ? undefined : argv[index + 1];
  return revision?.startsWith("sha256:") ? revision : undefined;
}

function ownerProcessState(owner: ProjectWriteLockOwner | undefined): OwnerProcessState {
  if (owner === undefined || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return "unknown";
  try {
    process.kill(owner.pid, 0);
    return "running";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ESRCH") return "not-running";
      if (error.code === "EPERM") return "running";
    }
    return "unknown";
  }
}

async function readLockOwner(lockPath: string): Promise<ProjectWriteLockOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, PROJECT_WRITE_LOCK_OWNER), "utf8")) as Partial<ProjectWriteLockOwner>;
    if (
      parsed.protocol !== "context.project-write-lock.v1" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.operation !== "string" ||
      typeof parsed.started_at !== "string"
    ) return undefined;
    return parsed as ProjectWriteLockOwner;
  } catch {
    return undefined;
  }
}

function lockOwnerDetail(owner: ProjectWriteLockOwner | undefined): Record<string, unknown> {
  const processState = ownerProcessState(owner);
  return {
    process_state: processState,
    ...(owner === undefined
      ? {}
      : {
          pid: owner.pid,
          operation: owner.operation,
          started_at: owner.started_at,
          ...(owner.workflow_revision === undefined ? {} : { workflow_revision: owner.workflow_revision }),
        }),
  };
}

export async function withProjectWriteLock<T>(
  projectRoot: string,
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const relPath = join(LOCK_ROOT, PROJECT_WRITE_LOCK);
  const lockPath = resolve(projectRoot, relPath);
  const inheritedLocks = activeProjectWriteLocks.getStore();
  if (inheritedLocks?.has(lockPath) === true) {
    // Nested store operations belong to the already serialized outer action.
    // Reuse that lock without weakening process-level exclusion.
    return action();
  }
  await mkdir(dirname(lockPath), { recursive: true });
  const lockStarted = performance.now();
  let acquiredAt = lockStarted;

  try {
    await mkdir(lockPath);
    acquiredAt = performance.now();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const owner = await readLockOwner(lockPath);
      const processState = ownerProcessState(owner);
      await recordContextDebugPerformance({
        projectRoot,
        operation: "project-write-lock",
        durationMs: performance.now() - lockStarted,
        outcome: "error",
        counters: { write_lock_attempt_count: 1, write_lock_acquired_count: 0 },
        data: { requested_operation: name, lock_outcome: "contended" },
      });
      throw new ContextError(ExitCode.WorkspaceStateError, `context project write lock is already held: ${relPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "project-write-in-progress",
        lock: relPath,
        requested_operation: name,
        owner: lockOwnerDetail(owner),
        next_action: {
          kind: processState === "running" ? "wait-for-active-context-command" : "inspect-project-write-lock",
          message: processState === "running"
            ? "Keep polling the existing Context command until it returns an exit code and receipt; do not start another write command."
            : "No active owner could be confirmed. Inspect the runtime lock and the previous Context process before retrying; do not delete a lock owned by a running process.",
        },
        next: processState === "running"
          ? "Wait for the running context command to finish, then retry."
          : "Inspect the workspace runtime lock and previous Context process before retrying.",
      });
    }
    throw error;
  }
  const scope = new ExecutionScope(`project-write:${name}`);
  scope.defer("project-write-lock", () => rm(lockPath, { recursive: true, force: true }));
  const revision = currentWorkflowRevision();
  try {
    await writeFile(join(lockPath, PROJECT_WRITE_LOCK_OWNER), `${JSON.stringify({
      protocol: "context.project-write-lock.v1",
      pid: process.pid,
      operation: name,
      started_at: new Date().toISOString(),
      ...(revision === undefined ? {} : { workflow_revision: revision }),
    } satisfies ProjectWriteLockOwner, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await scope.close();
    await recordContextDebugPerformance({
      projectRoot,
      operation: "project-write-lock",
      durationMs: performance.now() - lockStarted,
      outcome: "error",
      counters: { write_lock_attempt_count: 1, write_lock_acquired_count: 1 },
      data: {
        requested_operation: name,
        lock_outcome: "owner-metadata-failed",
        acquire_duration_ms: acquiredAt - lockStarted,
      },
    });
    throw error;
  }
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
    result = await activeProjectWriteLocks.run(
      new Set([...(inheritedLocks ?? []), lockPath]),
      action,
    );
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
  await recordContextDebugPerformance({
    projectRoot,
    operation: "project-write-lock",
    durationMs: performance.now() - lockStarted,
    outcome: actionError === undefined && receipt.releaseErrors === 0 ? "success" : "error",
    counters: { write_lock_attempt_count: 1, write_lock_acquired_count: 1 },
    data: {
      requested_operation: name,
      lock_outcome: receipt.releaseErrors === 0 ? "released" : "release-failed",
      acquire_duration_ms: acquiredAt - lockStarted,
      hold_duration_ms: performance.now() - acquiredAt,
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
