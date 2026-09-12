import { expect, test } from "bun:test";
import type { ArticleStructureEntry, SourcesRegistry } from "@c4a/context";
import { siteArticleSources } from "../project/packageSiteSources.js";
const registry: SourcesRegistry = {
  kind: "sources.registry", registryPaths: { repo: "", file: "", lark: "" }, absolutePaths: { repo: "", file: "", lark: "" },
  repos: [{ id: "snapshot/ui", name: "ui", namespace: "snapshot", module: "ui", materializedAt: "", subpath: "packages/ui", remote: "git@github.com:example/widgets.git", ref: "abc123def4567890abc123def4567890abc123de" }],
  larks: [{ id: "snapshot/guide", name: "guide", title: "Usage guide", materializedAt: "", url: "https://docs.example.com/guide" }], files: [], notes: [], sessions: [],
};
const article = (repoPath = "src/button.ts"): ArticleStructureEntry => ({
  article_id: "article:button", path: "guide/button.md", collection: "codeindex", visibility: "public",
  sections: [{ id: "usage", references: [
    { source_ref: "repo:snapshot/ui", locator: { path: repoPath, start_line: 3, end_line: 8 }, content_digest: `sha256:${"a".repeat(64)}` },
    { source_ref: "lark:snapshot/guide", locator: { path: "guide.md", start_line: 1, end_line: 4 }, content_digest: `sha256:${"b".repeat(64)}` },
  ] }],
});
test("recorded repository regions and document URLs become deduplicated source links", () => {
  const entry = article();
  entry.sections.push({ ...entry.sections[0]!, id: "more" });
  const result = siteArticleSources(entry, registry);
  expect(result).toHaveLength(2);
  expect(result[0]!.href).toBe("https://github.com/example/widgets/blob/abc123def4567890abc123def4567890abc123de/packages/ui/src/button.ts#L3-L8");
  expect(result[0]!.label).toBe("ui/src/button.ts L3–L8 · abc123d");
  expect(result[1]).toEqual({ label: "Usage guide · guide.md L1–L4", href: "https://docs.example.com/guide" });
});
test("unknown sources and prose do not invent provenance; unsafe paths and URLs are not linked", () => {
  expect(siteArticleSources(undefined, registry)).toEqual([]);
  const unsafe = { ...registry, larks: [{ ...registry.larks[0]!, url: "javascript:alert(1)" }] };
  const result = siteArticleSources(article("../../secret"), unsafe);
  expect(result.every(source => source.href === undefined)).toBe(true);
});
