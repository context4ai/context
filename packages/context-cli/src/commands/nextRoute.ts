import type { Command } from "commander";
import { mergedWorkflowAuthorities } from "../project/workflow/workflowCommandOptions.js";

/** The running command's own `--managed`/`--authority`, merged with the global options. */
export function nextRouteExecution(program: Command, command: { managed?: boolean; authorities?: readonly string[] } = {}) {
  const root = program.opts() as { workflowManaged?: boolean; workflowAuthority?: unknown };
  return { managed: root.workflowManaged === true || command.managed === true,
    authorities: mergedWorkflowAuthorities(root.workflowAuthority, command.authorities ?? []) };
}

/** A result whose next step is only "check status", or that names none, carries that status's Route,
 * as `version record` does. If observing fails, the result keeps its status command. */
export async function withNextRoute(program: Command, projectRoot: string, result: unknown,
  command: { managed?: boolean; authorities?: readonly string[] } = {}): Promise<unknown> {
  const next = (result as { next_action?: { command?: unknown } } | null)?.next_action;
  if (next !== undefined && next.command !== "context status --format json") return result;
  try {
    const { collectProjectStatus } = await import("../project/status.js");
    const status = await collectProjectStatus(projectRoot, nextRouteExecution(program, command));
    return { ...(result as object), workflow: status.workflow };
  } catch { return result; }
}
