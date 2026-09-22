import type { Writable } from "node:stream";

/** A closed or congested progress consumer must not affect source registration. */
export function createSourceProgressSink(stream: Writable): {
  write(value: Record<string, unknown>): void;
  close(): void;
} {
  let failed = false;
  let finished = false;
  let pending = 0;
  let cleanupScheduled = false;
  const unavailable = () => { failed = true; };
  const cleanup = () => {
    if (!finished || pending !== 0 || cleanupScheduled) return;
    cleanupScheduled = true;
    // Writable calls its write callback before emitting some asynchronous
    // errors. Keep our listener until those events have had a turn to fire.
    setImmediate(() => {
      cleanupScheduled = false;
      if (!finished || pending !== 0) return;
      stream.off("error", unavailable);
      stream.off("close", unavailable);
    });
  };
  stream.on("error", unavailable);
  stream.on("close", unavailable);
  return {
    write(value) {
      if (finished || failed || stream.destroyed || stream.writableEnded || stream.writableNeedDrain) return;
      let settled = false;
      const done = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        pending -= 1;
        if (error !== undefined && error !== null) failed = true;
        cleanup();
      };
      pending += 1;
      try {
        stream.write(`${JSON.stringify({ kind: "source.operation.progress", ...value })}\n`, done);
      } catch {
        failed = true;
        done();
      }
    },
    close() {
      finished = true;
      cleanup();
    },
  };
}

/** Scoped cancellation and optional progress for source operations only. */
export async function withSourceOperationRuntime<T>(
  progress: boolean,
  run: (runtime: { signal: AbortSignal; report: (value: Record<string, unknown>) => void }) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const sink = progress ? createSourceProgressSink(process.stderr) : undefined;
  let latest: Record<string, unknown> | undefined;
  let lastWritten = 0;
  let firstSignal: "SIGINT" | "SIGTERM" | undefined;
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  const clearSignalHandlers = () => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    if (terminationTimer !== undefined) clearTimeout(terminationTimer);
  };
  const forceTermination = () => {
    clearSignalHandlers();
    // Restore the original termination behavior, including an embedding host's
    // handlers. A forced interruption may still need normal task lock recovery.
    if (firstSignal !== undefined) process.kill(process.pid, firstSignal);
  };
  const stop = (signal: "SIGINT" | "SIGTERM") => {
    if (firstSignal !== undefined) {
      forceTermination();
      return;
    }
    firstSignal = signal;
    terminationTimer = setTimeout(forceTermination, 5_000);
    terminationTimer.unref();
    controller.abort();
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  const writeProgress = () => {
    if (sink === undefined || latest === undefined) return;
    sink.write(latest);
    lastWritten = Date.now();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const heartbeat = progress ? setInterval(writeProgress, 5_000) : undefined;
  heartbeat?.unref();
  try {
    return await run({
      signal: controller.signal,
      report(value) {
        latest = value;
        if (lastWritten === 0 || Date.now() - lastWritten >= 1_000 ||
            value.phase === "completed" || value.phase === "failed" || value.phase === "interrupted") {
          writeProgress();
        }
      },
    });
  } finally {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    sink?.close();
    clearSignalHandlers();
  }
}
