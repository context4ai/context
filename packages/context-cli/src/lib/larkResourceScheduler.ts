import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { LarkResourceCommandResult, LarkResourceCommandRunner } from "./larkResourceCommand.js";

/** Finds a structured error record that satisfies `match`, including JSON embedded in CLI text. */
function structured(value: unknown, match: (record: Record<string, unknown>) => boolean, depth = 0): boolean {
  if (depth > 6 || value === null) return false;
  if (typeof value === "string") {
    const start = value.indexOf("{");
    if (start < 0) return false;
    try { return structured(JSON.parse(value.slice(start)), match, depth + 1); } catch { return false; }
  }
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (match(record)) return true;
  return [record.error, record.message, record.cause].some((entry) => structured(entry, match, depth + 1));
}

/** Only structured throttling signals qualify; ordinary permission/400 errors do not. */
const throttle = (value: unknown): boolean => structured(value, (record) =>
  [record.code, record.status, record.status_code].some((code) => ["429", "99991400"].includes(String(code))) ||
  record.type === "rate_limit" || record.subtype === "rate_limited");

const codes = (record: Record<string, unknown>): string[] => [record.code, record.status, record.status_code]
  .filter((code) => code !== undefined && code !== null).map(String);
const TRANSIENT_STATUS = new Set(["502", "503", "504"]);
/** A definite answer from the service: permission, missing source, invalid request or server error. */
const PERMANENT_STATUS = new Set(["400", "401", "403", "404", "500", "2890003", "3380004", "99991672"]);
const PERMANENT_TYPES = new Set(["authorization", "authentication", "validation"]);
const TRANSIENT_TEXT = new RegExp([
  String.raw`(?:HTTP[/\s\d.]*\s|status(?:[ _]code)?[:=\s]+|code[:=\s]+)(?:502|503|504)\b`,
  String.raw`\b(?:502|503|504)\s+(?:bad gateway|service unavailable|gateway time-?out)`,
  "bad gateway", "service unavailable", "gateway time-?out", "request time-?out", "timed out", "deadline exceeded", "i/o timeout",
  // Go http.Client: "Client.Timeout exceeded while awaiting headers", "Client.Timeout or context cancellation while reading body".
  String.raw`client\.timeout`, "timeout exceeded",
  "ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EPIPE", "EAI_AGAIN", "connection (?:reset|refused|closed)",
  "socket hang up", "unexpected EOF", "network is unreachable", "TLS handshake timeout",
].join("|"), "iu");

/** Failure body of a command: its output streams on a non-zero exit, otherwise only an `ok: false` envelope. */
function failureText(result: LarkResourceCommandResult): string | undefined {
  if (result.exitCode !== 0) return `${result.stderr}\n${result.stdout}`;
  const trimmed = result.stdout.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const envelope = JSON.parse(trimmed) as Record<string, unknown>;
    return envelope?.ok === false ? JSON.stringify(envelope.error ?? envelope) : undefined;
  } catch { return undefined; }
}

/** Gateway errors, timeouts and dropped connections: worth retrying the same request after a pause. */
export function isLarkResourceTransient(result: LarkResourceCommandResult): boolean {
  if (result.exitCode === null) return true;
  const text = failureText(result);
  if (text === undefined || isLarkResourceThrottled(result)) return false;
  if (structured(text, (record) => codes(record).some((code) => TRANSIENT_STATUS.has(code)))) return true;
  // A structured permanent error is final, whatever words its message or file name contains.
  if (structured(text, (record) => codes(record).some((code) => PERMANENT_STATUS.has(code)) ||
    PERMANENT_TYPES.has(String(record.type)))) return false;
  return TRANSIENT_TEXT.test(text);
}

export function isLarkResourceThrottled(result: LarkResourceCommandResult): boolean {
  return throttle(result.stderr) || throttle(result.stdout);
}

