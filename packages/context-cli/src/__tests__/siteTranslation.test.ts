import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kbPackage, updateKnowledgeMap, type PackageDefinition } from "@c4a/context";
import {
  inspectSiteTranslations, prepareSiteTranslation, siteTranslationFingerprint, skipSiteTranslation,
  submitSiteTranslation, translationStructureIssues,
} from "../project/siteTranslation.js";
import { createSiteNavigation, writePackageSite } from "../project/packageSite.js";
import { packageSiteOutputDir } from "../project/packageOutputPaths.js";
import { restoreOriginNavLinks } from "../project/packageSiteLocales.js";

const approved = '---\ntitle: Guide\n---\n# Guide\n\n<!-- context:section id="setup" -->\n## Setup\n\nRun it. See [next](next.md).\n\n```bash\ncontext status\n```\n\n```mermaid\nflowchart LR\nA-->B\n```\n<!-- /context:section -->\n';
const translated = '---\ntitle: 指南\n---\n# 指南\n\n<!-- context:section id="setup" -->\n## 准备\n\n运行。参见[下一篇](next.md)。\n\n```bash\ncontext status\n```\n\n```mermaid\nflowchart LR\nA[开始]-->B\n```\n<!-- /context:section -->\n';

test("translations must keep sections, code, languages and link targets", () => {
  expect(translationStructureIssues(approved, translated)).toEqual([]);
  expect(translationStructureIssues(approved, translated.replace("title: 指南\n", ""))).toHaveLength(1);
  expect(translationStructureIssues(approved, translated.replace('id="setup"', 'id="other"'))).toHaveLength(1);
  expect(translationStructureIssues(approved, translated.replace("context status", "context run"))).toHaveLength(1);
  expect(translationStructureIssues(approved, translated.replace("```bash", "```sh"))).toHaveLength(1);
  expect(translationStructureIssues(approved, translated.replace("(next.md)", "(other.md)"))).toHaveLength(1);
});

test("server-rendered origin nav links skip the site base", () => {
  const html = '<a class="title" href="/docs/">T</a>' +
    '<a class="VPLink link VPNavBarMenuLink active" href="/docs/" target="_self" tabindex="0">Home</a>' +
    '<a class="VPLink link" href="/docs/search/" target="_self">Search</a>' +
    '<a class="VPLink link" href="/docs/pages/a.html">Article</a>';
  expect(restoreOriginNavLinks(html, "/docs/", ["/", "/search/"])).toBe('<a class="title" href="/docs/">T</a>' +
    '<a class="VPLink link VPNavBarMenuLink active" href="/" target="_self" tabindex="0">Home</a>' +
    '<a class="VPLink link" href="/search/" target="_self">Search</a>' +
    '<a class="VPLink link" href="/docs/pages/a.html">Article</a>');
  expect(restoreOriginNavLinks(html, "/", ["/"])).toBe(html);
});

test("prepare, submit and skip track freshness by approved content", async () => {
  const parent = await mkdtemp(join(tmpdir(), "context-translation-"));
  try {
    const root = parent;
    await mkdir(join(root, "knowledge/codeindex"), { recursive: true });
    await writeFile(join(root, "knowledge/codeindex/guide.md"), approved);
    await writeFile(join(root, "knowledge/codeindex/next.md"), "---\ntitle: Next\n---\n# Next\n");
    const plain = { kind: "package.kb", name: "plain", outDir: "dist/plain", reads: [], writes: [],
      template: { path: "src/templates", vars: {} } } as unknown as PackageDefinition;
    expect((await inspectSiteTranslations(root, [plain])).route_satisfied).toBe(true);
    const pkg = { ...plain, site: { base: "/", lang: "en-US", locales: { "zh-CN": {} } } } as PackageDefinition;
    const task = await prepareSiteTranslation(root, [pkg]);
    expect(task.items.map(item => item.state)).toEqual(["missing", "missing"]);
    expect((await inspectSiteTranslations(root, [pkg])).route_satisfied).toBe(false);
    await mkdir(join(root, ".tmp/agent-payloads"), { recursive: true });
    await writeFile(join(root, ".tmp/agent-payloads/guide.md"), translated);
    await expect(submitSiteTranslation(root, [pkg], { expected_digest: "stale", articles: [], map_entries: [] }, file => join(root, file)))
      .rejects.toThrow("changed");
    await writeFile(join(root, ".tmp/agent-payloads/bad.md"), translated.replace("context status", "context run"));
    await expect(submitSiteTranslation(root, [pkg], { expected_digest: task.expected_digest!, map_entries: [],
      articles: [{ locale: "zh-CN", approved_path: "knowledge/codeindex/guide.md", file: ".tmp/agent-payloads/bad.md" }] }, file => join(root, file)))
      .rejects.toThrow("nothing was saved");
    expect(existsSync(join(root, "translations/zh-CN/wikis/guide.md"))).toBe(false);
    const before = await siteTranslationFingerprint(root, pkg);
    await submitSiteTranslation(root, [pkg], { expected_digest: task.expected_digest!, map_entries: [],
      articles: [{ locale: "zh-CN", approved_path: "knowledge/codeindex/guide.md", file: ".tmp/agent-payloads/guide.md" }] }, file => join(root, file));
    expect(await siteTranslationFingerprint(root, pkg)).not.toBe(before);
    const stored = await readFile(join(root, "translations/zh-CN/codeindex/guide.md"), "utf8");
    expect(stored).toContain("source_digest:");
    const afterSubmit = await inspectSiteTranslations(root, [pkg]);
    expect(afterSubmit.items.map(item => item.state)).toEqual(["current", "missing"]);
    expect(afterSubmit.route_satisfied).toBe(true);
    await writeFile(join(root, "knowledge/codeindex/guide.md"), approved.replace("Run it.", "Run it twice."));
    const changed = await inspectSiteTranslations(root, [pkg]);
    expect(changed.items[0]!.state).toBe("stale");
    expect(changed.route_satisfied).toBe(false);
    await skipSiteTranslation(root, [pkg], changed.source_set_digest!);
    expect((await inspectSiteTranslations(root, [pkg])).route_satisfied).toBe(true);
  } finally { await rm(parent, { recursive: true, force: true }); }
}, 60000);

