import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndexerSourceIdentityInventory, createArticleSourceReference, type IndexerAuthorizedWorksetView } from "@c4a/context";
import { articleReferenceResolver } from "../project/articleReferenceInput.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-article-reference-"));
  roots.push(root);
  const captured = join(root, "sources/repo/sample");
  await mkdir(captured, { recursive: true });
  const content = "// Entry\nexport const answer = 42;\n// End\n";
  await writeFile(join(captured, "entry.ts"), content);
  const view = { items: [{ category: "source-access", value: {
    source_ref: "repo:sample", captured_root: captured, paths: ["entry.ts"],
  } }] } as unknown as IndexerAuthorizedWorksetView;
  return { root, captured, content, view };
}

test("author references hash only the requested captured region and never manufacture a fact ledger", async () => {
  const { root, content, view } = await fixture();
  const reference = { source_ref: "repo:sample", locator: { path: "entry.ts", start_line: 2, end_line: 2 } };
  const resolve = articleReferenceResolver({ projectRoot: root, view });
  expect(resolve([reference, reference])).toEqual([createArticleSourceReference(reference.source_ref, reference.locator, content)]);
  expect(resolve([])).toEqual([]);
  expect(() => resolve(Array.from({ length: 4 }, () => reference))).toThrow("at most three");
  for (const locator of [
    { path: "entry.ts", start_line: 0, end_line: 2 },
    { path: "entry.ts", start_line: 3, end_line: 2 },
    { path: "entry.ts", start_line: 2, end_line: 99 },
    { path: "../outside.ts", start_line: 1, end_line: 1 },
  ]) expect(() => resolve([{ ...reference, locator }])).toThrow();
  expect(() => resolve([{ ...reference, source_ref: "repo:another" }])).toThrow("read scope");
});

test("a permitted path cannot escape the captured root through a symlink", async () => {
  const { root, captured, view } = await fixture();
  await writeFile(join(root, "private.ts"), "private data");
  await rm(join(captured, "entry.ts"));
  await symlink(join(root, "private.ts"), join(captured, "entry.ts"));
  expect(() => articleReferenceResolver({ projectRoot: root, view })([{
    source_ref: "repo:sample", locator: { path: "entry.ts", start_line: 1, end_line: 1 },
  }])).toThrow("authorized root");
});

test("documents use the current captured bytes, not a similarly named source or stale snapshot", async () => {
  const { root, captured, content } = await fixture();
  const view = { items: [{ category: "document", value: {
    source_ref: "file:guide", path: "guide.md", content_path: "sources/repo/sample/entry.ts",
    content_hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
  } }] } as unknown as IndexerAuthorizedWorksetView;
  const reference = { source_ref: "file:guide", locator: { path: "guide.md", start_line: 2, end_line: 2 } };
  expect(articleReferenceResolver({ projectRoot: root, view })([reference]))
    .toEqual([createArticleSourceReference(reference.source_ref, reference.locator, content)]);
  await writeFile(join(captured, "entry.ts"), "changed after task preparation");
  expect(() => articleReferenceResolver({ projectRoot: root, view })([reference])).toThrow("Captured source changed");
});

test("non-text and invalid UTF-8 sources are not silently decoded into references", async () => {
  const { root, captured, view } = await fixture();
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from("text\0binary")]) {
    await writeFile(join(captured, "entry.ts"), bytes);
    expect(() => articleReferenceResolver({ projectRoot: root, view })([{
      source_ref: "repo:sample", locator: { path: "entry.ts", start_line: 1, end_line: 1 },
    }])).toThrow();
  }
});

test("repository submission reuses the prepared source identity instead of accepting changed bytes", async () => {
  const { root, captured, content, view } = await fixture();
  const sourceIdentity = buildIndexerSourceIdentityInventory({ source_ref: "repo:sample", module_ref: null,
    source_input_digest: `sha256:${"a".repeat(64)}`, files: [{ normalized_path: "entry.ts", facts: [],
      content_digest: `sha256:${createHash("sha256").update(content).digest("hex")}` }] });
  const reference = { source_ref: "repo:sample", locator: { path: "entry.ts", start_line: 2, end_line: 2 } };
  expect(articleReferenceResolver({ projectRoot: root, view, sourceIdentity })([reference]))
    .toEqual([createArticleSourceReference(reference.source_ref, reference.locator, content)]);
  await writeFile(join(captured, "entry.ts"), content.replace("42", "43"));
  expect(() => articleReferenceResolver({ projectRoot: root, view, sourceIdentity })([reference]))
    .toThrow("Captured source changed");
});
