import { collectProjectStatus } from "../status.js";
import { WorkspaceExecutionRuntime } from "./workflowExecutionRuntime.js";
import { createWorkflowInProcessExecutor } from "./workflowInProcessActions.js";
import { runWorkflowUntilBlockedOrComplete } from "./workflowRun.js";
import type { ContextWorkflowAuthority } from "./workflowTypes.js";

/** Continue the existing Graph after an explicit review decision. Never infer
 * managed authority from approval: every following Gate keeps its own policy. */
export async function continueAfterProjectReview(input: {
  projectRoot: string;
  cliEntryPath: string;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
}) {
  const runtime = new WorkspaceExecutionRuntime({ projectRoot: input.projectRoot,
    cliEntryPath: input.cliEntryPath, inProcess: createWorkflowInProcessExecutor() });
  try {
    const result = await runWorkflowUntilBlockedOrComplete({
      observe: () => collectProjectStatus(input.projectRoot, { managed: input.managed, authorities: input.authorities }),
      execute: (command) => runtime.execute(command),
      managed: input.managed, maxSteps: 25, dryRun: false,
    });
    return { state: result.state, steps: result.steps.map((step) => ({
      node: step.node, outcome: step.receipt?.exitCode === 0 ? "completed" : "failed",
    })), stop: result.stop, next: result.workflow.current ?? null };
  } catch (error) {
    // Review was already committed. A preparation failure must not invite a
    // second apply of the same decisions or report that approval was lost.
    return { state: "failed", steps: [], next: null, stop: {
      message: error instanceof Error ? error.message : String(error),
      command: `context${input.authorities.map((authority) => ` --workflow-authority '${authority}'`).join("")} run${input.managed ? " --managed" : ""} --until blocked-or-complete --format json`,
    } };
  } finally {
    await runtime.close();
  }
}

export type ReviewContinuation = (projectRoot: string) => ReturnType<typeof continueAfterProjectReview>;
