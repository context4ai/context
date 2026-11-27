import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLarkResourceScheduler, isLarkResourceTransient } from "../lib/larkResourceScheduler.js";
import { materializeLarkResources, type LarkResourceCommandRunner } from "../lib/larkResourceMaterialization.js";
import { assertSnapshotResourcePolicy, normalizedSnapshotResourcePolicy, type ImportedLarkSnapshot } from "../project/larkSnapshotBundle.js";

const ok = { exitCode: 0, stdout: "{}", stderr: "" };
const gateway = { exitCode: 1, stdout: "", stderr: "HTTP 504 Gateway Timeout" };
const policy = { videos: "reference-only" as const, maxBytesPerResource: 1024, maxTotalBytes: 4096 };

test("classifies gateway errors, timeouts and dropped connections as transient", () => {
  for (const stderr of ["HTTP 504 Gateway Timeout", "502 Bad Gateway", "context deadline exceeded", "read: connection reset by peer",
    "lark-cli docs +media-download timed out after 120 s", JSON.stringify({ ok: false, error: { code: 503 } }),
    'Get "https://open.example/media": context canceled (Client.Timeout exceeded while awaiting headers)',
    "net/http: request canceled (Client.Timeout or context cancellation while reading body)", "408 Request Timeout"]) {
    expect(isLarkResourceTransient({ exitCode: 1, stdout: "", stderr })).toBe(true);
  }
  expect(isLarkResourceTransient({ exitCode: null, stdout: "", stderr: "" })).toBe(true);
  expect(isLarkResourceTransient({ exitCode: 0, stdout: JSON.stringify({ ok: false, error: { code: 504 } }), stderr: "" })).toBe(true);
  for (const stderr of [JSON.stringify({ error: { code: 403 } }), JSON.stringify({ error: { code: 500 } }), "invalid parameter",
    JSON.stringify({ error: { code: 429 } })]) {
    expect(isLarkResourceTransient({ exitCode: 1, stdout: "", stderr })).toBe(false);
  }
  // A structured permanent error is final even when its message or log id contains 503, timeout or EOF.
  expect(isLarkResourceTransient({ exitCode: 1, stdout: "", stderr: JSON.stringify({ ok: false, error: {
    code: 403, type: "authorization", subtype: "permission_denied", message: "no access to report_504.pdf after timeout", log_id: "20261127-503-abc" } }) })).toBe(false);
  expect(isLarkResourceTransient({ exitCode: 1, stdout: "", stderr: "cannot open report_504.pdf" })).toBe(false);
  // Successful output is content, not an error: a sheet may contain the word "timeout".
  expect(isLarkResourceTransient({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: "timeout 504" }), stderr: "" })).toBe(false);
});

test("the docs throttle code 99991400 cools down like 429", async () => {
  let clock = 0, calls = 0;
  const waits: number[] = [];
  const runner = createLarkResourceScheduler(async () => ++calls === 1
    ? { exitCode: 1, stdout: "", stderr: JSON.stringify({ ok: false, error: { code: 99991400, message: "frequency limit" } }) } : ok,
  { now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; } });
  expect(await runner([])).toEqual(ok);
  expect(waits).toEqual([1000]);
});

test("a transient failure retries only its own request with growing waits and never stops the others", async () => {
  const waits: number[] = [];
  const calls = new Map<string, number>();
  const runner = createLarkResourceScheduler(async args => {
    const key = args[0]!;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return key === "bad" ? gateway : ok;
  }, { sleep: async ms => { waits.push(ms); }, random: () => 0.5 });
  expect(await runner(["bad"])).toEqual(gateway);
  expect(waits).toEqual([1000, 3000, 9000]);
  expect(calls.get("bad")).toBe(4);
  expect(await Promise.all(["a", "b", "c"].map(key => runner([key])))).toEqual([ok, ok, ok]);
});

