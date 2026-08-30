import { describe, expect, test } from "bun:test";
import { validateIndexerProgramStaticSource } from
  "../project/indexerProgramStaticValidation.js";

describe("Indexer program static capability validation", () => {
  test("accepts structured JSON IPC and deterministic hashing", () => {
    expect(() => validateIndexerProgramStaticSource({
      path: "scripts/index.mjs",
      source: [
        'import { createHash } from "node:crypto";',
        "const chunks = [];",
        "for await (const chunk of process.stdin) chunks.push(chunk);",
        "const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
        "process.stdout.write(JSON.stringify({ request, digest: createHash('sha256').update('ok').digest('hex') }));",
      ].join("\n"),
    })).not.toThrow();
  });

  test("rejects explicit filesystem, process, network, and dynamic-code capabilities", () => {
    const cases = [{
      source: 'import { writeFile } from "node:fs/promises";',
      reason: "forbidden module node:fs/promises",
    }, {
      source: 'const { spawn } = require("child_process");',
      reason: "forbidden module child_process",
    }, {
      source: "const token = process.env.TOKEN;",
      reason: "forbidden environment access",
    }, {
      source: "const response = await fetch('https://example.invalid');",
      reason: "forbidden network access",
    }, {
      source: "const module = await import(request.module);",
      reason: "forbidden dynamic import",
    }, {
      source: "writeFile('/tmp/result', payload);",
      reason: "forbidden filesystem mutation",
    }];
    for (const item of cases) {
      expect(() => validateIndexerProgramStaticSource({
        path: "scripts/index.mjs",
        source: item.source,
      })).toThrow(item.reason);
    }
  });
});