function retryAfter(value: unknown, now: number, depth = 0): number {
  if (depth > 6 || value === null) return 0;
  if (typeof value === "string") {
    const start = value.indexOf("{");
    if (start < 0) return 0;
    try { return retryAfter(JSON.parse(value.slice(start)), now, depth + 1); } catch { return 0; }
  }
  if (typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const header = (record.headers as Record<string, unknown> | undefined)?.["retry-after"];
  const raw = record.retry_after ?? header;
  const seconds = Number(raw);
  const milliseconds = Number(record.retry_after_ms);
  const own = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds
    : Number.isFinite(seconds) && seconds > 0 ? seconds * 1000
    : typeof raw === "string" ? Math.max(0, Date.parse(raw) - now) || 0 : 0;
  return Math.max(own, ...[record.error, record.cause, record.message].map(entry => retryAfter(entry, now, depth + 1)));
}

async function emptyDirectory(path: string): Promise<void> {
  for (const entry of await readdir(path)) await rm(join(path, entry), { recursive: true, force: true });
}

/** Transient retries back off about 1, 3 and 9 seconds; within this window repeated failures halve concurrency once. */
const TRANSIENT_RETRIES = 3;
const TRANSIENT_CUT_WINDOW_MS = 5_000;

/**
 * Shared by one capture. No identity changes, user prompts, or unbounded retries.
 * Throttling cools down every queued request and stops them once its budget is spent;
 * a transient failure is retried for its own request only and never stops the others.
 * Waiting for a retry does not hold a concurrency slot.
 */
export function createLarkResourceScheduler(runner: LarkResourceCommandRunner, options: {
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  random?: () => number;
} = {}): LarkResourceCommandRunner {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;
  let concurrency = 4;
  let active = 0;
  let blockedUntil = 0;
  let successes = 0;
  let lastTransientCut = Number.NEGATIVE_INFINITY;
  let exhausted: LarkResourceCommandResult | undefined;
  const waiters: Array<() => void> = [];
  const wake = (): void => { for (const resolve of waiters.splice(0)) resolve(); };
  const acquire = async (): Promise<void> => {
    for (;;) {
      if (exhausted) { active++; return; }
      const remaining = blockedUntil - now();
      if (remaining > 0) { await sleep(remaining); continue; }
      if (active < concurrency) { active++; return; }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  return async (args, commandOptions) => {
    let throttled = 0;
    let transient = 0;
    for (;;) {
      if (exhausted) return exhausted;
      await acquire();
      let result: LarkResourceCommandResult;
      try {
        if (exhausted) return exhausted;
        if (throttled + transient > 0 && commandOptions?.scratchDirectory && commandOptions.cwd !== undefined) {
          await emptyDirectory(commandOptions.cwd);
        }
        result = await runner(args, commandOptions);
      } finally {
        active--;
        wake();
      }
      if (isLarkResourceThrottled(result)) {
        successes = 0;
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        // All queued requests share the cooldown; in-flight requests may finish.
        const wait = Math.max(1000 * 2 ** throttled,
          retryAfter(result.stderr, now()), retryAfter(result.stdout, now()));
        blockedUntil = Math.max(blockedUntil, now() + Math.min(wait, 30_000));
        // Do not retry earlier than a server delay beyond our local retry budget.
        if (throttled >= 3 || wait > 30_000) { exhausted = result; return result; }
        throttled++;
        continue;
      }
      if (isLarkResourceTransient(result)) {
        successes = 0;
        if (transient >= TRANSIENT_RETRIES) return result;
        if (now() - lastTransientCut >= TRANSIENT_CUT_WINDOW_MS) {
          concurrency = Math.max(1, Math.floor(concurrency / 2));
          lastTransientCut = now();
        }
        const base = 1000 * 3 ** transient;
        transient++;
        await sleep(Math.round(base * (0.75 + random() * 0.5)));
        continue;
      }
      if (failureText(result) === undefined && ++successes >= 8) {
        concurrency = Math.min(4, concurrency + 1);
        successes = 0;
      }
      return result;
    }
  };
}

/** A bounded work queue avoids starting one promise per attachment. */
export async function forEachLarkResource<T>(items: readonly T[], visit: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) await visit(items[next++]!);
  }));
}
