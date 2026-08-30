import { Command } from "commander";
import YAML from "yaml";
import {
  confirmProjectIndexerRequirementWorkset,
  routeProjectIndexerRequirementConfirmation,
} from "./indexerRequirementGateActions.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { findContextProjectRoot } from "./workspace.js";

function commandOptions(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

export function registerIndexerRequirementGateCommands(indexer: Command): void {
  for (const item of [{
    name: "route-index-requirement-confirmation",
    description: "Route an exact requirement report to its delegatable or human-only Gate",
    action: routeProjectIndexerRequirementConfirmation,
  }, {
    name: "confirm-index-requirement-workset",
    description: "Confirm one exact requirement report through its required authority",
    action: confirmProjectIndexerRequirementWorkset,
  }] as const) {
    indexer.command(item.name)
      .description(item.description)
      .requiredOption("--input <file>", "digest-bound requirement Gate input")
      .option("--format <format>", "output format: json | yaml", "json")
      .action(async (...args: unknown[]) => {
        const options = commandOptions(args);
        const path = typeof options.input === "string" ? options.input : undefined;
        if (path === undefined) throw new TypeError("--input is required");
        const project = findContextProjectRoot(process.cwd());
        if (project === null) throw new TypeError(`${item.name} requires a Context workspace`);
        const value = await readYamlOrJsonInput({
          path,
          label: item.name,
          missingNext: "Pass a payload file or - for stdin.",
          readFailureNext: "Fix the input path and retry.",
          parseFailureNext: "Fix the YAML/JSON payload and retry.",
        });
        const result = item.action({ projectRoot: project.projectRoot, value });
        const format = typeof options.format === "string" ? options.format : "json";
        if (format !== "json" && format !== "yaml") {
          throw new TypeError("--format must be json or yaml");
        }
        process.stdout.write(format === "json"
          ? `${JSON.stringify(result, null, 2)}\n`
          : YAML.stringify(result));
      });
  }
}
