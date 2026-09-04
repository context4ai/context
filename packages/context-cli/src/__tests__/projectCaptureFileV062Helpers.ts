import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CaptureRunJson {
  log: string;
  result: {
    kind: "document.capture.file.result";
    source: {
      type: "file";
      name: string;
      local: string;
      include: string[];
    };
    snapshot: {
      manifest: string;
      materializedAt: string;
      snapshot_hash: string;
      changed: boolean;
    };
    documents: Array<{
      path: string;
      title: string;
      line_count: number;
      route?: string;
      empty?: boolean;
    }>;
    metadata_files?: Array<{
      path: string;
      routes: string[];
    }>;
    next_action: {
      kind: string;
      command: string;
      completed_operation: string;
      message: string;
    };
  };
}

export function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-capture-file-v062-"));
}

export async function invokeCliInDir(dir: string, args: string[]): Promise<CliResult> {
  const originalCwd = process.cwd();
  const originalStdoutWrite = process.stdout.write;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await createCliProgram().parseAsync(["node", "context", ...args]);
    return { status: 0, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  } catch (error) {
    const status = handleCliFailure(error, {
      stderr: {
        write: ((chunk: string | Uint8Array) => {
          stderrChunks.push(String(chunk));
          return true;
        }) as typeof process.stderr.write,
      },
      exit: (code) => code,
    });
    return { status, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.chdir(originalCwd);
  }
}

export async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const result = await invokeCliInDir(dir, args);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}

export function writeCaptureProjectEntry(projectRoot: string, sourceName = "product-docs"): void {
  writeFileSync(join(projectRoot, "src", "index.ts"), [
    'import { captureFile, defineProject, source } from "@c4a/context";',
    "",
    `const docs = source("${sourceName}");`,
    "",
    "export default defineProject({",
    "  sources: [docs],",
    "  phases: [captureFile({ source: docs })],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

export function writeMdxCaptureProjectEntry(projectRoot: string, sourceName = "product-docs"): void {
  writeFileSync(join(projectRoot, "src", "index.ts"), [
    'import { captureFile, defineProject, source } from "@c4a/context";',
    "",
    `const docs = source("${sourceName}");`,
    "const captureDocs = captureFile({ source: docs });",
    'captureDocs.processors = [{ kind: "file.capture.processor.mdx-json-docs" }];',
    "",
    "export default defineProject({",
    "  sources: [docs],",
    "  phases: [captureDocs],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

export function readRunLogs(projectRoot: string): Record<string, unknown>[] {
  const dir = join(projectRoot, ".tmp", "context-runtime", "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => JSON.parse(readFileSync(join(dir, entry), "utf8")) as Record<string, unknown>);
}
