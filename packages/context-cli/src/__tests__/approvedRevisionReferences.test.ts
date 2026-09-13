import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticleSourceReference } from "@c4a/context";
import { prepareRevisionReferences } from "../project/approvedRevisionReferences.js";
import { prepareRevisionMarkdown } from "../project/approvedRevisionEdits.js";
import { rememberArticleRegion } from "../project/articleRegionBaselines.js";

test("revision resolves exact regions, retains untouched citations and removes deleted fragments", async () => {
  const root = await mkdtemp(join(tmpdir(), "revision-references-"));
  const source = "# Note\nFirst behavior\nSecond behavior\n";
  const sourceRef = "note:20260912/source.md";
  const locator = { path: "source.md", start_line: 2, end_line: 2 };
  const reference = createArticleSourceReference(sourceRef, locator, source);
  const input = { projectRoot: root, sourceRefs: [sourceRef],
    previous: [{ id: "first", references: [reference] }, { id: "deleted", references: [reference] }],
    sectionIds: ["first", "second"],
  };
  try {
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    await writeFile(join(root, "sources/note/20260912/source.md"), source);
    const result = await prepareRevisionReferences({ ...input, edits: [{ section_id: "second", references: [
      { source_ref: sourceRef, locator: { ...locator, start_line: 3, end_line: 3 } },
    ] }] });
    expect(result).toEqual([{ id: "first", references: [reference] }, { id: "second", references: [
      createArticleSourceReference(sourceRef, { ...locator, start_line: 3, end_line: 3 }, source),
    ] }]);
    expect(await prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [] }] }))
      .toEqual([{ id: "first", references: [] }, { id: "second", references: [] }]);
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "missing", references: [] }] })).rejects.toThrow();
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [] },
      { section_id: "first", references: [] }] })).rejects.toThrow();
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [
      { source_ref: "note:20260912/other.md", locator },
    ] }] })).rejects.toThrow(/outside this revision/);
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [
      { source_ref: sourceRef, locator: { ...locator, path: "other.md" } },
    ] }] })).rejects.toThrow(/not owned/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revision relocates only unique unchanged text and keeps ambiguous references pending", async () => {
  const root = await mkdtemp(join(tmpdir(), "revision-relocation-"));
  const source = "# Note\nExact old behavior\n";
  const reference = createArticleSourceReference("note:20260912/source.md",
    { path: "source.md", start_line: 2, end_line: 2 }, source);
  const input = { projectRoot: root, sourceRefs: [reference.source_ref], sectionIds: ["answer"],
    previous: [{ id: "answer", references: [reference] }], edits: undefined };
  try {
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    const path = join(root, "sources/note/20260912/source.md");
    rememberArticleRegion(root, reference, source);
    await writeFile(path, `Added heading\n${source}`);
    expect(await prepareRevisionReferences(input)).toEqual([{ id: "answer", references: [{ ...reference,
      locator: { ...reference.locator, start_line: 3, end_line: 3 },
    }] }]);
    await writeFile(path, `Added heading\n${source}Exact old behavior\n`);
    expect(await prepareRevisionReferences(input)).toEqual(input.previous);
    await writeFile(path, "# Note\nChanged behavior\n");
    expect(await prepareRevisionReferences(input)).toEqual(input.previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reference-only section edits preserve Markdown bytes", () => {
  const markdown = '---\ntitle: Guide\n---\n\n<!-- context:section id="answer" -->\nAnswer.\n<!-- /context:section -->\n';
  expect(prepareRevisionMarkdown(markdown, { sections: [{ section_id: "answer", references: [] }] }, []))
    .toBe(markdown);
  expect(prepareRevisionMarkdown(markdown, { markdown,
    sections: [{ section_id: "answer", references: [] }] }, [])).toBe(markdown);
  expect(() => prepareRevisionMarkdown(markdown, { markdown,
    sections: [{ section_id: "answer", content: [{ markdown: "Conflicting edit" }] }] }, [])).toThrow();
});
