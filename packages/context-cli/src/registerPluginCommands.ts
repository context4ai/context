import type { Command } from "commander";
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
    .description("Install or inspect global Context agent plugins");

  plugin
    .command("path")
    .description("Print the bundled plugin marketplace root used by `context plugin install`")
    .action(async () => {
      process.stdout.write(formatPluginPathResult(await runPluginPathCommand()));
    });

  plugin
    .command("status")
    .description("Inspect the bundled plugin marketplace root and global agent availability")
    .option("--agent <agent>", "agent target: claude | codex | all", "all")
    .action(async (options: Record<string, unknown>) => {
      const agent = pluginAgentOption(options.agent);
      process.stdout.write(formatPluginStatusResult(await runPluginStatusCommand({ agent })));
    });

  plugin
    .command("install")
    .description("Install the bundled Context plugin globally for Claude and/or Codex")
    .option("--agent <agent>", "agent target: claude | codex | all", "all")
    .option("--dry-run", "Print install commands without mutating global agent config")
    .action(async (options: Record<string, unknown>) => {
      const agent = pluginAgentOption(options.agent);
      const result = await runPluginInstallCommand({
        agent,
        dryRun: options.dryRun === true,
      });
      process.stdout.write(formatPluginInstallResult(result));
    });
}
