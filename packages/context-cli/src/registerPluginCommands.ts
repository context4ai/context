import { installLocalSkills } from "./project/pluginInstallLocal.js";
import type { Command } from "commander";
import { installAutoLocalSkills } from "./project/pluginInstallAuto.js";
import { ContextError } from "./lib/errors.js";
import { ExitCode } from "./types/exitCode.js";
import {
  formatPluginInstallResult,
  formatPluginPathResult,
  formatPluginStatusResult,
  pluginAgentOption,
  runPluginInstallCommand,
  runPluginPathCommand,
  runPluginStatusCommand,
} from "./project/pluginInstall.js";

export function registerPluginCommands(program: Command): void {
  const plugin = program
    .command("plugin")
    .description("Install Context agent integrations or inspect global plugins");

  plugin
    .command("path")
    .description("Print the bundled plugin marketplace root used by `context plugin install`")
    .action(async () => {
      process.stdout.write(formatPluginPathResult(await runPluginPathCommand()));
    });

  plugin
    .command("status")
    .description("Inspect the bundled plugin marketplace root and global agent availability")
    .option("--agent <agent>", "agent target: claude | codex | cursor | all", "all")
    .action(async (options: Record<string, unknown>) => {
      const agent = pluginAgentOption(options.agent);
      process.stdout.write(formatPluginStatusResult(await runPluginStatusCommand({ agent })));
    });

  plugin
    .command("install")
    .description("Install globally by default, or copy standalone skills with --local <path>")
    .option("--agent <agent>", "agent target: claude | codex | cursor | all; local only: auto-detect | standalone", "all")
    .option("--local <path>", "Repository root; install selected or detected hosts into their corresponding subdirectories")
    .option("--dry-run", "Preview installation without writing files or configuration")
    .action(async (options: Record<string, unknown>, command: Command) => {
      if (options.local !== undefined) {
        if (command.getOptionValueSource("agent") !== "cli") {
          throw new ContextError(ExitCode.UserError, "--local requires explicit --agent: claude, cursor, codex, all, auto-detect or standalone.");
        }
        const agent = options.agent === "auto-detect" || options.agent === "standalone"
          ? options.agent : pluginAgentOption(options.agent);
        const { pluginsRoot } = await runPluginPathCommand();
        process.stdout.write(agent === "standalone"
          ? await installLocalSkills(pluginsRoot, String(options.local), options.dryRun === true)
          : await installAutoLocalSkills(pluginsRoot, String(options.local), options.dryRun === true, undefined,
            agent === "auto-detect" ? undefined : agent));
        return;
      }
      const agent = pluginAgentOption(options.agent);
      const result = await runPluginInstallCommand({
        agent,
        dryRun: options.dryRun === true,
      });
      process.stdout.write(formatPluginInstallResult(result));
    });
}
