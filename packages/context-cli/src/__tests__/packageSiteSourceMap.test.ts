import { expect, test } from "bun:test";
import type { ArticleStructureEntry, SourcesRegistry } from "@c4a/context";
import { createSiteSourceMaps, siteDocumentKey, siteSectionHeadings } from "../project/packageSiteSourceMap.js";
import { siteArticleSources } from "../project/packageSiteSources.js";

const registry: SourcesRegistry = {
  kind: "sources.registry", registryPaths: { repo: "", file: "", lark: "" }, absolutePaths: { repo: "", file: "", lark: "" },
  repos: [{ id: "snapshot/ui", name: "ui", namespace: "snapshot", module: "ui", materializedAt: "", remote: "git@github.com:example/widgets.git", ref: "abc123def4567890abc123def4567890abc123de" }],
  larks: [{ id: "snapshot/guide", name: "guide", title: "Usage guide", materializedAt: "", url: "https://docs.example.com/guide" }], files: [],
  notes: [{ id: "20261001/decisions.md", name: "20261001/decisions.md", namespace: "20261001", module: "decisions.md", materializedAt: "sources/note/20261001/decisions.md" }], sessions: [],
};
const digest = `sha256:${"a".repeat(64)}`;
const ref = (source_ref: string, path: string, start_line = 1, end_line = 4) => ({ source_ref, locator: { path, start_line, end_line }, content_digest: digest });
const entry = (id: string, sections: ArticleStructureEntry["sections"]) => ({
  article: { article_id: id, path: `${id}.md`, collection: "codeindex", visibility: "public", sections } as ArticleStructureEntry,
  href: `/pages/${id}.html`, titles: { "en-US": `Title ${id}`, "zh-CN": `标题 ${id}` },
  sectionTitles: Object.fromEntries(sections.map(section => [section.id, { "en-US": section.id, "zh-CN": "" }])),
});
const button = entry("button", [
  { id: "usage", references: [ref("repo:snapshot/ui", "src/components/button/index.ts", 3, 8), ref("lark:snapshot/guide", "guide.md")] },
  { id: "styling", references: [ref("repo:snapshot/ui", "src/components/button/index.ts", 20, 30), ref("repo:snapshot/ui", "skills/button-style/SKILL.md")] },
  { id: "why", references: [ref("note:20261001/decisions.md", "decisions.md")] },
]);
const input = { registry, titles: new Map([[siteDocumentKey("note:20261001/decisions.md", "decisions.md"), "Design decisions"]]),
  articles: [button, entry("theme", [{ id: "tokens", references: [ref("repo:snapshot/ui", "skills/button-style/SKILL.md", 9, 12)] }]),
    entry("empty", [{ id: "intro", references: [] }])] };

test("source maps come from recorded references only, grouped by where each document lives", () => {
  const map = createSiteSourceMaps(input).get("button")!;
  expect(map.docs.map(doc => [doc.title, doc.path])).toEqual([
    ["index", "src/components/button/index.ts"], ["Usage guide", "guide.md"], ["button-style", "skills/button-style/SKILL.md"], ["Design decisions", "decisions.md"],
  ]);
  // Two regions of one file stay distinct citations, each with the link the plain list uses.
  expect(map.docs[0]!.refs).toEqual([
    { s: 0, lines: [3, 8], href: siteArticleSources(button.article, registry)[0]!.href! },
    { s: 1, lines: [20, 30], href: siteArticleSources(button.article, registry)[2]!.href! },
  ]);
  expect(map.areas.map(area => [area.kind, area.label])).toEqual([
    ["repo", "ui · button"], ["lark", { zh: "飞书文档", en: "Lark docs" }], ["repo", "ui · button-style"], ["note", { zh: "笔记", en: "Notes" }],
  ]);
  expect(map.sections.map(section => section.titles)).toEqual([{ "en-US": "usage", "zh-CN": "" }, { "en-US": "styling", "zh-CN": "" }, { "en-US": "why", "zh-CN": "" }]);
  // Articles citing the same document link to each other; an article without references gets no map.
  expect(map.others).toEqual([{ titles: { "en-US": "Title theme", "zh-CN": "标题 theme" }, href: "/pages/theme.html", docs: [2] }]);
  expect(createSiteSourceMaps(input).has("empty")).toBe(false);
});

test("the layout is deterministic and stays inside the drawing", () => {
  const first = createSiteSourceMaps(input).get("button")!;
  expect(createSiteSourceMaps(input).get("button")).toEqual(first);
  for (const node of [...first.sections, ...first.docs]) {
    expect(node.x).toBeGreaterThanOrEqual(70); expect(node.x).toBeLessThanOrEqual(first.w - 70);
    expect(node.y).toBeGreaterThanOrEqual(50); expect(node.y).toBeLessThanOrEqual(first.h - 64);
  }
  expect(first.sectionArea.blobs).toHaveLength(first.sections.length * 4);
  // Each label's free space reaches halfway to its row neighbours and stays inside the drawing.
  for (const node of [...first.sections, ...first.docs]) {
    expect(node.rl).toBeGreaterThan(0); expect(node.rr).toBeGreaterThan(0);
    expect(node.x - node.rl).toBeGreaterThanOrEqual(8); expect(node.x + node.rr).toBeLessThanOrEqual(first.w - 8);
  }
  // Area names lean with their blob's edge, never steeper than about 29 degrees.
  for (const area of [first.sectionArea, ...first.areas]) expect(Math.abs(area.la)).toBeLessThanOrEqual(28.7);
});

test("many directories coarsen into a few source areas", () => {
  const many = entry("many", [{ id: "all", references: ["a", "b", "c"].map(name => ref("repo:snapshot/ui", `packages/${name}/src/index.ts`)) },
    { id: "more", references: ["d", "e", "f", "g"].map(name => ref("repo:snapshot/ui", `packages/${name}/src/index.ts`)) }]);
  const map = createSiteSourceMaps({ ...input, articles: [many] }).get("many")!;
  expect(map.areas.map(area => area.label)).toEqual(["ui · packages"]);
});

test("sections are named by their heading, else by their first prose; the opening has no name", () => {
  const headings = siteSectionHeadings([
    '<!-- context:section id="intro" -->', "Opening text.", "<!-- /context:section -->",
    '<!-- context:section id="setup" -->', "## Set up **the** [client](./client.md) {#setup}", "", "### Detail", "<!-- /context:section -->",
    '<!-- context:section id="note" -->', "> [!NOTE]", "> Use **version 2** when you install `two` packages.", "<!-- /context:section -->",
  ].join("\n"));
  expect([...headings]).toEqual([["setup", "Set up the client"], ["note", "Use version 2 when you install two packages."]]);
});

test("each source type has one colour: repository files, Skills, Lark and notes", () => {
  const map = createSiteSourceMaps(input).get("button")!;
  // src/components/button/index.ts is code, skills/button-style/SKILL.md a Skill.
  expect(map.areas.map(area => [area.kind, area.color])).toEqual([
    ["repo", "#16a34a"], ["lark", "#2e7dd6"], ["repo", "#db2777"], ["note", "#ea7a1e"],
  ]);
  const docs = entry("docs", [{ id: "guide", references: [ref("repo:snapshot/ui", "docs/guide.md")] }]);
  expect(createSiteSourceMaps({ ...input, articles: [docs] }).get("docs")!.areas[0]!.color).toBe("#16a34a");
});
