import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { initContextProject } from "../project/workspace.js";
import {
  findDocumentSnapshotForSource,
  DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION,
} from "../project/documentBatchManifest.js";
import {
  makeTmp,
  runCliInDir,
} from "./projectCaptureFileV062Helpers.js";

describe("0.6.9 flat document date batches", () => {
  test("two file sources share one date manifest without deleting sibling documents", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const manualDir = join(projectRoot, "..", "manual");
      const apiDir = join(projectRoot, "..", "api");
      await mkdir(manualDir, { recursive: true });
      await mkdir(apiDir, { recursive: true });
      writeFileSync(join(manualDir, "intro.md"), "# Manual\n\nFirst revision.\n", "utf8");
      writeFileSync(join(apiDir, "reference.md"), "# API\n\nReference body.\n", "utf8");

      for (const source of [
        { module: "user-manual", local: manualDir },
        { module: "api-reference", local: apiDir },
      ]) {
        await runCliInDir(projectRoot, [
          "source", "add", "file", "20260712",
          "--module", source.module,
          "--local", source.local,
          "--format", "json",
        ]);
      }
      writeFileSync(join(projectRoot, "src", "index.ts"), [
        'import { captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const manual = source("20260712", "user-manual", { type: "file" });',
        'const api = source("20260712", "api-reference", { type: "file" });',
        "",
        "export default defineProject({",
        "  sources: [manual, api],",
        "  phases: [captureFile({ source: manual }), captureFile({ source: api })],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      await runCliInDir(projectRoot, ["run", "capture:file:20260712/user-manual", "--format", "json"]);
      await runCliInDir(projectRoot, ["run", "capture:file:20260712/api-reference", "--format", "json"]);
      writeFileSync(join(manualDir, "intro.md"), "# Manual\n\nSecond revision.\n", "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:20260712/user-manual", "--format", "json"]);

      const dateRoot = join(projectRoot, "sources", "file", "20260712");
      expect(existsSync(join(dateRoot, "user-manual.md"))).toBe(true);
      expect(existsSync(join(dateRoot, "api-reference.md"))).toBe(true);
      expect(readFileSync(join(dateRoot, "user-manual.md"), "utf8")).toContain("Second revision");
      expect(readFileSync(join(dateRoot, "api-reference.md"), "utf8")).toContain("Reference body");

      const rawManifest = JSON.parse(readFileSync(join(dateRoot, "manifest.json"), "utf8")) as Record<string, unknown>;
      expect(rawManifest.schema_version).toBe(DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION);
      expect(Object.keys(rawManifest.sources as Record<string, unknown>).sort()).toEqual([
        "api-reference",
        "user-manual",
      ]);
      expect(findDocumentSnapshotForSource(rawManifest, "20260712/user-manual")?.files[0]?.path).toBe("user-manual.md");
      expect(findDocumentSnapshotForSource(rawManifest, "20260712/api-reference")?.files[0]?.path).toBe("api-reference.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
