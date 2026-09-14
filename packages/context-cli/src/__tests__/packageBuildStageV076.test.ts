import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { kbPackage } from "@c4a/context";
import { withStagedPackageOutput } from "../project/packageBuildStage.js";
import { packageOutputFingerprint, packageOutputSnapshot } from "../project/packageBuildReceipt.js";

test("completed output snapshot and fresh fingerprint agree, including edits and removals", async () => {
  const temp = join(import.meta.dir, "../../../../.tmp");
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, "package-fingerprint-test-"));
  const pkg = kbPackage({ name: "sample", template: "src/templates/kb", site: {} });
  try {
    const observed = async () => packageOutputFingerprint(root, pkg, await packageOutputSnapshot(root, pkg, new Map()));
    expect(await observed()).toEqual(await packageOutputFingerprint(root, pkg));
    await mkdir(join(root, pkg.outDir), { recursive: true });
    await mkdir(join(root, "dist/sample-site"), { recursive: true });
    const path = join(root, pkg.outDir, "page.md");
    await writeFile(path, "# Original");
    await writeFile(join(root, "dist/sample-site/index.html"), "<h1>Site</h1>");
    const initial = await observed();
    expect(initial).toEqual(await packageOutputFingerprint(root, pkg));
    expect(initial.files).toBe(2);
    await writeFile(path, "# Modified");
    const changed = await observed();
    expect(changed).toEqual(await packageOutputFingerprint(root, pkg));
    expect(changed.fingerprint).not.toBe(initial.fingerprint);
    await rm(path);
    expect(await observed()).toEqual(await packageOutputFingerprint(root, pkg));
    expect((await observed()).files).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("package publication preserves unchanged files, removes obsolete outputs, and retains preview on render failure", async () => {
  const temp = join(import.meta.dir, "../../../../.tmp");
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, "package-stage-test-"));
  const pkg = kbPackage({ name: "sample", template: { path: "src/templates/kb", vars: {} } });
  try {
    await withStagedPackageOutput(root, pkg, async (staged) => {
      await writeFile(join(root, staged.outDir, "unchanged.md"), "# Retained page\n");
      await writeFile(join(root, staged.outDir, "changed.md"), "# Old page\n");
      await writeFile(join(root, staged.outDir, "obsolete.md"), "# Removed page\n");
      await writeFile(join(root, staged.outDir, "becomes-directory"), "old file");
      await mkdir(join(root, staged.outDir, "becomes-file"));
      await writeFile(join(root, staged.outDir, "becomes-file/child.md"), "old child");
    });
    const unchanged = join(root, pkg.outDir, "unchanged.md");
    const timestamp = new Date("2000-01-01T00:00:00Z");
    await utimes(unchanged, timestamp, timestamp);
    await expect(withStagedPackageOutput(root, pkg, async (staged) => {
      await writeFile(join(root, staged.outDir, "changed.md"), "# Broken attempt\n");
      throw new Error("render failed");
    })).rejects.toThrow("render failed");
    expect(await readFile(join(root, pkg.outDir, "changed.md"), "utf8")).toBe("# Old page\n");
    await withStagedPackageOutput(root, pkg, async (staged) => {
      await writeFile(join(root, staged.outDir, "unchanged.md"), "# Retained page\n");
      await writeFile(join(root, staged.outDir, "changed.md"), "# New page\n");
      await writeFile(join(root, staged.outDir, "asset.bin"), new Uint8Array([0, 255, 127]));
      await mkdir(join(root, staged.outDir, "becomes-directory"));
      await writeFile(join(root, staged.outDir, "becomes-directory/child.md"), "new child");
      await writeFile(join(root, staged.outDir, "becomes-file"), "new file");
    });
    expect((await stat(unchanged)).mtime.toISOString()).toBe(timestamp.toISOString());
    expect(await readFile(join(root, pkg.outDir, "changed.md"), "utf8")).toBe("# New page\n");
    expect([...await readFile(join(root, pkg.outDir, "asset.bin"))]).toEqual([0, 255, 127]);
    expect(await readFile(join(root, pkg.outDir, "becomes-directory/child.md"), "utf8")).toBe("new child");
    expect(await readFile(join(root, pkg.outDir, "becomes-file"), "utf8")).toBe("new file");
    await expect(stat(join(root, pkg.outDir, "obsolete.md"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
