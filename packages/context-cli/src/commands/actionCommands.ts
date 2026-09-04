import { Command, Option } from "commander";
import YAML from "yaml";
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
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (options: Record<string, unknown>) => {
      const format = options.format;
      if (format !== "json" && format !== "yaml") {
        throw new ContextError(ExitCode.UserError, "--format must be json or yaml", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
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
        authorities: mergedWorkflowAuthorities(
          rootOptions.workflowAuthority,
          options.authority,
        ),
      });
      process.stdout.write(format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : YAML.stringify(result));
    });
}
