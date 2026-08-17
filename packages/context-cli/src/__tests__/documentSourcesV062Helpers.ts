import { expect } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";

export async function makeProjectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-"));
  await mkdir(join(root, "sources", "repo"), { recursive: true });
  await mkdir(join(root, "sources", "file"), { recursive: true });
  await mkdir(join(root, "sources", "lark"), { recursive: true });
  await writeFile(join(root, "sources", "repo", "index.yaml"), "sources: []\n", "utf8");
  return root;
}

export async function expectContextError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
    throw new Error("expected ContextError");
  } catch (error) {
    expect(error).toBeInstanceOf(ContextError);
    expect((error as ContextError).message).toMatch(pattern);
    expect((error as ContextError).detail?.category).toBe(ErrorCategory.UserInputInvalid);
  }
}

export async function invokeCliInDir(dir: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
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
