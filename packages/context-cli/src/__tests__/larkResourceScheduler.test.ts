import { expect, test } from "bun:test";
import { createLarkResourceScheduler, forEachLarkResource } from "../lib/larkResourceScheduler.js";

const ok = { exitCode: 0, stdout: "{}", stderr: "" };
const limited = { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code: 429 } }) };

test("bounds simultaneous requests and processes each item once", async () => {
  let active = 0, peak = 0;
  const seen: string[] = [];
  const runner = createLarkResourceScheduler(async args => {
    active++; peak = Math.max(peak, active); seen.push(args[0]!);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--; return ok;
  });
  await forEachLarkResource(Array.from({ length: 12 }, (_, i) => String(i)), item => runner([item]).then(() => {}));
  expect(peak).toBe(4);
  expect(new Set(seen).size).toBe(12);
});

test("throttling reduces concurrency and retries unchanged identity after cooldown", async () => {
  let clock = 0, calls = 0, active = 0, peakAfter = 0;
  const waits: number[] = [];
  const runner = createLarkResourceScheduler(async args => {
    expect(args).toEqual(["--as", "bot"]);
    calls++;
    if (calls === 1) return limited;
    active++; peakAfter = Math.max(peakAfter, active);
    await Promise.resolve(); active--; return ok;
  }, { now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; } });
  expect(await runner(["--as", "bot"])).toEqual(ok);
  await Promise.all(Array.from({ length: 4 }, () => runner(["--as", "bot"])));
  expect(waits).toEqual([1000]);
  expect(peakAfter).toBeLessThanOrEqual(2);
});

test("persistent throttling exhausts bounded retries and stops queued downloads", async () => {
  let clock = 0, calls = 0;
  const waits: number[] = [];
  const runner = createLarkResourceScheduler(async () => { calls++; return limited; }, {
    now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; },
  });
  expect(await runner([])).toEqual(limited);
  expect(await runner([])).toEqual(limited);
  expect(calls).toBe(4);
  expect(waits).toEqual([1000, 2000, 4000]);
});

test("honors retry-after and never retries permission or ordinary failures", async () => {
  let clock = 0, calls = 0;
  const runner = createLarkResourceScheduler(async () => ++calls === 1
    ? { ...limited, stderr: JSON.stringify({ error: { code: 429, retry_after: 5 } }) } : ok,
  { now: () => clock, sleep: async ms => { clock += ms; } });
  expect(await runner([])).toEqual(ok);
  expect(clock).toBe(5000);
  for (const code of [400, 403, 500]) {
    let count = 0;
    const failed = { ...limited, stderr: JSON.stringify({ error: { code } }) };
    expect(await createLarkResourceScheduler(async () => { count++; return failed; })([])).toEqual(failed);
    expect(count).toBe(1);
  }
});

test("releases permits after thrown errors", async () => {
  let calls = 0;
  const runner = createLarkResourceScheduler(async () => { if (++calls <= 4) throw new Error("offline"); return ok; });
  await Promise.allSettled(Array.from({ length: 4 }, () => runner([])));
  expect(await runner([])).toEqual(ok);
});

test("long server cooldown stops requests without retrying early", async () => {
  let calls = 0;
  const failure = { ...limited, stderr: JSON.stringify({ error: { code: 429, retry_after: 120 } }) };
  const runner = createLarkResourceScheduler(async () => { calls++; return failure; }, {
    sleep: async () => { throw new Error("must not wait beyond retry budget"); },
  });
  expect(await runner([])).toEqual(failure);
  expect(await runner([])).toEqual(failure);
  expect(calls).toBe(1);
});

test("real resource processing overlaps, deduplicates and retains identity and byte budget", async () => {
  const { writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { materializeLarkResources } = await import("../lib/larkResourceMaterialization.js");
  let active = 0, peak = 0, calls = 0;
  const resources = ["a", "b", "c", "d", "a"].map(token => ({
    kind: "image" as const, locator: `lark:image:${token}`, attributes: { token },
  }));
  const result = await materializeLarkResources({
    identity: "bot", resources,
    policy: { videos: "reference-only", maxBytesPerResource: 10, maxTotalBytes: 9 },
    runner: async (args, options) => {
      expect(args[args.indexOf("--as") + 1]).toBe("bot");
      calls++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      await writeFile(resolve(options!.cwd!, "resource.png"), "data");
      active--; return ok;
    },
  });
  expect(calls).toBe(4);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(4);
  expect(result.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0)).toBeLessThanOrEqual(9);
  expect(result.report.items).toHaveLength(4);
  expect(result.report.items.map(item => item.locator)).toEqual([...new Set(resources.map(item => item.locator))].sort());
});
