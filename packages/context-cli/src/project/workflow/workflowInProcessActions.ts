import { contextWorkflowAuthorities } from "./workflowFacts.js";
import type { ContextWorkflowAuthority } from "./workflowTypes.js";
import type { WorkflowInProcessExecutor } from "./workflowExecutionRuntime.js";
import { assertProjectWorkflowRevision } from "../statusCommand.js";
import { runProjectPhaseCommand } from "../run.js";
import {
  runReviewApproveAllCommand,
  runReviewReconcileIdentitiesCommand,
} from "../review.js";
import { runProjectCloseCommand } from "../close.js";
import { runProjectBuildCommand } from "../packageBuilder.js";
import { acceptStarterPackageTemplates } from "../packageTemplateReview.js";
import type { ProseAlignRunOptions } from "../proseAlignTypes.js";
import { formatFeedback } from "../../lib/cliFeedback.js";
import { workflowAuthorities } from "./workflowCommandOptions.js";

interface ParsedWorkflowInvocation {
  revision: string;
  managed: boolean;
  authorities: ContextWorkflowAuthority[];
  resourceReceiptsReference?: string;
  command: string[];
}

interface ParsedOptions {
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

const VALUE_OPTIONS = new Set([
  "--workflow-revision",
  "--workflow-authority",
  "--workflow-resource-receipts",
]);

function takeOption(
  args: readonly string[],
  index: number,
): { name: string; value?: string; consumed: number } {
  const token = args[index]!;
  const equals = token.indexOf("=");
  if (equals > 0) {
    return { name: token.slice(0, equals), value: token.slice(equals + 1), consumed: 1 };
  }
  if (VALUE_OPTIONS.has(token)) {
    const value = args[index + 1];
    if (value === undefined) throw new Error(`missing value for ${token}`);
    return { name: token, value, consumed: 2 };
  }
  return { name: token, consumed: 1 };
}

function parseWorkflowInvocation(args: readonly string[]): ParsedWorkflowInvocation | undefined {
  let index = 0;
  let revision: string | undefined;
  let managed = false;
  let resourceReceiptsReference: string | undefined;
  const requestedAuthorities: string[] = [];
  while (index < args.length && args[index]!.startsWith("--workflow-")) {
    const option = takeOption(args, index);
    if (option.name === "--workflow-revision") revision = option.value;
    else if (option.name === "--workflow-managed") managed = true;
    else if (option.name === "--workflow-authority" && option.value !== undefined) {
      requestedAuthorities.push(option.value);
    } else if (option.name === "--workflow-resource-receipts") {
      resourceReceiptsReference = option.value;
    } else {
      return undefined;
    }
    index += option.consumed;
  }
  if (revision === undefined || index >= args.length) return undefined;
  return {
    revision,
    managed,
    authorities: workflowAuthorities(requestedAuthorities),
    ...(resourceReceiptsReference === undefined ? {} : { resourceReceiptsReference }),
    command: args.slice(index),
  };
}

function parseOptions(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string>,
): ParsedOptions | undefined {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < args.length;) {
    const token = args[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      index += 1;
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals > 0 ? token.slice(0, equals) : token;
    if (flagOptions.has(name)) {
      if (equals > 0) return undefined;
      flags.add(name);
      index += 1;
      continue;
    }
    if (!valueOptions.has(name)) return undefined;
    const value = equals > 0 ? token.slice(equals + 1) : args[index + 1];
    if (value === undefined) return undefined;
    values.set(name, value);
    index += equals > 0 ? 1 : 2;
  }
  return { positionals, flags, values };
}

const RUN_VALUE_OPTIONS = new Set([
  "--input",
  "--format",
  "--view",
  "--token-budget",
  "--byte-budget",
  "--page-size",
  "--page-token",
  "--read-cursor",
  "--rule",
  "--source",
  "--query",
  "--collection",
  "--node-type",
  "--chunk",
  "--span",
  "--range",
]);
const RUN_FLAG_OPTIONS = new Set([
  "--dry-run",
  "--auto-promote",
  "--managed",
  "--schema",
  "--validate",
  "--stage",
  "--confirm",
  "--compact",
  "--verbose",
]);

function optionValue(options: ParsedOptions, name: string): string | undefined {
  return options.values.get(name);
}

function outputFormat(options: ParsedOptions): "text" | "json" | undefined {
  const value = optionValue(options, "--format");
  return value === undefined || value === "text" || value === "json"
    ? value
    : undefined;
}

async function executePhase(
  cwd: string,
  invocation: ParsedWorkflowInvocation,
): Promise<void> {
  const options = parseOptions(invocation.command.slice(1), RUN_VALUE_OPTIONS, RUN_FLAG_OPTIONS);
  if (options === undefined || options.positionals.length !== 1) {
    throw new Error("managed in-process phase command has an unsupported shape");
  }
  const phaseId = options.positionals[0]!;
  const managed = invocation.managed || options.flags.has("--managed");
  const align: ProseAlignRunOptions = {
    ...(options.flags.has("--schema") ? { schema: true } : {}),
    ...(options.flags.has("--validate") ? { validate: true } : {}),
    ...(options.flags.has("--stage") ? { stage: true } : {}),
    ...(options.flags.has("--confirm") ? { confirm: true } : {}),
    ...(managed ? { managed: true } : {}),
    ...(options.flags.has("--compact") ? { compact: true } : {}),
  };
  const alignValues: Array<[string, keyof ProseAlignRunOptions]> = [
    ["--view", "view"],
    ["--input", "input"],
    ["--token-budget", "tokenBudget"],
    ["--byte-budget", "byteBudget"],
    ["--page-size", "pageSize"],
    ["--page-token", "pageToken"],
    ["--read-cursor", "readCursor"],
    ["--rule", "rule"],
    ["--source", "source"],
    ["--query", "query"],
    ["--collection", "collection"],
    ["--node-type", "nodeType"],
    ["--chunk", "chunk"],
    ["--span", "span"],
    ["--range", "range"],
  ];
  for (const [option, key] of alignValues) {
    const value = optionValue(options, option);
    if (value !== undefined) align[key] = value as never;
  }
  await runProjectPhaseCommand({
    cwd,
    phaseId,
    ...(options.flags.has("--dry-run") ? { dryRun: true } : {}),
    ...(options.flags.has("--auto-promote") ? { autoPromote: true } : {}),
    ...(managed ? { managed: true } : {}),
    workflowRevision: invocation.revision,
    ...(invocation.resourceReceiptsReference === undefined
      ? {}
      : { resourceReceiptsReference: invocation.resourceReceiptsReference }),
    authorities: contextWorkflowAuthorities({ managed, authorities: invocation.authorities }),
    ...(options.flags.has("--verbose") ? { verbose: true } : {}),
    format: optionValue(options, "--format") === "json" ? "json" : "text",
    align,
  });
}

function supportsCommand(command: readonly string[]): boolean {
  const [topLevel, subcommand] = command;
  if (topLevel === "run") {
    const options = parseOptions(command.slice(1), RUN_VALUE_OPTIONS, RUN_FLAG_OPTIONS);
    return options !== undefined && options.positionals.length === 1 &&
      outputFormat(options) !== undefined;
  }
  if (topLevel === "close" || topLevel === "build") {
    const options = parseOptions(
      command.slice(1),
      new Set(["--format"]),
      topLevel === "build" ? new Set(["--verbose"]) : new Set(),
    );
    return options !== undefined && options.positionals.length === 0 &&
      outputFormat(options) !== undefined;
  }
  if (topLevel === "review" && subcommand === "approve-all") {
    const options = parseOptions(
      command.slice(2),
      new Set(["--format"]),
      new Set(["--all", "--managed", "--verbose"]),
    );
    return options !== undefined && options.positionals.length <= 1 &&
      !(options.flags.has("--all") && options.positionals.length === 1) &&
      outputFormat(options) !== undefined;
  }
  if (topLevel === "review" && subcommand === "reconcile-identities") {
    const options = parseOptions(
      command.slice(2),
      new Set(["--source", "--strategy", "--format"]),
      new Set(),
    );
    return options !== undefined && options.positionals.length === 0 &&
      optionValue(options, "--source") !== undefined &&
      optionValue(options, "--strategy") === "preserve-approved" &&
      outputFormat(options) !== undefined;
  }
  if (topLevel === "package" && subcommand === "template" && command[2] === "accept") {
    const options = parseOptions(command.slice(3), new Set(["--format"]), new Set(["--all"]));
    return options !== undefined && options.positionals.length <= 1 &&
      (options.positionals.length === 1) !== options.flags.has("--all") &&
      outputFormat(options) !== undefined;
  }
  return false;
}

async function assertRevision(
  cwd: string,
  invocation: ParsedWorkflowInvocation,
): Promise<ContextWorkflowAuthority[]> {
  const authorities = contextWorkflowAuthorities({
    managed: invocation.managed,
    authorities: invocation.authorities,
  });
  await assertProjectWorkflowRevision({
    cwd,
    expectedRevision: invocation.revision,
    managed: invocation.managed,
    authorities,
  });
  return authorities;
}

async function executeClose(
  cwd: string,
  command: readonly string[],
): Promise<void> {
  const options = parseOptions(command.slice(1), new Set(["--format"]), new Set());
  if (options === undefined || options.positionals.length > 0) throw new Error("unsupported close command");
  await runProjectCloseCommand({ cwd, format: outputFormat(options) ?? "text" });
}

async function executeBuild(
  cwd: string,
  command: readonly string[],
): Promise<void> {
  const options = parseOptions(
    command.slice(1),
    new Set(["--format"]),
    new Set(["--verbose"]),
  );
  if (options === undefined || options.positionals.length > 0) throw new Error("unsupported build command");
  await runProjectBuildCommand({
    cwd,
    format: outputFormat(options) ?? "text",
    verbose: options.flags.has("--verbose"),
  });
}

async function executeReviewApproveAll(
  cwd: string,
  invocation: ParsedWorkflowInvocation,
): Promise<void> {
  const options = parseOptions(
    invocation.command.slice(2),
    new Set(["--format"]),
    new Set(["--all", "--managed", "--verbose"]),
  );
  if (options === undefined || options.positionals.length > 1) throw new Error("unsupported review approve-all command");
  await runReviewApproveAllCommand({
    cwd,
    ...(options.positionals[0] === undefined ? {} : { collection: options.positionals[0] }),
    ...(options.flags.has("--all") ? { all: true } : {}),
    managed: invocation.managed || options.flags.has("--managed"),
    verbose: options.flags.has("--verbose"),
    format: outputFormat(options) ?? "text",
  });
}

async function executeReviewReconcile(
  cwd: string,
  command: readonly string[],
): Promise<void> {
  const options = parseOptions(
    command.slice(2),
    new Set(["--source", "--strategy", "--format"]),
    new Set(),
  );
  if (options === undefined || options.positionals.length > 0) throw new Error("unsupported review reconciliation command");
  await runReviewReconcileIdentitiesCommand({
    cwd,
    source: optionValue(options, "--source") ?? "",
    strategy: optionValue(options, "--strategy") ?? "",
    format: outputFormat(options) ?? "text",
  });
}

async function executePackageTemplateAccept(
  cwd: string,
  command: readonly string[],
): Promise<void> {
  const options = parseOptions(command.slice(3), new Set(["--format"]), new Set(["--all"]));
  if (options === undefined || options.positionals.length > 1) throw new Error("unsupported package template command");
  const result = await acceptStarterPackageTemplates({
    projectRoot: cwd,
    ...(options.positionals[0] === undefined ? {} : { packageNames: [options.positionals[0]] }),
  });
  if (outputFormat(options) === "json") {
    process.stdout.write(`${JSON.stringify({
      action: "package-template-accepted",
      ...result,
      next_action: {
        kind: "reevaluate-workspace",
        command: "context status --format json",
      },
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "accepted",
    subject: result.accepted.join(", ") || "package templates",
    headline: "starter package template",
    body: result.alreadyResolved.length === 0
      ? []
      : [`already resolved: ${result.alreadyResolved.join(", ")}`],
  }));
}

async function executeCommand(
  cwd: string,
  invocation: ParsedWorkflowInvocation,
): Promise<void> {
  await assertRevision(cwd, invocation);
  const [command, subcommand] = invocation.command;
  if (command === "run") {
    await executePhase(cwd, invocation);
    return;
  }
  if (command === "close") {
    await executeClose(cwd, invocation.command);
    return;
  }
  if (command === "build") {
    await executeBuild(cwd, invocation.command);
    return;
  }
  if (command === "review" && subcommand === "approve-all") {
    await executeReviewApproveAll(cwd, invocation);
    return;
  }
  if (command === "review" && subcommand === "reconcile-identities") {
    await executeReviewReconcile(cwd, invocation.command);
    return;
  }
  if (command === "package" && subcommand === "template" && invocation.command[2] === "accept") {
    await executePackageTemplateAccept(cwd, invocation.command);
    return;
  }
  throw new Error(`unsupported managed in-process command: ${invocation.command.join(" ")}`);
}

export function createWorkflowInProcessExecutor(): WorkflowInProcessExecutor {
  return {
    supports: ({ args, effect }) => {
      if (effect === "external") return false;
      try {
        const invocation = parseWorkflowInvocation(args);
        return invocation !== undefined && supportsCommand(invocation.command);
      } catch {
        return false;
      }
    },
    execute: async ({ cwd, args }) => {
      const invocation = parseWorkflowInvocation(args);
      if (invocation === undefined) throw new Error("managed in-process command is not revision-bound");
      await executeCommand(cwd, invocation);
    },
  };
}
