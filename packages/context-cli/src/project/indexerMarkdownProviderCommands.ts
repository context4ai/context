import { Command } from "commander";
import YAML from "yaml";
import {
  inspectProjectMarkdownProviderCapture,
  validateProjectMarkdownProviderSelection,
} from "./indexerMarkdownProviderRoute.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { findContextProjectRoot } from "./workspace.js";

function options(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

async function execute(
  args: readonly unknown[],
  name: string,
  action: (input: { projectRoot: string; value: unknown }) => Promise<unknown>,
): Promise<void> {
  const commandOptions = options(args);
  const path = typeof commandOptions.input === "string" ? commandOptions.input : undefined;
  if (path === undefined) throw new TypeError("--input is required");
  const project = findContextProjectRoot(process.cwd());
  if (project === null) throw new TypeError(`${name} requires a Context workspace`);
  const value = await readYamlOrJsonInput({
    path,
    label: name,
    missingNext: "Pass a payload file or - for stdin.",
    readFailureNext: "Fix the input path and retry.",
    parseFailureNext: "Fix the YAML/JSON payload and retry.",
  });
  const result = await action({ projectRoot: project.projectRoot, value });
  const format = typeof commandOptions.format === "string" ? commandOptions.format : "json";
  if (format !== "json" && format !== "yaml") {
    throw new TypeError("--format must be json or yaml");
  }
  process.stdout.write(format === "json"
    ? `${JSON.stringify(result, null, 2)}\n`
    : YAML.stringify(result));
}

export function registerIndexerMarkdownProviderCommands(indexer: Command): void {
  for (const item of [{
    name: "inspect-markdown-provider-capture",
    description: "Bind Markdown Provider discovery to current captured document snapshots",
    action: inspectProjectMarkdownProviderCapture,
  }, {
    name: "validate-markdown-provider-selection",
    description: "Resolve and finally validate one capture-bound Markdown Provider selection",
    action: validateProjectMarkdownProviderSelection,
  }] as const) {
    indexer.command(item.name)
      .description(item.description)
      .requiredOption("--input <file>", "digest-bound Markdown Provider Route input")
      .option("--format <format>", "output format: json | yaml", "json")
      .action(async (...args: unknown[]) => execute(args, item.name, item.action));
  }
}
