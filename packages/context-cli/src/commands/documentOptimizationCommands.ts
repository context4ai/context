import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  applyDocumentOptimizationDecisions,
  collectDocumentOptimizationStatus,
  createDocumentOptimizationPlan,
} from "../project/documentOptimization.js";
import {
  beginDocumentRevision,
  currentDocumentRevisionPlan,
  validateDocumentOptimizationRevisions,
} from "../project/documentRevision.js";
import {
  disableDocumentOptimization,
  enableDocumentOptimization,
} from "../project/documentOptimizationConfig.js";
import { listApprovedKnowledge } from "../project/packageBuilder.js";
import { findContextProjectRoot } from "../project/workspace.js";
import { ExitCode } from "../types/exitCode.js";

function requireProjectRoot(cwd = process.cwd()): string {
  const found = findContextProjectRoot(cwd);
  if (found !== null) return found.projectRoot;
  throw new ContextError(ExitCode.WorkspaceStateError, "optimize-docs commands require a Context workspace", {
    category: ErrorCategory.WorkspaceNotFound,
  });
}

function outputFormat(value: unknown): "text" | "json" {
  if (value === "text" || value === "json") return value;
  throw new ContextError(ExitCode.UserError, "--format must be text or json", {
    category: ErrorCategory.UserInputInvalid,
  });
}

function writeResult(value: unknown, format: "text" | "json"): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
  process.stdout.write(`${Object.entries(record).flatMap(([key, item]) =>
    item !== null && typeof item === "object"
      ? [`${key}: ${JSON.stringify(item)}`]
      : [`${key}: ${String(item)}`]
  ).join("\n")}\n`);
}

async function readPayload(reference: string, projectRoot: string): Promise<unknown> {
  if (reference === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  const normalized = reference.startsWith("@") ? reference.slice(1) : reference;
  const path = resolve(projectRoot, normalized);
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new ContextError(ExitCode.UserError, `cannot read document optimization payload: ${reference}`, {
      category: ErrorCategory.UserInputInvalid,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function registerDocumentOptimizationCommands(program: Command): void {
  program.command("revise <target>")
    .description("Start a source-faithful correction for one approved knowledge page")
    .option("--format <format>", "output format: text | json", "json")
    .action(async (target: string, options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      writeResult(await beginDocumentRevision({
        projectRoot,
        files: await listApprovedKnowledge(projectRoot),
        selector: target,
      }), outputFormat(options.format));
    });

  const optimize = program
    .command("optimize-docs")
    .description("Configure and apply source-constrained editorial revisions");

  optimize.command("enable")
    .description("Enable document optimization for subsequent package builds")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      await enableDocumentOptimization(projectRoot);
      writeResult(
        await collectDocumentOptimizationStatus({ projectRoot, files: await listApprovedKnowledge(projectRoot) }),
        outputFormat(options.format),
      );
    });

  optimize.command("disable")
    .description("Disable document optimization and move its revisions to runtime recovery storage")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      const recoveryPath = await disableDocumentOptimization(projectRoot);
      writeResult({
        schema: "context.document-optimization-disabled.v1",
        enabled: false,
        ...(recoveryPath === undefined ? {} : { recovery_path: recoveryPath }),
      }, outputFormat(options.format));
    });

  optimize.command("status")
    .description("Show revision freshness, editorial signals, and pending Section counts")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      writeResult(
        await collectDocumentOptimizationStatus({ projectRoot, files: await listApprovedKnowledge(projectRoot) }),
        outputFormat(options.format),
      );
    });

  optimize.command("validate")
    .description("Validate revision pages and reconcile safe manual edits")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      const status = await validateDocumentOptimizationRevisions({
        projectRoot,
        files: await listApprovedKnowledge(projectRoot),
      });
      if (status.conflict_fragments > 0) {
        throw new ContextError(ExitCode.WorkspaceStateError, "document optimization contains stale or invalid revision pages", {
          category: ErrorCategory.WorkspaceStateInvalid,
          conflicts: status.conflict_fragment_ids,
          next: "Regenerate or review the listed revision pages, then rerun context optimize-docs validate.",
        });
      }
      writeResult({
        schema: "context.document-optimization-validation.v1",
        valid: true,
        status,
      }, outputFormat(options.format));
    });

  optimize.command("plan")
    .description("Materialize the current Section-level editorial decision batch")
    .option("--format <format>", "output format: text | json", "json")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      writeResult(
        await createDocumentOptimizationPlan({ projectRoot, files: await listApprovedKnowledge(projectRoot) }),
        outputFormat(options.format),
      );
    });

  optimize.command("apply")
    .description("Apply a complete revision-bound Agent optimization decision batch")
    .requiredOption("--input <json-or-@file>", "decision payload path, @path, or - for stdin")
    .option("--format <format>", "output format: text | json", "json")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      if (typeof options.input !== "string") {
        throw new ContextError(ExitCode.UserError, "--input is required", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      const result = await applyDocumentOptimizationDecisions({
        projectRoot,
        files: await listApprovedKnowledge(projectRoot),
        payload: await readPayload(options.input, projectRoot),
      });
      writeResult({
        schema: "context.document-optimization-apply-result.v2",
        applied: result.applied,
        status: result.status,
        next_action: { kind: "reevaluate-workspace", command: "context status --format json" },
      }, outputFormat(options.format));
    });

  optimize.command("revise <target>")
    .description("Start a source-faithful correction by title, approved path, ViewRef, or fragment id")
    .option("--format <format>", "output format: text | json", "json")
    .action(async (target: string, options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      writeResult(await beginDocumentRevision({
        projectRoot,
        files: await listApprovedKnowledge(projectRoot),
        selector: target,
      }), outputFormat(options.format));
    });

  optimize.command("revise-current")
    .description("Show the active conversational correction target and validation step")
    .option("--format <format>", "output format: text | json", "json")
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();
      writeResult(await currentDocumentRevisionPlan({
        projectRoot,
        files: await listApprovedKnowledge(projectRoot),
      }), outputFormat(options.format));
    });
}
