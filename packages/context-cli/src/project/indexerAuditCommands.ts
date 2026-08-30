import { Command } from "commander";
import YAML from "yaml";
import { inspectProjectIndexerCandidateReviewReadiness } from
  "./indexerCandidateReviewReadinessActions.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { findContextProjectRoot } from "./workspace.js";

function options(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

export function registerIndexerAuditCommands(indexer: Command): void {
  indexer.command("inspect-index-candidate-review-readiness")
    .description("Prove exact pre/post mechanical audits are current before main Review")
    .requiredOption("--input <file>", "digest-bound candidate Review readiness input")
    .option("--format <format>", "output format: json | yaml", "json")
    .action(async (...args: unknown[]) => {
      const commandOptions = options(args);
      const path = typeof commandOptions.input === "string"
        ? commandOptions.input
        : undefined;
      if (path === undefined) throw new TypeError("--input is required");
      const project = findContextProjectRoot(process.cwd());
      if (project === null) {
        throw new TypeError("inspect-index-candidate-review-readiness requires a Context workspace");
      }
      const value = await readYamlOrJsonInput({
        path,
        label: "inspect-index-candidate-review-readiness",
        missingNext: "Pass a payload file or - for stdin.",
        readFailureNext: "Fix the input path and retry.",
        parseFailureNext: "Fix the YAML/JSON payload and retry.",
      });
      const result = await inspectProjectIndexerCandidateReviewReadiness({
        projectRoot: project.projectRoot,
        value,
      });
      const format = typeof commandOptions.format === "string"
        ? commandOptions.format
        : "json";
      if (format !== "json" && format !== "yaml") {
        throw new TypeError("--format must be json or yaml");
      }
      process.stdout.write(format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : YAML.stringify(result));
    });
}
