import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { kbPackage } from "@c4a/context";
import { repoContentPages, repoContentNavigation, writeRepoContentPages } from "../project/repoContentPages.js";
import { writeRenderedPackageTemplate } from "../project/packageBuildContent.js";
import { writePackageSite } from "../project/packageSite.js";

test("repository entrance stays package-only until website exposure is explicitly selected", async () => {
  const parent = resolve(import.meta.dir, "../../../../.tmp/v0750/site-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "repo-"));
  try {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs/README.md"), "# Repository overview\n\nOriginal repository introduction.\n");
    await writeFile(join(root, "repo-content.yaml"), "protocol: context.repo-content/v1\nentries:\n  docs:\n    kind: docs\n    path: docs\n");
    // Isolate from the enclosing developer repository without changing its Git state.
    const { repoContentGit } = await import("../project/repoContentGit.js");
    await repoContentGit(root, ["init", "-b", "main"]);
    for (const exposed of [false, true]) {
      const pkg = kbPackage({ name: exposed ? "public" : "internal", site: {},
        template: { path: "template" }, repoContentPage: exposed ? { site: true } : true });
      await mkdir(join(root, pkg.outDir, "wikis"), { recursive: true });
      const pages = await repoContentPages(root, pkg);
      await writeRenderedPackageTemplate({ projectRoot: root, pkg,
        files: [{ relPath: "wikis/index.md", absPath: "", content: "# Reference\n\n{{knowledgeGroupsMarkdown}}\n" }],
        bundle: "", knowledgeTimestamp: "", selected: [], navigationFiles: repoContentNavigation(pages), buildInventory: {}, knowledgeStructure: null });
      expect(await readFile(join(root, pkg.outDir, "wikis/index.md"), "utf8")).toContain("repo-content.md");
      await writeRepoContentPages(root, pkg, pages);
      expect(await readFile(join(root, pkg.outDir, "wikis/repo-content.md"), "utf8")).toContain("Original repository introduction");
      await writePackageSite({ projectRoot: root, pkg, selected: [] });
      const map = JSON.parse(await readFile(join(root, pkg.outDir, "context-site-map.json"), "utf8"));
      expect(map.pages.some((page: { package_path: string }) => page.package_path === "wikis/repo-content.md")).toBe(exposed);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
