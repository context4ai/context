import type { Command } from "commander";
import { resolve } from "node:path";
import { installEvidencePlugin } from "../project/evidencePlugin.js";

export function registerEvidenceCommands(program: Command): void {
  program.command("evidence").description("Manage the repository evidence Wasm plugin")
    .command("install [project-dir]")
    .description("Install or safely upgrade the bundled evidence plugin without starting production")
    .option("--repository-root <path>", "explicit enclosing Git root for a nested workspace")
    .option("--plugin-root <path>", "explicit host-registered content root inside the repository")
    .option("--format <format>", "output format: json", "json")
    .action(async (projectDir: string | undefined, options: { repositoryRoot?: string; pluginRoot?: string; format: string }) => {
      if (options.format !== "json") throw new Error("--format must be json");
      const result = await installEvidencePlugin({ projectRoot: resolve(projectDir ?? "."),
        ...(options.repositoryRoot === undefined ? {} : { repositoryRoot: options.repositoryRoot }),
        ...(options.pluginRoot === undefined ? {} : { pluginRoot: options.pluginRoot }) });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status === "conflict" || result.status === "needs-repository-root") process.exitCode = 1;
    });
}
