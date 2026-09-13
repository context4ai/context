import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { createArticleSourceReference } from "@c4a/context";
import { productionExistingArticleNavigation } from "../project/productionExistingArticles.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const parent = resolve(".tmp/production-existing-article-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-")); roots.push(root);
  await mkdir(join(root, "knowledge/architecture"), { recursive: true });
  return root;
}
const formal = (name: string) => ({ article_id: `article:${name}`, path: `architecture/${name}.md`, collection: "architecture",
  visibility: "public", sections: [{ id: "behavior", references: [createArticleSourceReference("repo:service",
    { path: "service.ts", start_line: 1, end_line: 1 }, "export class Service {}\n")] }] });

test("existing topic navigation returns reader metadata and source anchors, never the body or a new persistent index", async () => {
  const root = await fixture();
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ articles: [formal("service")] }));
  await writeFile(join(root, "knowledge/architecture/service.md"), `---\ntitle: Service responsibilities\ndescription: Explains the service boundary.\n---\n${"BODY_MUST_NOT_BE_PROJECTED".repeat(10000)}`);
  const files = await productionExistingArticleNavigation(root);
  expect(files.get("existing-articles.md")).toContain("Articles: 1");
  const page = files.get("existing-articles-1.md")!;
  expect(page).toContain("Service responsibilities");
  expect(page).toContain("Explains the service boundary.");
  expect(page).toContain("article:service");
  expect(page).toContain("repo:service: service.ts");
  expect(page).not.toContain("BODY_MUST_NOT_BE_PROJECTED");
  expect(await readdir(root)).toEqual(["knowledge"]);
});

test("bounded pages keep all articles discoverable and malformed headers remain explicit gaps", async () => {
  const root = await fixture();
  const articles = Array.from({ length: 65 }, (_, index) => formal(`page-${String(index).padStart(3, "0")}`));
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ articles }));
  for (const article of articles) await writeFile(join(root, "knowledge", article.path), "---\ntitle: Existing topic\ndescription: A reader question.\n---\n");
  await writeFile(join(root, "knowledge", articles[0]!.path), `---\ntitle: ${"x".repeat(70 * 1024)}`);
  const files = await productionExistingArticleNavigation(root);
  expect(files.size).toBe(3);
  expect(files.get("existing-articles.md")).toContain("existing-articles-2.md");
  expect(files.get("existing-articles-1.md")).toContain("Navigation gap:");
  expect(files.get("existing-articles-2.md")).toContain(articles[64]!.article_id);
});

test("symlink articles are not read and an empty library needs no synthetic topic", async () => {
  const root = await fixture();
  expect((await productionExistingArticleNavigation(root)).get("existing-articles.md")).toContain("Articles: 0");
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ articles: [formal("linked")] }));
  await writeFile(join(root, "outside.md"), "---\ntitle: DO_NOT_READ\ndescription: Private target\n---\n");
  await symlink(join(root, "outside.md"), join(root, "knowledge/architecture/linked.md"));
  const page = (await productionExistingArticleNavigation(root)).get("existing-articles-1.md")!;
  expect(page).toContain("Navigation gap:");
  expect(page).not.toContain("DO_NOT_READ");
});
