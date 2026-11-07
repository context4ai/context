import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as syncFs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import { kbPackage } from "@c4a/context";
import { withCommandReadCache } from "../project/commandReadCache.js";
import { packageOutputFingerprint } from "../project/packageBuildReceipt.js";
import { collectPackageFreshness } from "../project/packageBuilder.js";
import { readSourceStatus } from "../project/statusReaders.js";
import { initContextProject } from "../project/workspace.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "context-read-reuse-")); roots.push(root); return root;
}

test("one source observation parses a shared manifest once even above the file-cache capacity", async () => {
  const root = await fixture();
  const batch = "20260101";
  const sourceRoot = join(root, "sources/lark", batch);
  await fs.mkdir(sourceRoot, { recursive: true });
  const modules = Array.from({ length: 80 }, (_, index) => ({ name: `doc-${index}`, docToken: `document${index}` }));
  const sources = Object.fromEntries(await Promise.all(modules.map(async entry => {
    await fs.writeFile(join(sourceRoot, `${entry.name}.md`), "# Document\n");
    return [entry.name, createDocumentSnapshotManifest({ sourceType: "lark", sourceName: `${batch}/${entry.name}`,
      capturedAt: "2026-01-01T00:00:00.000Z", files: [{ path: `${entry.name}.md`, bytes: "# Document\n", title: "Document" }],
      metadata: { source: { docToken: entry.docToken } } })];
  })));
  await fs.writeFile(join(root, "sources/lark/index.yaml"), stringify({ sources: [{ name: batch, modules }] }));
  const path = join(sourceRoot, "manifest.json");
  await fs.writeFile(path, JSON.stringify({ schema_version: "context.document-snapshot-batch.v1", source_type: "lark", batch, sources }));
  const original = syncFs.readFileSync;
  let reads = 0;
  const spy = spyOn(syncFs, "readFileSync").mockImplementation(((...args: Parameters<typeof original>) => {
    if (String(args[0]) === path) reads++;
    return original(...args);
  }) as typeof original);
  try {
    const status = await readSourceStatus(root);
    expect(status.diagnostics).toEqual([]);
    expect(status.documentSources).toHaveLength(80);
    expect(status.documentSources.every(source => source.snapshotReady)).toBe(true);
    expect(reads).toBe(1);
    await fs.writeFile(path, "{ invalid manifest");
    const next = await readSourceStatus(root);
    expect(next.documentSources.every(source => !source.snapshotReady)).toBe(true);
    expect(reads).toBe(2);
  } finally { spy.mockRestore(); }
});

test("output hashes are reused within a command, and edits, additions, deletions and a new command invalidate reuse", async () => {
  const root = await fixture();
  const pkg = kbPackage({ name: "sample", template: "src/templates" });
  const path = join(root, pkg.outDir, "file.bin");
  await fs.mkdir(join(path, ".."), { recursive: true }); await fs.writeFile(path, "first");
  const original = fs.readFile;
  let reads = 0;
  const spy = spyOn(fs, "readFile").mockImplementation(((...args: Parameters<typeof original>) => {
    if (String(args[0]) === path) reads++;
    return original(...args);
  }) as typeof original);
  try {
    await withCommandReadCache(async () => {
      const first = await packageOutputFingerprint(root, pkg);
      expect(await packageOutputFingerprint(root, pkg)).toEqual(first); expect(reads).toBe(1);
      await fs.writeFile(join(root, "replacement"), "other"); await fs.rename(join(root, "replacement"), path);
      expect((await packageOutputFingerprint(root, pkg)).fingerprint).not.toBe(first.fingerprint); expect(reads).toBe(2);
      await fs.writeFile(join(root, pkg.outDir, "new.bin"), "new");
      expect((await packageOutputFingerprint(root, pkg)).files).toBe(2);
      await fs.rm(join(root, pkg.outDir, "new.bin"));
      expect((await packageOutputFingerprint(root, pkg)).files).toBe(1);
    });
    const previous = reads;
    await withCommandReadCache(() => packageOutputFingerprint(root, pkg)); expect(reads).toBe(previous + 1);
  } finally { spy.mockRestore(); }
});

test("known stale input counts output files without reading their bytes; missing receipt still checks output", async () => {
  const parent = await fixture();
  const { projectRoot: root } = await initContextProject({ cwd: parent, projectDir: "kb", dev: true });
  const pkg = kbPackage({ name: "sample", template: "src/package-templates/kb" });
  const path = join(root, pkg.outDir, "asset.bin");
  await fs.mkdir(join(path, ".."), { recursive: true }); await fs.writeFile(path, Buffer.alloc(1024));
  const receipt = join(root, ".tmp/context-runtime/packages/sample.json");
  await fs.mkdir(join(receipt, ".."), { recursive: true });
  await fs.writeFile(receipt, JSON.stringify({ builder_protocol: "previous-builder", fingerprint: "old", output_fingerprint: "old", output_files: 1, outputs: [] }));
  const original = fs.readFile;
  let reads = 0;
  const spy = spyOn(fs, "readFile").mockImplementation(((...args: Parameters<typeof original>) => {
    if (String(args[0]) === path) reads++;
    return original(...args);
  }) as typeof original);
  try {
    expect(await collectPackageFreshness(root, [pkg])).toEqual([expect.objectContaining({ state: "stale", outputFiles: 1 })]);
    expect(reads).toBe(0);
    await fs.rm(receipt);
    expect(await collectPackageFreshness(root, [pkg])).toEqual([expect.objectContaining({ state: "stale", outputFiles: 1 })]);
    expect(reads).toBe(1);
  } finally { spy.mockRestore(); }
});
