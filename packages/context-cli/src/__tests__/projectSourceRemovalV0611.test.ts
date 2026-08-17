import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import {
  renderDocumentManifestFile,
  updateDocumentManifestFile,
} from "../project/documentBatchManifest.js";
import { initContextProject } from "../project/workspace.js";
import { invokeCliInDir } from "./documentSourcesV062Helpers.js";

function removalDigest(stdout: string): string {
  return (JSON.parse(stdout) as { plan_digest: string }).plan_digest;
}

async function addDocumentSource(input: {
  projectRoot: string;
  type: "file" | "lark";
  batch: string;
  module: string;
  local?: string;
}): Promise<void> {
  const args = input.type === "file"
    ? ["source", "add", "file", input.batch, "--module", input.module, "--local", input.local!, "--format", "json"]
    : ["source", "add", "lark", input.batch, "--module", input.module, "--doc-token", `token-${input.module}`, "--format", "json"];
  expect((await invokeCliInDir(input.projectRoot, args)).status).toBe(0);
}

async function writeBatchSnapshot(input: {
  projectRoot: string;
  type: "file" | "lark";
  batch: string;
  modules: string[];
}): Promise<void> {
  const root = join(input.projectRoot, "sources", input.type, input.batch);
  await mkdir(root, { recursive: true });
  let manifest: ReturnType<typeof updateDocumentManifestFile> | null = null;
  for (const module of input.modules) {
    const bytes = `# ${module}\n`;
    await writeFile(join(root, `${module}.md`), bytes, "utf8");
    manifest = updateDocumentManifestFile({
      current: manifest,
      snapshot: createDocumentSnapshotManifest({
        sourceType: input.type,
        sourceName: `${input.batch}/${module}`,
        capturedAt: "2026-08-12T00:00:00.000Z",
        files: [{ path: `${module}.md`, bytes, title: module }],
      }),
    });
  }
  await writeFile(join(root, "manifest.json"), renderDocumentManifestFile(manifest!), "utf8");
}

