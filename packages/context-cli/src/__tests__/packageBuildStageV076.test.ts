import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { kbPackage } from "@c4a/context";
import { withStagedPackageOutput } from "../project/packageBuildStage.js";

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
