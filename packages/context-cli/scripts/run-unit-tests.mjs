#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testsRoot = join(packageRoot, "src", "__tests__");
const exactTests = new Set([
  "caseStudyReplay.test.ts",
  "cli.test.ts",
  "okfTypes.test.ts",
  "pathFreeContractInventory.test.ts",
  "proseAlignBudget.test.ts",
  "sectionContentDigest.test.ts",
]);
const selectedPatterns = [
  /^document.*V062\.test\.ts$/u,
  /^plugin.*\.test\.ts$/u,
  /^project.*\.test\.ts$/u,
];
const chunkSize = 32;

function selectedTest(name) {
  return exactTests.has(name) || selectedPatterns.some((pattern) => pattern.test(name));
}

async function runChunk(files, index, total, forwardedArgs) {
  process.stdout.write(`Context CLI unit-test chunk ${index}/${total} (${files.length} files)\n`);
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
const tests = (await readdir(testsRoot))
  .filter(selectedTest)
  .sort((left, right) => left.localeCompare(right));
if (tests.length === 0) throw new Error(`no Context CLI unit tests found under ${testsRoot}`);

const chunks = [];
for (let index = 0; index < tests.length; index += chunkSize) {
  chunks.push(tests.slice(index, index + chunkSize));
}
for (const [index, files] of chunks.entries()) {
  await runChunk(files, index + 1, chunks.length, forwardedArgs);
}
