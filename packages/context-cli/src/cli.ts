import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, Option } from "commander";
import { registerContextWorkflowResourceCommands } from "./commands/resourceCommands.js";
import { registerProjectRunCommand } from "./commands/runProject.js";
import { registerDebugCommands } from "./commands/debugCommands.js";
import { runDoctorCleanClaudePluginCache } from "./commands/cleanClaudePluginCache.js";
import { cleanAllRetrievalCache, inspectAllRetrievalCache } from "./commands/cleanCache.js";
import { ContextError } from "./lib/errors.js";
import { ErrorCategory, formatFeedback } from "./lib/cliFeedback.js";
import { ExitCode } from "./types/exitCode.js";
import {
  findContextProjectRoot,
  formatProjectInitResult,
  initContextProject,
  projectLanguage,
} from "./project/workspace.js";
import { acceptStarterPackageTemplates } from "./project/packageTemplateReview.js";
import {
  assertProjectWorkflowRevision,
  runProjectStatusCommand,
} from "./project/statusCommand.js";
import { runProjectBuildCommand } from "./project/packageBuilder.js";
import { runProjectCloseCommand } from "./project/close.js";
import { runProjectVerifyCommand } from "./project/verify.js";
import { registerProjectSourceCommands } from "./project/sourceCommands.js";
import {
  formatPluginInstallResult,
  formatPluginPathResult,
  formatPluginStatusResult,
  pluginAgentOption,
  runPluginInstallCommand,
  runPluginPathCommand,
  runPluginStatusCommand,
} from "./project/pluginInstall.js";
import {
  runReviewApplyCommand,
  runReviewApproveAllCommand,
  runReviewDeprecateCommand,
  runReviewHtmlCommand,
  runReviewKeepOrphanedCommand,
  runReviewListCommand,
  runReviewMaintainCommand,
  runReviewMarkCommand,
  runReviewReconcileIdentitiesCommand,
  runReviewRePinCommand,
} from "./project/review.js";
import { contextWorkflowAuthorities } from "./project/workflow/workflowFacts.js";
import {
  collectWorkflowAuthorityOption,
  workflowAuthorities,
} from "./project/workflow/workflowCommandOptions.js";
import { parseWorkflowResourceReceipts } from "./project/workflow/workflowResourceReceipts.js";
import { withDebugCliInvocation } from "./project/debugTrace.js";

const TOP_LEVEL_COMMANDS = new Set([
  "init",
  "plugin",
  "status",
  "run",
  "review",
  "close",
  "build",
  "source",
  "verify",
  "resource",
  "package",
  "clean-cache",
  "debug",
  "help",
]);

function inferErrorCategory(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("cannot be mounted") || lower.includes("mount matrix")) return ErrorCategory.MountMatrixViolation;
  if (lower.includes("is not registered")) return ErrorCategory.SourceNotFound;
  if (lower.includes("no .context") || lower.includes("not a context workspace")) return ErrorCategory.WorkspaceNotFound;
  if (lower.includes("lark-cli") || lower.includes("git rev-parse") || lower.includes("external")) return ErrorCategory.ExternalToolFailed;
  if (lower.includes("schema") || lower.includes("frontmatter") || lower.includes("invalid") || lower.includes("parse failed")) return ErrorCategory.SchemaInvalid;
  if (lower.includes("usage:") || lower.includes("requires") || lower.includes("must be") || lower.includes("not supported")) {
    return ErrorCategory.UserInputInvalid;
  }
  return ErrorCategory.Unknown;
}

/**
 * Read the CLI version from this package's package.json at runtime.
 *
 * Walks up from this file's location (dist/cli.js in prod, src/cli.ts in dev)
 * until it finds a package.json — that's always `packages/context-cli/package.json`.
 * This keeps the CLI version in lockstep with the package, and with the root
 * monorepo version after `./start.sh → package → bump`, without needing a
 * build-time string replacement.
 */
function readPackageVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const pkg = join(dir, "package.json");
      if (existsSync(pkg)) {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { version?: string };
        return parsed.version ?? "unknown";
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through to unknown */
  }
  return "unknown";
}

