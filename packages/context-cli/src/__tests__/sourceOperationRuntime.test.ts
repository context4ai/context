import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { createSourceProgressSink, withSourceOperationRuntime } from "../project/sourceOperationRuntime.js";

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function terminateStalledOperation(secondSignal: boolean): Promise<{ signal: string | null; elapsed: number }> {
  const modulePath = new URL("../project/sourceOperationRuntime.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--eval", `
    import { withSourceOperationRuntime } from ${JSON.stringify(modulePath)};
    await withSourceOperationRuntime(false, async () => {
      setInterval(() => {}, 1000);
      process.stdout.write("ready\\n");
      await new Promise(() => {});
    });
  `], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let started: number | undefined;
    let additionalSignal: ReturnType<typeof setTimeout> | undefined;
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    const deadline = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`stalled operation did not terminate: ${stderr}`)); }, 12_000);
    child.stdout.on("data", chunk => {
      if (started !== undefined || !chunk.toString().includes("ready")) return;
      started = Date.now();
      child.kill("SIGTERM");
      if (secondSignal) additionalSignal = setTimeout(() => { child.kill("SIGINT"); }, 50);
    });
    child.on("error", error => {
      clearTimeout(deadline);
      if (additionalSignal !== undefined) clearTimeout(additionalSignal);
      reject(error);
    });
    child.on("close", (_code, signal) => {
      clearTimeout(deadline);
      if (additionalSignal !== undefined) clearTimeout(additionalSignal);
      if (started === undefined) reject(new Error(`stalled operation never started: ${stderr}`));
      else resolve({ signal, elapsed: Date.now() - started });
    });
  });
}

describe("source operation progress transport", () => {
  test("writes JSON progress and removes only its own stream listeners", async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _encoding, done) { lines.push(chunk.toString()); done(); } });
    const existingErrorHandler = () => undefined;
    stream.on("error", existingErrorHandler);
    const sink = createSourceProgressSink(stream);
    sink.write({ phase: "running", committed_count: 10, total: 100 });
    sink.close();
    // A synchronous _write completion may defer the public write callback.
    // Confirm all writes have settled before observing deferred listener cleanup.
    await new Promise<void>((resolve) => stream.end(resolve));
    await nextTurn();
    expect(lines.map(line => JSON.parse(line))).toEqual([
      { kind: "source.operation.progress", phase: "running", committed_count: 10, total: 100 },
    ]);
    expect(stream.listeners("error")).toEqual([existingErrorHandler]);
    expect(stream.listenerCount("close")).toBe(0);
    stream.destroy();
  });

  test("an asynchronous EPIPE after close does not escape as an unhandled stream error", async () => {
    let complete: ((error?: Error | null) => void) | undefined;
    const stream = new Writable({ write(_chunk, _encoding, done) { complete = done; } });
    const sink = createSourceProgressSink(stream);
    sink.write({ phase: "running", committed_count: 0, total: 100 });
    sink.close();
    expect(stream.listenerCount("error")).toBe(1);
    const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    complete!(error);
    await nextTurn();
    await nextTurn();
    expect(stream.destroyed).toBe(true);
    expect(stream.listenerCount("error")).toBe(0);
    expect(stream.listenerCount("close")).toBe(0);
  });

  test("backpressure drops heartbeats and close returns without waiting for drain", async () => {
    let writes = 0;
    let complete: (() => void) | undefined;
    const stream = new Writable({ highWaterMark: 1, write(_chunk, _encoding, done) { writes += 1; complete = done; } });
    const sink = createSourceProgressSink(stream);
    sink.write({ phase: "running", committed_count: 1, total: 100 });
    const buffered = stream.writableLength;
    for (let index = 2; index < 100; index += 1) sink.write({ phase: "running", committed_count: index, total: 100 });
    expect(writes).toBe(1);
    expect(stream.writableLength).toBe(buffered);
    expect(sink.close()).toBeUndefined();
    sink.write({ phase: "completed", committed_count: 100, total: 100 });
    expect(stream.writableLength).toBe(buffered);
    complete!();
    await nextTurn();
    expect(stream.listenerCount("error")).toBe(0);
    stream.destroy();
  });

  test("a drain allows later progress again without replaying dropped messages", async () => {
    const phases: string[] = [];
    let complete: (() => void) | undefined;
    const stream = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
      phases.push(JSON.parse(chunk.toString()).phase);
      complete = done;
    } });
    const sink = createSourceProgressSink(stream);
    sink.write({ phase: "running" });
    sink.write({ phase: "intermediate" });
    complete!();
    await nextTurn();
    sink.write({ phase: "completed" });
    complete!();
    sink.close();
    await nextTurn();
    expect(phases).toEqual(["running", "completed"]);
    stream.destroy();
  });

  test("synchronous failures and already closed streams are ignored", async () => {
    const stream = new Writable({ write(_chunk, _encoding, done) { done(); } });
    stream.write = () => { throw new Error("consumer unavailable"); };
    const sink = createSourceProgressSink(stream);
    expect(() => sink.write({ phase: "running" })).not.toThrow();
    sink.close();
    await nextTurn();
    expect(stream.listenerCount("error")).toBe(0);
    stream.destroy();
    const closedSink = createSourceProgressSink(stream);
    expect(() => closedSink.write({ phase: "completed" })).not.toThrow();
    closedSink.close();
    await nextTurn();
    expect(stream.listenerCount("error")).toBe(0);
  });

  test("runtime preserves operation results/errors and restores signal handlers", async () => {
    const before = { interrupt: process.listenerCount("SIGINT"), terminate: process.listenerCount("SIGTERM") };
    const value = await withSourceOperationRuntime(false, async ({ report, signal }) => {
      report({ phase: "completed", committed_count: 2, total: 2 });
      expect(signal.aborted).toBe(false);
      return "registered";
    });
    expect(value).toBe("registered");
    const original = new Error("registration failed");
    await expect(withSourceOperationRuntime(false, async () => { throw original; })).rejects.toBe(original);
    expect(process.listenerCount("SIGINT")).toBe(before.interrupt);
    expect(process.listenerCount("SIGTERM")).toBe(before.terminate);
  });

  test("a second cancellation signal restores termination without waiting for the stalled operation", async () => {
    const result = await terminateStalledOperation(true);
    expect(result.signal).toBe("SIGTERM");
    expect(result.elapsed).toBeLessThan(3_000);
  }, 15_000);

  test("the cancellation grace expires even if a child operation never cooperates", async () => {
    const result = await terminateStalledOperation(false);
    expect(result.signal).toBe("SIGTERM");
    expect(result.elapsed).toBeGreaterThanOrEqual(4_800);
    expect(result.elapsed).toBeLessThan(10_000);
  }, 15_000);
});
