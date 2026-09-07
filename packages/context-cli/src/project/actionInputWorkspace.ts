import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { findContextProjectRoot } from "./workspace.js";

/** Payload storage does not select the command workspace. Reject cross-workspace
 * submissions before resolving a Route or changing any workflow state. */
export function assertActionInputWorkspace(cwd: string, inputPath: string): void {
  if (inputPath === "-") return;
  const current = findContextProjectRoot(cwd);
  if (current === null) return;
  let file: string;
  try {
    file = realpathSync(resolve(cwd, inputPath));
  } catch {
    return; // The input reader owns missing/unreadable-file diagnostics.
  }
  const owner = findContextProjectRoot(dirname(file));
  if (owner === null || realpathSync(owner.projectRoot) === realpathSync(current.projectRoot)) return;
  throw new ContextError(ExitCode.WorkspaceStateError,
    "The completion input belongs to a different Context workspace. Run the workflow CLI and read/write this task's .tmp files in the same intended workspace. No tasks were submitted.", {
      category: "workflow-workspace-mismatch",
      project_root: current.projectRoot,
      input_project_root: owner.projectRoot,
      input_file: file,
      revision_advanced: false,
      next_action: {
        kind: "refresh_workflow_route",
        cwd: owner.projectRoot,
        command: "context status --view summary --format json",
        message: "Verify which workspace the request targets, set the command working directory explicitly, and read its current Route. Do not reuse this submission's revision or migrate accepted results between workspaces.",
      },
    });
}
