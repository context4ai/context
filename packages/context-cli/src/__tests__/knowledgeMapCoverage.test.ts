import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kbPackage, updateKnowledgeMap } from "@c4a/context";
import { assertKnowledgeMapCoverage, packageMenuTargets } from "../project/knowledgeMapCoverage.js";
import { writePackageKnowledgeMap } from "../project/packageKnowledgeMap.js";
const article = { artifact_ref: "article:a", section_keys: ["entry"] };
const make = (target?: { artifact_ref: string; section_key?: string }) => updateKnowledgeMap(undefined, { expected_revision: null,
  upsert: [{ key: "category", parent: null, title: "Guide" }, ...(target ? [{ key: "page", parent: "category", title: "Start", target }] : [])] });
test("website pages are not approved knowledge and cannot substitute for article coverage", () => {
  const map = make({ artifact_ref: "site:help" });
  expect(assertKnowledgeMapCoverage(map, [], { known: [] }).total).toBe(0);
  expect(() => assertKnowledgeMapCoverage(map, [article], { known: [article] })).toThrow("incomplete");
});
test("categories alone cannot approve articles and diagnostics contain recovery input", () => {
  try { assertKnowledgeMapCoverage(make(), [article]); throw new Error("expected rejection"); }
  catch (error) { expect(error).toMatchObject({ detail: { reason_code: "knowledge-map-incomplete", coverage: { total: 1, bound: 0 }, next_action: { command: "context task adjust --input - --format json" } } }); }
});
test("article and section links count once; invalid identities and sections fail", () => {
  expect(assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref }), [article]).bound).toBe(1);
  expect(assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref, section_key: "entry" }), [article]).bound).toBe(1);
  const rejection = (run: () => unknown) => { try { run(); } catch (error) { return error; } throw new Error("expected rejection"); };
  expect(rejection(() => assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref, section_key: "typo" }), [article])))
    .toMatchObject({ detail: { invalid_targets: [{ reason: "unknown-section" }] } });
  expect(rejection(() => assertKnowledgeMapCoverage(make({ artifact_ref: "missing" }), [], { known: [article] })))
    .toMatchObject({ detail: { invalid_targets: [{ reason: "unknown-article" }] } });
  expect(rejection(() => assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref }), [article], { require_update: true, has_update: false })))
    .toMatchObject({ detail: { reason_code: "knowledge-map-incomplete", coverage: { bound: 1, missing: [] } } });
});
test("More menu targets need no knowledge map binding; other articles still do", async () => {
  const root = await mkdtemp(join(tmpdir(), "menu-coverage-"));
  try {
    const site = { more: [{ text: "Release Notes", target: { artifact_ref: "article:notes" } }] };
    const pkg = kbPackage({ name: "docs-kb", template: "src/templates", site });
    expect([...packageMenuTargets([pkg, kbPackage({ name: "plain-kb", template: "src/templates" })])]).toEqual(["article:notes"]);
    const file = (name: string) => ({ relPath: `codeindex/${name}.md`, absPath: "/unused", content: `---\ntitle: ${name}\n---\n# ${name}\n`,
      article: { article_id: `article:${name}`, path: `codeindex/${name}.md`, collection: "codeindex" as const, visibility: "public" as const, sections: [] } });
    const structure = make({ artifact_ref: "article:guide" });
    await mkdir(join(root, pkg.outDir), { recursive: true });
    await writePackageKnowledgeMap({ projectRoot: root, pkg, selected: [file("guide"), file("notes")], structure });
    const output = JSON.parse(await readFile(join(root, pkg.outDir, "context-knowledge-map.json"), "utf8"));
    expect(JSON.stringify(output)).not.toContain("article:notes");
    await expect(writePackageKnowledgeMap({ projectRoot: root, pkg: kbPackage({ name: "docs-kb", template: "src/templates" }),
      selected: [file("guide"), file("notes")], structure })).rejects.toMatchObject({ detail: { reason_code: "knowledge-map-incomplete" } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