test("a request that recovers on retry succeeds", async () => {
  let calls = 0;
  const runner = createLarkResourceScheduler(async () => ++calls === 1 ? gateway : ok, { sleep: async () => {} });
  expect(await runner([])).toEqual(ok);
  expect(calls).toBe(2);
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test("waiting for a retry does not hold a concurrency slot, and one wave of failures halves concurrency once", async () => {
  const allStarted = deferred(), allWaiting = deferred(), backoff = deferred(), second = deferred();
  let started = 0, waiting = 0, active = 0;
  const failing = new Set(["1", "2", "3", "4"]);
  const runner = createLarkResourceScheduler(async args => {
    const key = args[0]!;
    if (failing.delete(key)) {
      if (++started === 4) allStarted.resolve();
      await allStarted.promise;
      return gateway;
    }
    if (Number(key) > 4) { active++; await second.promise; active--; }
    return ok;
  }, { now: () => 0, random: () => 0.5, sleep: async () => { if (++waiting === 4) allWaiting.resolve(); await backoff.promise; } });
  const first = ["1", "2", "3", "4"].map(key => runner([key]));
  await allWaiting.promise;
  // All four failed and wait without slots; concurrency is 2 after one wave, not 1.
  const next = ["5", "6", "7", "8"].map(key => runner([key]));
  for (let index = 0; index < 5; index++) await turn();
  expect(active).toBe(2);
  second.resolve();
  expect(await Promise.all(next)).toEqual([ok, ok, ok, ok]);
  backoff.resolve();
  expect(await Promise.all(first)).toEqual([ok, ok, ok, ok]);
});

test("a retry starts from an empty scratch directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-scratch-"));
  try {
    const seen: string[][] = [];
    let calls = 0;
    const runner = createLarkResourceScheduler(async (_args, options) => {
      seen.push(await readdir(options!.cwd!));
      await writeFile(join(options!.cwd!, `partial-${++calls}`), "x");
      return calls === 1 ? gateway : ok;
    }, { sleep: async () => {} });
    await runner([], { cwd: directory, scratchDirectory: true });
    expect(seen).toEqual([[], []]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a non-scratch working directory is never emptied", async () => {
  const directory = await mkdtemp(join(tmpdir(), "context-shared-"));
  try {
    await writeFile(join(directory, "keep"), "x");
    let calls = 0;
    const runner = createLarkResourceScheduler(async () => ++calls === 1 ? gateway : ok, { sleep: async () => {} });
    await runner([], { cwd: directory });
    expect(await readdir(directory)).toEqual(["keep"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function mediaRunner(seen: { args: string[]; timeoutMs?: number }[]): LarkResourceCommandRunner {
  return async (args, options) => {
    seen.push({ args, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
    if (args.includes("+media-download")) await writeFile(resolve(options!.cwd!, "resource.png"), "data");
    return ok;
  };
}

test("each resource request has a per-process time limit by kind", async () => {
  const seen: { args: string[]; timeoutMs?: number }[] = [];
  await materializeLarkResources({ identity: "bot", policy, runner: mediaRunner(seen), resources: [
    { kind: "image", locator: "lark:image:a", attributes: { token: "a" } },
    { kind: "file", locator: "lark:file:b", attributes: { token: "b" } },
  ] });
  const limit = (token: string) => seen.find(call => call.args.includes(token))?.timeoutMs;
  expect(limit("a")).toBe(120_000);
  expect(limit("b")).toBe(300_000);
});

test("files and whiteboards excluded by policy keep placeholders without any request", async () => {
  const seen: { args: string[] }[] = [];
  const result = await materializeLarkResources({ identity: "bot", runner: mediaRunner(seen),
    policy: { ...policy, files: "reference-only", whiteboards: "reference-only" }, resources: [
      { kind: "file", locator: "lark:file:b", attributes: { token: "b" }, title: "Plan.pdf" },
      { kind: "whiteboard", locator: "lark:whiteboard:w", attributes: { token: "w" } },
      { kind: "diagram", locator: "lark:diagram:d", attributes: { token: "d" } },
      { kind: "diagram", locator: "lark:diagram:inline", attributes: {}, inline_content: true },
    ] });
  expect(seen).toEqual([]);
  expect(result.report.status).toBe("complete");
  expect(result.report.items.map(item => [item.kind, item.status, item.reason_code])).toEqual([
    ["diagram", "reference-only", "whiteboard-excluded-by-policy"],
    ["diagram", "materialized", undefined],
    ["file", "reference-only", "file-excluded-by-policy"],
    ["whiteboard", "reference-only", "whiteboard-excluded-by-policy"],
  ]);
  expect(result.replacements.get("lark:file:b")).toContain("File omitted: Plan.pdf");
});

test("reused images keep their representation and still count toward the byte budget", async () => {
  const seen: { args: string[] }[] = [];
  const result = await materializeLarkResources({ identity: "bot", runner: mediaRunner(seen),
    policy: { ...policy, maxTotalBytes: 6 },
    reuse: async resource => resource.locator === "lark:image:a"
      ? { path: "assets/materialized/image/old.jpg", bytes: Buffer.from("small"), mediaType: "image/jpeg", representation: "preview" }
      : undefined,
    resources: [
      { kind: "image", locator: "lark:image:a", attributes: { token: "a" } },
      { kind: "image", locator: "lark:image:b", attributes: { token: "b" } },
    ] });
  expect(seen.map(call => call.args[call.args.indexOf("--token") + 1])).toEqual(["b"]);
  const [a, b] = result.report.items;
  expect(a).toMatchObject({ status: "materialized", reason_code: "document.resource.preview" });
  expect(a?.asset_paths[0]).toEndWith(".jpg");
  // 5 reused bytes + 4 downloaded exceed the 6-byte budget.
  expect(b).toMatchObject({ status: "reference-only", reason_code: "image-budget-exceeded" });
});

test("synced blocks are read through the scheduled runner", async () => {
  let received: LarkResourceCommandRunner | undefined;
  const raw: LarkResourceCommandRunner = async () => ok;
  await materializeLarkResources({ identity: "bot", policy, runner: raw,
    resources: [{ kind: "synced-reference", locator: "lark:synced:s", attributes: {} }],
    resolveSyncedReference: async (_resource, runner) => { received = runner; return { markdown: "Synced", resources: [] }; } });
  expect(received).toBeDefined();
  expect(received).not.toBe(raw);
});

test("snapshots without file or whiteboard settings match the default policy", () => {
  const snapshot = (resourcePolicy: object) => ({ resourcePolicy }) as unknown as ImportedLarkSnapshot;
  const earlier = { images: "bundle", gifs: "bundle", videos: "reference-only", maxBytesPerResource: 1024, maxTotalBytes: 4096 };
  expect(() => assertSnapshotResourcePolicy(snapshot(earlier), policy)).not.toThrow();
  expect(() => assertSnapshotResourcePolicy(snapshot(earlier), { ...policy, files: "bundle", whiteboards: "bundle" })).not.toThrow();
  expect(() => assertSnapshotResourcePolicy(snapshot(earlier), { ...policy, files: "reference-only" })).toThrow("different resource policy");
  expect(normalizedSnapshotResourcePolicy({ ...policy, whiteboards: "bundle" })).toEqual({ ...policy, images: "bundle", gifs: "bundle" });
});


test("previously saved resources take the budget before new downloads", async () => {
  const seen: { args: string[] }[] = [];
  const saved = new Set(["lark:image:c", "lark:image:d"]);
  const result = await materializeLarkResources({ identity: "bot", runner: mediaRunner(seen),
    policy: { ...policy, maxTotalBytes: 10 },
    reuse: async resource => saved.has(resource.locator)
      ? { path: `assets/materialized/image/${resource.locator.slice(-1)}.png`, bytes: Buffer.from("saved"), mediaType: "image/png", representation: "original" }
      : undefined,
    resources: ["a", "b", "c", "d"].map(token => ({ kind: "image" as const, locator: `lark:image:${token}`, attributes: { token } })) });
  const status = Object.fromEntries(result.report.items.map(item => [item.locator.slice(-1), item.reason_code ?? item.status]));
  expect(status).toEqual({ a: "image-budget-exceeded", b: "image-budget-exceeded", c: "materialized", d: "materialized" });
});

test("the process runner ends a timed-out command and its children, and reports a timeout", async () => {
  if (process.platform === "win32") return;
  // Some hosts mount the system temporary directory without execute permission.
  await mkdir(resolve(import.meta.dir, "../../.tmp"), { recursive: true });
  const directory = await mkdtemp(resolve(import.meta.dir, "../../.tmp/context-timeout-"));
  const previous = process.env.CONTEXT_LARK_CLI_BIN;
  try {
    const pidFile = join(directory, "child.pid");
    const script = join(directory, "slow-lark.sh");
    await writeFile(script, `#!/bin/sh\nif [ "$1" = quick ]; then echo done; exit 0; fi\nsleep 30 &\necho $! > ${JSON.stringify(pidFile)}\nwait\n`, { mode: 0o700 });
    process.env.CONTEXT_LARK_CLI_BIN = script;
    const { runLarkCommand } = await import("../lib/feishu.js");
    expect(await runLarkCommand(["quick"])).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
    const result = await runLarkCommand(["docs", "+media-download"], { timeoutMs: 500 });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("timed out");
    expect(isLarkResourceTransient(result)).toBe(true);
    const child = Number((await readFile(pidFile, "utf8")).trim());
    await turn();
    expect(() => process.kill(child, 0)).toThrow();
  } finally {
    if (previous === undefined) delete process.env.CONTEXT_LARK_CLI_BIN; else process.env.CONTEXT_LARK_CLI_BIN = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("resources kept as references never read earlier bytes, and synced-block media can be reused", async () => {
  const looked: string[] = [];
  const seen: { args: string[] }[] = [];
  const reuse = async (resource: { locator: string }) => {
    looked.push(resource.locator);
    return resource.locator === "lark:image:nested"
      ? { path: "assets/materialized/image/nested.png", bytes: Buffer.from("saved"), mediaType: "image/png", representation: "original" as const }
      : undefined;
  };
  await materializeLarkResources({ identity: "bot", runner: mediaRunner(seen), reuse,
    policy: { ...policy, images: "reference-only", files: "reference-only" },
    resources: [{ kind: "image", locator: "lark:image:a", attributes: { token: "a" } }, { kind: "file", locator: "lark:file:b", attributes: { token: "b" } }] });
  expect(looked).toEqual([]);
  const result = await materializeLarkResources({ identity: "bot", runner: mediaRunner(seen), reuse, policy,
    resources: [{ kind: "synced-reference", locator: "lark:synced:s", attributes: {} }],
    resolveSyncedReference: async () => ({ markdown: "Synced", resources: [{ kind: "image", locator: "lark:image:nested", attributes: { token: "nested" } }] }) });
  expect(seen).toEqual([]);
  expect(result.report.items.find(item => item.locator === "lark:image:nested")).toMatchObject({ status: "materialized" });
});

test("images the earlier capture skipped for budget are not downloaded again", async () => {
  const seen: { args: string[] }[] = [];
  const result = await materializeLarkResources({ identity: "bot", runner: mediaRunner(seen), policy,
    budgetExcluded: new Set(["lark:image:big"]),
    resources: [{ kind: "image", locator: "lark:image:big", attributes: { token: "big" } }, { kind: "image", locator: "lark:image:small", attributes: { token: "small" } }] });
  expect(seen.map(call => call.args[call.args.indexOf("--token") + 1])).toEqual(["small"]);
  expect(result.report.items.find(item => item.locator === "lark:image:big")).toMatchObject({ status: "reference-only", reason_code: "image-budget-exceeded" });
});
