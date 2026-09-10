import { expect, test } from "bun:test";
import { packageSiteOutputDir } from "../project/packageOutputPaths.js";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kbPackage, updateKnowledgeMap } from "@c4a/context";
import { createSiteNavigation, siteMarkdown, siteSections, writePackageSite } from "../project/packageSite.js";
import { withStagedPackageOutput } from "../project/packageBuildStage.js";

const pkg = kbPackage({ name: "sample", template: "src/templates", site: { title: "Knowledge", base: "/docs/" } });
const selected = [{ relPath: "codeindex/app/start.md", absPath: "/unused", content: '---\ntitle: Start\nartifact_ref: article:start\n---\n# Start\n<!-- context:section id="entry" -->\n## Entry\n' },
  { relPath: "codeindex/app/next.md", absPath: "/unused", content: '---\ntitle: Next\nartifact_ref: article:next\n---\n# Next\n' }];
const structure = updateKnowledgeMap(undefined, { expected_revision: null, upsert: [
  { key: "business", parent: null, title: "Business" },
  { key: "start", parent: "business", title: "Getting started", target: { artifact_ref: "article:start" } },
  { key: "section", parent: "business", title: "Entry", target: { artifact_ref: "article:start", section_key: "entry" } },
  { key: "future", parent: null, title: "Pending", target: { artifact_ref: "article:future" } },
] });

test("navigation uses stable identities, multiple placements and a complete unmatched fallback", () => {
  const result = createSiteNavigation(pkg, selected, structure);
  expect(result.pages).toHaveLength(2);
  expect(result.entries[0]!.children).toHaveLength(2);
  expect(result.entries[0]!.children[0]!.href?.split("#")[0]).toBe(result.entries[0]!.children[1]!.href?.split("#")[0]);
  expect(result.entries[1]!.children[0]!.title).toBe("Next");
  expect(result.warnings).toHaveLength(2);
  expect(result.entries[1]!.title).toBe("All articles");
  expect(JSON.stringify(result.entries)).not.toContain("codeindex");
  const sections = siteSections(result.entries);
  expect(sections[0]!.pages).toEqual([`/${result.pages[0]!.site_path}`]);
  expect(sections[1]!.pages).toEqual([`/${result.pages[1]!.site_path}`]);
  expect(sections[0]!.href).not.toBe(sections[1]!.href);
  const moved = createSiteNavigation(pkg, [{ ...selected[0]!, relPath: "codeindex/renamed.md" }]);
  expect(moved.pages[0]!.site_path).toBe(result.pages[0]!.site_path);
  expect(() => createSiteNavigation(pkg, [selected[0]!, selected[0]!])).toThrow("Duplicate");
});

test("website rewrites selected references, anchors and delivered assets without touching code", () => {
  const mapping = createSiteNavigation(pkg, selected);
  const pages = new Map(mapping.pages.map(page => [page.package_path, page]));
  const result = siteMarkdown('---\nhead: dangerous\n---\n[Next][n]\n\n[n]: next.md#entry\n\n![Figure](../../../others/assets/a.svg)\n`[Next](next.md)`',
    mapping.pages[0]!.package_path, pages, new Set(["others/assets/a.svg"]));
  expect(result).toContain(`/${mapping.pages[1]!.site_path}#entry`);
  expect(result).toContain("/resources/others/assets/a.svg");
  expect(result).toContain("`[Next](next.md)`");
  expect(result).not.toContain("dangerous");
});

