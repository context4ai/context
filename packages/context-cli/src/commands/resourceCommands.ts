import { Command, Option } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  collectWorkflowAuthorityOption,
  workflowAuthorities,
} from "../project/workflow/workflowCommandOptions.js";
import {
  runContextWorkflowResourceAcknowledgeCommand,
  runContextWorkflowResourceCommand,
} from "../project/workflow/workflowResource.js";
import {
  parseWorkflowResourceReceipts,
  workflowResourceReceiptCwd,
} from "../project/workflow/workflowResourceReceipts.js";
import { ExitCode } from "../types/exitCode.js";

type ResourceOutputFormat = "text" | "json";
type ResourceOutputView = "summary" | "full";

function resourceOutputFormat(value: unknown): ResourceOutputFormat {
  if (value === "text" || value === "json") return value;
  throw new ContextError(ExitCode.UserError, "--format must be text or json", {
    category: ErrorCategory.UserInputInvalid,
  });
}

function requiredRevision(value: unknown): string {
  if (typeof value === "string") return value;
  throw new ContextError(ExitCode.UserError, "--revision is required", {
    category: ErrorCategory.UserInputInvalid,
  });
}

function resourceOutputView(value: unknown): ResourceOutputView {
  if (value === "summary" || value === "full") return value;
  throw new ContextError(ExitCode.UserError, "--view must be summary or full", {
    category: ErrorCategory.UserInputInvalid,
  });
}

export function registerContextWorkflowResourceCommands(program: Command): void {
  const resource = program
    .command("resource")
    .description("Read and acknowledge resources selected by the current workflow route");

  resource
    .command("acknowledge-current")
    .description("Record receipts after reading every direct required resource selected by the current route")
    .requiredOption("--revision <revision>", "workflow revision returned by context status")
    .option("--managed", "preserve explicit current-conversation managed approval")
    .option("--resource-receipts <json-or-@file>", "merge current-conversation resource receipts")
    .addOption(
      new Option("--authority <authority>")
        .hideHelp()
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .option("--format <format>", "output format: text | json", "text")
    .option("--view <view>", "with --format json, output view: summary | full", "summary")
    .action(async (options: Record<string, unknown>) => {
      const format = resourceOutputFormat(options.format);
      const view = resourceOutputView(options.view);
      const revision = requiredRevision(options.revision);
      const resourceReceiptsReference = typeof options.resourceReceipts === "string"
        ? options.resourceReceipts
        : undefined;
      const cwd = workflowResourceReceiptCwd(resourceReceiptsReference, process.cwd());
      const resourceReceipts = resourceReceiptsReference === undefined
        ? undefined
        : await parseWorkflowResourceReceipts(resourceReceiptsReference, cwd);

      await runContextWorkflowResourceAcknowledgeCommand({
        cwd,
        revision,
        managed: options.managed === true,
        authorities: workflowAuthorities(options.authority),
        ...(resourceReceipts === undefined ? {} : { resourceReceipts }),
        ...(resourceReceiptsReference === undefined
          ? {}
          : { resourceReceiptsReference }),
        format,
        view,
      });
    });

  resource
    .command("materialize <resource-id>")
    .description("Materialize one revision-bound Context view as a local file")
    .requiredOption("--revision <revision>", "workflow revision returned by context status")
    .option("--managed", "use explicit current-conversation managed approval for this resource view")
    .option("--resource-receipts <json-or-@file>", "merge current-conversation receipts after the returned file is read")
    .addOption(
      new Option("--authority <authority>")
        .hideHelp()
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .option("--format <format>", "output format: text | json", "text")
    .action(async (
      resourceId: string,
      options: Record<string, unknown>,
    ) => {
      const format = resourceOutputFormat(options.format);
      const revision = requiredRevision(options.revision);
      const resourceReceiptsReference = typeof options.resourceReceipts === "string"
        ? options.resourceReceipts
        : undefined;
      const cwd = workflowResourceReceiptCwd(resourceReceiptsReference, process.cwd());
      await runContextWorkflowResourceCommand({
        cwd,
        resourceId,
        revision,
        managed: options.managed === true,
        authorities: workflowAuthorities(options.authority),
        ...(resourceReceiptsReference !== undefined
          ? {
              resourceReceipts: await parseWorkflowResourceReceipts(
                resourceReceiptsReference,
                cwd,
              ),
            }
          : {}),
        format,
      });
    });
}
