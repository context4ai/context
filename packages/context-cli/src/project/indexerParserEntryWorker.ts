import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexerParserCoordinateMapping, IndexerParserRequirement, IndexerParserResolutionLock } from "@c4a/context";
import { loadProjectIndexerParser } from "./indexerParserRuntimeImport.js";
import { materializeProjectIndexerParserEntryInput } from "./indexerParserSourceMaterialization.js";
import type { IndexerParserRuntimeEntryInput } from "./indexerParserRuntimeExecution.js";
import { recordContextDebugPerformance } from "./debugTrace.js";
import { parserProgress } from "./parserProgress.js";

export interface ParserEntryPreparation {
  projectRoot: string;
  entry_digest: string;
  capability: string;
  source_ref: string;
  normalized_paths: string[];
  requirement: IndexerParserRequirement;
  mapping: IndexerParserCoordinateMapping;
  lock: IndexerParserResolutionLock;
}

export async function prepareParserEntryInProcess(input: ParserEntryPreparation) {
  const loaded = await loadProjectIndexerParser(input);
  return materializeProjectIndexerParserEntryInput({ ...input, loaded_module: loaded.module });
}

/** Keep WASM trees and language checker heaps outside the orchestration process. */
export async function prepareParserEntry(input: ParserEntryPreparation): Promise<IndexerParserRuntimeEntryInput> {
  if (!["parser.typescript", "parser.javascript", "parser.go", "parser.rush"].includes(input.capability)) {
    return prepareParserEntryInProcess(input);
  }
  const directory = dirname(fileURLToPath(import.meta.url));
  const worker = [join(directory, "parserEntryWorker.js"), resolve(directory, "../../dist/parserEntryWorker.js")]
    .find(path => existsSync(path));
  // Source-only development can run without a build; installed CLI always ships the worker.
  if (worker === undefined) {
    if (import.meta.url.endsWith(".ts")) return prepareParserEntryInProcess(input);
    throw new Error("Parser worker is missing from the CLI distribution; rebuild or repair the CLI installation.");
  }
  const root = join(input.projectRoot, ".tmp/context-runtime/parser-workers");
  await mkdir(root, { recursive: true });
  const work = await mkdtemp(join(root, "entry-"));
  const request = join(work, "input.json");
  const result = join(work, "output.json");
  const progress = parserProgress(`${input.source_ref}: ${input.capability}, ${input.normalized_paths.length} files, language preparation`);
  let completed = false;
  try {
    await writeFile(request, JSON.stringify(input));
    await new Promise<void>((resolveResult, reject) => {
      const child = spawn(process.execPath, [worker, request, result], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", data => { stderr = (stderr + String(data)).slice(-8192); });
      const stop = () => { child.kill(); };
      const interrupt = () => { child.kill("SIGINT"); };
      const terminate = () => { child.kill("SIGTERM"); };
      const detach = () => {
        process.removeListener("exit", stop);
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", terminate);
      };
      process.once("exit", stop);
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", terminate);
      child.once("error", error => { detach(); reject(error); });
      child.once("close", (code, signal) => {
        detach();
        if (code === 0) resolveResult();
        else reject(new Error(`Parser preparation failed for ${input.source_ref} (${input.capability}, ${input.normalized_paths.length} files; exit ${code ?? signal}). Completed source caches remain reusable. ${stderr.trim()}`));
      });
    });
    const output = JSON.parse(await readFile(result, "utf8")) as {
      prepared: IndexerParserRuntimeEntryInput;
      stats: { duration_ms: number; max_rss_kib: number };
    };
    await recordContextDebugPerformance({
      projectRoot: input.projectRoot, operation: "parser.entry.prepare",
      durationMs: output.stats.duration_ms, outcome: "success",
      data: { source_ref: input.source_ref, capability: input.capability,
        file_count: input.normalized_paths.length, worker_max_rss_kib: output.stats.max_rss_kib },
    });
    completed = true;
    return output.prepared;
  } finally {
    progress.close(completed ? "completed" : "failed");
    await rm(work, { recursive: true, force: true });
  }
}
