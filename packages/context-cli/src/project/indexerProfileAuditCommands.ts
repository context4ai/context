import { Command } from "commander";
import YAML from "yaml";
import {
  overrideProjectIndexerProfileAudit,
  inspectProjectIndexerProfileFailure,
  recordProjectIndexerProfileRevision,
  reportProjectIndexerProfileFailure,
} from "./indexerProfileAuditActions.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { findContextProjectRoot } from "./workspace.js";

function options(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

function projectRoot(action: string): string {
  const project = findContextProjectRoot(process.cwd());
  if (project !== null) return project.projectRoot;
  throw new TypeError(`${action} requires a Context workspace`);
}

async function readInput(path: string, label: string): Promise<unknown> {
  return readYamlOrJsonInput({
    path,
    label,
    missingNext: "Pass a payload file or - for stdin.",
    readFailureNext: "Fix the input path and retry.",
    parseFailureNext: "Fix the YAML/JSON payload and retry.",
  });
}

function registerAction(input: {
  indexer: Command;
  name: string;
  description: string;
  run: (projectRoot: string, value: unknown) => Promise<unknown>;
}): void {
  input.indexer.command(input.name)
    .description(input.description)
    .requiredOption("--input <file>", "digest-bound action input")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (...args: unknown[]) => {
      const commandOptions = options(args);
      const path = typeof commandOptions.input === "string"
        ? commandOptions.input
        : undefined;
      if (path === undefined) throw new TypeError("--input is required");
      const format = typeof commandOptions.format === "string"
        ? commandOptions.format
        : "json";
      if (format !== "json" && format !== "yaml") {
        throw new TypeError("--format must be json or yaml");
      }
      const result = await input.run(
        projectRoot(input.name),
        await readInput(path, input.name),
      );
      process.stdout.write(format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : YAML.stringify(result));
    });
}

export function registerIndexerProfileAuditCommands(indexer: Command): void {
  registerAction({
    indexer,
    name: "inspect-index-profile-failure",
    description: "Read the exact persisted three-attempt report before an override decision",
    run: (root, value) => inspectProjectIndexerProfileFailure({
      projectRoot: root,
      value,
    }),
  });
  registerAction({
    indexer,
    name: "record-index-profile-revision",
    description: "Record one distinct failed profile revision under ledger CAS",
    run: (root, value) => recordProjectIndexerProfileRevision({
      projectRoot: root,
      value,
    }),
  });
  registerAction({
    indexer,
    name: "report-index-profile-failure",
    description: "Persist the full human report after exactly three profile revisions",
    run: (root, value) => reportProjectIndexerProfileFailure({
      projectRoot: root,
      value,
    }),
  });
  registerAction({
    indexer,
    name: "override-index-profile-audit",
    description: "Record an explicit user override for the exact current profile failure",
    run: (root, value) => overrideProjectIndexerProfileAudit({
      projectRoot: root,
      value,
    }),
  });
}
