import { scaffoldCurrentAuthor } from "../project/indexerAuthorDraft.js";
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

function requiredString(value: unknown, flag: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new ContextError(ExitCode.UserError, `${flag} is required`, {
    category: ErrorCategory.UserInputInvalid,
  });
}

export function registerProjectActionCommands(program: Command): void {
  const action = program.command("action")
    .description("Complete the one semantic or Gate action selected by the current workflow route");

  action.command("scaffold-current")
    .description("Print an unfilled Author payload with current task IDs, page plans and inventory; redirect into workspace .tmp/agent-payloads/")
    .requiredOption("--revision <revision>", "current workflow revision")
    .option("--managed", "use current-conversation managed approval")
    .option("--format <format>", "payload format: json | yaml", "json")
    .action(async (options: { revision: string; managed?: boolean; format: string }) => {
      if (options.format !== "json" && options.format !== "yaml") throw new TypeError("--format must be json or yaml");
      const root = findContextProjectRoot(process.cwd());
      if (!root) throw new TypeError("scaffold-current requires a Context workspace");
      const rootOptions = program.opts() as Record<string, unknown>;
      const value = await scaffoldCurrentAuthor({ projectRoot: root.projectRoot, revision: options.revision,
        managed: options.managed === true, authorities: mergedWorkflowAuthorities(rootOptions.workflowAuthority, []) });
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(serializeActionCompletion(value, options.format as "json" | "yaml"), error => {
          if (error) reject(error); else resolve();
        });
      });
    });

  action.command("complete-current")
    .description("Submit minimal semantic output for the exact current workflow revision")
    .requiredOption("--revision <revision>", "workflow revision returned by context status")
    .requiredOption("--input <file>", "YAML/JSON input path, or - for stdin")
    .option("--managed", "continue under explicit current-conversation managed approval")
    .addOption(
      new Option("--authority <authority>")
        .hideHelp()
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .option("--preview", "validate and preview current Author or approved revision content without submitting")
    .option("--verbose", "include the full completion and next Route inline")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (options: Record<string, unknown>) => {
      const format = options.format;
      if (format !== "json" && format !== "yaml") {
        throw new ContextError(ExitCode.UserError, "--format must be json or yaml", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      assertActionInputWorkspace(process.cwd(), requiredString(options.input, "--input"));
      const rootOptions = program.opts() as Record<string, unknown>;
      const result = await completeCurrentIndexerAction({
        cwd: process.cwd(),
        revision: requiredString(options.revision, "--revision"),
        value: await readYamlOrJsonInput({
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