function readQuickstartPath(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, "docs", "quickstart.md");
      if (existsSync(candidate)) return candidate;
      const pkg = join(dir, "package.json");
      if (existsSync(pkg)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through to relative fallback */
  }
  return join(dirname(fileURLToPath(import.meta.url)), "docs", "quickstart.md");
}

const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function greenBox(lines: readonly string[]): string {
  const width = Math.max(...lines.map((line) => line.length));
  const border = `+${"-".repeat(width + 2)}+`;
  const body = lines.map((line) => `| ${line.padEnd(width)} |`);
  return `${GREEN}${[border, ...body, border].join("\n")}${RESET}`;
}

function headerHelpText(): string {
  return `${greenBox(["Local knowledge workspace CLI"])}\n\n`;
}

function quickstartHelpText(): string {
  return `\n${greenBox([
    "Quick start manual:",
    readQuickstartPath(),
    "Covers plugin installation, project initialization, and agent workflow handoff.",
  ])}\n`;
}

function assertKnownTopLevelCommand(argv: string[]): void {
  for (const token of argv.slice(2)) {
    if (token === "-h" || token === "--help" || token === "-V" || token === "--version") return;
    if (token.startsWith("-")) return;
    if (!TOP_LEVEL_COMMANDS.has(token)) {
      throw new ContextError(ExitCode.UserError, `unknown command '${token}'`, {
        category: ErrorCategory.UserInputInvalid,
      });
    }
    return;
  }
}

export function handleCliFailure(
  err: unknown,
  options: {
    stderr?: Pick<NodeJS.WriteStream, "write">;
    exit?: (code: number) => never | void;
  } = {},
): number {
  const stderr = options.stderr ?? process.stderr;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  // Failures land on stderr in the unified `✗ failed: <category>\n  detail`
  // shape so an LLM tail-reading stderr can route on the first line's
  // category token. ContextError carries a `category` in its detail object;
  // fall back to inferred/unknown for errors without structured detail.
  if (err instanceof ContextError) {
    const detail = err.detail ?? {};
    const category = typeof detail.category === "string" ? detail.category : inferErrorCategory(err.message);
    // Strip `category` from the rest so we don't print it twice.
    const rest = { ...detail };
    delete (rest as Record<string, unknown>).category;
    const restJson = Object.keys(rest).length > 0 ? `\n  ${JSON.stringify(rest, null, 2).split("\n").join("\n  ")}` : "";
    stderr.write(`✗ failed: ${category}\n  ${err.message}${restJson}\n`);
    exit(err.code);
    return err.code;
  }

  const message = err instanceof Error ? err.message : String(err);
  const machineCode = err !== null && typeof err === "object" && "code" in err && typeof err.code === "string"
    ? err.code
    : undefined;
  stderr.write(`✗ failed: ${inferErrorCategory(message)}\n  ${message}${machineCode === undefined ? "" : `\n  ${JSON.stringify({ code: machineCode })}`}\n`);
  exit(1);
  return 1;
}

