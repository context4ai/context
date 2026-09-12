import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { createArticleSourceReference, type ArticleStructureEntry } from "@c4a/context";
import { approvedStructureInputHash, sha256Text } from "../project/approvedStructureInputHash.js";
import { compactApprovedKnowledgeMarkdown } from "../project/approvedKnowledgeMetadata.js";
import { rememberArticleRegion } from "../project/articleRegionBaselines.js";
import { deprecateApprovedPage } from "../project/reviewMaintenance.js";
import { verifyProjectWorkspace } from "../project/verify.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-article-regions-"));
  roots.push(root);
  await mkdir(join(root, "knowledge/faq"), { recursive: true });
  await mkdir(join(root, "sources/note/20260912"), { recursive: true });
  const source = "Introduction\nDocumented behavior\nOther material\n";
  const sourcePath = join(root, "sources/note/20260912/guide.md");
  await writeFile(sourcePath, source);
  const reference = createArticleSourceReference("note:20260912/guide.md",
    { path: "guide.md", start_line: 2, end_line: 2 }, source);
  rememberArticleRegion(root, reference, source);
  const article: ArticleStructureEntry = { article_id: "guide", path: "faq/guide.md", collection: "faq",
    visibility: "public", sections: [{ id: "answer", references: [reference] }] };
  const markdown = ["---", "title: Guide", "type: Guide", "description: Documented behavior.",
    "timestamp: 2026-09-12T00:00:00.000Z", "---", "", "# Guide", "",
    '<!-- context:section id="answer" -->', "Documented behavior.", "<!-- /context:section -->", ""].join("\n");
  const page = join(root, "knowledge/faq/guide.md");
  await writeFile(page, markdown);
  async function save(articles = [article], content = markdown) {
    await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({
      schema_version: "context.approved-structure.v1", articles,
      input_hash: approvedStructureInputHash({ schemaVersion: "context.approved-structure.v1",
        files: articles.length ? [{ path: article.path, sha256: sha256Text(compactApprovedKnowledgeMarkdown(content)) }] : [],
        metadata: articles }),
    }));
  }
  await save();
  return { root, source, sourcePath, page, article, markdown, save };
}

test("verifies actual source regions and reports drift without rewriting approved content", async () => {
  const sample = await fixture();
  expect((await verifyProjectWorkspace(sample.root)).issues).toEqual([]);
  await writeFile(sample.sourcePath, sample.source.replace("Other material", "Unrelated new material"));
  expect((await verifyProjectWorkspace(sample.root)).issues).toEqual([]);
  await writeFile(sample.sourcePath, `Inserted line\n${sample.source}`);
  expect((await verifyProjectWorkspace(sample.root)).issues).toContainEqual(expect.objectContaining({
    code: "approved-source-region-moved", severity: "warning" }));
  await writeFile(sample.sourcePath, sample.source.replace("Documented behavior", "Changed behavior"));
  expect((await verifyProjectWorkspace(sample.root)).issues).toContainEqual(expect.objectContaining({
    code: "approved-source-region-changed", severity: "warning" }));
  await rm(sample.sourcePath);
  expect((await verifyProjectWorkspace(sample.root)).issues).toContainEqual(expect.objectContaining({
    code: "approved-source-region-changed", severity: "warning" }));
  expect(await readFile(sample.page, "utf8")).toBe(sample.markdown);
});

test("fragment removal must remove its structure references as well", async () => {
  const sample = await fixture();
  await writeFile(sample.page, sample.markdown.replace('<!-- context:section id="answer" -->', "")
    .replace("<!-- /context:section -->", ""));
  const result = await verifyProjectWorkspace(sample.root);
  expect(result.issues.some(issue => issue.severity === "error")).toBe(true);
});

test("explicit article retirement preserves the file and is a no-op on repetition", async () => {
  const sample = await fixture();
  expect((await deprecateApprovedPage({ projectRoot: sample.root, viewRef: "guide" })).changed).toBe(true);
  const retired = await readFile(sample.page, "utf8");
  expect(retired).toContain("deprecated: true");
  expect(retired).toContain("Documented behavior.");
  expect((await deprecateApprovedPage({ projectRoot: sample.root, viewRef: "guide" })).changed).toBe(false);
  await sample.save([], retired);
  expect((await verifyProjectWorkspace(sample.root)).issues).toEqual([]);
});
