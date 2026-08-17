import { PackageKind, SymbolKind, Visibility } from "@c4a/core";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntryFile, ExtractionPlugin, SourceInfo } from "../protocol.js";
import { runRepositoryExtraction } from "../repository.js";

const createTempRepo = async () => mkdtemp(join(tmpdir(), "c4a-extract-repo-"));

const writeText = async (root: string, relPath: string, content: string) => {
  const fullPath = join(root, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
};

const createFixturePlugin = (detectedEntries: EntryFile[] = [
  { path: "src/Button.ts", subpath: "src/Button.ts", type: "library" },
]): ExtractionPlugin => ({
  id: "fixture-plugin",
  languages: ["typescript"],
  packageManagers: ["npm"],
  canHandle(source: SourceInfo) {
    return source.manifests.some((manifest) => manifest.type === "package.json");
  },
  async detectEntries(manifest) {
    const pkg = manifest.content as { name?: string };
    return {
      package: {
        name: pkg.name ?? "fixture",
        kind: PackageKind.Lib,
        language: "typescript",
      },
      entries: detectedEntries,
    };
  },
  async extractSymbols(entries) {
    const firstEntry = entries[0]?.path ?? "src/Button.ts";
    return {
      version: "2",
      meta: {
        extractedAt: "2026-05-07T00:00:00.000Z",
        pluginId: "fixture-plugin",
        commitHash: null,
        language: "typescript",
      },
      package: {
        name: "@fixture/ui",
        kind: PackageKind.Lib,
        language: "typescript",
      },
      files: [{ path: firstEntry, language: "typescript", lines: 1 }],
      symbols: [{
        name: "Button",
        kind: SymbolKind.Function,
        visibility: Visibility.Exported,
        file: firstEntry,
        line: 1,
        endLine: 1,
      }],
      relations: [],
      stats: { files: 1, lines: 1, exportedSymbols: 1, internalSymbols: 0, relations: 0 },
    };
  },
});

describe("runRepositoryExtraction", () => {
  test("extracts a requested module and normalizes paths to repo-relative POSIX paths", async () => {
    const repo = await createTempRepo();
    try {
      await writeText(repo, "packages/ui/package.json", JSON.stringify({ name: "@fixture/ui" }));
      await writeText(repo, "packages/ui/src/Button.ts", "export const Button = () => null;\n");

      const result = await runRepositoryExtraction({
        repoPath: repo,
        modules: ["packages/ui"],
        commitHash: "abc123",
        plugins: [createFixturePlugin()],
      });

      expect(result.moduleErrors).toEqual([]);
      expect(result.results).toHaveLength(1);
      const extraction = result.results[0]!.extraction;
      expect(extraction.meta.commitHash).toBe("abc123");
      expect(extraction.files[0]!.path).toBe("packages/ui/src/Button.ts");
      expect(extraction.symbols[0]!.file).toBe("packages/ui/src/Button.ts");
      expect(result.results[0]!.entryDetection.entries[0]!.path).toBe("packages/ui/src/Button.ts");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("returns a structured module error when a requested path has no package", async () => {
    const repo = await createTempRepo();
    try {
      await writeText(repo, "src/index.ts", "export const value = 1;\n");

      const result = await runRepositoryExtraction({
        repoPath: repo,
        modules: ["."],
        plugins: [createFixturePlugin()],
      });

      expect(result.results).toEqual([]);
      expect(result.moduleErrors).toHaveLength(1);
      expect(result.moduleErrors[0]!.module_path).toBe(".");
      expect(result.moduleErrors[0]!.error).toContain("No indexable code module detected");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("uses configured source-relative entries without changing the package manifest", async () => {
    const repo = await createTempRepo();
    try {
      await writeText(repo, "packages/ui/package.json", JSON.stringify({ name: "@fixture/ui" }));
      await writeText(repo, "packages/ui/src/Feature.ts", "export const Feature = () => null;\n");

      const result = await runRepositoryExtraction({
        repoPath: repo,
        modules: ["packages/ui"],
        entrySelection: { mode: "configured", entries: ["packages/ui/src/Feature.ts"] },
        plugins: [createFixturePlugin([])],
      });

      expect(result.results[0]?.entryDetection.entries).toEqual([{
        path: "packages/ui/src/Feature.ts",
        subpath: ".",
        type: "library",
      }]);
      expect(result.results[0]?.extraction.symbols[0]?.file).toBe("packages/ui/src/Feature.ts");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("scan mode uses all code files selected by the path filter as entry roots", async () => {
    const repo = await createTempRepo();
    try {
      await writeText(repo, "package.json", JSON.stringify({ name: "@fixture/ui" }));
      await writeText(repo, "src/Button.ts", "export const Button = () => null;\n");
      await writeText(repo, "src/internal/format.ts", "const format = () => null;\n");
      await writeText(repo, "test/ignored.ts", "export const ignored = true;\n");

      const result = await runRepositoryExtraction({
        repoPath: repo,
        pathFilter: {
          package: { include: ["**/package.json"] },
          code: { include: ["src/**/*.ts"], exclude: [] },
          doc: { include: [], exclude: [] },
        },
        entrySelection: { mode: "scan" },
        plugins: [createFixturePlugin([])],
      });

      expect(result.results[0]?.entryDetection.entries.map((entry) => entry.path)).toEqual([
        "src/Button.ts",
        "src/internal/format.ts",
      ]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test("auto mode rejects packages without entries and points to Context-side configuration", async () => {
    const repo = await createTempRepo();
    try {
      await writeText(repo, "package.json", JSON.stringify({ name: "@fixture/ui" }));
      await writeText(repo, "src/Feature.ts", "export const Feature = () => null;\n");

      await expect(runRepositoryExtraction({
        repoPath: repo,
        plugins: [createFixturePlugin([])],
      })).rejects.toMatchObject({
        code: "NO_ENTRY_DETECTED",
        message: expect.stringMatching(/Configure extractTs entries in the Context project, or use mode: "scan"/u),
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
