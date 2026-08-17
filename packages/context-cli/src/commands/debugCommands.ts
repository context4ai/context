import { Command } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  contextDebugStatus,
  disableContextDebug,
  enableContextDebug,
  exportContextDebugReplay,
} from "../project/debugTrace.js";
import { findContextProjectRoot } from "../project/workspace.js";
import { ExitCode } from "../types/exitCode.js";

function requireProjectRoot(): string {
  const found = findContextProjectRoot(process.cwd());
  if (found !== null) return found.projectRoot;
  throw new ContextError(ExitCode.WorkspaceStateError, "debug commands require a Context workspace", {
    category: ErrorCategory.WorkspaceNotFound,
    next: "Run this command inside an initialized Context workspace.",
  });
}

function debugFormat(value: unknown): "text" | "json" {
  if (value === "text" || value === "json") return value;
  throw new ContextError(ExitCode.UserError, "--format must be text or json", {
    category: ErrorCategory.UserInputInvalid,
  });
}

function writeResult(result: Record<string, unknown>, format: "text" | "json"): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = Object.entries(result).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (value !== null && typeof value === "object") return [`${key}: ${JSON.stringify(value)}`];
    return [`${key}: ${String(value)}`];
  });
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function registerDebugCommands(program: Command): void {
  const debug = program
    .command("debug")
    .description("Enable, inspect, or export workspace-local Context traces");

  debug.command("enable")
    .description("Enable observational tracing in package.json and .tmp")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      await enableContextDebug(projectRoot, "command");
      writeResult(await contextDebugStatus(projectRoot), debugFormat(options.format));
    });

  debug.command("disable")
    .description("Disable new trace recording without deleting existing traces")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      await disableContextDebug(projectRoot);
      writeResult(await contextDebugStatus(projectRoot), debugFormat(options.format));
    });

  debug.command("status")
    .description("Show debug configuration, counts, and trace paths")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      writeResult(await contextDebugStatus(requireProjectRoot()), debugFormat(options.format));
    });

  debug.command("export")
    .description("Build a replay projection from the append-only event stream")
    .option("--output <path>", "output file below the workspace .tmp directory")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const result = await exportContextDebugReplay(
        requireProjectRoot(),
        typeof options.output === "string" ? options.output : undefined,
      );
      writeResult(result, debugFormat(options.format));
    });
}
