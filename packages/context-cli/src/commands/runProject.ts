import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { runProjectPhaseCommand } from "../project/run.js";
import { collectProjectStatus } from "../project/status.js";
import { findContextProjectRoot } from "../project/workspace.js";
import {
  collectWorkflowAuthorityOption,
  mergedWorkflowAuthorities,
} from "../project/workflow/workflowCommandOptions.js";
import {
  formatWorkflowRunResult,
  runWorkflowUntilBlockedOrComplete,
} from "../project/workflow/workflowRun.js";
import {
  parseWorkflowResourceReceipts,
  workflowResourceReceiptCwd,
} from "../project/workflow/workflowResourceReceipts.js";
import { ExitCode } from "../types/exitCode.js";
import { recordWorkflowStop } from "../project/debugTrace.js";
import { WorkspaceExecutionRuntime } from "../project/workflow/workflowExecutionRuntime.js";
import { createWorkflowInProcessExecutor } from "../project/workflow/workflowInProcessActions.js";

type ProjectRunInput = Parameters<typeof runProjectPhaseCommand>[0];

function projectRunFormat(value: unknown): "text" | "json" {
  if (value === "text" || value === "json") return value;
  throw new ContextError(
    ExitCode.UserError,
    "--format must be text or json",
    { category: ErrorCategory.UserInputInvalid },
  );
}

