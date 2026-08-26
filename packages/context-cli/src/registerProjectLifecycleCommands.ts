import { Command, Option } from "commander";
import { ErrorCategory } from "./lib/cliFeedback.js";
import { ContextError } from "./lib/errors.js";
import { runProjectCloseCommand } from "./project/close.js";
import { runProjectBuildCommand } from "./project/packageBuilder.js";
import { runProjectStatusCommand } from "./project/statusCommand.js";
import { runProjectVerifyCommand } from "./project/verify.js";
import {
  formatProjectInitResult,
  initContextProject,
  isContextProjectRoot,
  projectLanguage,
  resolveContextProjectInitTarget,
} from "./project/workspace.js";
import {
  collectWorkflowAuthorityOption,
  workflowAuthorities,
} from "./project/workflow/workflowCommandOptions.js";
import {
  parseWorkflowResourceReceipts,
  workflowResourceReceiptCwd,
} from "./project/workflow/workflowResourceReceipts.js";
import { queueContextRuntimeEvent } from "./runtimeEvents.js";
import { ExitCode } from "./types/exitCode.js";
import { formatContextEntry, resolveContextEntry } from "./project/entryCommand.js";

export function registerProjectEntryCommand(program: Command): void {
  program
    .command("entry [project-dir]")
    .description("Resolve the single Context agent entry for initialization or workflow evaluation")
    .option("--name <name>", "display/package name override when initialization is required")
    .option("--language <language>", "workspace and starter-template language: en | zh-CN", "en")
    .option("--dev", "plan initialization with the locally linked @c4a/context SDK")
    .option("--debug", "plan initialization with workspace-local tracing enabled")
    .option("--optimize-docs", "plan initialization with document optimization enabled")
    .option("--no-optimize-docs", "plan initialization with document optimization disabled")
    .option("--managed", "use explicit current-conversation managed approval for workflow evaluation")
    .addOption(
      new Option("--authority <authority>", "current-conversation scoped authority granted by the user; repeatable")
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .option("--format <format>", "output format: json", "json")
    .action((projectDir: string | undefined, options: Record<string, unknown>) => {
      if (options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      process.stdout.write(formatContextEntry(resolveContextEntry({
        cwd: process.cwd(),
        ...(projectDir === undefined ? {} : { projectDir }),
        ...(typeof options.name === "string" ? { name: options.name } : {}),
        language: projectLanguage(options.language),
        ...(options.dev === true ? { dev: true } : {}),
        ...(options.debug === true ? { debug: true } : {}),
        ...(typeof options.optimizeDocs === "boolean" ? { optimizeDocs: options.optimizeDocs } : {}),
        ...(options.managed === true ? { managed: true } : {}),
        authorities: workflowAuthorities(options.authority),
      })));
    });
}

export function registerProjectInitCommand(program: Command): void {
  program
    .command("init [project-dir]")
    .description("Initialize a project-local context workspace")
    .option("--name <name>", "display/package name override")
    .option("--language <language>", "workspace and starter-template language: en | zh-CN")
    .option("--dev", "initialize with the locally linked @c4a/context SDK")
    .option("--debug", "enable workspace-local command and Agent Graph tracing")
    .option("--optimize-docs", "enable source-constrained editorial revisions (default for new workspaces)")
    .option("--no-optimize-docs", "disable document revisions for the initialized workspace")
    .option("--allow-nonempty", "after explicit confirmation, preserve existing files and initialize inside a non-empty non-Context directory")
    .action(async (projectDir: string | undefined, options: Record<string, unknown>) => {
      const targetRoot = resolveContextProjectInitTarget(process.cwd(), projectDir);
      const wasContextWorkspace = isContextProjectRoot(targetRoot);
      const optimizeDocs = typeof options.optimizeDocs === "boolean"
        ? options.optimizeDocs
        : wasContextWorkspace
        ? undefined
        : true;
      const result = await initContextProject({
        cwd: process.cwd(),
        ...(projectDir !== undefined ? { projectDir } : {}),
        ...(typeof options.name === "string" ? { name: options.name } : {}),
        ...(typeof options.language === "string"
          ? { language: projectLanguage(options.language) }
          : {}),
        ...(options.dev === true ? { dev: true } : {}),
        ...(options.debug === true ? { debug: true } : {}),
        ...(optimizeDocs === undefined ? {} : { optimizeDocs }),
        ...(options.allowNonempty === true ? { allowNonempty: true } : {}),
      });
      process.stdout.write(formatProjectInitResult(result));
      if (!wasContextWorkspace) {
        queueContextRuntimeEvent({
          cwd: result.projectRoot,
          kind: "workspace.initialized",
          properties: {
            init_mode: result.kept.length > 0 ? "nonempty_existing" : "new",
            language: result.language,
            created_file_count: result.created.length,
          },
        });
      }
    });
}

export function registerProjectStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Print workspace overview and suggested next actions")
    .option("--format <format>", "output format: table | json", "table")
    .option("--view <view>", "with --format json, output view: summary | full", "summary")
    .option("--managed", "use explicit current-conversation managed approval for this status loop")
    .option("--resource-receipts <json-or-@file>", "current-conversation Agent Graph resource read receipts")
    .addOption(
      new Option("--authority <authority>", "current-conversation scoped authority granted by the user; repeatable")
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .action(async (options: Record<string, unknown>) => {
      const rootOptions = program.opts() as Record<string, unknown>;
      const resourceReceiptsReference = typeof options.resourceReceipts === "string"
        ? options.resourceReceipts
        : typeof rootOptions.workflowResourceReceipts === "string"
        ? rootOptions.workflowResourceReceipts
        : undefined;
      const cwd = workflowResourceReceiptCwd(resourceReceiptsReference, process.cwd());
      const resourceReceipts = resourceReceiptsReference !== undefined
        ? await parseWorkflowResourceReceipts(resourceReceiptsReference, cwd)
        : undefined;
      if (await runProjectStatusCommand({
        cwd,
        format: options.format === "json" ? "json" : "table",
        view: options.view === "full" ? "full" : "summary",
        managed: options.managed === true,
        authorities: workflowAuthorities(options.authority),
        ...(resourceReceipts === undefined ? {} : { resourceReceipts }),
        ...(resourceReceiptsReference === undefined
          ? {}
          : { resourceReceiptsReference }),
        onSuccess: (status) => {
          queueContextRuntimeEvent({
            cwd: status.projectRoot,
            kind: "workspace.active",
            properties: { workflow_status: status.workflow.status },
          });
        },
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "status requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });
}

export function registerProjectCloseAndBuildCommands(program: Command): void {
  program
    .command("close")
    .description("Close approved project knowledge by deriving structure and running final verification")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (await runProjectCloseCommand({
        cwd: process.cwd(),
        format: options.format === "json" ? "json" : "text",
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "close requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });

  program
    .command("build")
    .description("Build declared project packages")
    .option("--format <format>", "output format: text | json", "text")
    .option("--verbose", "include per-file build changes in JSON output")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (await runProjectBuildCommand({
        cwd: process.cwd(),
        format: options.format === "json" ? "json" : "text",
        verbose: options.verbose === true,
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "build requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });
}

export function registerProjectVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description("Validate knowledge workspace")
    .option("--format <format>", "output format: table | json", "table")
    .option("--compact", "return grouped diagnostics without the complete issue list")
    .option("--view <view>", "read a verification view: diagnostics")
    .option("--page-size <n>", "with --view diagnostics, limit returned issues")
    .option("--page-token <token>", "with --view diagnostics, continue pagination")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "table" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be table or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (options.view !== undefined && options.view !== "diagnostics") {
        throw new ContextError(ExitCode.UserError, "--view must be diagnostics", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (options.view === "diagnostics" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--view diagnostics requires --format json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (await runProjectVerifyCommand({
        cwd: process.cwd(),
        format: options.format === "json" ? "json" : "table",
        ...(options.compact === true ? { compact: true } : {}),
        ...(options.view === "diagnostics" ? { view: "diagnostics" as const } : {}),
        ...(typeof options.pageSize === "string" ? { pageSize: options.pageSize } : {}),
        ...(typeof options.pageToken === "string" ? { pageToken: options.pageToken } : {}),
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "verify requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });
}