test("VitePress builds an independent site with search, safe prose, anchors and local resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-site-"));
  try {
    const mapping = createSiteNavigation(pkg, selected, structure);
    for (const page of mapping.pages) {
      const path = join(root, pkg.outDir, page.package_path);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, `---\nhead: [[script, {}, "unsafe-script"]]\n---\n# ${page.title}\n\n<a id="section-entry"></a>\n\n## Entry\n\n{{ window.alert('unsafe') }}\n\n<script>unsafe()</script>\n\n| A | B |\n|---|---|\n| { x?: number; y?: number; } | 2 |\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\`\n\n![Figure](../../../others/assets/example.svg)\n`);
    }
    await mkdir(join(root, pkg.outDir, "others/assets"), { recursive: true });
    await writeFile(join(root, pkg.outDir, "others/assets/example.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    await mkdir(join(root, pkg.outDir, "skills/search/references"), { recursive: true });
    await writeFile(join(root, pkg.outDir, "skills/search/SKILL.md"), '---\nname: Search guide\n---\n# Search guide\n\n[Reference](./references/tips.md)');
    await writeFile(join(root, pkg.outDir, "skills/search/references/tips.md"), '# Search tips\n');
    await mkdir(join(root, "sources/repo"), { recursive: true });
    await writeFile(join(root, "sources/repo/index.yaml"), 'sources:\n  - name: "20260910"\n    modules:\n      - name: sample\n        subpath: packages/ui\n        git:\n          remote: git@github.com:example/components.git\n          ref: abc123\n');
    const sourced = selected.map(file => ({ ...file, content: file.content + '\n<!-- context:section id="source" source_ref="repo:20260910/sample" -->\n' }));
    await writeFile(join(root, "changelog.yaml"), JSON.stringify({ entries: [5, 4, 3, 2, 1].map(value => ({
      version: `0.${value}.0`, date: "2026-09-10T10:00:00.000Z", title: `Version ${value}`,
      changes: ["Added coverage <script>unsafe()</script>"], triggers: [{ kind: "module", description: "New module material" }],
      actor: { name: "Example User", kind: "git" },
    })) }));
    await writePackageSite({ projectRoot: root, pkg, selected: sourced, structure });
    const history = await readFile(join(root, packageSiteOutputDir(pkg), "changelog.html"), "utf8");
    expect(history.match(/<details class="context-history-card"/gu)).toHaveLength(5);
    expect(history.match(/<details class="context-history-card" open/gu)).toHaveLength(3);
    expect(history).toContain("Example User");
    expect(history).toMatch(/<summary>[\s\S]*?Example User updated on <time[\s\S]*?<\/summary>/u);
    expect(history).not.toContain("User: Example User");
    expect(history).toContain("context-empty-sidebar");
    const llmsHome = await readFile(join(root, packageSiteOutputDir(pkg), "llms/index.html"), "utf8");
    expect(llmsHome).toContain("context-empty-sidebar");
    const llmsMain = llmsHome.match(/<main\b[^>]*>([\s\S]*?)<\/main>/u)![1]!;
    expect(llmsMain).not.toContain("changelog.html");
    expect([...llmsMain.matchAll(/href="([^"]*llms-full[^"]*)"/gu)].map(match => match[1])).toEqual(["/docs/llms-full.txt"]);
    expect([...llmsMain.matchAll(/href="([^"]*llms\.txt[^"]*)"/gu)].map(match => match[1])).toEqual(["/docs/llms.txt"]);
    expect(llmsMain).toContain("Getting started");
    expect(llmsMain).not.toContain("/docs/docs/");
    expect((await readFile(join(root, packageSiteOutputDir(pkg), "llms-full.txt"))).subarray(0, 3).toString("hex")).toBe("efbbbf");
    expect(history).toContain("New module material");
    expect(history).not.toContain("<script>unsafe()</script>");
    const home = await readFile(join(root, packageSiteOutputDir(pkg), "index.html"), "utf8");
    const article = await readFile(join(root, packageSiteOutputDir(pkg), mapping.pages[0]!.site_path), "utf8");
    expect(article).not.toContain("context-history-button");
    expect(article).toMatch(/LLM Docs[\s\S]*?Changelog[\s\S]*?VPNavBarAppearance/u);
    expect(article).toContain('changelog.html');
    expect(home).toContain("Business");
    expect(home).toContain('"light"');
    expect(home).toContain("context-theme:");
    expect(article).toContain('id="section-entry"');
    expect(article).toContain("<table");
    expect(article).toContain("x?: number;");
    expect(article).not.toContain("<script>unsafe()");
    expect(article).not.toContain("unsafe-script");
    expect(article).toContain("language-mermaid");
    expect(article).toContain('class="context-sources"');
    expect(article).toContain("https://github.com/example/components/tree/abc123/packages/ui");
    expect(await readFile(join(root, packageSiteOutputDir(pkg), "resources/others/assets/example.svg"), "utf8")).toContain("<svg");
    const map = JSON.parse(await readFile(join(root, packageSiteOutputDir(pkg), "context-site-map.json"), "utf8"));
    expect(map.pages).toHaveLength(4);
    expect(map.sections[0].title).toBe("Business");
    expect(map.sections.some((section: { title: string }) => section.title === "Skills")).toBe(false);
    expect(map.sections[0].pages).toHaveLength(1);
    for (const section of map.sections) {
      expect(await readFile(join(root, packageSiteOutputDir(pkg), section.href.slice(1)), "utf8")).toContain(section.title);
    }
    const skill = map.pages.find((page: { package_path: string }) => page.package_path === "skills/search/SKILL.md");
    expect(await readFile(join(root, packageSiteOutputDir(pkg), skill.site_path), "utf8")).toContain("Search guide");
    expect(map.warnings).toHaveLength(2);
    // A failed additional channel must not replace the prior package.
    await expect(withStagedPackageOutput(root, pkg, async staged => {
      await mkdir(join(root, packageSiteOutputDir(staged)));
      await writePackageSite({ projectRoot: root, pkg: staged, selected });
    })).rejects.toThrow("Website output already exists");
    expect(await readFile(join(root, packageSiteOutputDir(pkg), "index.html"), "utf8")).toBe(home);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