function integerOption(
  value: unknown,
  name: string,
  range: { min: number; max: number },
): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (
    !Number.isInteger(parsed) ||
    parsed < range.min ||
    parsed > range.max
  ) {
    throw new ContextError(
      ExitCode.UserError,
      `${name} must be an integer from ${range.min} to ${range.max}`,
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  return parsed;
}

function assertUntilOptions(
  phaseId: string | undefined,
  options: Record<string, unknown>,
): void {
  if (phaseId !== undefined) {
    throw new ContextError(
      ExitCode.UserError,
      "--until cannot be combined with a phase id",
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  const incompatible = [
    "list",
    "verbose",
  ].filter((key) =>
    options[key] !== undefined && options[key] !== false
  );
  if (incompatible.length > 0) {
    throw new ContextError(
      ExitCode.UserError,
      `--until cannot be combined with phase options: ${incompatible.join(", ")}`,
      { category: ErrorCategory.UserInputInvalid },
    );
  }
}

function projectPhaseRunInput(input: {
  cwd: string;
  phaseId?: string;
  options: Record<string, unknown>;
  managed: boolean;
  authorities: NonNullable<ProjectRunInput["authorities"]>;
  format: "text" | "json";
  workflowRevision?: string;
  resourceReceiptsReference?: string;
}): ProjectRunInput {
  return {
    cwd: input.cwd,
    ...(input.phaseId === undefined ? {} : { phaseId: input.phaseId }),
    ...(input.options.list === true ? { list: true } : {}),
    ...(input.options.dryRun === true ? { dryRun: true } : {}),
    ...(input.managed ? { managed: true } : {}),
    ...(input.workflowRevision === undefined
      ? {}
      : { workflowRevision: input.workflowRevision }),
    ...(input.resourceReceiptsReference === undefined
      ? {}
      : { resourceReceiptsReference: input.resourceReceiptsReference }),
    ...(input.authorities !== undefined && input.authorities.length > 0
      ? { authorities: input.authorities }
      : {}),
    ...(input.options.verbose === true ? { verbose: true } : {}),
    format: input.format,
  };
}

async function runManagedUntil(input: {
  cwd: string;
  cliModuleUrl: string;
  phaseId?: string;
  options: Record<string, unknown>;
  managed: boolean;
  authorities: NonNullable<ProjectRunInput["authorities"]>;
  format: "text" | "json";
  resourceReceiptsReference?: string;
}): Promise<void> {
  assertUntilOptions(input.phaseId, input.options);
  if (input.options.until !== "blocked-or-complete") {
    throw new ContextError(
      ExitCode.UserError,
      "--until currently supports only blocked-or-complete",
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  if (!input.managed) {
    throw new ContextError(
      ExitCode.UserError,
      "--until blocked-or-complete requires explicit --managed authority in the current conversation",
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  const found = findContextProjectRoot(input.cwd);
  if (found === null) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "managed workflow execution requires a context project",
      { category: ErrorCategory.WorkspaceNotFound },
    );
  }
  const resourceReceipts = input.resourceReceiptsReference === undefined
    ? undefined
    : await parseWorkflowResourceReceipts(
        input.resourceReceiptsReference,
        found.projectRoot,
      );
  const runtime = new WorkspaceExecutionRuntime({
    projectRoot: found.projectRoot,
    cliEntryPath: fileURLToPath(input.cliModuleUrl),
    inProcess: createWorkflowInProcessExecutor(),
  });
  let result;
  try {
    result = await runWorkflowUntilBlockedOrComplete({
      observe: () =>
        collectProjectStatus(found.projectRoot, {
          managed: true,
          authorities: input.authorities,
          ...(resourceReceipts === undefined ? {} : { resourceReceipts }),
          ...(input.resourceReceiptsReference === undefined
            ? {}
            : { resourceReceiptsReference: input.resourceReceiptsReference }),
        }),
      execute: (command) => runtime.execute(command),
      maxSteps: integerOption(input.options.maxSteps, "--max-steps", {
        min: 1,
        max: 100,
      }),
      dryRun: input.options.dryRun === true,
    });
  } finally {
    await runtime.close();
  }
  await recordWorkflowStop(found.projectRoot, {
    state: result.state,
    steps: result.steps.length,
    stop: result.stop,
    final_workflow: {
      revision: result.workflow.revision,
      status: result.workflow.status,
      route_id: result.workflow.current?.id,
      node: result.workflow.current?.node,
      reason_code: result.workflow.current?.reason_code,
    },
  });
  process.stdout.write(formatWorkflowRunResult(result, input.format));
}


export function registerProjectRunCommand(
  program: Command,
  cliModuleUrl: string,
): void {
  program
    .command("run [phase-id]")
    .description("Inspect or run a declared project phase")
    .option("--list", "list declared phases")
    .option("--dry-run", "print phase reads/writes or the next managed workflow command without mutating project files")
    .option("--managed", "continue this command under explicit current-conversation managed approval")
    .addOption(
      new Option("--authority <authority>", "current-conversation scoped authority granted by the user; repeatable")
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .option("--until <condition>", "with --managed and no phase id, execute deterministic routes until blocked-or-complete")
    .option("--max-steps <n>", "maximum deterministic routes for --until", "25")
    .option("--verbose", "include phase contracts and repeated source metadata in JSON output")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (
      phaseId: string | undefined,
      options: Record<string, unknown>,
    ) => {
      const format = projectRunFormat(options.format);
      const rootOptions = program.opts() as Record<string, unknown>;
      const managed = options.managed === true ||
        rootOptions.workflowManaged === true;
      const authorities = mergedWorkflowAuthorities(
        rootOptions.workflowAuthority,
        options.authority,
      );
      const resourceReceiptsReference = typeof rootOptions.workflowResourceReceipts === "string"
        ? rootOptions.workflowResourceReceipts
        : undefined;
      const cwd = workflowResourceReceiptCwd(resourceReceiptsReference, process.cwd());
      if (options.until !== undefined) {
        await runManagedUntil({
          cwd,
          cliModuleUrl,
          ...(phaseId === undefined ? {} : { phaseId }),
          options,
          managed,
          authorities,
          format,
          ...(resourceReceiptsReference === undefined
            ? {}
            : { resourceReceiptsReference }
          ),
        });
        return;
      }
      await runProjectPhaseCommand(projectPhaseRunInput({
        cwd,
        ...(phaseId === undefined ? {} : { phaseId }),
        options,
        managed,
        authorities,
        format,
        ...(typeof rootOptions.workflowRevision === "string"
          ? { workflowRevision: rootOptions.workflowRevision }
          : {}),
        ...(resourceReceiptsReference === undefined ? {} : { resourceReceiptsReference }),
      }));
    });
}
