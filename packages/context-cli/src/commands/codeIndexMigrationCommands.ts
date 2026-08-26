import { Command } from "commander";
import { findContextProjectRoot } from "../project/workspace.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { migrateLegacyCodeIndex } from "../project/codeIndexMigration.js";

export function registerCodeIndexMigrationCommands(program: Command): void {
  const migrate = program.command("migrate").description("Run deterministic workspace protocol migrations");
  migrate.command("codeindex")
    .description("Migrate the legacy codegraph collection to codeindex")
    .option("--format <format>", "Output format", "text")
    .action(async (options: { format: string }) => {
      const project = findContextProjectRoot(process.cwd());
      if (project === null) throw new ContextError(ExitCode.UserError, "Context project not found");
      const result = await migrateLegacyCodeIndex(project.projectRoot);
      process.stdout.write(options.format === "json"
        ? `${JSON.stringify(result)}\n`
        : `Migrated code index: changed=${result.changed}, pages=${result.moved_pages}, files=${result.rewritten_files.length}\n`);
    });
}
