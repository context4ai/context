import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticleSourceReference } from "@c4a/context";
import { prepareRevisionReferences, removedCitations } from "../project/approvedRevisionReferences.js";
import { prepareRevisionMarkdown } from "../project/approvedRevisionEdits.js";
import { rememberArticleRegion } from "../project/articleRegionBaselines.js";
import { suggestedRange } from "../project/articleReferenceObservation.js";

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
    const symbolic = await prepareRevisionReferences({ ...input, edits: [{ section_id: "second", references: [
      { source_ref: sourceRef, locator: { path: "source.md", quote: "Second behavior" } },
      { source_ref: sourceRef, locator: { path: "source.md", start_line: 3, end_line: 3 } },
      { source_ref: sourceRef, locator: { path: "source.md", quote: "Second behavior" } },
      { source_ref: sourceRef, locator: { path: "source.md", quote: "Second behavior" } },
    ] }] });
    expect(symbolic).toEqual(result);
    expect(await prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [] }] }))
      .toEqual([{ id: "first", references: [] }, { id: "second", references: [] }]);
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "missing", references: [] }] })).rejects.toThrow();
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [] },
      { section_id: "first", references: [] }] })).rejects.toThrow();
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [
      { source_ref: "note:20260912/other.md", locator },
    ] }] })).rejects.toMatchObject({ message: expect.stringContaining(`allowed sources: ${sourceRef}`),
      path: ["sections", 0, "references", 0, "source_ref"] });
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [
      { source_ref: sourceRef, locator: { path: "source.md", quote: "Missing behavior" } },
    ] }] })).rejects.toMatchObject({ message: expect.stringContaining("Fragment first:"),
      path: ["sections", 0, "references", 0, "locator"] });
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [
      { source_ref: sourceRef, locator: { ...locator, path: "other.md" } },
    ] }] })).rejects.toThrow(/not owned/);
    await writeFile(join(root, "sources/note/20260912/source.md"), Array.from({ length: 12 }, (_, line) => `Line ${line}`).join("\n"));
    const lines = (count: number) => Array.from({ length: count }, (_, index) =>
      ({ source_ref: sourceRef, locator: { path: "source.md", start_line: index + 1, end_line: index + 1 } }));
    expect((await prepareRevisionReferences({ ...input, edits: [{ section_id: "second", references: lines(8) }] }))[1]!.references).toHaveLength(8);
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "first", references: [] }, { section_id: "second", references: lines(9) }] }))
      .rejects.toMatchObject({ message: expect.stringContaining("Fragment second: A fragment can cite at most 8 source regions"),
        path: ["sections", 1, "references"] });
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

