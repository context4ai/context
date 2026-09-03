import { createDocumentSnapshotManifest } from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDocumentSourcesRegistry } from "../project/documentSources.js";
import { initContextProject } from "../project/workspace.js";
import { invokeCliInDir } from "./documentSourcesV062Helpers.js";

describe("0.6.2 Lark document source registry helpers", () => {
  test("source add lark stores identity metadata and inspect does not fetch remote contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-add-lark-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const missingIdentity = await invokeCliInDir(result.projectRoot, [
        "source", "add", "lark", "handbook", "--format", "json",
      ]);
      expect(missingIdentity.status).not.toBe(0);
      expect(missingIdentity.stderr).toContain("source add lark requires exactly one");

      const added = await invokeCliInDir(result.projectRoot, [
        "source", "add", "lark", "handbook",
        "--doc-token", "doc-token-123",
        "--title", "Product Handbook",
        "--format", "json",
      ]);
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout) as Record<string, unknown>).toMatchObject({
        name: "handbook",
        type: "lark",
        identity: "docToken",
        title: "Product Handbook",
      });
      expect(added.stdout).not.toContain("doc-token-123");
      await expect(readDocumentSourcesRegistry(result.projectRoot)).resolves.toMatchObject({
        larks: [{
          name: "handbook",
          docToken: "doc-token-123",
          title: "Product Handbook",
        }],
      });

      const inspected = await invokeCliInDir(result.projectRoot, [
        "source", "inspect", "handbook", "--format", "json",
      ]);
      expect(inspected.status).toBe(0);
      const inspectJson = JSON.parse(inspected.stdout) as Array<Record<string, unknown>>;
      expect(inspectJson[0]).toMatchObject({
        name: "handbook",
        type: "lark",
        status: "needs-capture",
        identity: "docToken",
        title: "Product Handbook",
        snapshotReady: false,
        next: "context run capture:lark:handbook",
      });
      expect(JSON.stringify(inspectJson)).not.toContain("doc-token-123");
      expect(JSON.stringify(inspectJson)).not.toContain("documentCount");
      expect(JSON.stringify(inspectJson)).not.toContain("Fetched Handbook");
      expect(existsSync(join(result.projectRoot, "sources", "lark", "handbook", "manifest.json"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add lark groups multiple documents under today's date batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-add-lark-default-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const added = await invokeCliInDir(result.projectRoot, [
        "source", "add", "lark", "--doc-token", "doc-token-123", "--format", "json",
      ]);
      expect(added.status).toBe(0);
      const addedJson = JSON.parse(added.stdout) as Record<string, unknown>;
      expect(addedJson.name).toMatch(/^\d{8}\/doc-[a-f0-9]{12}$/u);
      expect(addedJson).toMatchObject({ type: "lark", identity: "docToken" });
      expect(addedJson.module).toMatch(/^doc-[a-f0-9]{12}$/u);
      expect(addedJson.materializedAt).toBe(`sources/lark/${String(addedJson.namespace)}`);
      expect(addedJson.snapshot).toEqual({
        manifest: `sources/lark/${String(addedJson.namespace)}/manifest.json`,
      });
      expect(added.stdout).not.toContain("doc-token-123");

      const second = await invokeCliInDir(result.projectRoot, [
        "source", "add", "lark", "--wiki-token", "wiki-token-456", "--format", "json",
      ]);
      expect(second.status).toBe(0);
      expect(JSON.parse(second.stdout)).toMatchObject({ type: "lark", identity: "wikiToken" });
      const secondJson = JSON.parse(second.stdout) as Record<string, unknown>;
      expect(secondJson.module).toMatch(/^wiki-[a-f0-9]{12}$/u);
      const registry = await readDocumentSourcesRegistry(result.projectRoot);
      expect(registry.larks.map((entry) => entry.name)).toEqual([
        `${String(addedJson.namespace)}/${String(addedJson.module)}`,
        `${String(addedJson.namespace)}/${String(secondJson.module)}`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add lark rejects a flat entry that collides with a date batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-invalid-lark-date-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFile(join(result.projectRoot, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    url: https://example.larksuite.com/wiki/first",
        "",
      ].join("\n"), "utf8");

      const added = await invokeCliInDir(result.projectRoot, [
        "source", "add", "lark", "20260712",
        "--module", "second-guide",
        "--url", "https://example.larksuite.com/wiki/second",
        "--format", "json",
      ]);
      expect(added.status).not.toBe(0);
      expect(added.stderr).toContain("current protocol requires a date batch with modules");
      const raw = await readFile(join(result.projectRoot, "sources", "lark", "index.yaml"), "utf8");
      expect(raw).not.toContain("modules:");
      expect(raw).toContain("https://example.larksuite.com/wiki/first");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("source add lark returns the lifecycle reevaluation next action", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-add-lark-next-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFile(join(result.projectRoot, "src", "index.ts"), [
        'import { captureLark, defineProject, source } from "@c4a/context";',
        "",
        'const handbook = source("handbook");',
        "",
        "export default defineProject({",
        "  sources: [handbook],",
        "  phases: [captureLark({ source: handbook })],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const added = await invokeCliInDir(result.projectRoot, [
        "source", "add", "lark", "handbook",
        "--doc-token", "doc-token-123",
        "--format", "json",
      ]);
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout) as Record<string, unknown>).toMatchObject({
        name: "handbook",
        type: "lark",
        next_action: {
          kind: "reevaluate_workspace_route",
          command: "context status --format json",
          completed_operation: "source.add.lark:handbook",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("captured lark inspect routes to read-plan instead of dry-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-doc-sources-v062-ready-lark-"));
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await invokeCliInDir(result.projectRoot, [
        "source", "add", "lark", "handbook",
        "--doc-token", "doc-token-123",
        "--title", "Product Handbook",
        "--format", "json",
      ]);
      const snapshotDir = join(result.projectRoot, "sources", "lark", "handbook");
      await mkdir(snapshotDir, { recursive: true });
      const bytes = "# Product Handbook\n\nIntro.\n";
      await writeFile(join(snapshotDir, "index.md"), bytes, "utf8");
      const manifest = createDocumentSnapshotManifest({
        sourceType: "lark",
        sourceName: "handbook",
        capturedAt: "2026-06-24T00:00:00.000Z",
        files: [{ path: "index.md", bytes, title: "Product Handbook", locator: "docToken:doc-token-123" }],
        metadata: { source: { docToken: "doc-token-123", title: "Product Handbook" } },
      });
      await writeFile(join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const inspected = await invokeCliInDir(result.projectRoot, [
        "source", "inspect", "handbook", "--format", "json",
      ]);
      expect(inspected.status).toBe(0);
      const inspectJson = JSON.parse(inspected.stdout) as Array<Record<string, unknown>>;
      expect(inspectJson[0]).toMatchObject({
        name: "handbook",
        type: "lark",
        status: "ready",
        snapshotReady: true,
        next: "context status --format json",
      });
      expect(JSON.stringify(inspectJson)).not.toContain("align:lark:handbook:architecture --dry-run");

      await writeFile(join(result.projectRoot, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    docToken: doc-token-456",
        "    title: Product Handbook",
        "",
      ].join("\n"), "utf8");
      const staleIdentity = await invokeCliInDir(result.projectRoot, [
        "source", "inspect", "handbook", "--format", "json",
      ]);
      expect(staleIdentity.status).toBe(0);
      const staleIdentityJson = JSON.parse(staleIdentity.stdout) as Array<Record<string, unknown>>;
      expect(staleIdentityJson[0]).toMatchObject({
        name: "handbook",
        type: "lark",
        status: "needs-capture",
        snapshotReady: false,
        diagnostics: ["snapshot identity is stale for lark source handbook: rerun context run capture:lark:handbook"],
        next: "context run capture:lark:handbook",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
