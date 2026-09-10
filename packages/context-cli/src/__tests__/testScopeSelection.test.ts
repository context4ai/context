import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../../scripts/run-unit-tests.mjs", import.meta.url));
function list(...args: string[]): string[] {
  return execFileSync(process.execPath, [runner, ...args, "--list"], {
    encoding: "utf8", env: { ...process.env, CONTEXT_TEST_SHARD: "1/1" },
  }).trim().split("\n");
}

test("default and full-only are disjoint and together cover every discovered test", () => {
  const light = list();
  const heavy = list("--full-only");
  const full = list("--full");
  const discovered = readdirSync(fileURLToPath(new URL("./", import.meta.url)), { recursive: true })
    .filter((file): file is string => typeof file === "string" && /\.test\.tsx?$/u.test(file));
  expect(light.length).toBeGreaterThan(0);
  expect(heavy.length).toBeGreaterThan(0);
  expect(light.filter(file => heavy.includes(file))).toEqual([]);
  expect([...light, ...heavy].sort()).toEqual(full.slice().sort());
  expect(full.slice().sort()).toEqual(discovered.sort());
  const manifest = JSON.parse(readFileSync(new URL("../../scripts/full-only-tests.json", import.meta.url), "utf8"));
  expect(heavy.slice().sort()).toEqual(manifest.sort());
});

test("conflicting scopes fail instead of silently choosing less coverage", () => {
  expect(spawnSync(process.execPath, [runner, "--full", "--full-only", "--list"]).status).not.toBe(0);
});

test("four shards cover each scope exactly once, including newly discovered files", () => {
  for (const args of [[], ["--full"], ["--full-only"]]) {
    const shards = [1, 2, 3, 4].flatMap(index => execFileSync(process.execPath,
      [runner, ...args, "--list"], {
        encoding: "utf8", env: { ...process.env, CONTEXT_TEST_SHARD: `${index}/4` },
      }).trim().split("\n").filter(Boolean));
    expect(shards.slice().sort()).toEqual(list(...args).sort());
    expect(new Set(shards).size).toBe(shards.length);
  }
});

test("invalid shard coordinates fail closed", () => {
  for (const value of ["0/4", "5/4", "1/0", "bad", "1/2.5"]) {
    expect(spawnSync(process.execPath, [runner, "--list"], {
      env: { ...process.env, CONTEXT_TEST_SHARD: value },
    }).status).not.toBe(0);
  }
});
