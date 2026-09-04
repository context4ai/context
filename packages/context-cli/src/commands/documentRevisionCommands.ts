import { Command } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { findContextProjectRoot } from "../project/workspace.js";
import { ExitCode } from "../types/exitCode.js";

function requireProjectRoot(): string {
  const found = findContextProjectRoot(process.cwd());
  if (found !== null) return found.projectRoot;
  throw new ContextError(ExitCode.WorkspaceStateError, "revise requires a Context workspace", {
    category: ErrorCategory.WorkspaceNotFound,
  });
}

export function registerDocumentRevisionCommand(program: Command): void {
  program.command("revise <target>")
    .description("Repair one current Candidate or approved knowledge page through the Indexer lifecycle")
    .requiredOption("--instruction <feedback>", "reader-facing correction request")
    .option("--format <format>", "output format: json", "json")
    .action(async (target: string, options: Record<string, unknown>) => {
      if (options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (typeof options.instruction !== "string") {
        throw new ContextError(ExitCode.UserError, "--instruction is required", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      process.stdout.write(`${JSON.stringify(await beginDocumentRevision({
        projectRoot: requireProjectRoot(),
        selector: target,
        instruction: options.instruction,
      }), null, 2)}\n`);
    });
}
