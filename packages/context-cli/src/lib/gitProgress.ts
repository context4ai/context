import { spawn } from "node:child_process";

/** Never echo credentials embedded in remote URLs. */
export function redactRemoteCredentials(text: string): string {
  return text.replace(/\/\/[^/@\s]+@/gu, "//");
}

export class GitProgressError extends Error {
  constructor(message: string, readonly kind: "no-progress" | "too-long" | "failed") { super(message); }
}

const UNITS: Record<string, number> = { bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };

/** git's progress line, "Receiving objects:  40% (4/10), 1.20 MiB | 2.00 MiB/s" or
 * "remote: Counting objects: 12": its phase, object count and bytes received so far.
 * Other lines (warnings, retries) are not progress. */
function progressCount(line: string): { phase: string; count: number; bytes: number } | undefined {
  const match = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+(?:\d+%\s+\((\d+)\/\d+\)|(\d+))/u.exec(line);
  if (!match) return undefined;
  const size = /,\s*(\d+(?:\.\d+)?)\s*(bytes|[KMGT]iB)(?!\/s)/u.exec(line.slice(match[0].length));
  return { phase: match[1]!, count: Number(match[2] ?? match[3]), bytes: size ? Number(size[1]) * UNITS[size[2]!]! : 0 };
}

/** Run a git fetch or clone while it makes progress. Progress means a phase's object count or
 * received bytes in git's progress lines went up; repeated lines or warnings are not. Stops after
 * `idleMs` without progress or `limitMs` in total, and reports which. Progress is shown on
 * stderr only (throttled), never on stdout. */
export async function runGitWithProgress(args: readonly string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; label: string;
  idleMs?: number; limitMs?: number; reportMs?: number; bin?: string;
} ): Promise<string> {
  const idleMs = options.idleMs ?? 5 * 60_000, limitMs = options.limitMs ?? 30 * 60_000, reportMs = options.reportMs ?? 30_000;
  const command = args.findIndex(arg => arg === "fetch" || arg === "clone");
  const argv = command < 0 ? [...args] : [...args.slice(0, command + 1), "--progress", ...args.slice(command + 1)];
  const child = spawn(options.bin ?? "git", argv, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
  const started = Date.now();
  let lastProgress = started, lastReport = started, lastLine = "", stdout = "", tail = "";
  const counts = new Map<string, { count: number; bytes: number }>();
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => {
    const text = String(chunk);
    tail = (tail + text).slice(-4000);
    for (const line of text.split(/[\r\n]+/u).map(part => part.trim()).filter(Boolean)) {
      const progress = progressCount(line);
      if (!progress) continue;
      lastLine = line;
      const previous = counts.get(progress.phase);
      if (!previous || progress.count > previous.count || progress.bytes > previous.bytes) {
        counts.set(progress.phase, { count: Math.max(progress.count, previous?.count ?? 0), bytes: Math.max(progress.bytes, previous?.bytes ?? 0) });
        lastProgress = Date.now();
      }
    }
  });
  let stopped: GitProgressError | undefined;
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - started > limitMs) stopped = new GitProgressError(`${options.label} stopped after ${Math.round(limitMs / 60_000)} minutes `
      + `(still running; last progress: ${redactRemoteCredentials(lastLine) || "none"}). Report this to the user before retrying.`, "too-long");
    else if (now - lastProgress > idleMs) stopped = new GitProgressError(`${options.label} made no progress for ${Math.round(idleMs / 60_000)} minutes `
      + `(last progress: ${redactRemoteCredentials(lastLine) || "none"}).`, "no-progress");
    if (stopped) { child.kill("SIGKILL"); return; }
    if (now - lastReport >= reportMs && lastLine) {
      lastReport = now;
      process.stderr.write(`[context] ${options.label}: ${redactRemoteCredentials(lastLine)}\n`);
    }
  }, Math.min(1000, idleMs, limitMs));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearInterval(timer));
  if (stopped) throw stopped;
  if (code !== 0) {
    const line = tail.split(/[\r\n]+/u).map(part => part.trim()).find(part => /^(fatal|error):/iu.test(part)) ?? tail.trim().split(/[\r\n]+/u).pop() ?? "";
    throw new GitProgressError(`${options.label} failed: ${redactRemoteCredentials(line).slice(0, 300) || `exit ${code}`}`, "failed");
  }
  return stdout;
}
