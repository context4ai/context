import { Command } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { findContextProjectRoot } from "../project/workspace.js";
import {
  describeConfiguredContextRuntimeEventDelivery,
  flushConfiguredContextRuntimeEvents,
} from "../runtimeEvents.js";
import { ExitCode } from "../types/exitCode.js";

const FLUSH_RESULT_SCHEMA = "context.runtime-event-flush-result.v1" as const;
const RETRY_COMMAND = "context logs flush --format json";
const PLAN_COMMAND = "context logs plan --format json";

function isNetworkFailure(reason: string | undefined): boolean {
  return reason === "network_error" || reason === "request_error";
}

export function registerRuntimeEventLogCommands(program: Command): void {
  const logs = program.command("logs", { hidden: true });
  logs
    .command("plan")
    .description("Describe the configured runtime event delivery plan")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      const found = findContextProjectRoot(process.cwd());
      if (found === null) {
        throw new ContextError(ExitCode.WorkspaceStateError, "logs plan requires a context project workspace", {
          category: ErrorCategory.WorkspaceNotFound,
        });
      }
      const plan = await describeConfiguredContextRuntimeEventDelivery(found.projectRoot);
      if (options.format === "json") {
        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        return;
      }
      const destination = plan.sink?.description?.destination ?? "unresolved";
      process.stdout.write(
        `${plan.status}: ${plan.outbox.event_count} event(s), outbox ${plan.outbox.path}, destination ${destination}\n`,
      );
    });
  logs
    .command("flush")
    .description("Flush configured runtime event logs")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      const found = findContextProjectRoot(process.cwd());
      if (found === null) {
        throw new ContextError(ExitCode.WorkspaceStateError, "logs flush requires a context project workspace", {
          category: ErrorCategory.WorkspaceNotFound,
        });
      }
      const result = await flushConfiguredContextRuntimeEvents(found.projectRoot);
      if (result.status === "pending") {
        const reason = result.last_result?.reason;
        const requiresNetworkAccess = isNetworkFailure(reason);
        throw new ContextError(
          ExitCode.ExternalToolError,
          requiresNetworkAccess
            ? "runtime event delivery could not reach the configured sink"
            : "runtime event delivery was rejected by the configured sink",
          {
            category: ErrorCategory.ExternalToolFailed,
            reason_code: requiresNetworkAccess
              ? "runtime-events-network-unavailable"
              : "runtime-events-delivery-failed",
            pending_count: result.pending_count,
            requires_network_access: requiresNetworkAccess,
            plan_command: PLAN_COMMAND,
            retry_command: RETRY_COMMAND,
            ...(result.last_result === undefined ? {} : { delivery: result.last_result }),
          },
        );
      }
      const output = {
        schema: FLUSH_RESULT_SCHEMA,
        status: result.status === "disabled" ? "skipped" : result.status,
        reason_code: result.status === "disabled"
          ? "runtime-events-sink-not-configured"
          : result.status === "empty"
          ? "runtime-events-outbox-empty"
          : "runtime-events-delivered",
        pending_count: result.pending_count,
        attempted_count: result.attempted_count,
        sent_count: result.sent_count,
      };
      process.stdout.write(options.format === "json"
        ? `${JSON.stringify(output, null, 2)}\n`
        : `${output.status}: ${output.sent_count} event(s) sent, ${output.pending_count} pending\n`);
    });
}
