import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cli_main, handleCliFailure } from "../cli.js";

export async function invokeCliInDir(
  dir: string,
  args: string[],
): Promise<{ status: number; stdout: string; stderr: string }> {
  const originalCwd = process.cwd();
  const originalStdoutWrite = process.stdout.write;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: (error?: Error | null) => void) => {
    stdoutChunks.push(String(chunk));
    const complete = typeof encodingOrCallback === "function" ? encodingOrCallback as (error?: Error | null) => void : callback;
    if (complete) queueMicrotask(() => complete());
    return true;
  }) as typeof process.stdout.write;
  try {
    await cli_main(["node", "context", ...args]);
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
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

export function commitAll(path: string, message: string): string {
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", message], { cwd: path });
  const headRef = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
  return headRef.startsWith("ref: ")
    ? readFileSync(join(path, ".git", headRef.slice("ref: ".length)), "utf8").trim()
    : headRef;
}
