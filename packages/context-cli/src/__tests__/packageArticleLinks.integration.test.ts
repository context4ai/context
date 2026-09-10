import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { kbPackage } from "@c4a/context";
import { writeSelectedPackageKnowledge } from "../project/packageBuildContent.js";
import { markdownReaderLinks } from "../project/markdownLinks.js";

test("the real KB writer rewrites cross-collection links and preserves package exclusion", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-article-links-"));
  try {
    const pkg = kbPackage({ name: "navigation", template: { path: "src/template", vars: {} } });
    const files = [
      { relPath: "codeindex/app/entry.md", content: "# Entry\n\n[Design](../../architecture/app/design.md#decisions)\n[Recovery](../../sop/app/recovery.md)\n" },
      { relPath: "architecture/app/design.md", content: "# Design\n\n## Decisions\n\nKeep the public interface small.\n" },
    ].map(file => ({ ...file, absPath: join(root, "knowledge", file.relPath) }));
    for (const file of files) { await mkdir(dirname(file.absPath), { recursive: true }); await writeFile(file.absPath, file.content); }
    const output = await writeSelectedPackageKnowledge({ projectRoot: root, pkg, files });
    const page = "wikis/codeindex/app/entry.md";
    const markdown = await readFile(join(root, pkg.outDir, page), "utf8");
    const links = markdownReaderLinks(markdown);
    expect(links.map(link => link.target)).toEqual(["../../../guides/architecture/app/design.md#decisions"]);
    expect(await readFile(join(root, pkg.outDir, posix.join(posix.dirname(page), links[0]!.target.split("#")[0]!)), "utf8")).toContain("## Decisions");
    expect(output.linkWarnings.map(warning => warning.target)).toEqual(["sop/app/recovery.md"]);
    for (const file of files) expect(await readFile(file.absPath, "utf8")).toBe(file.content);
  } finally { await rm(root, { recursive: true, force: true }); }
});
