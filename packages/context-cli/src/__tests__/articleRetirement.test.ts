import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { updateKnowledgeMap } from "@c4a/context";
import { retireArticles } from "../project/articleRetirement.js";
import { readKnowledgeMap } from "../project/knowledgeMap.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(link = "[Old](old.md)") {
  const parent = resolve(import.meta.dir, "../../../../.tmp/retirement-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-")); roots.push(root);
  await mkdir(join(root, "knowledge/architecture"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  const articles = ["old", "new", "peer"].map(name => ({ article_id: name, path: `architecture/${name}.md`,
    collection: "architecture", visibility: "public", sections: [{ id: name, references: [] }] }));
  for (const article of articles) await writeFile(join(root, "knowledge", article.path), `---\ntitle: ${article.article_id}\ntype: Wiki\ndescription: Example\n---\n<!-- context:section id="${article.article_id}" -->\n${article.article_id === "peer" ? link : article.article_id}\n<!-- /context:section -->\n`);
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ articles }));
  await writeFile(join(root, "src/knowledge-map.yaml"), YAML.stringify(updateKnowledgeMap(undefined, { expected_revision: null,
    upsert: articles.map(article => ({ key: article.article_id, parent: null, title: article.article_id, target: { artifact_ref: article.article_id } })) })));
  return root;
}
const value = { reason: "Content merged into the approved successor", targets: [{ path: "architecture/old.md", replacement: "architecture/new.md" }] };

test("retirement previews, atomically removes the page and structure, rewrites references, and retries safely", async () => {
  const root = await fixture("[Old][ref]\n\n[ref]: old.md\n\n[Direct](knowledge:architecture/old)");
  const original = await readFile(join(root, "knowledge/architecture/old.md"), "utf8");
  const preview = await retireArticles({ projectRoot: root, value });
  expect(preview.action).toBe("preview");
  expect(await readFile(join(root, "knowledge/architecture/old.md"), "utf8")).toBe(original);
  const applied = await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  expect(applied.action).toBe("applied");
  await expect(access(join(root, "knowledge/architecture/old.md"))).rejects.toThrow();
  expect(YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")).articles.map((a: { article_id: string }) => a.article_id)).toEqual(["new", "peer"]);
  const peer = await readFile(join(root, "knowledge/architecture/peer.md"), "utf8");
  expect(peer).toContain("[ref]: new.md");
  expect(peer).toContain("knowledge:architecture/new");
  expect((await readKnowledgeMap(root))!.entries.find(entry => entry.key === "old")!.target!.artifact_ref).toBe("new");
  if (applied.action !== "applied") throw new Error("Missing application");
  const restore = JSON.parse(await readFile(join(root, applied.recovery), "utf8"));
  expect(restore.files.find((file: { path: string }) => file.path === "knowledge/architecture/old.md").content).toBe(original);
  expect((await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision })).action).toBe("already-applied");
});

test("retirement does not guess fragment replacements or discard unresolved incoming links", async () => {
  const root = await fixture("[Old](old.md#old)");
  const preview = await retireArticles({ projectRoot: root, value });
  expect(preview.action === "preview" && preview.blockers.length).toBe(1);
  await expect(retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision })).rejects.toThrow("incoming fragment links");
  expect(await readFile(join(root, "knowledge/architecture/old.md"), "utf8")).toContain("old");
  const without = { reason: "Obsolete", targets: [{ path: "architecture/old.md" }] };
  const inspection = await retireArticles({ projectRoot: root, value: without });
  expect(inspection.action === "preview" && inspection.blockers.length).toBe(1);
});

test("stale preview and invalid replacement preserve all originals", async () => {
  const root = await fixture();
  const preview = await retireArticles({ projectRoot: root, value });
  await writeFile(join(root, "knowledge/architecture/new.md"), "Changed replacement");
  await expect(retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision })).rejects.toThrow("changed");
  await expect(retireArticles({ projectRoot: root, value: { ...value, targets: [{ path: "architecture/old.md", replacement: "architecture/missing.md" }] } })).rejects.toThrow("already-approved");
  await expect(retireArticles({ projectRoot: root, value: { ...value, targets: [{ path: "../outside.md" }] } })).rejects.toThrow("exact approved");
  await access(join(root, "knowledge/architecture/old.md"));
});

test("custom template and fragment navigation references must be resolved explicitly", async () => {
  const root = await fixture();
  await mkdir(join(root, "src/package-templates/kb"), { recursive: true });
  await writeFile(join(root, "src/package-templates/kb/index.md"), "[Old](knowledge:architecture/old)");
  const map = (await readKnowledgeMap(root))!;
  await writeFile(join(root, "src/knowledge-map.yaml"), YAML.stringify(updateKnowledgeMap(map, { expected_revision: map.revision,
    upsert: [{ ...map.entries.find(entry => entry.key === "old")!, target: { artifact_ref: "old", section_key: "old" } }] })));
  const preview = await retireArticles({ projectRoot: root, value });
  expect(preview.action === "preview" && preview.blockers.map(blocker => blocker.path)).toEqual([
    "src/package-templates/kb/index.md", "src/knowledge-map.yaml",
  ]);
});

test("batch retirement without successors removes navigation targets while retaining children", async () => {
  const root = await fixture("No incoming link");
  const value = { reason: "No longer applicable", targets: [{ path: "architecture/old.md" }, { path: "architecture/new.md" }] };
  const preview = await retireArticles({ projectRoot: root, value });
  await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision });
  expect((await readKnowledgeMap(root))!.entries.filter(entry => entry.target).map(entry => entry.key)).toEqual(["peer"]);
});

test("interrupted retirement rolls forward with its original digest", async () => {
  const root = await fixture();
  const preview = await retireArticles({ projectRoot: root, value });
  await expect(retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision,
    inject_failure: point => { if (point === "after-target-delete:knowledge/architecture/old.md") throw new Error("interrupted"); } })).rejects.toThrow("interrupted");
  expect((await retireArticles({ projectRoot: root, value, apply: true, plan_digest: preview.revision })).action).toBe("already-applied");
  await expect(access(join(root, "knowledge/architecture/old.md"))).rejects.toThrow();
});