export function createCliProgram(): Command {
  const program = new Command();
  program
    .name("context")
    .enablePositionalOptions()
    .version(readPackageVersion())
    .addOption(
      new Option("--workflow-revision <revision>")
        .hideHelp(),
    )
    .addOption(
      new Option("--workflow-authority <authority>")
        .hideHelp()
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .addOption(
      new Option("--workflow-managed")
        .hideHelp(),
    )
    .addOption(
      new Option("--workflow-resource-receipts <json-or-@file>")
        .hideHelp(),
    );
  program.hook("preAction", async (rootCommand) => {
    const options = rootCommand.opts() as Record<string, unknown>;
    if (typeof options.workflowRevision !== "string") return;
    const authorities = contextWorkflowAuthorities({
      managed: options.workflowManaged === true,
      authorities: workflowAuthorities(options.workflowAuthority),
    });
    await assertProjectWorkflowRevision({
      cwd: process.cwd(),
      expectedRevision: options.workflowRevision,
      authorities,
    });
  });
  const baseHelpInformation = program.helpInformation.bind(program);
  program.helpInformation = () => `${headerHelpText()}${baseHelpInformation()}${quickstartHelpText()}`;

  program
    .command("init [project-dir]")
    .description("Initialize a project-local context workspace")
    .option("--name <name>", "display/package name override")
    .option("--language <language>", "workspace and starter-template language: en | zh-CN")
    .option("--dev", "initialize with the locally linked @c4a/context SDK")
    .option("--debug", "enable workspace-local command and Agent Graph tracing")
    .option("--allow-nonempty", "after explicit confirmation, preserve existing files and initialize inside a non-empty non-Context directory")
    .action(async (projectDir: string | undefined, options: Record<string, unknown>) => {
      const result = await initContextProject({
        cwd: process.cwd(),
        ...(projectDir !== undefined ? { projectDir } : {}),
        ...(typeof options.name === "string" ? { name: options.name } : {}),
        ...(typeof options.language === "string"
          ? { language: projectLanguage(options.language) }
          : {}),
        ...(options.dev === true ? { dev: true } : {}),
        ...(options.debug === true ? { debug: true } : {}),
        ...(options.allowNonempty === true ? { allowNonempty: true } : {}),
      });
      process.stdout.write(formatProjectInitResult(result));
    });

  const plugin = program
    .command("plugin")
    .description("Install or inspect global Context agent plugins");

  registerDebugCommands(program);

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

  registerContextWorkflowResourceCommands(program);

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

  program
    .command("status")
    .description("Print workspace overview and suggested next actions")
    .option("--format <format>", "output format: table | json", "table")
    .option("--view <view>", "with --format json, output view: summary | full", "summary")
    .option("--managed", "use explicit current-conversation managed approval for this status loop")
    .option("--resource-receipts <json-or-@file>", "current-conversation Agent Graph resource read receipts")
    .addOption(
      new Option("--authority <authority>", "current-conversation scoped authority granted by the user; repeatable")
        .argParser(collectWorkflowAuthorityOption)
        .default([]),
    )
    .action(async (options: Record<string, unknown>) => {
      const rootOptions = program.opts() as Record<string, unknown>;
      const resourceReceiptsReference = typeof options.resourceReceipts === "string"
        ? options.resourceReceipts
        : typeof rootOptions.workflowResourceReceipts === "string"
        ? rootOptions.workflowResourceReceipts
        : undefined;
      const resourceReceipts = resourceReceiptsReference !== undefined
        ? await parseWorkflowResourceReceipts(resourceReceiptsReference, process.cwd())
        : undefined;
      if (await runProjectStatusCommand({
        cwd: process.cwd(),
        format: options.format === "json" ? "json" : "table",
        view: options.view === "full" ? "full" : "summary",
        managed: options.managed === true,
        authorities: workflowAuthorities(options.authority),
        ...(resourceReceipts === undefined ? {} : { resourceReceipts }),
        ...(resourceReceiptsReference === undefined
          ? {}
          : { resourceReceiptsReference }),
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "status requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });

  registerProjectRunCommand(program, import.meta.url);

  const review = program
    .command("review")
    .description("Review draft project candidates and apply approval decisions");

  review
    .command("html [collection]")
    .description("Render a self-contained local review HTML page")
    .option("--all", "review all draft candidates across internal collections")
    .option("--out <file>", "output HTML path, defaults to .tmp/context-runtime/review/<collection>.html")
    .option("--open", "open the generated HTML with the system default browser")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (collection: string | undefined, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewHtmlCommand({
        cwd: process.cwd(),
        ...(collection !== undefined ? { collection } : {}),
        ...(options.all === true ? { all: true } : {}),
        ...(typeof options.out === "string" ? { out: options.out } : {}),
        format: options.format === "json" ? "json" : "text",
        open: options.open === true,
      });
    });

  review
    .command("list [collection]")
    .description("List draft candidates for CLI review")
    .option("--all", "list draft candidates across internal collections")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (collection: string | undefined, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewListCommand({
        cwd: process.cwd(),
        ...(collection !== undefined ? { collection } : {}),
        ...(options.all === true ? { all: true } : {}),
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("apply <payload-file>")
    .description("Apply a copied review Payload from a JSON or JSONL file")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (payloadInput: string, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewApplyCommand({
        cwd: process.cwd(),
        payloadInput,
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("reconcile-identities")
    .description("Coordinate approved path identity conflicts before Review")
    .requiredOption("--source <source-key>", "source-bound structure whose approved path identities must be preserved")
    .requiredOption("--strategy <strategy>", "identity strategy: preserve-approved")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewReconcileIdentitiesCommand({
        cwd: process.cwd(),
        source: String(options.source),
        strategy: String(options.strategy),
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("approve-all [collection]")
    .description("Approve the complete current review scope under explicit managed-session authority")
    .option("--all", "approve all current draft candidates across internal collections")
    .option("--managed", "assert explicit current-conversation managed approval")
    .option("--verbose", "include candidate ids and materialized page paths in JSON output")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (collection: string | undefined, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewApproveAllCommand({
        cwd: process.cwd(),
        ...(collection !== undefined ? { collection } : {}),
        ...(options.all === true ? { all: true } : {}),
        managed: options.managed === true,
        verbose: options.verbose === true,
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("approve <candidate-id>")
    .description("Approve one draft candidate through the scoped quick gate")
    .option("--collection <collection>", "scope the quick approval to one internal collection")
    .option("--all", "scope the quick approval to all draft candidates")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (id: string, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewMarkCommand({
        cwd: process.cwd(),
        id,
        status: "approved",
        ...(typeof options.collection === "string" ? { collection: options.collection } : {}),
        ...(options.all === true ? { all: true } : {}),
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("reject <candidate-id>")
    .description("Reject one draft candidate through the scoped quick gate")
    .option("--collection <collection>", "scope the quick rejection to one internal collection")
    .option("--all", "scope the quick rejection to all draft candidates")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (id: string, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewMarkCommand({
        cwd: process.cwd(),
        id,
        status: "rejected",
        ...(typeof options.collection === "string" ? { collection: options.collection } : {}),
        ...(options.all === true ? { all: true } : {}),
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("re-pin <view-ref>")
    .description("Accept document source drift by updating approved prose source_ref metadata only")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (viewRef: string, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewRePinCommand({
        cwd: process.cwd(),
        viewRef,
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("deprecate <view-ref>")
    .description("Mark an approved knowledge page as deprecated without deleting it")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (viewRef: string, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      await runReviewDeprecateCommand({
        cwd: process.cwd(),
        viewRef,
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("keep-orphaned <view-ref>")
    .description(
      "Keep an approved page with an explicit source-orphaned evidence warning",
    )
    .option("--format <format>", "output format: text | json", "text")
    .action(async (viewRef: string, options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(
          ExitCode.UserError,
          "--format must be text or json",
          { category: ErrorCategory.UserInputInvalid },
        );
      }
      await runReviewKeepOrphanedCommand({
        cwd: process.cwd(),
        viewRef,
        format: options.format === "json" ? "json" : "text",
      });
    });

  review
    .command("maintain")
    .description(
      "Apply a typed batch of approved evidence-maintenance decisions",
    )
    .requiredOption("--input <file>", "YAML/JSON payload path, or - for stdin")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(
          ExitCode.UserError,
          "--format must be text or json",
          { category: ErrorCategory.UserInputInvalid },
        );
      }
      if (typeof options.input !== "string") {
        throw new ContextError(
          ExitCode.UserError,
          "review maintain requires --input <file> or --input -",
          { category: ErrorCategory.UserInputInvalid },
        );
      }
      await runReviewMaintainCommand({
        cwd: process.cwd(),
        payloadInput: options.input,
        format: options.format === "json" ? "json" : "text",
      });
    });

  program
    .command("close")
    .description("Close approved project knowledge by deriving structure and running final verification")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (await runProjectCloseCommand({
        cwd: process.cwd(),
        format: options.format === "json" ? "json" : "text",
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "close requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });

  program
    .command("build")
    .description("Build declared project packages")
    .option("--format <format>", "output format: text | json", "text")
    .option("--verbose", "include per-file build changes in JSON output")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be text or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (await runProjectBuildCommand({
        cwd: process.cwd(),
        format: options.format === "json" ? "json" : "text",
        verbose: options.verbose === true,
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "build requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });

  registerProjectSourceCommands(program);
  program
    .command("verify")
    .description("Validate knowledge workspace")
    .option("--format <format>", "output format: table | json", "table")
    .option("--compact", "return grouped diagnostics without the complete issue list")
    .option("--view <view>", "read a verification view: diagnostics")
    .option("--page-size <n>", "with --view diagnostics, limit returned issues")
    .option("--page-token <token>", "with --view diagnostics, continue pagination")
    .action(async (options: Record<string, unknown>) => {
      if (options.format !== "table" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be table or json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (options.view !== undefined && options.view !== "diagnostics") {
        throw new ContextError(ExitCode.UserError, "--view must be diagnostics", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (options.view === "diagnostics" && options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--view diagnostics requires --format json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (await runProjectVerifyCommand({
        cwd: process.cwd(),
        format: options.format === "json" ? "json" : "table",
        ...(options.compact === true ? { compact: true } : {}),
        ...(options.view === "diagnostics" ? { view: "diagnostics" as const } : {}),
        ...(typeof options.pageSize === "string" ? { pageSize: options.pageSize } : {}),
        ...(typeof options.pageToken === "string" ? { pageToken: options.pageToken } : {}),
      })) {
        return;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "verify requires a context project workspace", {
        category: ErrorCategory.WorkspaceNotFound,
      });
    });

  // Distribution to Cursor / Codex / other agents is delegated to the
  // community standard `npx skills add` (vercel-labs/skills, 45-agent
  // support). See README / acceptance-playbook §2b.

  const cleanCacheAction = async (options: Record<string, unknown>) => {
    const dryRun = options.dryRun === true;
    await runDoctorCleanClaudePluginCache({ dryRun });
    if (dryRun) {
      const inspected = await inspectAllRetrievalCache();
      process.stdout.write(formatFeedback({
        symbol: "·",
        action: "scanned",
        subject: "context retrieval cache",
        headline: `dry-run: ${inspected.projects} project(s), ${inspected.files} file(s) would be removed`,
        body: [
          "cache scope: all-projects",
          inspected.projectIds.length > 0 ? `project ids: ${inspected.projectIds.join(", ")}` : "project ids: none",
          "`context clean-cache` is a cross-workspace maintenance operation that removes all retrieval cache projects",
        ],
      }));
      return;
    }
    const result = await cleanAllRetrievalCache();
    process.stdout.write(formatFeedback({
      symbol: "✓",
      action: result.action,
      subject: "context retrieval cache",
      headline: `${result.removedProjects} project(s), ${result.removedFiles} file(s) removed`,
      body: ["cache scope: all-projects"],
    }));
  };

  program
    .command("clean-cache")
    .description("Clean orphaned Claude Code plugin caches and all retrieval cache projects")
    .option("--dry-run", "Report what would be deleted without removing anything")
    .action(cleanCacheAction);

  return program;
}

export async function cli_main(argv: string[] = process.argv): Promise<void> {
  await withDebugCliInvocation(argv, async () => {
    assertKnownTopLevelCommand(argv);
    const program = createCliProgram();
    await program.parseAsync(argv);
  });
}

export function isDirectCliInvocation(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    let resolved = argv1;
    try {
      resolved = realpathSync(argv1);
    } catch {
      // The argv path may not exist in unusual launchers. Still normalize
      // encoding so paths with spaces do not become silent no-ops.
    }
    return metaUrl === pathToFileURL(resolved).href;
  } catch {
    return false;
  }
}

const isDirectInvocation =
  typeof process !== "undefined" &&
  isDirectCliInvocation(import.meta.url, process.argv[1]);

if (isDirectInvocation) {
  cli_main().catch((err: unknown) => {
    handleCliFailure(err);
  });
}
