import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { reuseCommandValue } from "./commandReadCache.js";

export class SourceUnavailableError extends ContextError {
  constructor(message: string, reason = "source-unavailable") {
    super(ExitCode.WorkspaceStateError, message, { category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: reason, next_action: { command: "context source recovery-plan --format json" } });
  }
}
export class SourceReadError extends ContextError {
  constructor(message: string, recoveryCommand = "context status --format json") {
    super(ExitCode.ExternalToolError, message, { category: ErrorCategory.ExternalToolFailed,
      reason_code: "source-read-failed", next_action: { command: recoveryCommand } });
  }
}

/** Git answers "missing" both for a path absent from the commit and for an object a
 * partial clone has not downloaded. The local tree tells them apart without network. */
async function missingReason(root: string, expression: string): Promise<SourceUnavailableError> {
  const separator = expression.indexOf(":./");
  const commit = expression.slice(0, separator), path = expression.slice(separator + 3);
  const listed = await new Promise<string>(resolve => execFile("git", ["-C", root, "ls-tree", "-z", commit, "--", path],
    { timeout: 10_000, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } }, (error, stdout) => resolve(error ? "" : String(stdout))));
  return listed.trim()
    ? new SourceUnavailableError("The cited file exists in the fixed source commit, but its content is not downloaded to the local checkout", "source-content-missing")
    : new SourceUnavailableError("The cited file does not exist in the fixed source commit", "source-file-missing");
}

type Pending = { expression: string; resolve: (bytes: Buffer) => void; reject: (error: Error) => void; attempts: number };
/** A short-lived pipe per checkout, shared by all files in an observation. The
 * protocol is framed by byte length, never by newlines in a blob's contents. */
export function createGitObjectReader(options: { idleMs?: number; progressTimeoutMs?: number } = {}) {
  const pipes = new Map<string, { read: (expression: string) => Promise<Buffer>; close: () => void }>();
  const reads = new Map<string, Promise<Buffer>>();
  const commits = new Map<string, Promise<void>>();
  function requireCommit(root: string, commit: string): Promise<void> {
    const key = JSON.stringify([root, commit]);
    let check = commits.get(key);
    if (!check) {
      check = new Promise<void>((resolve, reject) => {
        execFile("git", ["-C", root, "cat-file", "-e", `${commit}^{commit}`],
          { timeout: 10_000, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } }, error => {
            if (error) reject(new SourceReadError("The fixed source commit is not locally readable. Restore or fetch the registered source before retrying; no citation state was determined.", "context source recovery-plan --format json"));
            else resolve();
          });
      });
      commits.set(key, check);
      void check.catch(() => commits.delete(key));
    }
    return check;
  }
  function pipe(root: string) {
    let child: ChildProcessWithoutNullStreams | undefined;
    let pending: Pending[] = [];
    let bytes = Buffer.alloc(0);
    let header: { size: number; type: string } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { clearTimeout(timer); clearTimeout(idle); };
    function close() {
      clear();
      const process = child;
      child = undefined;
      process?.stdin.end();
    }
    function fail(message: string) {
      const process = child;
      child = undefined;
      clear(); bytes = Buffer.alloc(0); header = undefined;
      process?.kill();
      const retry = pending.filter(item => ++item.attempts < 2);
      for (const item of pending) if (item.attempts >= 2) item.reject(new SourceReadError(message));
      pending = retry;
      if (pending.length) start();
    }
    function progress() {
      clearTimeout(timer);
      if (pending.length) timer = setTimeout(() => fail("Git source reading stopped making progress; retry the current command."), options.progressTimeoutMs ?? 30_000);
      else {
        clearTimeout(idle);
        idle = setTimeout(close, options.idleMs ?? 100);
      }
    }
    function consume(chunk: Buffer) {
      bytes = Buffer.concat([bytes, chunk]);
      while (pending.length) {
        if (!header) {
          const end = bytes.indexOf(10);
          if (end < 0) break;
          const line = bytes.subarray(0, end).toString("utf8");
          bytes = bytes.subarray(end + 1);
          if (line.endsWith(" missing")) {
            const item = pending.shift()!;
            void missingReason(root, item.expression).then(error => item.reject(error));
            continue;
          }
          const match = /^[a-f0-9]+ (\w+) (\d+)$/u.exec(line);
          if (!match || !Number.isSafeInteger(Number(match[2]))) { fail("Git returned an invalid source object header; retry the current command."); return; }
          header = { type: match[1]!, size: Number(match[2]) };
          if (header.size > 64 * 1024 * 1024) { fail("The cited Git object exceeds the 64 MiB read limit."); return; }
        }
        if (bytes.length < header.size + 1) break;
        if (bytes[header.size] !== 10) { fail("Git returned an incomplete source object; retry the current command."); return; }
        const value = Buffer.from(bytes.subarray(0, header.size));
        bytes = bytes.subarray(header.size + 1);
        const item = pending.shift()!;
        if (header.type === "blob") item.resolve(value);
        else item.reject(new SourceUnavailableError("The cited source path is not a file", "source-file-type"));
        header = undefined;
      }
      progress();
    }
    function start() {
      const process = spawn("git", ["-C", root, "cat-file", "--batch", "-z"], { env: { ...globalThis.process.env, GIT_NO_LAZY_FETCH: "1" } });
      child = process;
      process.stdout.on("data", (chunk: Buffer) => { if (child === process) consume(chunk); });
      process.stderr.on("data", () => { /* Do not leak Git diagnostics or remote credentials into source output. */ });
      process.on("error", () => { if (child === process) fail("Git could not read source objects; check Git and retry the current command."); });
      process.stdin.on("error", () => { if (child === process) fail("Git source input closed unexpectedly; retry the current command."); });
      process.on("close", () => { if (child === process) fail("Git exited before source reading completed; retry the current command."); });
      for (const item of pending) process.stdin.write(`${item.expression}\0`);
      progress();
    }
    return { close, read(expression: string): Promise<Buffer> {
      clearTimeout(idle);
      return new Promise((resolve, reject) => {
        pending.push({ expression, resolve, reject, attempts: 0 });
        if (child) { child.stdin.write(`${expression}\0`); progress(); }
        else start();
      });
    } };
  }
  return {
    read(root: string, commit: string, path: string): Promise<Buffer> {
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(commit) || /[\0\r\n]/u.test(path) || path.startsWith("/") || path.split("/").some(part => part === "..")) {
        return Promise.reject(new SourceUnavailableError("Source reads require a fixed commit and a repository-relative file path", "source-path-invalid"));
      }
      const key = JSON.stringify([root, commit, path]);
      let result = reads.get(key);
      if (!result) {
        let current = pipes.get(root);
        if (!current) { current = pipe(root); pipes.set(root, current); }
        result = requireCommit(root, commit).then(() => current!.read(`${commit}:./${path}`));
        reads.set(key, result);
        void result.catch(() => { if (reads.get(key) === result) reads.delete(key); });
      }
      return result;
    },
    close() { for (const current of pipes.values()) current.close(); },
  };
}
export function commandGitObjectReader() {
  return reuseCommandValue("fixed-git-object-reader", () => createGitObjectReader());
}
