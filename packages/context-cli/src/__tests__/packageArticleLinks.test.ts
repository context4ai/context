import { expect, test } from "bun:test";
import { projectPackageArticleLinks } from "../project/packageArticleLinks.js";
import { markdownReaderLinks } from "../project/markdownLinks.js";

const selected = new Map([
  ["codeindex/app/entry.md", "wikis/codeindex/app/entry.md"],
  ["architecture/app/design notes.md", "guides/architecture/app/design notes.md"],
  ["codeindex/app/usage.md", "wikis/codeindex/app/usage.md"],
]);
const project = (markdown: string) => projectPackageArticleLinks({ markdown, selected,
  approvedPath: "codeindex/app/entry.md", outputPath: "wikis/codeindex/app/entry.md" });

test("maps approved cross-root, same-root and reference links with encoded paths and fragments", () => {
  const result = project('[Design](../../architecture/app/design%20notes.md#trade-offs)\n[Usage](./usage.md)\n[Design reference][d]\n\n[d]: ../../architecture/app/design%20notes.md#trade-offs');
  expect(result.warnings).toEqual([]);
  expect(markdownReaderLinks(result.markdown).map(link => link.target)).toEqual([
    "../../../guides/architecture/app/design%20notes.md#trade-offs", "usage.md",
    "../../../guides/architecture/app/design%20notes.md#trade-offs",
  ]);
});

test("excluded pages retain an inspect coordinate without pulling content into the selection", () => {
  const result = project('[Runbook](../../sop/app/recovery.md)');
  expect(markdownReaderLinks(result.markdown)).toEqual([]);
  expect(result.markdown).toContain("sop/app/recovery.md");
  expect(result.warnings).toEqual([{ code: "package-article-not-selected", path: "codeindex/app/entry.md", target: "sop/app/recovery.md" }]);
  expect(selected.size).toBe(3);
});

test("does not rewrite external URLs, source coordinates, code examples or assets", () => {
  const markdown = '[Site](https://example.test/a.md)\n[Source](../../../src/entry.ts)\n![Figure](./figure.png)\n[Local](#entry)\n`[Sample](./usage.md)`\n```md\n[Sample](./usage.md)\n```';
  expect(project(markdown)).toEqual({ markdown, warnings: [] });
});

test("uses an independent target mapping rather than assuming KB folder layout", () => {
  const result = projectPackageArticleLinks({ markdown: '[Design](../../architecture/app/design%20notes.md#trade-offs)',
    approvedPath: "codeindex/app/entry.md", outputPath: "site/products/app/index.md",
    selected: new Map([["architecture/app/design notes.md", "site/engineering/design.md"]]) });
  expect(markdownReaderLinks(result.markdown)[0]!.target).toBe("../../engineering/design.md#trade-offs");
});
