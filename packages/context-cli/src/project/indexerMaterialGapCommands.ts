import { Command } from "commander";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { auditProjectIndexerMaterialGapState } from
  "./indexerMaterialGapAuditActions.js";
import {
  checkpointProjectIndexerReconciliationGaps,
} from "./indexerMaterialGapActions.js";
import { closeProjectIndexerApprovedKnowledge } from
  "./indexerMaterialGapCloseActions.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { findContextProjectRoot } from "./workspace.js";

type OutputFormat = "json" | "yaml";

function commandOptions(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

function stringOption(
  options: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function outputFormat(options: Record<string, unknown>): OutputFormat {
  const value = stringOption(options, "format") ?? "json";
  if (value === "json" || value === "yaml") return value;
  throw new ContextError(ExitCode.UserError, "--format must be json or yaml", {
    category: ErrorCategory.UserInputInvalid,
    flag: "--format",
  });
}

function projectRoot(action: string): string {
  const project = findContextProjectRoot(process.cwd());
  if (project !== null) return project.projectRoot;
  throw new ContextError(
    ExitCode.WorkspaceStateError,
    `${action} requires a Context workspace`,
    {
      category: ErrorCategory.WorkspaceNotFound,
      next: "Run this command from a Context project after registering its sources.",
    },
  );
}

async function executeProjectAction(
  args: readonly unknown[],
  actionName: string,
  action: (input: { projectRoot: string; value: unknown }) => unknown | Promise<unknown>,
): Promise<void> {
  const options = commandOptions(args);
  const inputPath = stringOption(options, "input");
  if (inputPath === undefined) throw new TypeError("--input is required");
  const value = await readYamlOrJsonInput({
    path: inputPath,
    label: actionName,
    missingNext: "Pass a payload file or - for stdin.",
    readFailureNext: "Fix the input path or pass - for stdin, then retry.",
    parseFailureNext: "Fix the YAML/JSON payload and retry.",
  });
  const output = await action({
    projectRoot: projectRoot(actionName),
    value,
  });
  process.stdout.write(outputFormat(options) === "json"
    ? `${JSON.stringify(output, null, 2)}\n`
    : YAML.stringify(output));
}

export function registerIndexerMaterialGapCommands(indexer: Command): void {
  const actions = [{
    name: "audit-material-gap-state",
    description: "Recompute current material gaps and route lifecycle drift",
    action: auditProjectIndexerMaterialGapState,
  }, {
    name: "checkpoint-material-gaps",
    description: "Checkpoint current material gaps in local runtime state",
    action: checkpointProjectIndexerReconciliationGaps,
  }, {
    name: "close-indexer-approved-knowledge",
    description: "Close approved knowledge after required material gaps are resolved",
    action: closeProjectIndexerApprovedKnowledge,
  }] as const;
  for (const item of actions) {
    indexer.command(item.name)
      .description(item.description)
      .requiredOption("--input <file>", "digest-bound material-gap input")
      .option("--format <format>", "output format: json | yaml", "json")
      .action(async (...args: unknown[]) => {
        await executeProjectAction(args, item.name, item.action);
      });
  }
}
