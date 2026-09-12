import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { buildApprovedArticleIndex, findApprovedPageForArticleId } from "../project/reviewShared.js";
import { approvedKnowledgeMetadataIndex, hydrateApprovedFrontmatter } from "../project/approvedKnowledgeMetadata.js";

const article = {
  article_id: "stable-article", path: "faq/login.md", collection: "faq", visibility: "internal",
  sections: [{ id: "login", references: [] }],
};

test("Review resolves article identity from structure, not frontmatter or title", async () => {
  const root = await mkdtemp(join(tmpdir(), "approved-article-"));
  try {
    await mkdir(join(root, "knowledge/faq"), { recursive: true });
    await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ articles: [article] }));
    await writeFile(join(root, "knowledge/faq/login.md"), "---\ntitle: Changed title\ntype: Wiki\ndescription: Login help\ntimestamp: 2026-09-08T09:20:01.872Z\n---\n\n# Changed title\n");
    const index = await buildApprovedArticleIndex(root);
    expect(findApprovedPageForArticleId(article.article_id, index)).toMatchObject({
      articleId: article.article_id, relPath: "knowledge/faq/login.md",
    });
    expect(findApprovedPageForArticleId("Changed title", index)).toBeUndefined();
    expect(index.byRelPath.get("knowledge/faq/login.md")?.articleId).toBe(article.article_id);
    await writeFile(join(root, "knowledge/structure.yaml"), "articles: invalid\n");
    await expect(buildApprovedArticleIndex(root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structure classification and visibility cannot be overridden by stale Markdown metadata", () => {
  const metadata = approvedKnowledgeMetadataIndex({ articles: [article] });
  expect(hydrateApprovedFrontmatter({
    metadata, relPath: article.path,
    frontmatter: { title: "Login", visibility: "public", collection: "sop" },
  })).toEqual({ title: "Login", visibility: "internal", collection: "faq" });
});
