import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { computeDocumentContentHash, computeLogicalRawHash, parseDocumentSnapshotManifest } from "@c4a/extract";
import { initContextProject } from "../project/workspace.js";
import { parseDocumentSnapshotForSource } from "../project/documentBatchManifest.js";
import {
  type CaptureRunJson,
  makeTmp,
  readRunLogs,
  runCliInDir,
  writeCaptureProjectEntry,
  writeMdxCaptureProjectEntry,
} from "./projectCaptureFileV062Helpers.js";

describe("0.6.2 capture:file runtime", () => {
  test("captures a file module under a shared date batch", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "manual");
      await mkdir(docsDir, { recursive: true });
      writeFileSync(join(docsDir, "intro.md"), "# Intro\n\nBatch file source.\n", "utf8");
      await runCliInDir(projectRoot, [
        "source", "add", "file", "20260712",
        "--module", "user-manual",
        "--local", docsDir,
        "--format", "json",
      ]);
      writeFileSync(join(projectRoot, "src", "index.ts"), [
        'import { captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const manual = source("20260712", "user-manual", { type: "file" });',
        "",
        "export default defineProject({",
        "  sources: [manual],",
        "  phases: [captureFile({ source: manual })],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const output = JSON.parse(await runCliInDir(projectRoot, [
        "run", "capture:file:20260712/user-manual", "--format", "json",
      ])) as CaptureRunJson;
      expect(output.result).toMatchObject({
        source: { type: "file", name: "20260712/user-manual" },
        snapshot: {
          manifest: "sources/file/20260712/manifest.json",
          materializedAt: "sources/file/20260712",
        },
      });
      const manifest = parseDocumentSnapshotForSource(JSON.parse(readFileSync(
        join(projectRoot, "sources", "file", "20260712", "manifest.json"),
        "utf8",
      )) as unknown, "20260712/user-manual");
      expect(manifest.source_name).toBe("20260712/user-manual");
      expect(manifest.files.map((file) => file.path)).toEqual(["user-manual.md"]);
      expect(existsSync(join(projectRoot, "sources", "file", "20260712", "user-manual.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("captures relative assets referenced by Markdown inside the source boundary", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "manual-with-assets");
      await mkdir(join(docsDir, "assets"), { recursive: true });
      const firstBytes = new Uint8Array([1, 2, 3, 4]);
      writeFileSync(join(docsDir, "intro.md"), "# Intro\n\n![Diagram](assets/diagram.png)\n", "utf8");
      writeFileSync(join(docsDir, "assets", "diagram.png"), firstBytes);
      await runCliInDir(projectRoot, [
        "source", "add", "file", "20260712",
        "--module", "manual",
        "--local", docsDir,
        "--format", "json",
      ]);
      writeFileSync(join(projectRoot, "src", "index.ts"), [
        'import { captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const manual = source("20260712", "manual", { type: "file" });',
        "",
        "export default defineProject({",
        "  sources: [manual],",
        "  phases: [captureFile({ source: manual })],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const first = JSON.parse(await runCliInDir(projectRoot, [
        "run", "capture:file:20260712/manual", "--format", "json",
      ])) as CaptureRunJson;
      expect(first.result.snapshot.changed).toBe(true);
      const manifestPath = join(projectRoot, "sources", "file", "20260712", "manifest.json");
      const manifest = parseDocumentSnapshotForSource(
        JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
        "20260712/manual",
      );
      expect(manifest.assets).toEqual([{
        path: "assets/diagram.png",
        content_hash: computeDocumentContentHash(firstBytes),
        role: "evidence",
        source: { kind: "file" },
      }]);
      expect(readFileSync(join(projectRoot, "sources", "file", "20260712", "assets", "diagram.png")))
        .toEqual(Buffer.from(firstBytes));

      const legacyManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        sources: Record<string, { assets?: unknown }>;
      };
      delete legacyManifest.sources.manual?.assets;
      writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`, "utf8");
      const staleEnsure = JSON.parse(await runCliInDir(projectRoot, [
        "source", "ensure", "20260712/manual", "--format", "json",
      ])) as Array<Record<string, unknown>>;
      expect(staleEnsure[0]).toMatchObject({
        status: "needs-capture",
        snapshotReady: false,
        diagnostics: ["snapshot linked asset is stale: manifest is missing assets/diagram.png"],
        next: "context run capture:file:20260712/manual",
      });

      const secondBytes = new Uint8Array([5, 6, 7]);
      writeFileSync(join(docsDir, "assets", "diagram.png"), secondBytes);
      const second = JSON.parse(await runCliInDir(projectRoot, [
        "run", "capture:file:20260712/manual", "--format", "json",
      ])) as CaptureRunJson;
      expect(second.result.snapshot.changed).toBe(true);
      expect(second.result.snapshot.snapshot_hash).not.toBe(first.result.snapshot.snapshot_hash);

      writeFileSync(join(docsDir, "intro.md"), "# Intro\n\nNo local asset.\n", "utf8");
      await runCliInDir(projectRoot, [
        "run", "capture:file:20260712/manual", "--format", "json",
      ]);
      const withoutAsset = parseDocumentSnapshotForSource(
        JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
        "20260712/manual",
      );
      expect(withoutAsset.assets).toBeUndefined();
      expect(existsSync(join(projectRoot, "sources", "file", "20260712", "assets", "diagram.png"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:file writes normalized snapshot, manifest, summary, status and idempotent captured_at", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "docs");
      await mkdir(join(docsDir, "guides"), { recursive: true });
      await mkdir(join(docsDir, "private"), { recursive: true });
      writeFileSync(join(docsDir, "guides", "intro.md"), "# Intro\r\n\r\n* Alpha\r\n", "utf8");
      writeFileSync(join(docsDir, "private", "draft.md"), "# Draft\n\nDo not capture.\n", "utf8");

      const added = await runCliInDir(projectRoot, [
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
      expect(JSON.parse(added) as Record<string, unknown>).toMatchObject({
        name: "product-docs",
        local: "../docs",
        include: ["guides/**/*.md"],
      });
      writeCaptureProjectEntry(projectRoot);

      const output = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ])) as CaptureRunJson;

      expect(output.result).toMatchObject({
        kind: "document.capture.file.result",
        source: {
          type: "file",
          name: "product-docs",
          local: "../docs",
          include: ["guides/**/*.md"],
        },
        snapshot: {
          manifest: "sources/file/product-docs/manifest.json",
          materializedAt: "sources/file/product-docs",
          changed: true,
        },
        documents: [{
          path: "intro.md",
          title: "Intro",
          line_count: 3,
        }],
      });
      expect(output.result.next_action).toEqual({
        kind: "reevaluate_workspace_route",
        command: "context status --format json",
        completed_operation: "capture:file:product-docs",
        message: "The current operation completed. Re-evaluate workflow.current before another workspace lifecycle action.",
      });

      const investigation = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--view",
        "read-plan",
        "--format",
        "json",
      ])) as { result: Record<string, unknown> };
      expect(investigation.result).toMatchObject({
        investigation_mode: "collection-neutral",
        allowed_actions: ["view", "propose_collection"],
        classification_state: {
          required: true,
          reason_code: "route.indexer.lifecycle-required",
        },
      });
      expect(investigation.result).not.toHaveProperty("collection");
      expect(investigation.result).not.toHaveProperty("payload_schema");
      expect(investigation.result).not.toHaveProperty("payload_target");
      expect(investigation.result).not.toHaveProperty("semantic_rules");
      expect(output.result.snapshot.snapshot_hash).toBe(
        computeLogicalRawHash([{ path: "intro.md", bytes: "# Intro\n\n- Alpha\n" }]),
      );
      expect(output.log).toMatch(/^\.tmp\/context-runtime\/runs\/run_/u);
      expect(readFileSync(join(projectRoot, "sources", "file", "product-docs", "intro.md"), "utf8"))
        .toBe("# Intro\n\n- Alpha\n");
      expect(existsSync(join(projectRoot, "sources", "file", "product-docs", "draft.md"))).toBe(false);

      const manifestPath = join(projectRoot, "sources", "file", "product-docs", "manifest.json");
      const manifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
      expect(manifest).toMatchObject({
        source_type: "file",
        source_name: "product-docs",
        snapshot_hash: output.result.snapshot.snapshot_hash,
        metadata: {
          capture: {
            include: ["guides/**/*.md"],
          },
        },
        files: [{
          path: "intro.md",
          source_path: "guides/intro.md",
          title: "Intro",
          line_count: 3,
        }],
      });
      const capturedAt = manifest.captured_at;

      const ensure = JSON.parse(await runCliInDir(projectRoot, [
        "source",
        "ensure",
        "product-docs",
        "--format",
        "json",
      ])) as Array<Record<string, unknown>>;
      expect(ensure).toEqual([
        expect.objectContaining({
          name: "product-docs",
          status: "ready",
          snapshotReady: true,
          next: "context status --format json",
        }),
      ]);

      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as Record<string, unknown>;
      expect(status).toMatchObject({
        sourceCount: 1,
        readySources: 1,
        state: "route.indexer.lifecycle-required",
      });
      expect(status).toMatchObject({
        routing: {
          current_state: "route.indexer.lifecycle-required",
          human_gate: {
            required: false,
            kind: "none",
          },
          command_plan: [],
        },
      });
      expect(String(status.next)).toContain("sole registry-and-Provider indexing lifecycle");

      const secondOutput = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ])) as CaptureRunJson;
      expect(secondOutput.result.snapshot.changed).toBe(false);
      const secondManifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
      expect(secondManifest.captured_at).toBe(capturedAt);

      const logs = readRunLogs(projectRoot);
      expect(logs.some((log) =>
        log.phase_id === "capture:file:product-docs" &&
        log.status === "success" &&
        (log.summary as Record<string, unknown> | undefined)?.kind === "document.capture.file.result"
      )).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:file captures MDX documents and _meta.json route metadata without treating JSON as body evidence", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "mdx-docs");
      await mkdir(join(docsDir, "guide", "quickly-setup"), { recursive: true });
      writeFileSync(join(docsDir, "guide", "quickly-setup", "_meta.json"), JSON.stringify([
        "message-setup",
        "workflow",
      ], null, 2), "utf8");
      writeFileSync(join(docsDir, "guide", "quickly-setup", "message-setup.mdx"), [
        "# 消息搭建",
        "",
        '<Card title="快速落地" description="使用消息搭建快速落地" />',
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(docsDir, "guide", "quickly-setup", "workflow.mdx"), "", "utf8");
      writeFileSync(join(docsDir, "guide", "quickly-setup", "ignored.json"), "{\"body\":true}\n", "utf8");

      await runCliInDir(projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--include",
        "**/*.mdx",
        "--include",
        "**/_meta.json",
        "--format",
        "json",
      ]);
      writeMdxCaptureProjectEntry(projectRoot);

      const output = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ])) as CaptureRunJson;

      expect(output.result.documents.map((document) => document.path)).toEqual([
        "message-setup.mdx",
        "workflow.mdx",
        "__context_route_metadata.md",
        "__context_mdx_component_text.md",
      ]);
      expect(output.result.documents.find((document) => document.path === "message-setup.mdx")).toMatchObject({
        title: "消息搭建",
        line_count: 3,
        route: "/guide/quickly-setup/message-setup",
      });
      expect(output.result.documents.find((document) => document.path === "workflow.mdx")).toMatchObject({
        title: "workflow",
        line_count: 0,
        route: "/guide/quickly-setup/workflow",
        empty: true,
      });
      expect(output.result.documents.find((document) => document.path === "__context_route_metadata.md")).toMatchObject({
        title: "Document site route metadata",
      });
      expect(output.result.documents.find((document) => document.path === "__context_mdx_component_text.md")).toMatchObject({
        title: "MDX component text",
      });
      expect(output.result.metadata_files).toEqual([{
        path: "_meta.json",
        routes: ["message-setup", "workflow"],
      }]);
      expect(existsSync(join(projectRoot, "sources", "file", "product-docs", "_meta.json"))).toBe(true);
      expect(existsSync(join(projectRoot, "sources", "file", "product-docs", "ignored.json"))).toBe(false);

      const manifest = parseDocumentSnapshotManifest(
        JSON.parse(readFileSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as unknown,
      );
      expect(manifest.files.map((file) => file.path)).toEqual([
        "message-setup.mdx",
        "workflow.mdx",
        "__context_route_metadata.md",
        "__context_mdx_component_text.md",
      ]);
      expect(manifest.files[0]?.source_path).toBe("guide/quickly-setup/message-setup.mdx");
      expect(manifest.files[1]?.source_path).toBe("guide/quickly-setup/workflow.mdx");
      expect(readFileSync(join(projectRoot, "sources", "file", "product-docs", "__context_route_metadata.md"), "utf8")).toContain("no .html suffix");
      expect(readFileSync(join(projectRoot, "sources", "file", "product-docs", "__context_route_metadata.md"), "utf8"))
        .toContain("Original document path: guide/quickly-setup/message-setup.mdx");
      expect(readFileSync(join(projectRoot, "sources", "file", "product-docs", "__context_mdx_component_text.md"), "utf8")).toContain("component Card title: 快速落地");
      expect(manifest.assets?.map((asset) => asset.path)).toEqual(["_meta.json"]);
      expect(manifest.assets?.[0]?.source?.source_path).toBe("guide/quickly-setup/_meta.json");
      expect(manifest.metadata?.capture?.documentExtensions).toEqual([".md", ".mdx"]);
      expect(manifest.metadata?.capture?.routeHints).toEqual([
        {
          documentPath: "message-setup.mdx",
          route: "/guide/quickly-setup/message-setup",
          metadataPath: "_meta.json",
        },
        {
          documentPath: "workflow.mdx",
          route: "/guide/quickly-setup/workflow",
          metadataPath: "_meta.json",
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
