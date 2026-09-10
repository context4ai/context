export interface DebugPerformanceInput {
  projectRoot: string;
  operation: string;
  durationMs: number;
  outcome: "success" | "error";
  counters?: Readonly<Record<string, number>>;
  data?: Readonly<Record<string, unknown>>;
}

interface PerformanceTotal {
  operation: string;
  count: number;
  duration_ms: number;
  max_duration_ms: number;
  counters: Record<string, number>;
  detail: Record<string, unknown>;
}

/** Fast successful measurements are totals, not thousands of tiny disk writes.
 * Slow/error samples stay immediate, so a stalled command remains diagnosable. */
export class DebugPerformanceSummary {
  private readonly totals = new Map<string, PerformanceTotal>();

  add(input: DebugPerformanceInput): boolean {
    if (input.outcome !== "success" || input.durationMs >= 1_000) return false;
    const detail = Object.fromEntries(["requested_operation", "read_mode", "cache_outcome"]
      .flatMap((key) => input.data?.[key] === undefined ? [] : [[key, input.data[key]]]));
    const key = JSON.stringify([input.operation, detail]);
    if (!this.totals.has(key) && this.totals.size >= 128) return false;
    const total = this.totals.get(key) ?? { operation: input.operation,
      count: 0, duration_ms: 0, max_duration_ms: 0, counters: {}, detail };
    total.count++;
    const duration = Math.max(0, input.durationMs);
    total.duration_ms += duration;
    total.max_duration_ms = Math.max(total.max_duration_ms, duration);
    for (const [name, value] of Object.entries(input.counters ?? {})) {
      total.counters[name] = (total.counters[name] ?? 0) + value;
    }
    // Lock hold time includes the operation; acquisition time identifies actual
    // contention. Do not lose that distinction when summarizing fast locks.
    if (typeof input.data?.acquire_duration_ms === "number") {
      total.counters.acquire_duration_ms = (total.counters.acquire_duration_ms ?? 0) + input.data.acquire_duration_ms;
    }
    this.totals.set(key, total);
    return true;
  }

  snapshot() {
    return [...this.totals.values()].map((value) => ({ ...value,
      duration_ms: Math.round(value.duration_ms * 1_000) / 1_000,
      max_duration_ms: Math.round(value.max_duration_ms * 1_000) / 1_000,
    }));
  }
}
