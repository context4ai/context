import type { Command } from "commander";
import { installLocalSkills } from "./project/pluginInstallLocal.js";
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
    .option("--agent <agent>", "agent target: claude | codex | cursor | all", "all")
    .option("--local <path>", "Auto-detect hosts under a repository; with --agent, use the exact host directory")
    .option("--dry-run", "Preview installation without writing files or configuration")
    .action(async (options: Record<string, unknown>, command: Command) => {
      if (options.local !== undefined) {
        const agent = command.getOptionValueSource("agent") === "cli" ? pluginAgentOption(options.agent) : undefined;
        if (agent === "all") {
          throw new ContextError(ExitCode.UserError, "--local requires one --agent (claude, cursor or codex), or omit --agent for automatic detection.");
        }
        const { pluginsRoot } = await runPluginPathCommand();
        process.stdout.write(agent
          ? await installLocalSkills(pluginsRoot, String(options.local), options.dryRun === true, agent)
          : await installAutoLocalSkills(pluginsRoot, String(options.local), options.dryRun === true));
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
