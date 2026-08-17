import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { PathFilterConfigSchema, type PathFilterConfig } from "@c4a/core";
import type { ExtractionPlugin } from "./protocol.js";
import { buildCodeSnapshot, type CodeSnapshotPayload } from "./codeSnapshot.js";
import { runRepositoryExtraction, type RepositoryExtractionResult } from "./repository.js";
import { ExtractionInputError, NO_ENTRY_DETECTED } from "./errors.js";

export interface CodeExtractRunnerPluginSpec {
  package: string;
  exportName?: string | undefined;
}

export interface CodeExtractRunnerInput {
  repoPath: string;
  modules?: string[];
  ref?: string;
  commitHash?: string | null;
  moduleCommits?: Record<string, string | null | undefined>;
  pathFilter?: PathFilterConfig;
  entrySelection?:
    | { mode: "auto" }
    | { mode: "configured"; entries: string[] }
    | { mode: "scan" };
  plugins: CodeExtractRunnerPluginSpec[];
  snapshot?: {
    sourceId: string;
    sourceSlug: string;
    snapshotId: string;
    codeSnapshotContractVersion: string;
    scriptHash: string;
    toolchain: {
      manager_package: string;
      manager_version: string;
      runner_package: string;
      runner_package_version: string;
      runner_bin: string;
      plugin_package: string;
      plugin_package_version: string;
      plugin_export: string;
    };
    sourceCommit?: string | null;
    versionPolicy?: "package-version" | "module-commit" | "explicit" | "none";
    originPath?: string;
    worktreeContentHash?: string;
  };
}

export type CodeExtractRunnerEvent =
  | { type: "progress"; phase: string; progress: number; module_name?: string; module_path?: string; message?: string }
  | { type: "module_error"; module_name: string; module_path: string; error: string }
  | {
      type: "summary";
      extraction: RepositoryExtractionResult;
      snapshot?: CodeSnapshotPayload;
    }
  | { type: "error"; code: string; message: string };

const pluginSpecSchema = z.object({
  package: z.string().min(1),
  exportName: z.string().min(1).optional(),
});

const entrySelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("configured"), entries: z.array(z.string().min(1)) }),
  z.object({ mode: z.literal("scan") }),
]);

export const codeExtractRunnerInputSchema = z.object({
  repoPath: z.string().min(1),
  modules: z.array(z.string().min(1)).optional(),
  ref: z.string().min(1).optional(),
  commitHash: z.string().min(1).nullable().optional(),
  moduleCommits: z.record(z.string().nullable()).optional(),
  pathFilter: PathFilterConfigSchema.optional(),
  entrySelection: entrySelectionSchema.optional(),
  plugins: z.array(pluginSpecSchema).min(1),
  snapshot: z.object({
    sourceId: z.string().min(1),
    sourceSlug: z.string().min(1),
    snapshotId: z.string().min(1),
    codeSnapshotContractVersion: z.string().min(1),
    scriptHash: z.string().min(1),
    toolchain: z.object({
      manager_package: z.string().min(1),
      manager_version: z.string().min(1),
      runner_package: z.string().min(1),
      runner_package_version: z.string().min(1),
      runner_bin: z.string().min(1),
      plugin_package: z.string().min(1),
      plugin_package_version: z.string().min(1),
      plugin_export: z.string().min(1),
    }),
    sourceCommit: z.string().min(1).nullable().optional(),
    versionPolicy: z.enum(["package-version", "module-commit", "explicit", "none"]).optional(),
    originPath: z.string().min(1).optional(),
    worktreeContentHash: z.string().min(1).optional(),
  }).optional(),
});

const isPlugin = (value: unknown): value is ExtractionPlugin => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExtractionPlugin>;
  return typeof candidate.id === "string" &&
    Array.isArray(candidate.languages) &&
    typeof candidate.canHandle === "function" &&
    typeof candidate.detectEntries === "function" &&
    typeof candidate.extractSymbols === "function";
};

const resolvePluginModule = (packageName: string, cwd: string): string => {
  if (packageName.startsWith(".") || packageName.startsWith("/") || packageName.startsWith("file:")) {
    const filePath = packageName.startsWith("file:")
      ? packageName.slice("file:".length)
      : packageName;
    return path.resolve(cwd, filePath);
  }
  const require = createRequire(path.join(cwd, "package.json"));
  return require.resolve(packageName);
};