describe("project source removal", () => {
  test("previews and removes an unreferenced source through the registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-source-remove-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docs = join(root, "docs");
      await mkdir(docs, { recursive: true });
      await writeFile(join(docs, "guide.md"), "# Guide\n", "utf8");
      const added = await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "file", "20260811", "--module", "guide", "--local", docs, "--format", "json",
      ]);
      expect(added.status).toBe(0);

      const preview = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260811/guide", "--format", "json",
      ]);
      expect(preview.status).toBe(0);
      expect(JSON.parse(preview.stdout)).toMatchObject({
        action: "preview",
        source: { type: "file", name: "20260811/guide" },
        references: [],
        cleanup: { mode: "registry-only" },
      });

      const removed = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260811/guide", "--yes", "--plan-digest", removalDigest(preview.stdout), "--format", "json",
      ]);
      expect(removed.status).toBe(0);
      expect(JSON.parse(removed.stdout)).toMatchObject({
        action: "removed",
        source: { type: "file", name: "20260811/guide" },
      });
      const registry = await readFile(join(initialized.projectRoot, "sources/file/index.yaml"), "utf8");
      expect(registry).not.toContain("guide");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks removal while the project declaration still references the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-source-remove-referenced-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const docs = join(root, "docs");
      await mkdir(docs, { recursive: true });
      await writeFile(join(docs, "guide.md"), "# Guide\n", "utf8");
      expect((await invokeCliInDir(initialized.projectRoot, [
        "source", "add", "file", "20260811", "--module", "guide", "--local", docs, "--format", "json",
      ])).status).toBe(0);
      await writeFile(join(initialized.projectRoot, "src/index.ts"), [
        'import { defineProject, source } from "@c4a/context";',
        'const guide = source("20260811", "guide", { type: "file" });',
        "export default defineProject({ sources: [guide], phases: [], packages: [] });",
        "",
      ].join("\n"), "utf8");

      const preview = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260811/guide", "--format", "json",
      ]);
      const blocked = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260811/guide", "--yes", "--plan-digest", removalDigest(preview.stdout), "--format", "json",
      ]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain("source-remove-referenced");
      expect(blocked.stderr).toContain("project.sources[0]");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("removing an uncaptured Lark module preserves every snapshot in the shared batch directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-source-remove-shared-lark-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      for (const module of ["first", "second", "pending"]) {
        await addDocumentSource({ projectRoot: initialized.projectRoot, type: "lark", batch: "20260812", module });
      }
      await writeBatchSnapshot({
        projectRoot: initialized.projectRoot,
        type: "lark",
        batch: "20260812",
        modules: ["first", "second"],
      });

      const preview = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260812/pending", "--format", "json",
      ]);
      expect(preview.status).toBe(0);
      expect(JSON.parse(preview.stdout)).toMatchObject({
        cleanup: {
          mode: "registry-only",
          filesToRemove: [],
          directoriesToRemove: [],
          sharedMaterializedBy: ["lark:20260812/first", "lark:20260812/second"],
        },
      });
      const removed = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260812/pending", "--yes", "--plan-digest", removalDigest(preview.stdout), "--format", "json",
      ]);
      expect(removed.status).toBe(0);
      expect(await readFile(join(initialized.projectRoot, "sources/lark/20260812/first.md"), "utf8")).toBe("# first\n");
      expect(await readFile(join(initialized.projectRoot, "sources/lark/20260812/second.md"), "utf8")).toBe("# second\n");
      const manifest = await readFile(join(initialized.projectRoot, "sources/lark/20260812/manifest.json"), "utf8");
      expect(manifest).toContain("20260812/first");
      expect(manifest).toContain("20260812/second");
      expect(manifest).not.toContain("20260812/pending");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("removing a captured module deletes only manifest-owned files for Lark and file batches", async () => {
    for (const type of ["lark", "file"] as const) {
      const root = await mkdtemp(join(tmpdir(), `ctx-source-remove-owned-${type}-`));
      try {
        const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
        const docs = join(root, "docs");
        await mkdir(docs, { recursive: true });
        for (const module of ["first", "second"]) {
          await addDocumentSource({ projectRoot: initialized.projectRoot, type, batch: "20260812", module, local: docs });
        }
        await writeBatchSnapshot({ projectRoot: initialized.projectRoot, type, batch: "20260812", modules: ["first", "second"] });

        const preview = await invokeCliInDir(initialized.projectRoot, [
          "source", "remove", "20260812/first", "--format", "json",
        ]);
        expect(preview.status).toBe(0);
        expect(JSON.parse(preview.stdout)).toMatchObject({
          cleanup: {
            mode: "document-snapshot",
            manifestEntry: "20260812/first",
            filesToRemove: [`sources/${type}/20260812/first.md`],
            directoriesToRemove: [],
          },
        });
        const removed = await invokeCliInDir(initialized.projectRoot, [
          "source", "remove", "20260812/first", "--yes", "--plan-digest", removalDigest(preview.stdout), "--format", "json",
        ]);
        expect(removed.status).toBe(0);
        expect(await readFile(join(initialized.projectRoot, `sources/${type}/20260812/second.md`), "utf8")).toBe("# second\n");
        const manifest = await readFile(join(initialized.projectRoot, `sources/${type}/20260812/manifest.json`), "utf8");
        expect(manifest).not.toContain("20260812/first");
        expect(manifest).toContain("20260812/second");
        await expect(readFile(join(initialized.projectRoot, `sources/${type}/20260812/first.md`), "utf8")).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("requires a fresh preview digest before applying a destructive cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-source-remove-plan-digest-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await addDocumentSource({ projectRoot: initialized.projectRoot, type: "lark", batch: "20260812", module: "first" });
      const missing = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260812/first", "--yes", "--format", "json",
      ]);
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain("source-remove-plan-required");

      const preview = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260812/first", "--format", "json",
      ]);
      await addDocumentSource({ projectRoot: initialized.projectRoot, type: "lark", batch: "20260812", module: "second" });
      const stale = await invokeCliInDir(initialized.projectRoot, [
        "source", "remove", "20260812/first", "--yes", "--plan-digest", removalDigest(preview.stdout), "--format", "json",
      ]);
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain("source-remove-plan-stale");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
