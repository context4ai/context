import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectCodeIndexDocuments,
  markdownPathsFromEvidence,
} from "../project/codeIndexDocumentInventory.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("0.6.19 code-index document inventory", () => {
  test("enumerates root and related Markdown while excluding generated dependency trees", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-docs-"));
    roots.push(root);
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Module\n", "utf8");
    await writeFile(join(root, "docs", "index.md"), "# Documentation\n", "utf8");
    await writeFile(join(root, "docs", "operations.md"), "# Operations\n", "utf8");
    await writeFile(join(root, "src", "notes.mdx"), "# Notes\n", "utf8");
    await writeFile(join(root, "node_modules", "dependency", "README.md"), "ignored\n", "utf8");

    const inventory = await inspectCodeIndexDocuments({
      moduleRoot: root,
      modulePrefix: "packages/sample",
      declaredDocuments: ["packages/sample/README.md", "docs/operations.md"],
    });
    expect(inventory.documentTargets).toEqual([
      "packages/sample/README.md",
      "packages/sample/docs/index.md",
      "packages/sample/docs/operations.md",
      "packages/sample/src/notes.mdx",
    ]);
    expect(inventory.rootDocumentTargets).toEqual([
      "packages/sample/README.md",
      "packages/sample/docs/index.md",
    ]);
    expect(inventory.readDocumentTargets).toEqual([
      "packages/sample/README.md",
      "packages/sample/docs/operations.md",
    ]);
  });

  test("extracts legacy Markdown paths from classification evidence", () => {
    expect(markdownPathsFromEvidence([
      "README.md documents the module entry",
      "classified from docs/architecture.mdx and src/index.ts",
    ])).toEqual(["README.md", "docs/architecture.mdx"]);
  });
});