test("localized website keeps one URL per page with a block per reader language", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-site-locales-"));
  try {
    const pkg = kbPackage({ name: "sample", template: "src/templates", site: { title: "Docs", base: "/context/", lang: "en-US",
      locales: { "zh-CN": { title: "文档", label: "简体中文" } },
      nav: [{ text: "Source Graph", link: "/sourcegraph/" }],
      more: [{ text: "Release Notes", target: { artifact_ref: "article:notes" }, locales: { "zh-CN": "发布说明" } }],
    } });
    const files = [["guide", approved], ["next", "---\ntitle: Next\n---\n# Next\n"], ["notes", "---\ntitle: Notes\n---\n# Notes\n"]] as const;
    const selected = files.map(([name, content]) => ({ relPath: `codeindex/${name}.md`, absPath: "/unused", content,
      article: { article_id: `article:${name}`, path: `codeindex/${name}.md`, collection: "codeindex" as const, visibility: "public", sections: [] } }));
    const structure = updateKnowledgeMap(undefined, { expected_revision: null, upsert: [
      { key: "start", parent: null, title: "Getting Started" },
      { key: "guide", parent: "start", title: "Guide", target: { artifact_ref: "article:guide" } },
      { key: "next", parent: "start", title: "Next", target: { artifact_ref: "article:next" } },
    ] });
    const mapping = createSiteNavigation(pkg, selected, structure);
    expect(mapping.warnings).toHaveLength(0);
    for (const page of mapping.pages) {
      const path = join(root, pkg.outDir, page.package_path);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, selected.find(file => `knowledge/${file.relPath}` === page.approved_path)!.content);
    }
    const { approvedArticleDigest } = await import("../project/siteTranslation.js");
    await mkdir(join(root, "translations/zh-CN/codeindex"), { recursive: true });
    await writeFile(join(root, "translations/zh-CN/codeindex/guide.md"),
      translated.replace("title: 指南\n", `title: 指南\ntranslation:\n  locale: zh-CN\n  source_digest: ${approvedArticleDigest(approved)}\n`));
    await writeFile(join(root, "translations/zh-CN/codeindex/notes.md"),
      "---\ntitle: 说明\ntranslation:\n  locale: zh-CN\n  source_digest: outdated\n---\n# 说明\n");
    await writeFile(join(root, "translations/zh-CN/knowledge-map.yaml"), "locale: zh-CN\nentries:\n  start: { title: 入门, source_digest: x }\n");
    await writePackageSite({ projectRoot: root, pkg, selected, structure });
    const output = join(root, packageSiteOutputDir(pkg));
    const page = (artifact: string) => readFile(join(output, mapping.pages.find(item => item.artifact_ref === artifact)!.site_path), "utf8");
    const next = mapping.pages.find(item => item.artifact_ref === "article:next")!;
    const guide = await page("article:guide");
    expect(guide).toContain('<div data-context-locales="en-US" lang="en-US">');
    expect(guide).toContain('<div data-context-locales="zh-CN" lang="zh-CN">');
    expect(guide).toContain("Run it.");
    expect(guide).toContain("运行。");
    expect(guide).toContain('<span data-context-locales="zh-CN" lang="zh-CN">入门</span>');
    expect(guide).toContain(`/context/${next.site_path}`);
    expect(guide).not.toContain("/context/zh/");
    const chineseBlock = guide.slice(guide.indexOf('<div data-context-locales="zh-CN"'));
    expect(chineseBlock).toContain('id="section-setup"');
    expect(chineseBlock).not.toContain("context:section");
    expect(guide).not.toMatch(/context-locale-[0-9a-f]{16}/u);
    expect(guide).toContain("简体中文");
    expect(guide).not.toContain("VPNavBarTranslations");
    const untranslated = await page("article:next");
    expect(untranslated).toContain("尚未翻译");
    expect(untranslated).toContain('<div data-context-locales="en-US zh-CN" lang="en-US">');
    const stale = await page("article:notes");
    expect(stale).toContain("译文可能已过时");
    expect(stale).toContain('class="context-locale-original">查看原文</button>');
    expect(guide).toContain('<span data-context-locales="zh-CN" lang="zh-CN">发布说明</span>');
    expect(guide).toContain("Source Graph");
    expect(guide).not.toContain("All articles");
    expect(guide).toContain(">On this page</div>");
    expect(guide).toContain('Placeholder">Search</span>');
    expect(guide).toContain('href="/sourcegraph/" target="_self"');
    expect(guide).toContain('<script id="context-appearance">');
    expect(guide).not.toContain('id="check-dark-mode"');
    expect(guide).toContain('localStorage.getItem("context-theme")');
    expect(guide).toContain('<script id="context-locale">');
    expect(guide).toMatch(/key:"context-locale"/);
    const map = JSON.parse(await readFile(join(output, "context-site-map.json"), "utf8"));
    expect(map.locales).toEqual([{ tag: "zh-CN", translated: 1, stale: 1, missing: 1 }]);
    expect(existsSync(join(output, "zh"))).toBe(false);
    expect(() => createSiteNavigation(kbPackage({ name: "x", template: "t", site: { more: [{ text: "Missing", target: { artifact_ref: "article:none" } }] } }), selected))
      .toThrow("not a delivered article");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
