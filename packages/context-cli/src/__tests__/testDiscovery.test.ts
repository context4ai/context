import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("the standard CLI test entry discovers every test in its test directory", async () => {
  const expected = (await readdir(fileURLToPath(new URL(".", import.meta.url)), { recursive: true }))
    .filter(name => /\.test\.tsx?$/u.test(name)).sort();
  const listed = execFileSync(process.execPath,
    [fileURLToPath(new URL("../../scripts/run-unit-tests.mjs", import.meta.url)), "--list"],
    { encoding: "utf8" }).trim().split("\n").sort();
  expect(listed).toEqual(expected);
});
