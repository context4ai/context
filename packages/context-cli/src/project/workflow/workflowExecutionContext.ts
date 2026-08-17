import { contextWorkflowAuthorities } from "./workflowFacts.js";
import type { ContextWorkflowAuthority } from "./workflowTypes.js";

export interface ContextWorkflowExecutionContext {
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
  revision?: string;
  resourceReceiptsReference?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function workflowStatusCommand(
  context: ContextWorkflowExecutionContext,
): string {
  const managedAuthorities = contextWorkflowAuthorities({ managed: true });
  const effectiveAuthorities = contextWorkflowAuthorities({
    managed: context.managed,
    authorities: context.authorities,
  });
  const explicitAuthorities = context.managed
    ? effectiveAuthorities.filter((authority) =>
      !managedAuthorities.includes(authority)
    )
    : effectiveAuthorities;
  return [
    "context status",
    ...(context.managed ? ["--managed"] : []),
    ...explicitAuthorities.flatMap((authority) => [
      "--authority",
      shellQuote(authority),
    ]),
    ...(context.resourceReceiptsReference === undefined
      ? []
      : ["--resource-receipts", shellQuote(context.resourceReceiptsReference)]),
    "--format json",
  ].join(" ");
}

function workflowContextCommand(
  command: string,
  context: ContextWorkflowExecutionContext,
): string {
  if (!command.startsWith("context ") || command.startsWith("context --workflow-revision ")) {
    return command;
  }
  const managedAuthorities = contextWorkflowAuthorities({ managed: true });
  const effectiveAuthorities = contextWorkflowAuthorities({
    managed: context.managed,
    authorities: context.authorities,
  });
  const explicitAuthorities = context.managed
    ? effectiveAuthorities.filter((authority) => !managedAuthorities.includes(authority))
    : effectiveAuthorities;
  const prefix = [
    "context",
    ...(context.revision === undefined
      ? []
      : ["--workflow-revision", shellQuote(context.revision)]),
    ...(context.managed ? ["--workflow-managed"] : []),
    ...explicitAuthorities.flatMap((authority) => [
      "--workflow-authority",
      shellQuote(authority),
    ]),
    ...(context.resourceReceiptsReference === undefined
      ? []
      : [
          "--workflow-resource-receipts",
          shellQuote(context.resourceReceiptsReference),
        ]),
  ];
  return [...prefix, command.slice("context ".length)].join(" ");
}

export function bindWorkflowExecutionContext<T>(
  result: T,
  context: ContextWorkflowExecutionContext,
): T {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    return result;
  }
  const record = result as Record<string, unknown>;
  const nextAction = record.next_action;
  if (
    nextAction === null ||
    typeof nextAction !== "object" ||
    Array.isArray(nextAction)
  ) {
    return result;
  }
  const nextRecord = nextAction as Record<string, unknown>;
  if (nextRecord.command === "context status --format json") {
    return {
      ...record,
      next_action: {
        ...nextRecord,
        command: workflowStatusCommand(context),
      },
    } as T;
  }
  if (typeof nextRecord.command !== "string") {
    return result;
  }
  return {
    ...record,
    next_action: {
      ...nextRecord,
        command: workflowContextCommand(nextRecord.command, context),
    },
  } as T;
}
