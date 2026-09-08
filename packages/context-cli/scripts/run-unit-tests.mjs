#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testsRoot = join(packageRoot, "src", "__tests__");
const isolatedTests = new Set([
  "projectCompileProseV066Evidence.test.ts",
  "projectIndexerProviderDispatcherV070.test.ts",
]);
const chunkSize = 32;

function selectedTest(name) {
  return /\.test\.tsx?$/u.test(name);
}

async function runChunk(files, index, total, forwardedArgs) {
  const started = performance.now();
  process.stdout.write(`Context CLI test chunk ${index}/${total} (${files.length} files)\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "test",
      ...forwardedArgs,
      ...files.map((name) => join(testsRoot, name)),
    ], {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.stdout.write(
        `Context CLI test chunk ${index}/${total}: ${(performance.now() - started).toFixed(0)}ms` +
        ` · exit ${String(code)}${signal === null ? "" : ` · signal ${signal}`}\n`,
      );
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Context CLI unit-test chunk ${index}/${total} failed` +
        (signal === null ? ` with exit code ${String(code)}` : ` from signal ${signal}`),
      ));
    });
  });
}

const forwardedArgs = process.argv.slice(2);
const tests = (await readdir(testsRoot, { recursive: true }))
  .filter(selectedTest)
  .sort((left, right) => left.localeCompare(right));
if (tests.length === 0) throw new Error(`no Context CLI unit tests found under ${testsRoot}`);
if (forwardedArgs.includes("--list")) {
  process.stdout.write(`${tests.join("\n")}\n`);
  process.exit(0);
}

const chunks = [];
const sharedProcessTests = tests.filter((name) => !isolatedTests.has(name));
for (let index = 0; index < sharedProcessTests.length; index += chunkSize) {
  chunks.push(sharedProcessTests.slice(index, index + chunkSize));
}
chunks.push(...tests.filter((name) => isolatedTests.has(name)).map((name) => [name]));
const failures = [];
for (const [index, files] of chunks.entries()) {
  try {
    await runChunk(files, index + 1, chunks.length, forwardedArgs);
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length > 0) {
  throw new AggregateError(failures, `${failures.length} Context CLI unit-test chunks failed`);
}
