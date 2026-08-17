import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodeExtractRunner } from "../runner.js";

const createTempRepo = async () => mkdtemp(join(tmpdir(), "c4a-extract-runner-"));

const writeText = async (root: string, relPath: string, content: string) => {
  const fullPath = join(root, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
};

const toolchain = {
  manager_package: "@c4a/context-cli",
  manager_version: "0.5.29-beta.11",
  runner_package: "@c4a/extract",
  runner_package_version: "0.5.29-beta.11",
  runner_bin: "c4a-extract-code",
  plugin_package: "@c4a/extract-ts",
  plugin_package_version: "0.5.29-beta.11",
  plugin_export: "TypeScriptPlugin",
};

const pluginSource = `
export default class FixturePlugin {
  id = "fixture-plugin";
  languages = ["typescript"];
  packageManagers = ["npm"];
  canHandle(source) {
    return source.manifests.some((manifest) => manifest.type === "package.json");
  }
  async detectEntries(manifest) {
    const name = manifest.content.name ?? "fixture";
    return {
      package: { name, kind: "lib", language: "typescript" },
      entries: [{ path: "src/index.ts", subpath: "src/index.ts", type: "library" }],
    };
  }
  async extractSymbols() {
    return {
      version: "2",
      meta: {
        extractedAt: "2026-05-07T00:00:00.000Z",
        pluginId: "fixture-plugin",
        commitHash: null,
        language: "typescript",
      },
      package: { name: "@fixture/app", kind: "lib", language: "typescript" },
      files: [{ path: "src/index.ts", language: "typescript", lines: 1 }],
      symbols: [{
        name: "run",
        kind: "function",
        visibility: "exported",
        file: "src/index.ts",
        line: 1,
        endLine: 1,
      }],
      relations: [],
      stats: { files: 1, lines: 1, exportedSymbols: 1, internalSymbols: 0, relations: 0 },
    };
  }
}
`;

describe("code extract runner", () => {
  test("rejects empty configured entries with a stable machine code", async () => {
    await expect(runCodeExtractRunner({
      repoPath: ".",
      entrySelection: { mode: "configured", entries: [] },
      plugins: [{ package: "fixture" }],
    })).rejects.toMatchObject({ code: "NO_ENTRY_DETECTED" });
  });

  test("loads plugins dynamically and emits NDJSON-ready events with a snapshot", async () => {
    const repo = await createTempRepo();
    try {
      await writeText(repo, "package.json", JSON.stringify({ name: "@fixture/app" }));
      await writeText(repo, "src/index.ts", "export const run = () => 1;\n");
      await writeText(repo, "fixture-plugin.mjs", pluginSource);

      const events = await runCodeExtractRunner({
        repoPath: repo,
        commitHash: "abc123",
        entrySelection: { mode: "configured", entries: ["src/index.ts"] },
        plugins: [{ package: join(repo, "fixture-plugin.mjs") }],
        snapshot: {
          sourceId: "aspect:code:fixture",
          sourceSlug: "code-fixture",
          snapshotId: "code-fixture@abc123",
          codeSnapshotContractVersion: "0.5.29-beta.6",
          scriptHash: "sha256:script",
          toolchain,
        },
      });

      expect(events.some((event) => event.type === "progress")).toBe(true);
      const summary = events.find((event) => event.type === "summary");
      expect(summary?.type).toBe("summary");
      if (summary?.type !== "summary") throw new Error("summary missing");
      expect(summary.extraction.moduleErrors).toEqual([]);
      expect(summary.extraction.results).toHaveLength(1);
      expect(summary.snapshot?.manifest.module_count).toBe(1);
      expect(summary.snapshot?.manifest.toolchain).toEqual(toolchain);
      expect(summary.snapshot?.rows.symbols[0]!.file).toBe("src/index.ts");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
