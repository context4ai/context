import { Command } from "commander";
import YAML from "yaml";
import {
  confirmProjectIndexerSubjectReidentification,
  validateProjectIndexerSubjectKeySchemas,
} from "./indexerSubjectReidentificationActions.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { findContextProjectRoot } from "./workspace.js";

function options(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

function stringOption(value: Record<string, unknown>, name: string): string | undefined {
  const item = value[name];
  return typeof item === "string" && item.trim().length > 0 ? item.trim() : undefined;
}

async function execute(
  args: readonly unknown[],
  name: string,
  action: (input: { projectRoot: string; value: unknown }) => unknown,
): Promise<void> {
  const commandOptions = options(args);
  const inputPath = stringOption(commandOptions, "input");
  if (inputPath === undefined) throw new TypeError("--input is required");
  const project = findContextProjectRoot(process.cwd());
  if (project === null) throw new TypeError(`${name} requires a Context workspace`);
  const value = await readYamlOrJsonInput({
    path: inputPath,
    label: name,
    missingNext: "Pass a payload file or - for stdin.",
    readFailureNext: "Fix the input path and retry.",
    parseFailureNext: "Fix the YAML/JSON payload and retry.",
  });
  const result = await action({ projectRoot: project.projectRoot, value });
  const format = stringOption(commandOptions, "format") ?? "json";
  if (format !== "json" && format !== "yaml") {
    throw new TypeError("--format must be json or yaml");
  }
  process.stdout.write(format === "json"
    ? `${JSON.stringify(result, null, 2)}\n`
    : YAML.stringify(result));
}

export function registerIndexerSubjectIdentityCommands(indexer: Command): void {
  for (const item of [{
    name: "validate-subject-key-schemas",
    description: "Validate SubjectKey schema evolution and exact re-identification authority",
    action: validateProjectIndexerSubjectKeySchemas,
  }, {
    name: "confirm-subject-reidentification",
    description: "Confirm one exact non-delegable SubjectKey re-identification mapping",
    action: confirmProjectIndexerSubjectReidentification,
  }] as const) {
    indexer.command(item.name)
      .description(item.description)
      .requiredOption("--input <file>", "digest-bound SubjectKey transition input")
      .option("--format <format>", "output format: json | yaml", "json")
      .action(async (...args: unknown[]) => execute(args, item.name, item.action));
  }
}
