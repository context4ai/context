import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import { readDocumentSourcesRegistry } from "../project/documentSources.js";
import { initContextProject } from "../project/workspace.js";
import { invokeCliInDir, makeProjectRoot } from "./documentSourcesV062Helpers.js";

describe("0.6.2 document source registry helpers", () => {
  test("init templates use sources top-level for file and lark registries", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-init-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });

      await expect(readFile(join(result.projectRoot, "sources", "file", "index.yaml"), "utf8")).resolves.toBe("sources: []\n");
      await expect(readFile(join(result.projectRoot, "sources", "lark", "index.yaml"), "utf8")).resolves.toBe("sources: []\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parse valid file and lark registries without reading document contents", async () => {
    const root = await makeProjectRoot();
    try {
      await writeFile(join(root, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: ../missing-docs",
        "",
      ].join("\n"), "utf8");
      await writeFile(join(root, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    wikiToken: wiki-token",
        "",
      ].join("\n"), "utf8");

      const registry = await readDocumentSourcesRegistry(root);

      expect(registry.files.map((entry) => entry.name)).toEqual(["product-docs"]);
      expect(registry.files[0]?.local).toBe("../missing-docs");
      expect(registry.larks.map((entry) => entry.name)).toEqual(["handbook"]);
      expect(registry.larks[0]?.wikiToken).toBe("wiki-token");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add file requires local and stores a project-relative refresh hint", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-add-file-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docsDir = join(result.projectRoot, "..", "docs");
      await mkdir(docsDir, { recursive: true });

      const missingLocal = await invokeCliInDir(result.projectRoot, ["source", "add", "file", "product-docs", "--format", "json"]);
      expect(missingLocal.status).not.toBe(0);
      expect(missingLocal.stderr).toContain("source add file requires --local <path>");

      const invalidName = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "../bad",
        "--local",
        "../docs",
        "--format",
        "json",
      ]);
      expect(invalidName.status).not.toBe(0);
      expect(invalidName.stderr).toContain("file source name must be a lowercase path-safe slug");
      await expect(readFile(join(result.projectRoot, "sources", "file", "index.yaml"), "utf8")).resolves.toBe("sources: []\n");

      const added = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--format",
        "json",
      ]);
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout) as Record<string, unknown>).toMatchObject({
        name: "product-docs",
        type: "file",
        local: "../docs",
        next_action: {
          kind: "reevaluate_workspace_route",
          command: "context status --format json",
          completed_operation: "source.add.file:product-docs",
        },
      });
      await expect(readFile(join(result.projectRoot, "sources", "file", "index.yaml"), "utf8")).resolves.toContain("sources:");
      await expect(readDocumentSourcesRegistry(result.projectRoot)).resolves.toMatchObject({
        files: [{
          name: "product-docs",
          local: "../docs",
        }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add file groups multiple modules under today's date batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-add-file-default-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docsDir = join(result.projectRoot, "..", "docs");
      const otherDocsDir = join(result.projectRoot, "..", "other-docs");
      await mkdir(docsDir, { recursive: true });
      await mkdir(otherDocsDir, { recursive: true });

      const added = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "--local",
        docsDir,
        "--format",
        "json",
      ]);
      expect(added.status).toBe(0);
      const addedJson = JSON.parse(added.stdout) as Record<string, unknown>;
      expect(addedJson.name).toMatch(/^\d{8}\/docs$/u);
      expect(addedJson).toMatchObject({
        type: "file",
        module: "docs",
        local: "../docs",
      });
      expect(addedJson.materializedAt).toBe(`sources/file/${String(addedJson.namespace)}`);
      expect(addedJson.snapshot).toEqual({
        manifest: `sources/file/${String(addedJson.namespace)}/manifest.json`,
      });

      const second = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "--local",
        otherDocsDir,
        "--format",
        "json",
      ]);
      expect(second.status).toBe(0);
      expect(JSON.parse(second.stdout)).toMatchObject({
        type: "file",
        module: "other-docs",
        local: "../other-docs",
      });
      const registry = await readDocumentSourcesRegistry(result.projectRoot);
      expect(registry.files.map((entry) => entry.name)).toEqual([
        `${String(addedJson.namespace)}/docs`,
        `${String(addedJson.namespace)}/other-docs`,
      ]);
      const inspected = await invokeCliInDir(result.projectRoot, [
        "source", "inspect", String(addedJson.namespace), "--format", "json",
      ]);
      expect(inspected.status).toBe(0);
      expect(JSON.parse(inspected.stdout)).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add file stores include and inspect does not read local contents before capture", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-include-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docsDir = join(result.projectRoot, "..", "docs");
      await mkdir(join(docsDir, "guides"), { recursive: true });
      await writeFile(join(docsDir, "guides", "intro.md"), "# Intro\n", "utf8");

      const added = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--include",
        "guides/**/*.md",
        "--format",
        "json",
      ]);
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout) as Record<string, unknown>).toMatchObject({
        name: "product-docs",
        include: ["guides/**/*.md"],
      });

      const inspected = await invokeCliInDir(result.projectRoot, [
        "source",
        "inspect",
        "product-docs",
        "--format",
        "json",
      ]);
      expect(inspected.status).toBe(0);
      const inspectJson = JSON.parse(inspected.stdout) as Array<Record<string, unknown>>;
      expect(inspectJson[0]).toMatchObject({
        name: "product-docs",
        type: "file",
        status: "needs-capture",
        include: ["guides/**/*.md"],
        snapshotReady: false,
      });
      expect(JSON.stringify(inspectJson)).not.toContain("Intro");
      expect(JSON.stringify(inspectJson)).not.toContain("documentCount");

      await writeFile(join(docsDir, "reference.md"), "# Reference\n", "utf8");
      await writeFile(join(result.projectRoot, "batch-files.txt"), [
        "# Batch scope",
        "",
        "guides/**/*.md",
        "reference.md",
        "",
      ].join("\n"), "utf8");
      const updated = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--include",
        "guides/**/*.md",
        "--include-list",
        "batch-files.txt",
        "--format",
        "json",
      ]);
      expect(updated.status).toBe(0);
      expect(JSON.parse(updated.stdout) as Record<string, unknown>).toMatchObject({
        name: "product-docs",
        include: ["guides/**/*.md", "reference.md"],
      });

      const ensured = await invokeCliInDir(result.projectRoot, [
        "source",
        "ensure",
        "product-docs",
        "--format",
        "json",
      ]);
      expect(ensured.status).toBe(0);
      expect(JSON.parse(ensured.stdout) as Array<Record<string, unknown>>).toEqual([
        expect.objectContaining({
          name: "product-docs",
          status: "needs-capture",
          next: "context run capture:file:product-docs",
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add file hints when an MDX documentation site needs processor configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-mdx-hint-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docsDir = join(result.projectRoot, "..", "docs-site");
      await mkdir(join(docsDir, "guide", "quickly-setup"), { recursive: true });
      await writeFile(join(docsDir, "guide", "quickly-setup", "_meta.json"), "[\"message-setup\"]\n", "utf8");
      await writeFile(join(docsDir, "guide", "quickly-setup", "message-setup.mdx"), "# 消息搭建\n", "utf8");

      const added = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--format",
        "json",
      ]);
      expect(added.status).toBe(0);
      const addedJson = JSON.parse(added.stdout) as Record<string, unknown>;
      expect(addedJson.agent_hints).toEqual([
        expect.stringContaining("document-site-processor-not-configured:product-docs"),
      ]);
      expect(JSON.stringify(addedJson.agent_hints)).toContain("guide/quickly-setup/message-setup.mdx");

      const inspected = await invokeCliInDir(result.projectRoot, [
        "source",
        "inspect",
        "product-docs",
        "--format",
        "json",
      ]);
      expect(inspected.status).toBe(0);
      const inspectJson = JSON.parse(inspected.stdout) as Array<Record<string, unknown>>;
      expect(inspectJson[0]?.agent_hints).toEqual([
        expect.stringContaining("document-site-processor-not-configured:product-docs"),
      ]);
      expect(JSON.stringify(inspectJson)).not.toContain("消息搭建");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add file returns declared align next_action without guessing a default collection", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-add-next-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docsDir = join(result.projectRoot, "..", "docs");
      await mkdir(docsDir, { recursive: true });
      await writeFile(join(result.projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const docs = source("product-docs");',
        "",
        "export default defineProject({",
        "  sources: [docs],",
        "  phases: [",
        "    captureFile({ source: docs }),",
        '    alignProse({ source: docs, collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const added = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--format",
        "json",
      ]);
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout) as Record<string, unknown>).toMatchObject({
        name: "product-docs",
        type: "file",
        next_action: {
          kind: "reevaluate_workspace_route",
          command: "context status --format json",
          completed_operation: "source.add.file:product-docs",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source ensure treats missing snapshot files as needs-capture", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-missing-snapshot-file-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docsDir = join(result.projectRoot, "..", "docs");
      await mkdir(docsDir, { recursive: true });

      const added = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--format",
        "json",
      ]);
      expect(added.status).toBe(0);

      const snapshotDir = join(result.projectRoot, "sources", "file", "product-docs");
      await mkdir(snapshotDir, { recursive: true });
      const manifest = createDocumentSnapshotManifest({
        sourceType: "file",
        sourceName: "product-docs",
        capturedAt: "2026-06-24T00:00:00.000Z",
        files: [{ path: "intro.md", bytes: "# Intro\n", title: "Intro" }],
      });
      await writeFile(join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const ensured = await invokeCliInDir(result.projectRoot, [
        "source",
        "ensure",
        "product-docs",
        "--format",
        "json",
      ]);
      expect(ensured.status).toBe(0);
      expect(JSON.parse(ensured.stdout) as Array<Record<string, unknown>>).toEqual([
        expect.objectContaining({
          name: "product-docs",
          status: "needs-capture",
          snapshotReady: false,
          diagnostics: ["snapshot file is missing: sources/file/product-docs/intro.md"],
          next: "context run capture:file:product-docs",
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source list and get include file and lark registry entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-list-get-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docsDir = join(result.projectRoot, "..", "docs");
      await mkdir(docsDir, { recursive: true });

      const addedFile = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--format",
        "json",
      ]);
      expect(addedFile.status).toBe(0);

      const addedLark = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "lark",
        "handbook",
        "--doc-token",
        "doc-token-123",
        "--title",
        "Product Handbook",
        "--format",
        "json",
      ]);
      expect(addedLark.status).toBe(0);

      const listed = await invokeCliInDir(result.projectRoot, ["source", "list", "--format", "json"]);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout) as Array<Record<string, unknown>>).toEqual([
        expect.objectContaining({
          name: "product-docs",
          type: "file",
          status: "registered",
          local: "../docs",
        }),
        expect.objectContaining({
          name: "handbook",
          type: "lark",
          status: "registered",
          identity: "docToken",
          title: "Product Handbook",
        }),
      ]);
      expect(listed.stdout).not.toContain("doc-token-123");

      const listedFiles = await invokeCliInDir(result.projectRoot, [
        "source",
        "list",
        "--type",
        "file",
        "--format",
        "json",
      ]);
      expect(listedFiles.status).toBe(0);
      expect(JSON.parse(listedFiles.stdout) as Array<Record<string, unknown>>).toEqual([
        expect.objectContaining({
          name: "product-docs",
          type: "file",
        }),
      ]);

      const listedRegistered = await invokeCliInDir(result.projectRoot, [
        "source",
        "list",
        "--status",
        "registered",
        "--format",
        "json",
      ]);
      expect(listedRegistered.status).toBe(0);
      expect((JSON.parse(listedRegistered.stdout) as Array<Record<string, unknown>>).map((source) => source.name)).toEqual([
        "product-docs",
        "handbook",
      ]);

      const fileEntry = await invokeCliInDir(result.projectRoot, ["source", "get", "product-docs", "--format", "json"]);
      expect(fileEntry.status).toBe(0);
      expect(JSON.parse(fileEntry.stdout) as Record<string, unknown>).toMatchObject({
        name: "product-docs",
        type: "file",
        status: "registered",
        local: "../docs",
      });

      const larkEntry = await invokeCliInDir(result.projectRoot, ["source", "get", "handbook", "--format", "json"]);
      expect(larkEntry.status).toBe(0);
      expect(JSON.parse(larkEntry.stdout) as Record<string, unknown>).toMatchObject({
        name: "handbook",
        type: "lark",
        status: "registered",
        identity: "docToken",
        title: "Product Handbook",
      });
      expect(larkEntry.stdout).not.toContain("doc-token-123");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add file updates existing entries without dropping id or snapshot metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-update-file-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const nextDocsDir = join(result.projectRoot, "..", "next-docs");
      await mkdir(nextDocsDir, { recursive: true });
      await writeFile(join(result.projectRoot, "sources", "file", "index.yaml"), [
        "sources:",
        "  - id: docs",
        "    name: product-docs",
        "    materializedAt: sources/file/product-docs",
        "    local: ../old-docs",
        "    include:",
        "      - '**/*.md'",
        "    snapshot:",
        "      manifest: sources/file/product-docs/manifest.json",
        "",
      ].join("\n"), "utf8");

      const updated = await invokeCliInDir(result.projectRoot, [
        "source",
        "add",
        "file",
        "docs",
        "--local",
        nextDocsDir,
        "--format",
        "json",
      ]);

      expect(updated.status).toBe(0);
      expect(JSON.parse(updated.stdout) as Record<string, unknown>).toMatchObject({
        id: "docs",
        name: "product-docs",
        local: "../next-docs",
        materializedAt: "sources/file/product-docs",
        include: ["**/*.md"],
        snapshot: {
          manifest: "sources/file/product-docs/manifest.json",
        },
      });
      const registry = await readDocumentSourcesRegistry(result.projectRoot);
      expect(registry.files[0]).toMatchObject({
        id: "docs",
        name: "product-docs",
        local: "../next-docs",
        materializedAt: "sources/file/product-docs",
        include: ["**/*.md"],
        snapshot: {
          manifest: "sources/file/product-docs/manifest.json",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
