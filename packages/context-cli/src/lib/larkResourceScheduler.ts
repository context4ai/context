import { setTimeout as delay } from "node:timers/promises";
import type { LarkResourceCommandResult, LarkResourceCommandRunner } from "./larkResourceCommand.js";

/** Only structured throttling signals qualify; ordinary permission/400 errors do not. */
function throttle(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null) return false;
  if (typeof value === "string") {
    const start = value.indexOf("{");
    if (start < 0) return false;
    try { return throttle(JSON.parse(value.slice(start)), depth + 1); } catch { return false; }
  }
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if ([record.code, record.status, record.status_code].some((code) => String(code) === "429") ||
      record.type === "rate_limit" || record.subtype === "rate_limited") return true;
  return [record.error, record.message, record.cause].some((entry) => throttle(entry, depth + 1));
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

/** Shared by one capture. No identity changes, user prompts, or unbounded retries. */
export function createLarkResourceScheduler(runner: LarkResourceCommandRunner, options: {
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
} = {}): LarkResourceCommandRunner {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  let concurrency = 4;
  let active = 0;
  let blockedUntil = 0;
  let successes = 0;
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
    for (let attempt = 0; ; attempt++) {
      if (exhausted) return exhausted;
      await acquire();
      try {
        if (exhausted) return exhausted;
        const result = await runner(args, commandOptions);
        if (!isLarkResourceThrottled(result)) {
          if (result.exitCode === 0 && ++successes >= 8) {
            concurrency = Math.min(4, concurrency + 1);
            successes = 0;
          }
          return result;
        }
        successes = 0;
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        // All queued requests share the cooldown; in-flight requests may finish.
        const wait = Math.max(1000 * 2 ** attempt,
          retryAfter(result.stderr, now()), retryAfter(result.stdout, now()));
        blockedUntil = Math.max(blockedUntil, now() + Math.min(wait, 30_000));
        // Do not retry earlier than a server delay beyond our local retry budget.
        if (attempt >= 3 || wait > 30_000) { exhausted = result; return result; }
      } finally {
        active--;
        wake();
      }
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
