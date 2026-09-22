import { Command, Option } from "commander";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { WikiDiscoveryError } from "../lib/wikiDiscoveryProvider.js";
import { ExitCode } from "../types/exitCode.js";
import { discoverLarkWiki } from "./wikiDiscovery.js";
import { findContextProjectRoot } from "./workspace.js";
import { withSourceOperationRuntime } from "./sourceOperationRuntime.js";

/** Explicit, optional inventory operation; it never changes the workflow. */
export function registerSourceDiscoveryCommands(source: Command): void {
  source.command("discover").description("Discover a source inventory without registering or capturing documents")
    .command("lark <url>")
    .description("Save a resumable Wiki subtree inventory using one fixed identity")
    .option("--resume", "Resume this URL's saved inventory; retry only transient failures")
    .addOption(new Option("--as <identity>", "Fixed read identity; defaults to bot").choices(["bot", "user"]))
    .option("--concurrency <count>", "Maximum concurrent directory reads, 1 to 4", "4")
    .option("--no-progress", "Disable the default bounded JSON progress on stderr")
    .addOption(new Option("--format <format>", "output format").choices(["json", "yaml", "table"]).default("table"))
    .addHelpText("after", "\nThis command reads Wiki directory metadata only. It does not fetch document bodies,\nfollow body links, register sources, create capture phases, or start production.\nResume with the same URL and identity. Completed pages are reused; permission\nfailures remain recorded and never trigger a switch to another identity.\n")
    .action(async (url: string, options: {
      resume?: boolean; as?: "bot" | "user"; concurrency: string; progress?: boolean; format: string;
    }) => {
      const root = findContextProjectRoot(process.cwd());
      if (!root) throw new ContextError(ExitCode.WorkspaceStateError, "source discover requires a Context workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
      try {
        const result = await withSourceOperationRuntime(options.progress === true, ({ signal, report }) => discoverLarkWiki({
          projectRoot: root.projectRoot, url,
          ...(options.as === undefined ? {} : { identity: options.as }),
          ...(options.resume === undefined ? {} : { resume: options.resume }),
          concurrency: Number(options.concurrency), signal,
          onProgress: value => report({ operation: "wiki-discovery", phase: "running", ...value }),
        }));
        if (result.status !== "completed") process.exitCode = 1;
        process.stdout.write(options.format === "json"
          ? `${JSON.stringify(result, null, 2)}\n`
          : YAML.stringify(result));
      } catch (error) {
        if (!(error instanceof WikiDiscoveryError)) throw error;
        throw new ContextError(ExitCode.WorkspaceStateError, error.message, {
          category: ErrorCategory.WorkspaceStateInvalid,
          reason_code: `wiki-discovery-${error.reason}`,
          retryable: error.retryable,
          next: "Keep the same URL and identity. Wait for an active discovery to finish, or resume its saved inventory with --resume.",
        });
      }
    });
}