export const loadRunnerPlugins = async (
  pluginSpecs: CodeExtractRunnerPluginSpec[],
  cwd = process.cwd(),
): Promise<ExtractionPlugin[]> => {
  const plugins: ExtractionPlugin[] = [];
  for (const spec of pluginSpecs) {
    const resolved = resolvePluginModule(spec.package, cwd);
    const moduleUrl = pathToFileURL(resolved).href;
    const loaded = await import(moduleUrl) as Record<string, unknown>;
    const exported = loaded[spec.exportName ?? "default"] ?? loaded.TypeScriptPlugin ?? loaded.plugin;
    const plugin = typeof exported === "function"
      ? new (exported as new () => ExtractionPlugin)()
      : exported;
    if (!isPlugin(plugin)) {
      throw new Error(`Plugin "${spec.package}" did not export a valid ExtractionPlugin`);
    }
    plugins.push(plugin);
  }
  return plugins;
};

export const runCodeExtractRunner = async (
  rawInput: unknown,
  cwd = process.cwd(),
): Promise<CodeExtractRunnerEvent[]> => {
  const input = codeExtractRunnerInputSchema.parse(rawInput);
  if (input.entrySelection?.mode === "configured" && input.entrySelection.entries.length === 0) {
    throw new ExtractionInputError(
      NO_ENTRY_DETECTED,
      "Configured extraction entries must contain at least one source-relative file path.",
      { mode: "configured" },
    );
  }
  const events: CodeExtractRunnerEvent[] = [];
  const plugins = await loadRunnerPlugins(input.plugins, cwd);
  const extraction = await runRepositoryExtraction({
    repoPath: input.repoPath,
    ...(input.modules ? { modules: input.modules } : {}),
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.commitHash !== undefined ? { commitHash: input.commitHash } : {}),
    ...(input.moduleCommits ? { moduleCommits: input.moduleCommits } : {}),
    ...(input.pathFilter ? { pathFilter: input.pathFilter } : {}),
    ...(input.entrySelection ? { entrySelection: input.entrySelection } : {}),
    plugins,
    onProgress: (event) => events.push({ type: "progress", ...event }),
  });

  for (const error of extraction.moduleErrors) {
    events.push({ type: "module_error", ...error });
  }

  const snapshot = input.snapshot
    ? buildCodeSnapshot({
        sourceId: input.snapshot.sourceId,
        sourceSlug: input.snapshot.sourceSlug,
        snapshotId: input.snapshot.snapshotId,
        repoPath: input.repoPath,
        sourceCommit: input.snapshot.sourceCommit ?? input.commitHash ?? null,
        codeSnapshotContractVersion: input.snapshot.codeSnapshotContractVersion,
        scriptHash: input.snapshot.scriptHash,
        toolchain: input.snapshot.toolchain,
        ...(input.snapshot.originPath ? { originPath: input.snapshot.originPath } : {}),
        ...(input.snapshot.versionPolicy ? { versionPolicy: input.snapshot.versionPolicy } : {}),
        ...(input.moduleCommits ? { dirCommits: input.moduleCommits } : {}),
        ...(input.snapshot.worktreeContentHash ? { worktreeContentHash: input.snapshot.worktreeContentHash } : {}),
        results: extraction.results,
      })
    : undefined;

  events.push({ type: "summary", extraction, ...(snapshot ? { snapshot } : {}) });
  return events;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
};

export const runCodeExtractCli = async (): Promise<void> => {
  try {
    const stdin = await readStdin();
    const input = stdin.trim() ? JSON.parse(stdin) : {};
    const events = await runCodeExtractRunner(input);
    for (const event of events) {
      process.stdout.write(JSON.stringify(event) + "\n");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ type: "error", code: "runner-failed", message }) + "\n");
    process.exitCode = 1;
  }
};

export const runCodeExtractCliFromFile = async (inputFile: string): Promise<CodeExtractRunnerEvent[]> => {
  const content = await readFile(inputFile, "utf-8");
  return runCodeExtractRunner(JSON.parse(content), path.dirname(path.resolve(inputFile)));
};
