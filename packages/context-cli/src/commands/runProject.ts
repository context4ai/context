import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { runProjectPhaseCommand } from "../project/run.js";
import {
  formatProseStructureBatchResult,
  runProseStructureBatch,
} from "../project/proseStructureBatch.js";
import { collectProjectStatus } from "../project/status.js";
import { findContextProjectRoot } from "../project/workspace.js";
import {
  collectWorkflowAuthorityOption,
  mergedWorkflowAuthorities,
} from "../project/workflow/workflowCommandOptions.js";
import { bindWorkflowExecutionContext } from "../project/workflow/workflowExecutionContext.js";
import {
  formatWorkflowRunResult,
  runWorkflowUntilBlockedOrComplete,
} from "../project/workflow/workflowRun.js";
import { parseWorkflowResourceReceipts } from "../project/workflow/workflowResourceReceipts.js";
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
    "autoPromote",
    "view",
    "schema",
    "validate",
    "stage",
    "confirm",
    "input",
    "tokenBudget",
    "byteBudget",
    "compact",
    "pageSize",
    "pageToken",
    "readCursor",
    "rule",
    "source",
    "query",
    "collection",
    "nodeType",
    "chunk",
    "span",
    "range",
    "verbose",
    "batchInput",
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

function assertBatchOptions(
  phaseId: string | undefined,
  options: Record<string, unknown>,
): "validate" | "stage" {
  if (phaseId !== undefined) {
    throw new ContextError(ExitCode.UserError, "--batch-input cannot be combined with a phase id", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const validate = options.validate === true;
  const stage = options.stage === true;
  if (validate === stage) {
    throw new ContextError(ExitCode.UserError, "--batch-input requires exactly one of --validate or --stage", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const incompatible = [
    "list",
    "dryRun",
    "autoPromote",
    "until",
    "view",
    "schema",
    "confirm",
    "input",
    "tokenBudget",
    "byteBudget",
    "compact",
    "pageSize",
    "pageToken",
    "readCursor",
    "rule",
    "source",
    "query",
    "collection",
    "nodeType",
    "chunk",
    "span",
    "range",
    "verbose",
  ].filter((key) => options[key] !== undefined && options[key] !== false);
  if (incompatible.length > 0) {
    throw new ContextError(ExitCode.UserError, `--batch-input cannot be combined with: ${incompatible.join(", ")}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  return stage ? "stage" : "validate";
}

function alignRunOptions(
  options: Record<string, unknown>,
  managed: boolean,
): NonNullable<ProjectRunInput["align"]> {
  return {
    ...(typeof options.view === "string" ? { view: options.view } : {}),
    ...(options.schema === true ? { schema: true } : {}),
    ...(options.validate === true ? { validate: true } : {}),
    ...(options.stage === true ? { stage: true } : {}),
    ...(options.confirm === true ? { confirm: true } : {}),
    ...(managed ? { managed: true } : {}),
    ...(typeof options.input === "string" ? { input: options.input } : {}),
    ...(typeof options.tokenBudget === "string"
      ? { tokenBudget: options.tokenBudget }
      : {}),
    ...(typeof options.byteBudget === "string"
      ? { byteBudget: options.byteBudget }
      : {}),
    ...(options.compact === true ? { compact: true } : {}),
    ...(typeof options.pageSize === "string"
      ? { pageSize: options.pageSize }
      : {}),
    ...(typeof options.pageToken === "string"
      ? { pageToken: options.pageToken }
      : {}),
    ...(typeof options.readCursor === "string"
      ? { readCursor: options.readCursor }
      : {}),
    ...(typeof options.rule === "string" ? { rule: options.rule } : {}),
    ...(typeof options.source === "string" ? { source: options.source } : {}),
    ...(typeof options.query === "string" ? { query: options.query } : {}),
    ...(typeof options.collection === "string"
      ? { collection: options.collection }
      : {}),
    ...(typeof options.nodeType === "string"
      ? { nodeType: options.nodeType }
      : {}),
    ...(typeof options.chunk === "string" ? { chunk: options.chunk } : {}),
    ...(typeof options.span === "string" ? { span: options.span } : {}),
    ...(typeof options.range === "string" ? { range: options.range } : {}),
  };
}

function projectPhaseRunInput(input: {
  phaseId?: string;
  options: Record<string, unknown>;
  managed: boolean;
  authorities: NonNullable<ProjectRunInput["authorities"]>;
  format: "text" | "json";
  workflowRevision?: string;
  resourceReceiptsReference?: string;
}): ProjectRunInput {
  return {
    cwd: process.cwd(),
    ...(input.phaseId === undefined ? {} : { phaseId: input.phaseId }),
    ...(input.options.list === true ? { list: true } : {}),
    ...(input.options.dryRun === true ? { dryRun: true } : {}),
    ...(input.options.autoPromote === true ? { autoPromote: true } : {}),
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
    align: alignRunOptions(input.options, input.managed),
    format: input.format,
  };
}

async function runManagedUntil(input: {
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
  const found = findContextProjectRoot(process.cwd());
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
    .option("--auto-promote", "with a codegraph extract phase, apply deterministic deltas, refresh close, and verify without review")
    .option("--managed", "continue this command under explicit current-conversation managed approval")
    .addOption(
      new Option("--authority <authority>", "current-conversation scoped authority granted by the user; repeatable")
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .option("--until <condition>", "with --managed and no phase id, execute deterministic routes until blocked-or-complete")
    .option("--max-steps <n>", "maximum deterministic routes for --until", "25")
    .option("--view <view>", "with align/compile phases, return evidence or context view")
    .option("--schema", "with align phases, return the context.structure.v1 schema")
    .option("--validate", "validate an align structure or deterministic compile projection")
    .option("--stage", "stage an align structure or deterministically materialize a confirmed compile slot")
    .option("--confirm", "with align phases, confirm and stage a draft structure after explicit user approval")
    .option("--input <file>", "read payload YAML/JSON for one validate, stage, confirm, or input-consuming view operation")
    .option("--batch-input <file>", "validate or stage multiple align structure payloads from one batch manifest")
    .option("--token-budget <n>", "with align evidence views, limit approximate output tokens")
    .option("--byte-budget <n>", "with align evidence views, limit evidence output bytes")
    .option("--compact", "with align source-index, return a refs-only compact index")
    .option("--page-size <n>", "with paged evidence, diagnostics, or semantic-rules views, limit page output")
    .option("--page-token <token>", "with paged item or diagnostics views, continue pagination")
    .option("--read-cursor <cursor>", "with paged text or semantic-rules views, continue line pagination")
    .option("--rule <id>", "with semantic-rules view, read one required rule by id")
    .option("--source <locator>", "with align evidence views, narrow to one document path or locator")
    .option("--query <text>", "with align existing-knowledge view, match an approved title or stable ref")
    .option("--collection <name>", "with align existing-knowledge view, filter by collection")
    .option("--node-type <type>", "with align existing-knowledge view, filter by node type")
    .option("--chunk <id>", "with align span-text/source-bundle, narrow to a reading chunk")
    .option("--span <source-ref>", "with align span-text, read a canonical source span")
    .option("--range <range>", "with align span-text and --source, read a line range")
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
      if (typeof options.batchInput === "string") {
        const operation = assertBatchOptions(phaseId, options);
        const result = await runProseStructureBatch({
          cwd: process.cwd(),
          batchInput: options.batchInput,
          operation,
          managed,
        });
        const bound = bindWorkflowExecutionContext(result, {
          managed,
          authorities,
          ...(typeof rootOptions.workflowRevision === "string"
            ? { revision: rootOptions.workflowRevision }
            : {}),
          ...(typeof rootOptions.workflowResourceReceipts === "string"
            ? { resourceReceiptsReference: rootOptions.workflowResourceReceipts }
            : {}),
        });
        process.stdout.write(formatProseStructureBatchResult(bound, format));
        return;
      }
      if (options.until !== undefined) {
        await runManagedUntil({
          cliModuleUrl,
          ...(phaseId === undefined ? {} : { phaseId }),
          options,
          managed,
          authorities,
          format,
          ...(typeof rootOptions.workflowResourceReceipts === "string"
            ? { resourceReceiptsReference: rootOptions.workflowResourceReceipts }
            : {}),
        });
        return;
      }
      await runProjectPhaseCommand(projectPhaseRunInput({
        ...(phaseId === undefined ? {} : { phaseId }),
        options,
        managed,
        authorities,
        format,
        ...(typeof rootOptions.workflowRevision === "string"
          ? { workflowRevision: rootOptions.workflowRevision }
          : {}),
        ...(typeof rootOptions.workflowResourceReceipts === "string"
          ? { resourceReceiptsReference: rootOptions.workflowResourceReceipts }
          : {}),
      }));
    });
}
