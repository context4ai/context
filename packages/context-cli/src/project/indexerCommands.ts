import { Command } from "commander";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { listProductionSkills } from "./productionSkillCatalog.js";
import { reportProjectIndexerBenchmark } from "./indexerBenchmarkActions.js";
import { findContextProjectRoot } from "./workspace.js";

function outputFormat(options: { format?: string }): "json" | "yaml" {
  const format = options.format ?? "json";
  if (format === "json" || format === "yaml") return format;
  throw new ContextError(ExitCode.UserError, "--format must be json or yaml", {
    category: ErrorCategory.UserInputInvalid, flag: "--format", reason_code: "invalid-indexer-format",
    valid_formats: ["json", "yaml"], next_action: { command: "context indexer --help",
      instruction: "Retry the same command with --format json or --format yaml." },
  });
}

function writeOutput(value: unknown, format: "json" | "yaml"): void {
  process.stdout.write(format === "json" ? `${JSON.stringify(value, null, 2)}\n` : YAML.stringify(value));
}

/** Skills are guidance, not independently registered production engines.
 * Planning, report approval and writing use the current workflow's file actions.
 * The independent benchmark reporter is not a production prerequisite. */
export function registerProjectIndexerCommands(program: Command): void {
  const indexer = program.command("indexer").description("Discover bundled skills or inspect a benchmark result");
  indexer.command("catalog")
    .description("List bundled skill names, descriptions and entries; the Agent declares its actual available skills separately")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (options: { format?: string }) => {
      const format = outputFormat(options);
      writeOutput(await listProductionSkills(), format);
    });

  indexer.command("report-benchmark")
    .description("Build a forward-test report from an independently loaded oracle")
    .requiredOption("--manifest <file>", "benchmark manifest path")
    .requiredOption("--current <file>", "current source and toolchain authority path")
    .requiredOption("--observation <file>", "post-run structured observation path")
    .requiredOption("--oracle <file>", "read-only oracle evaluation outside the Agent workspace")
    .requiredOption("--override <file>", "explicit none or human-approved override path")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (options: { manifest: string; current: string; observation: string; oracle: string; override: string; format?: string }) => {
      const format = outputFormat(options);
      const project = findContextProjectRoot(process.cwd());
      if (!project) throw new ContextError(ExitCode.WorkspaceStateError, "report-benchmark requires a Context workspace", {
        category: ErrorCategory.WorkspaceNotFound, next: "Run this command from the benchmark's Context workspace.",
      });
      const read = (path: string, label: string) => readYamlOrJsonInput({ path, label,
        missingNext: "Pass a payload file or - for stdin.", readFailureNext: "Fix the input path and retry.",
        parseFailureNext: "Fix the YAML/JSON payload and retry." });
      writeOutput(await reportProjectIndexerBenchmark({ projectRoot: project.projectRoot, oraclePath: options.oracle,
        manifest: await read(options.manifest, "benchmark manifest"),
        currentAuthority: await read(options.current, "benchmark current authority"),
        observation: await read(options.observation, "benchmark observation"),
        oracleEvaluation: await read(options.oracle, "benchmark oracle evaluation"),
        override: await read(options.override, "benchmark override"),
      }), format);
    });
}
