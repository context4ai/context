import { Command, Option } from "commander";
import YAML from "yaml";
import { fetchLarkSource } from "./sourceFetchLark.js";
import { findContextProjectRoot } from "./workspace.js";

export function registerSourceFetchCommands(source: Command): void {
  source.command("fetch").description("Fetch a portable source snapshot without registering a workspace source")
    .command("lark <url>")
    .description("Capture full Lark text and resources for local reuse using one fixed identity")
    .requiredOption("--output <directory>", "New output directory, normally below a task's .tmp directory")
    .addOption(new Option("--as <identity>", "Fixed read identity; defaults to bot").choices(["bot", "user"]).default("bot"))
    .addOption(new Option("--format <format>", "output format").choices(["json", "yaml", "table"]).default("json"))
    .addHelpText("after", "\nNo workspace, source registration, capture phase, or production workflow is required.\nThe directory must not exist. Resource permission gaps remain in the receipt;\nidentity never switches automatically. Import the intact snapshot_dir after\nregistering a matching source. Import reuses captured resources without remote calls.\n")
    .action(async (url: string, options: { output: string; as: "bot" | "user"; format: string }) => {
      const workspaceRoot = findContextProjectRoot(process.cwd())?.projectRoot;
      const result = await fetchLarkSource({ url, output: options.output, identity: options.as,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }) });
      if (result.status === "partial") process.exitCode = 1;
      process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : YAML.stringify(result));
    });
}
