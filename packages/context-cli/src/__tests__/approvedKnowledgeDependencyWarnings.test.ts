import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticleSourceReference } from "@c4a/context";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import { approvedKnowledgeDependencyWarnings } from "../project/approvedKnowledgeDependencyWarnings.js";
import { rememberArticleRegion } from "../project/articleRegionBaselines.js";

test("checks actual cited regions without a parser or article dependency graph", async () => {
  const root = await mkdtemp(join(tmpdir(), "article-region-check-"));
  const source = "header\nimportant behavior\nother material\n";
  const reference = createArticleSourceReference("file:guide",
    { path: "guide.md", start_line: 2, end_line: 2 }, source);
  const structure = { articles: [{ article_id: "guide", path: "faq/guide.md",
    collection: "faq", visibility: "public", sections: [{ id: "behavior", references: [reference] }] }] };
  const path = join(root, "sources/file/guide/guide.md");
  try {
    await mkdir(join(root, "sources/file/guide"), { recursive: true });
    await writeFile(join(root, "sources/file/index.yaml"), "sources:\n  - name: guide\n");
    await writeFile(path, source);
    await writeFile(join(root, "sources/file/guide/manifest.json"), JSON.stringify(createDocumentSnapshotManifest({
      sourceType: "file", sourceName: "guide", capturedAt: "2026-09-12T00:00:00.000Z",
      files: [{ path: "guide.md", bytes: source, title: "Guide" }],
    })));
    rememberArticleRegion(root, reference, source);
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toEqual([]);
    await writeFile(path, `inserted line\n${source}`);
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toMatchObject([
      { code: "approved-source-region-moved" },
    ]);
    await writeFile(path, `inserted line\n${source}important behavior\n`);
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toMatchObject([
      { code: "approved-source-region-changed" },
    ]);
    await writeFile(path, source.replace("other material", "unrelated change"));
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toEqual([]);
    await writeFile(path, source.replace("important behavior", "changed behavior"));
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toMatchObject([
      { severity: "warning", code: "approved-source-region-changed", path: "faq/guide.md" },
    ]);
    expect(structure.articles[0]!.sections[0]!.references[0]).toEqual(reference);
    await rm(path);
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toHaveLength(1);
    await symlink(join(root, "sources/file/index.yaml"), path);
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("articles without source regions do not load source registries", async () => {
  expect(await approvedKnowledgeDependencyWarnings("/not-a-workspace", { articles: [] })).toEqual([]);
});

test.each(["note", "sessions"] as const)("%s references cannot borrow a sibling document's content", async kind => {
  const root = await mkdtemp(join(tmpdir(), "article-managed-region-"));
  const text = "# Saved material\nShared text\n";
  const directory = join(root, "sources", kind, "20260912");
  const reference = createArticleSourceReference(`${kind}:20260912/first.md`,
    { path: "first.md", start_line: 2, end_line: 2 }, text);
  const structure = { articles: [{ article_id: "saved", path: "faq/saved.md",
    collection: "faq", visibility: "public", sections: [{ id: "answer", references: [reference] }] }] };
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "first.md"), text);
    await writeFile(join(directory, "second.md"), text);
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toEqual([]);
    reference.locator.path = "second.md";
    expect(await approvedKnowledgeDependencyWarnings(root, structure)).toMatchObject([
      { code: "approved-source-region-changed" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
