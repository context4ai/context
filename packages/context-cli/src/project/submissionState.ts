import { AsyncLocalStorage } from "node:async_hooks";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { ErrorCategory } from "../lib/cliFeedback.js";

export type SubmissionState = "not-committed" | "committed" | "uncertain";
const current = new AsyncLocalStorage<{ state: SubmissionState }>();

/** In-memory reporting only; the existing transaction journal owns recovery. */
export function markSubmissionState(state: SubmissionState): void {
  const observation = current.getStore();
  if (observation) observation.state = state;
}

export async function withSubmissionState<T>(work: () => Promise<T>, options: { fresh?: boolean; managed?: boolean } = {}): Promise<T> {
  return current.run((options.fresh ? undefined : current.getStore()) ?? { state: "not-committed" }, async () => {
    try {
      const result = await work();
      if (result !== null && typeof result === "object" && !Array.isArray(result)) {
        return { submission_state: current.getStore()!.state, ...result };
      }
      return result;
    }
    catch (error) {
      const state = current.getStore()!.state;
      const previous = error instanceof ContextError ? error : undefined;
      const action = state === "uncertain"
        ? { command: `context task recover --operation transactions${options.managed ? " --managed" : ""} --format json`, instruction: "Preview and complete the interrupted transaction before deciding whether to retry." }
        : state === "committed"
          ? { command: `context status${options.managed ? " --managed" : ""} --format json`, instruction: "The submission was saved. Continue from the current Route; do not resubmit it." }
          : { command: `context status${options.managed ? " --managed" : ""} --format json`, instruction: "Correct the rejected input and submit it using the current Route." };
      const priorAction = previous?.detail?.next_action;
      // Production feedback supplies this generic fallback before the outer
      // submission boundary knows the session authority. Keep specific repairs.
      const nextAction = state !== "not-committed" || priorAction === undefined || priorAction === null ? action
        : options.managed && priorAction !== null && typeof priorAction === "object" &&
          "command" in priorAction && priorAction.command === "context status --format json"
          ? { ...priorAction, command: action.command } : priorAction;
      throw new ContextError(previous?.code ?? ExitCode.WorkspaceStateError,
        error instanceof Error ? error.message : String(error), {
          category: ErrorCategory.WorkspaceStateInvalid, ...previous?.detail,
          submission_state: state, next_action: nextAction,
        });
    }
  });
}
