import type { Command } from "commander";
import { ErrorCategory, formatFeedback } from "./lib/cliFeedback.js";
import { ContextError } from "./lib/errors.js";
import { acceptStarterPackageTemplates } from "./project/packageTemplateReview.js";
import { findContextProjectRoot } from "./project/workspace.js";
import { ExitCode } from "./types/exitCode.js";

export function registerPackageCommands(program: Command): void {
  const packageCommand = program
    .command("package")
    .description("Inspect or resolve package output configuration");

  const packageTemplate = packageCommand
    .command("template")
    .description("Manage package template review state");

  packageTemplate
    .command("accept [package-name]")
    .description("Explicitly accept an unchanged generated starter template")
    .option("--all", "accept all unchanged generated starter templates")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (
      packageName: string | undefined,
      options: Record<string, unknown>,
    ) => {
      if ((packageName === undefined) === (options.all !== true)) {
        throw new ContextError(
          ExitCode.UserError,
          "provide one package name or --all",
          { category: ErrorCategory.UserInputInvalid },
        );
      }
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      const found = findContextProjectRoot(process.cwd());
      if (!found) {
        throw new ContextError(
          ExitCode.WorkspaceStateError,
          "package template acceptance requires a context project workspace",
          { category: ErrorCategory.WorkspaceNotFound },
        );
      }
      const result = await acceptStarterPackageTemplates({
        projectRoot: found.projectRoot,
        ...(packageName === undefined ? {} : { packageNames: [packageName] }),
      });
      if (options.format === "json") {
        process.stdout.write(`${JSON.stringify({
          action: "package-template-accepted",
          ...result,
          next_action: {
            kind: "reevaluate-workspace",
            command: "context status --format json",
          },
        }, null, 2)}\n`);
      } else {
        process.stdout.write(formatFeedback({
          symbol: "✓",
          action: "accepted",
          subject: result.accepted.join(", ") || "package templates",
          headline: "starter package template",
          body: result.alreadyResolved.length === 0
            ? []
            : [`already resolved: ${result.alreadyResolved.join(", ")}`],
        }));
      }
    });
}
