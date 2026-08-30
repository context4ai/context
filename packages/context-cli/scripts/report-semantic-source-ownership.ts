#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertSemanticSourceOwnership } from
  "../src/project/semanticSourceOwnership.js";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const outputFlag = process.argv.indexOf("--output");
const outputPath = outputFlag >= 0 && process.argv[outputFlag + 1] !== undefined
  ? resolve(process.cwd(), process.argv[outputFlag + 1]!)
  : resolve(repositoryRoot, ".tmp", "semantic-source-ownership-report.json");

const report = await assertSemanticSourceOwnership({ repositoryRoot });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  schema: report.schema,
  mode: report.mode,
  output: outputPath.startsWith(repositoryRoot)
    ? outputPath.slice(repositoryRoot.length + 1)
    : outputPath,
  summary: report.summary,
  blocking_eligible: report.blocking_eligible,
  blocking_reasons: report.blocking_reasons,
}, null, 2)}\n`);
