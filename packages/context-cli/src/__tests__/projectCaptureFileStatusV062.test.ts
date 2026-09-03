import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseDocumentSnapshotManifest } from "@c4a/extract";
import { initContextProject } from "../project/workspace.js";
import {
  type CaptureRunJson,
  invokeCliInDir,
  makeTmp,
  readRunLogs,
  runCliInDir,
  writeCaptureProjectEntry,
} from "./projectCaptureFileV062Helpers.js";

describe("0.6.2 capture:file status and refresh", () => {
  test("source include changes make the previous file snapshot need capture", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "docs-include-change");
      await mkdir(join(docsDir, "guides"), { recursive: true });
      await mkdir(join(docsDir, "private"), { recursive: true });
      writeFileSync(join(docsDir, "guides", "intro.md"), "# Intro\n", "utf8");
      writeFileSync(join(docsDir, "private", "draft.md"), "# Draft\n", "utf8");

      await runCliInDir(projectRoot, [
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
      writeCaptureProjectEntry(projectRoot);
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);

      await runCliInDir(projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--include",
        "private/**/*.md",
        "--format",
        "json",
      ]);

      const ensured = JSON.parse(await runCliInDir(projectRoot, [
        "source",
        "ensure",
        "product-docs",
        "--format",
        "json",
      ])) as Array<Record<string, unknown>>;
      expect(ensured[0]).toMatchObject({
        name: "product-docs",
        status: "needs-capture",
        snapshotReady: false,
        diagnostics: [expect.stringContaining("snapshot include is stale")],
        next: "context run capture:file:product-docs",
      });

      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as Record<string, unknown>;
      expect(status).toMatchObject({
        sourceCount: 1,
        readySources: 0,
        state: "route.capture.permission-required",
      });
      expect(JSON.stringify(status)).toContain("snapshot include is stale");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:file refreshes include metadata when matching snapshot bytes are unchanged", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "docs-include-same-files");
      await mkdir(join(docsDir, "guides"), { recursive: true });
      writeFileSync(join(docsDir, "guides", "intro.md"), "# Intro\n", "utf8");

      await runCliInDir(projectRoot, [
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
      writeCaptureProjectEntry(projectRoot);
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);

      const manifestPath = join(projectRoot, "sources", "file", "product-docs", "manifest.json");
      const firstManifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);

      await runCliInDir(projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--include",
        "**/*.md",
        "--format",
        "json",
      ]);

      const staleEnsure = JSON.parse(await runCliInDir(projectRoot, [
        "source",
        "ensure",
        "product-docs",
        "--format",
        "json",
      ])) as Array<Record<string, unknown>>;
      expect(staleEnsure[0]).toMatchObject({
        name: "product-docs",
        status: "needs-capture",
        snapshotReady: false,
        diagnostics: [expect.stringContaining("snapshot include is stale")],
      });

      const output = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ])) as CaptureRunJson;
      expect(output.result.snapshot.changed).toBe(false);

      const secondManifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
      expect(secondManifest.snapshot_hash).toBe(firstManifest.snapshot_hash);
      expect(secondManifest.captured_at).toBe(firstManifest.captured_at);
      expect(secondManifest.files.map((file) => file.path)).toEqual(["intro.md"]);
      expect(secondManifest.files[0]?.source_path).toBe("guides/intro.md");
      expect(secondManifest.metadata?.capture?.include).toEqual(["**/*.md"]);

      const readyEnsure = JSON.parse(await runCliInDir(projectRoot, [
        "source",
        "ensure",
        "product-docs",
        "--format",
        "json",
      ])) as Array<Record<string, unknown>>;
      expect(readyEnsure[0]).toMatchObject({
        name: "product-docs",
        status: "ready",
        snapshotReady: true,
        diagnostics: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:file removes stale Markdown snapshot files outside the current manifest", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "docs-cleanup");
      await mkdir(join(docsDir, "guides"), { recursive: true });
      await mkdir(join(docsDir, "obsolete"), { recursive: true });
      writeFileSync(join(docsDir, "guides", "keep.md"), "# Keep\n", "utf8");
      writeFileSync(join(docsDir, "obsolete", "delete-me.md"), "# Delete me\n", "utf8");

      await runCliInDir(projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        docsDir,
        "--format",
        "json",
      ]);
      writeCaptureProjectEntry(projectRoot);
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
      expect(existsSync(join(projectRoot, "sources", "file", "product-docs", "delete-me.md"))).toBe(true);

      rmSync(join(docsDir, "obsolete", "delete-me.md"));
      const output = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ])) as CaptureRunJson;

      expect(output.result.snapshot.changed).toBe(true);
      const manifest = parseDocumentSnapshotManifest(
        JSON.parse(readFileSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as unknown,
      );
      expect(manifest.files.map((file) => file.path)).toEqual(["keep.md"]);
      expect(manifest.files[0]?.source_path).toBe("guides/keep.md");
      expect(existsSync(join(projectRoot, "sources", "file", "product-docs", "delete-me.md"))).toBe(false);
      expect(existsSync(join(projectRoot, "sources", "file", "product-docs", "obsolete"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:file rejects snapshot materializedAt outside the file source snapshot tree", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      const docsDir = join(projectRoot, "..", "docs-invalid-materialized");
      await mkdir(docsDir, { recursive: true });
      writeFileSync(join(docsDir, "readme.md"), "# Readme\n", "utf8");
      writeFileSync(join(projectRoot, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: ../docs-invalid-materialized",
        "    materializedAt: knowledge/product-docs",
        "",
      ].join("\n"), "utf8");
      writeCaptureProjectEntry(projectRoot);

      const resultJson = await invokeCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ]);

      expect(resultJson.status).not.toBe(0);
      expect(resultJson.stderr).toContain("file source \"product-docs\" in sources/file/index.yaml has invalid materializedAt");
      expect(resultJson.stderr).toContain("sources/file/product-docs");
      expect(existsSync(join(projectRoot, "knowledge", "product-docs", "readme.md"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:file runtime errors include actionable next and failed run log detail", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      writeFileSync(join(projectRoot, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "",
      ].join("\n"), "utf8");
      writeCaptureProjectEntry(projectRoot);

      const missingLocal = await invokeCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ]);
      expect(missingLocal.status).not.toBe(0);
      expect(missingLocal.stderr).toContain("file source product-docs is missing local refresh hint");
      expect(missingLocal.stderr).toContain("context source add file product-docs --local <relative-path>");
      const failureLog = readRunLogs(projectRoot).find((log) =>
        log.phase_id === "capture:file:product-docs" && log.status === "failed"
      );
      expect(failureLog).toBeDefined();
      expect(failureLog?.error).toMatchObject({
        message: "file source product-docs is missing local refresh hint",
        detail: {
          next: "context source add file product-docs --local <relative-path>",
        },
      });

      const docsDir = join(projectRoot, "..", "docs-empty-match");
      await mkdir(docsDir, { recursive: true });
      writeFileSync(join(docsDir, "readme.md"), "# Readme\n", "utf8");
      await runCliInDir(projectRoot, [
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

      const noMatch = await invokeCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ]);
      expect(noMatch.status).not.toBe(0);
      expect(noMatch.stderr).toContain("file source product-docs has no Markdown or MDX document files matching include");
      expect(noMatch.stderr).toContain("update sources/file/index.yaml include for product-docs");
      expect(existsSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"))).toBe(false);

      const matchingDocsDir = join(projectRoot, "..", "docs-write-failure");
      await mkdir(matchingDocsDir, { recursive: true });
      writeFileSync(join(matchingDocsDir, "readme.md"), "# Readme\n", "utf8");
      writeFileSync(join(projectRoot, "sources", "file", "product-docs"), "not a directory\n", "utf8");
      await runCliInDir(projectRoot, [
        "source",
        "add",
        "file",
        "product-docs",
        "--local",
        matchingDocsDir,
        "--include",
        "**/*.md",
        "--format",
        "json",
      ]);

      const writeFailure = await invokeCliInDir(projectRoot, [
        "run",
        "capture:file:product-docs",
        "--format",
        "json",
      ]);
      expect(writeFailure.status).not.toBe(0);
      expect(writeFailure.stderr).toContain("file source product-docs snapshot write failed");
      expect(writeFailure.stderr).toContain("fix write permissions or restore sources/file/product-docs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