test("a resubmitted earlier citation keeps its evidence; quote selects the text now at that position", async () => {
  const root = await mkdtemp(join(tmpdir(), "revision-kept-reference-"));
  const sourceRef = "note:20260912/source.md";
  const source = "# Note\nOld implementation\nOther text\n";
  const reference = createArticleSourceReference(sourceRef, { path: "source.md", start_line: 2, end_line: 2 }, source);
  const input = { projectRoot: root, sourceRefs: [sourceRef], sectionIds: ["answer"], previous: [{ id: "answer", references: [reference] }] };
  const resubmit = { section_id: "answer", references: [{ source_ref: sourceRef, locator: { path: "source.md", start_line: 2, end_line: 2 } }] };
  try {
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    const path = join(root, "sources/note/20260912/source.md");
    rememberArticleRegion(root, reference, source);
    // The old implementation moved away; new text now occupies line 2.
    const changed = "# Note\nNew implementation\nOther text\nOld implementation\n";
    await writeFile(path, changed);
    const kept = await prepareRevisionReferences({ ...input, edits: [resubmit] });
    expect(kept[0]!.references).toEqual([{ ...reference, locator: { ...reference.locator, start_line: 4, end_line: 4 } }]);
    const reselected = await prepareRevisionReferences({ ...input, edits: [{ section_id: "answer", references: [
      { source_ref: sourceRef, locator: { path: "source.md", quote: "New implementation" } }] }] });
    expect(reselected[0]!.references).toEqual([createArticleSourceReference(sourceRef, { path: "source.md", start_line: 2, end_line: 2 }, changed)]);
    // Without the earlier evidence the resubmission is rejected with both choices.
    await writeFile(path, "# Note\nNew implementation\nOther text\n");
    await expect(prepareRevisionReferences({ ...input, edits: [resubmit] })).rejects.toMatchObject({
      reason: "kept-reference-unresolved", path: ["sections", 0, "references", 0, "locator"],
      message: expect.stringContaining("use a quote or heading locator") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removed citations match by source, file and content, not by text alone", () => {
  const text = "# Note\nShared behavior\nOther\n";
  const moved = "# Note\nIntro\nShared behavior\nOther\n";
  const a = createArticleSourceReference("note:20260912/a", { path: "a.md", start_line: 2, end_line: 2 }, text);
  const b = createArticleSourceReference("note:20260912/a", { path: "b.md", start_line: 2, end_line: 2 }, text);
  const other = createArticleSourceReference("note:20260913/c", { path: "a.md", start_line: 2, end_line: 2 }, text);
  const aMoved = createArticleSourceReference("note:20260912/a", { path: "a.md", start_line: 3, end_line: 3 }, moved);
  expect(a.content_digest).toBe(b.content_digest);
  const previous = [{ id: "s", references: [a, b] }];
  // A and B cite identical text; dropping B still lists B.
  expect(removedCitations(previous, [{ id: "s", references: [a] }]))
    .toEqual([{ section_id: "s", source_ref: "note:20260912/a", path: "b.md", start_line: 2, end_line: 2 }]);
  // A line move in the same file is kept.
  expect(removedCitations(previous, [{ id: "s", references: [aMoved, b] }])).toEqual([]);
  // The same text from another source is a replacement and is listed.
  expect(removedCitations([{ id: "s", references: [a] }], [{ id: "s", references: [other] }]).map(item => item.path)).toEqual(["a.md"]);
  // Citations of a removed section are listed too.
  expect(removedCitations(previous, [])).toHaveLength(2);
});

test("suggested locators submit as new citations, never as another earlier citation", async () => {
  const root = await mkdtemp(join(tmpdir(), "revision-suggested-"));
  const sourceRef = "note:20260912/source.md";
  const before = "one\ntwo\nA\nfour\n";
  const after = "A2\nfour\n";
  const first = createArticleSourceReference(sourceRef, { path: "source.md", start_line: 1, end_line: 1 }, before);
  const third = createArticleSourceReference(sourceRef, { path: "source.md", start_line: 3, end_line: 3 }, before);
  const cited = [first, third].map(item => ({ source_ref: item.source_ref, path: item.locator.path,
    start_line: item.locator.start_line, end_line: item.locator.end_line }));
  try {
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    await writeFile(join(root, "sources/note/20260912/source.md"), after);
    const input = { projectRoot: root, sourceRefs: [sourceRef], previous: [{ id: "s", references: [first, third] }], sectionIds: ["s"] };
    // Line 3's new text maps onto line 1, which the same section already cites.
    const suggested = (await suggestedRange(root, third, before, after, cited))!;
    expect(suggested).toMatchObject({ start_line: 1, end_line: 1, text: "A2", locator: { path: "source.md", quote: "A2" } });
    await expect(prepareRevisionReferences({ ...input, edits: [{ section_id: "s", references: [
      { source_ref: sourceRef, locator: { path: "source.md", start_line: 1, end_line: 1 } }] }] })).rejects.toThrow("repeats an earlier citation");
    expect(await prepareRevisionReferences({ ...input, edits: [{ section_id: "s", references: [{ source_ref: sourceRef, locator: suggested.locator }] }] }))
      .toEqual([{ id: "s", references: [createArticleSourceReference(sourceRef, { path: "source.md", start_line: 1, end_line: 1 }, after)] }]);
    // Without a collision the numeric suggestion submits as written.
    const moved = "x\ny\nA2\n";
    await writeFile(join(root, "sources/note/20260912/source.md"), moved);
    const second = createArticleSourceReference(sourceRef, { path: "source.md", start_line: 2, end_line: 2 }, "x\nA\n");
    const numeric = (await suggestedRange(root, second, "x\nA\n", moved, []))! as { locator: { path: string; start_line: number; end_line: number } };
    expect(numeric.locator).toEqual({ path: "source.md", start_line: 2, end_line: 3 });
    expect(await prepareRevisionReferences({ ...input, previous: [{ id: "s", references: [second] }],
      edits: [{ section_id: "s", references: [{ source_ref: sourceRef, locator: numeric.locator }] }] }))
      .toEqual([{ id: "s", references: [createArticleSourceReference(sourceRef, numeric.locator, moved)] }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
