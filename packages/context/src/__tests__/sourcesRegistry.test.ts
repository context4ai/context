import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSourcesRegistry,
  resolveSourceReference,
  source,
} from "../index.js";
import type { SourcesRegistry } from "../index.js";

describe("@c4a/context source registry helpers", () => {
  test("resolve repo source references from sources/repo/index.yaml", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: sample-lib",
        "        local: ../sample-lib",
        "        git:",
        "          remote: https://git.example.com/team/sample-lib.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "",
      ].join("\n"));

      const registry = await loadSourcesRegistry({ rootDir });
      const resolved = resolveSourceReference(source("20260712", "sample-lib"), registry);

      expect(registry.kind).toBe("sources.registry");
      expect(resolved).toEqual({
        kind: "source.repo",
        id: "20260712/sample-lib",
        name: "20260712/sample-lib",
        namespace: "20260712",
        module: "sample-lib",
        local: "../sample-lib",
        materializedAt: "sources/repo/20260712/sample-lib",
        git: {
          remote: "https://git.example.com/team/sample-lib.git",
          ref: "a1b2c3d4e5f678901234567890abcdef12345678",
        },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("reject ambiguous repo source identifiers", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - id: shared",
        "        name: sample-lib",
        "        git:",
        "          remote: https://git.example.com/team/sample-lib.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "      - name: shared",
        "        git:",
        "          remote: https://git.example.com/team/other-lib.git",
        "          ref: d4e5f6a7b8c901234567890abcdef1234567890ab",
        "",
      ].join("\n"));

      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Duplicate repo source identifier "20260712\/shared"/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("reject repo module names repeated across date batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));
    try {
      await mkdir(join(root, "sources", "repo"), { recursive: true });
      await writeFile(join(root, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: module-a",
        "        git:",
        "          remote: https://example.test/a.git",
        `          ref: ${"a".repeat(40)}`,
        "  - name: '20260713'",
        "    modules:",
        "      - name: module-a",
        "        git:",
        "          remote: https://example.test/a.git",
        `          ref: ${"a".repeat(40)}`,
        "",
      ].join("\n"));

      await expect(loadSourcesRegistry({ rootDir: root })).rejects.toThrow(
        "repo module names are project-wide code-index identities",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accept an empty registry file and reject unsafe names", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), "");
      await expect(loadSourcesRegistry({ rootDir })).resolves.toMatchObject({
        kind: "sources.registry",
        repos: [],
        files: [],
        larks: [],
      });

      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: ../bad",
        "    modules:",
        "      - name: bad",
        "        git:",
        "          remote: https://git.example.com/team/bad.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "",
      ].join("\n"));

      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/valid YYYYMMDD date/);

      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260230'",
        "    modules:",
        "      - name: bad",
        "        git:",
        "          remote: https://git.example.com/team/bad.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "",
      ].join("\n"));

      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/valid YYYYMMDD date/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("reject repo paths that escape the workspace or git root", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: sample-lib",
        "        subpath: ../other",
        "        git:",
        "          remote: https://git.example.com/team/sample-lib.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "",
      ].join("\n"));

      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid subpath/);

      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: sample-lib",
        "        materializedAt: ../outside",
        "        git:",
        "          remote: https://git.example.com/team/sample-lib.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "",
      ].join("\n"));

      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid materializedAt/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("source resolver rejects unsafe repo subpaths from programmatic registries", () => {
    const registry: SourcesRegistry = {
      kind: "sources.registry",
      registryPaths: {
        repo: "sources/repo/index.yaml",
        file: "sources/file/index.yaml",
        lark: "sources/lark/index.yaml",
      },
      absolutePaths: {
        repo: "/workspace/sources/repo/index.yaml",
        file: "/workspace/sources/file/index.yaml",
        lark: "/workspace/sources/lark/index.yaml",
      },
      repos: [{
        id: "20260712/sample-lib",
        name: "20260712/sample-lib",
        namespace: "20260712",
        module: "sample-lib",
        materializedAt: "sources/repo/20260712/sample-lib",
        remote: "https://git.example.com/team/sample-lib.git",
        ref: "a1b2c3d4e5f678901234567890abcdef12345678",
        subpath: "../other",
      }],
      files: [],
      larks: [],
    };

    expect(() => resolveSourceReference(source("20260712", "sample-lib"), registry)).toThrow(/invalid subpath/);
  });

  test("reject legacy repo registry shapes", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), "repos: []\n");
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);

      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: sample-lib",
        "    git:",
        "      remote: https://git.example.com/team/sample-lib.git",
        "      ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("reject unknown nested source fields", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await mkdir(join(rootDir, "sources", "file"), { recursive: true });
      await mkdir(join(rootDir, "sources", "lark"), { recursive: true });

      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: sample-lib",
        "        git:",
        "          remote: https://git.example.com/team/sample-lib.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "          branch: main",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);

      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), "sources: []\n");
      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: ../docs",
        "    extraField: true",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    snapshot:",
        "      manifest: sources/file/product-docs/manifest.json",
        "      hash: abc123",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), "sources: []\n");
      await writeFile(join(rootDir, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    url: https://example.larksuite.com/wiki/example",
        "    extraField: true",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("parse file and lark sources without reading source contents", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await mkdir(join(rootDir, "sources", "file"), { recursive: true });
      await mkdir(join(rootDir, "sources", "lark"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), "sources: []\n");
      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: ../docs",
        "    include:",
        "      - '**/*.md'",
        "  - name: archived-docs",
        "    snapshot:",
        "      manifest: sources/file/archived-docs/manifest.json",
        "",
      ].join("\n"));
      await writeFile(join(rootDir, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    url: https://example.larksuite.com/wiki/example",
        "    title: Handbook",
        "",
      ].join("\n"));

      const registry = await loadSourcesRegistry({ rootDir });

      expect(registry.files).toEqual([
        {
          id: "product-docs",
          name: "product-docs",
          local: "../docs",
          include: ["**/*.md"],
          materializedAt: "sources/file/product-docs",
        },
        {
          id: "archived-docs",
          name: "archived-docs",
          materializedAt: "sources/file/archived-docs",
          snapshot: {
            manifest: "sources/file/archived-docs/manifest.json",
          },
        },
      ]);
      expect(registry.larks).toEqual([{
        id: "handbook",
        name: "handbook",
        materializedAt: "sources/lark/handbook",
        url: "https://example.larksuite.com/wiki/example",
        title: "Handbook",
      }]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("parse multiple document modules under one date batch", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-document-batch-"));
    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await mkdir(join(rootDir, "sources", "file"), { recursive: true });
      await mkdir(join(rootDir, "sources", "lark"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), "sources: []\n");
      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: user-manual",
        "        local: ../manual",
        "      - name: api-reference",
        "        local: ../api",
        "",
      ].join("\n"));
      await writeFile(join(rootDir, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: guide-a",
        "        url: https://example.larksuite.com/wiki/a",
        "      - name: guide-b",
        "        url: https://example.larksuite.com/wiki/b",
        "",
      ].join("\n"));

      const registry = await loadSourcesRegistry({ rootDir });
      expect(registry.files).toEqual([
        expect.objectContaining({
          id: "20260712/user-manual",
          name: "20260712/user-manual",
          namespace: "20260712",
          module: "user-manual",
          materializedAt: "sources/file/20260712",
          snapshot: { manifest: "sources/file/20260712/manifest.json" },
        }),
        expect.objectContaining({ name: "20260712/api-reference", module: "api-reference" }),
      ]);
      expect(registry.larks).toEqual([
        expect.objectContaining({
          id: "20260712/guide-a",
          name: "20260712/guide-a",
          namespace: "20260712",
          module: "guide-a",
          materializedAt: "sources/lark/20260712",
          snapshot: { manifest: "sources/lark/20260712/manifest.json" },
        }),
        expect.objectContaining({ name: "20260712/guide-b", module: "guide-b" }),
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("reject invalid document source registries", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "c4a-context-sdk-"));

    try {
      await mkdir(join(rootDir, "sources", "repo"), { recursive: true });
      await mkdir(join(rootDir, "sources", "file"), { recursive: true });
      await mkdir(join(rootDir, "sources", "lark"), { recursive: true });
      await writeFile(join(rootDir, "sources", "repo", "index.yaml"), "sources: []\n");

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: /tmp/docs",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid local/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: \"docs\\0evil\"",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid local/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    snapshot:",
        "      manifest: ../manifest.json",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid snapshot\.manifest/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    snapshot:",
        "      manifest: sources/file/product-docs//manifest.json",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid snapshot\.manifest/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    materializedAt: sources/file/custom-product-docs",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid materializedAt/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: ../docs",
        "    include:",
        "      - ../**/*.md",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid include\[0\]/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), "sources: []\n");
      await writeFile(join(rootDir, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    url: https://example.larksuite.com/wiki/handbook",
        "    materializedAt: sources/lark/custom-handbook",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/invalid materializedAt/);

      await writeFile(join(rootDir, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/exactly one of url, docToken, or wikiToken/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: shared",
        "    local: ../docs",
        "",
      ].join("\n"));
      await writeFile(join(rootDir, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: shared",
        "    docToken: doc-token",
        "",
      ].join("\n"));
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Duplicate source identifier "shared" across file and lark registries/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), "files: []\n");
      await writeFile(join(rootDir, "sources", "lark", "index.yaml"), "sources: []\n");
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);

      await writeFile(join(rootDir, "sources", "file", "index.yaml"), "sources: []\nunknown: true\n");
      await expect(loadSourcesRegistry({ rootDir })).rejects.toThrow(/Unrecognized key/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
