import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { collectPackageFreshness } from "../project/packageBuilder.js";
import { initContextProject } from "../project/workspace.js";

describe("0.7.4 package freshness recovery", () => {
  test("treats a partial stale output with broken links as rebuildable", async () => {
    const parent = await mkdtemp(join(tmpdir(), "context-package-freshness-v074-"));
    try {
      const initialized = await initContextProject({
        cwd: parent,
        projectDir: "kb",
        dev: true,
      });
      const pkg = {
        kind: "package.kb",
        name: "example-kb",
        outDir: "dist/example-kb",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb", vars: {} },
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
      } as PackageDefinition;
      const partialOutput = join(
        initialized.projectRoot,
        pkg.outDir,
        "wikis",
        "index.md",
      );
      await mkdir(join(partialOutput, ".."), { recursive: true });
      await writeFile(
        partialOutput,
        "# Partial output\n\n[Missing page](./missing.md)\n",
        "utf8",
      );

      await expect(collectPackageFreshness(initialized.projectRoot, [pkg]))
        .resolves.toEqual([expect.objectContaining({
          name: pkg.name,
          state: "stale",
          outputFiles: 1,
        })]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
