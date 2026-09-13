import { assertActionInputWorkspace } from "../project/actionInputWorkspace.js";
import { Command, Option } from "commander";
import { prepareActionCompletionOutput, serializeActionCompletion } from "../project/actionCompletionOutput.js";
import { findContextProjectRoot } from "../project/workspace.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import {
  collectWorkflowAuthorityOption,
  mergedWorkflowAuthorities,
} from "../project/workflow/workflowCommandOptions.js";
import { readYamlOrJsonInput } from "../project/payloadInput.js";
import { ExitCode } from "../types/exitCode.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { currentProductionOwnsAction } from "../project/indexerCurrentAction.js";
import { prepareKnownProductionTasks } from "../project/productionKnownTasks.js";

function requiredString(value: unknown, flag: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new ContextError(ExitCode.UserError, `${flag} is required`, {
    category: ErrorCategory.UserInputInvalid, reason_code: "missing-action-argument", flag,
    next_action: { command: "context status --format json", instruction: "Use the current action's command and supply its non-empty input path and revision." },
  });
}

export function registerProjectActionCommands(program: Command): void {
  const action = program.command("action")
    .description("Complete the one semantic or Gate action selected by the current workflow route");

  action.command("prepare-current")
    .description("Prepare or retry current production batch directories without resubmitting accepted articles")
    .requiredOption("--revision <revision>", "current production stage identity")
    .option("--input <file>", "already-decided article tasks under .tmp/agent-work; prepare and submit the plan together, then wait for report approval")
    .option("--multi-agent", "this caller can coordinate multiple independent batch directories; default is one batch")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (options: { revision: string; multiAgent?: boolean; format: string; input?: string }) => {
      if (options.format !== "json" && options.format !== "yaml") throw new ContextError(ExitCode.UserError,
        "--format must be json or yaml", { category: ErrorCategory.UserInputInvalid,
          reason_code: "invalid-action-format", flag: "--format", valid_formats: ["json", "yaml"],
          next_action: { command: "context action prepare-current --help", instruction: "Retry the same preparation with --format json or --format yaml." } });
      const root = findContextProjectRoot(process.cwd());
      if (!root) throw new ContextError(ExitCode.WorkspaceStateError,
        "prepare-current requires a Context workspace", { category: ErrorCategory.WorkspaceNotFound,
          reason_code: "action-workspace-not-found", next_action: { command: "context entry --format json", instruction: "Locate the intended workspace before preparing task files." } });
      const result = options.input ? await prepareKnownProductionTasks({ projectRoot: root.projectRoot, cwd: process.cwd(),
        revision: options.revision, path: options.input }) : await prepareCurrentProductionStage({ projectRoot: root.projectRoot,
        revision: options.revision, multiAgent: options.multiAgent === true });
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(serializeActionCompletion(result, options.format as "json" | "yaml"), error => {
          if (error) reject(error); else resolve();
        });
      });
    });

  action.command("complete-current")
    .description("Submit minimal semantic output for the exact current workflow revision")
    .requiredOption("--revision <revision>", "workflow revision returned by context status")
    .requiredOption("--input <file>", "YAML/JSON input path, or - for stdin")
    .option("--managed", "continue under explicit current-conversation managed approval")
    .option("--multi-agent", "this caller supports coordinating multiple independent production batch directories; default is one batch")
    .addOption(
      new Option("--authority <authority>")
        .hideHelp()
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .option("--preview", "preview an approved revision without submitting; not used for production stage files")
    .option("--verbose", "include the full completion and next Route inline")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (options: Record<string, unknown>) => {
      const format = options.format;
      if (format !== "json" && format !== "yaml") {
        throw new ContextError(ExitCode.UserError, "--format must be json or yaml", {
          category: ErrorCategory.UserInputInvalid, reason_code: "invalid-action-format",
          flag: "--format", valid_formats: ["json", "yaml"],
          next_action: { command: "context action complete-current --help", instruction: "Retry the same submission with --format json or --format yaml." },
        });
      }
      assertActionInputWorkspace(process.cwd(), requiredString(options.input, "--input"));
      const project = findContextProjectRoot(process.cwd());
      if (!project) throw new ContextError(ExitCode.WorkspaceStateError,
        "complete-current requires a Context workspace", { category: ErrorCategory.WorkspaceNotFound,
          reason_code: "action-workspace-not-found", next_action: { command: "context entry --format json", instruction: "Locate the intended workspace before submitting task files." } });
      const rootOptions = program.opts() as Record<string, unknown>;
      const result = await completeCurrentIndexerAction({
        cwd: process.cwd(),
        revision: requiredString(options.revision, "--revision"),
        submissionPath: requiredString(options.input, "--input"),
        multiAgent: options.multiAgent === true,
        value: await currentProductionOwnsAction(project.projectRoot) ? undefined : await readYamlOrJsonInput({
          path: requiredString(options.input, "--input"),
          label: "complete-current",
          missingNext: "Pass the current semantic result with --input <file> or --input -.",
          readFailureNext: "Fix the input path and retry the same current revision.",
          parseFailureNext: "Fix the YAML/JSON payload and retry the same current revision.",
        }),
        managed: options.managed === true,
        preview: options.preview === true,
        authorities: mergedWorkflowAuthorities(
          rootOptions.workflowAuthority,
          options.authority,
        ),
      });
      let output: unknown = result;
      try {
        if (options.preview !== true) output = await prepareActionCompletionOutput({
          projectRoot: findContextProjectRoot(process.cwd())!.projectRoot, result, format, verbose: options.verbose === true,
        });
      } catch (error) {
        // Submission may already be committed. Preserve its response on report I/O failure.
        process.stderr.write(`Could not save the full completion report; returning it inline: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(serializeActionCompletion(output, format), (error) => {
          if (error) reject(error); else resolve();
        });
      });
    });
}
