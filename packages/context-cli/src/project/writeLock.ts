import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { ExecutionScope } from "./workflow/executionScope.js";
import { recordWorkflowExecutionScope } from "./debugTrace.js";

const LOCK_ROOT = join(".tmp", "context-runtime", "locks");
const PROJECT_WRITE_LOCK = "project-write.lock";
const PROJECT_WRITE_LOCK_OWNER = "owner.json";

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
  const lockPath = join(projectRoot, relPath);
  await mkdir(dirname(lockPath), { recursive: true });

  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const owner = await readLockOwner(lockPath);
      const processState = ownerProcessState(owner);
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
