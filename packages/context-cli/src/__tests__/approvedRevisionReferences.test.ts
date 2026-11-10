import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticleSourceReference, type ArticleStructureEntry } from "@c4a/context";
import { prepareRevisionReferences, removedCitations } from "../project/approvedRevisionReferences.js";
import { SubmissionInputErrors } from "../project/productionFeedback.js";
import { initialRevisionKnowledge, prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { execFileSync } from "node:child_process";
import type { ReferenceReminder } from "../project/approvedRevisionReferences.js";
import YAML from "yaml";
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

test("every citation problem of a page is reported at once", async () => {
  const root = await mkdtemp(join(tmpdir(), "revision-problems-"));
  const sourceRef = "note:20260912/source.md";
  const source = "# Note\nOne\nTwo\n";
  try {
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    await writeFile(join(root, "sources/note/20260912/source.md"), source);
    const input = { projectRoot: root, sourceRefs: [sourceRef], previous: [], sectionIds: ["a", "b"] };
    const error = await prepareRevisionReferences({ ...input, edits: [
      { section_id: "a", references: [{ source_ref: sourceRef, locator: { path: "source.md", start_line: 90, end_line: 91 } }] },
      { section_id: "b", references: [
        { source_ref: "note:elsewhere.md", locator: { path: "elsewhere.md", start_line: 1, end_line: 1 } },
        { source_ref: sourceRef, locator: { path: "source.md", quote: "Missing text" } },
      ] },
    ] }).catch(value => value);
    expect(error).toBeInstanceOf(SubmissionInputErrors);
    expect((error as SubmissionInputErrors).errors.map(item => item.path)).toEqual([
      ["sections", 0, "references", 0, "locator"], ["sections", 1, "references", 0, "source_ref"], ["sections", 1, "references", 1, "locator"]]);
    expect(error.message).toStartWith("3 problems:");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unedited paragraph keeps its citation when its repository checkout is missing", async () => {
  const roots: string[] = [];
  const root = await initialRevisionKnowledge(roots);
  try {
    const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
    const kept = structure.articles[0].sections[0].references[0];
    await rm(join(root, "sources/repo/20260903/revision-fixture"), { recursive: true, force: true });
    const result = await prepareRevisionReferences({ projectRoot: root, sourceRefs: [kept.source_ref],
      previous: [{ id: "edited", references: [] }, { id: "unedited", references: [kept] }], sectionIds: ["edited", "unedited"],
      edits: [{ section_id: "edited", references: [] }] });
    expect(result).toEqual([{ id: "edited", references: [] }, { id: "unedited", references: [kept] }]);
  } finally { for (const item of roots) await rm(item, { recursive: true, force: true }); }
});

describe("citations kept in paragraphs the submission did not resubmit", () => {
  // Repository A (processed by this request) and note B (not processed), both stale.
  async function workspace(roots: string[], change: (source: string) => Promise<void>) {
    const root = await prepareRevisionKnowledge(roots);
    const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")) as { articles?: unknown[] };
    void structure;
    const source = join(root, "fixture-source");
    const before = "export const answer = 42;\n";
    const repo = createArticleSourceReference("repo:20260903/revision-fixture", { path: "src/index.ts", start_line: 1, end_line: 1 }, before);
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    await writeFile(join(root, "sources/note/20260912/b.md"), "Old note\n");
    const note = createArticleSourceReference("note:20260912/b.md", { path: "b.md", start_line: 1, end_line: 1 }, "Old note\n");
    await writeFile(join(root, "sources/note/20260912/b.md"), "New note\n");
    await change(source);
    execFileSync("git", ["add", "-A"], { cwd: source });
    execFileSync("git", ["commit", "-qm", "change"], { cwd: source });
    const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
    const registry = join(root, "sources/repo/index.yaml");
    const parsed = YAML.parse(await readFile(registry, "utf8"));
    parsed.sources[0].modules[0].git.ref = version;
    await writeFile(registry, YAML.stringify(parsed));
    return { root, repo, note };
  }
  const run = (root: string, previous: ArticleStructureEntry["sections"], options: { processed?: string[]; changed?: string[] } = {}) => {
    const reminders: ReferenceReminder[] = [];
    return { reminders, result: prepareRevisionReferences({ projectRoot: root, sourceRefs: previous.flatMap(section => section.references.map(item => item.source_ref)),
      previous, sectionIds: previous.map(section => section.id), edits: [], processedScopes: options.processed ?? [],
      changedBodies: new Set(options.changed ?? []), onReminder: item => reminders.push(item) }) };
  };

  test("a stale citation of a processed source blocks; a stale citation of another source is a reminder", async () => {
    const roots: string[] = [];
    try {
      const { root, repo, note } = await workspace(roots, async source => writeFile(join(source, "src/index.ts"), "export const answer = 43;\n"));
      const blocked = run(root, [{ id: "s", references: [repo, note] }], { processed: ["repo:20260903/revision-fixture"] });
      const error = await blocked.result.catch(value => value);
      expect(error).toMatchObject({ reason: "processed-reference-stale", path: ["fragments", "s", "references", 0] });
      expect(error.message).toContain("src/index.ts:1-1 is not-found (region-not-found) in the source version this revision processes");
      expect(blocked.reminders).toEqual([expect.objectContaining({ section_id: "s", source_ref: "note:20260912/b.md", state: "not-found" })]);
      // Without processed scopes both are reminders and the submission passes unchanged.
      const reminded = run(root, [{ id: "s", references: [repo, note] }]);
      expect(await reminded.result).toEqual([{ id: "s", references: [repo, note] }]);
      expect(reminded.reminders.map(item => item.source_ref)).toEqual(["repo:20260903/revision-fixture", "note:20260912/b.md"]);
    } finally { for (const item of roots) await rm(item, { recursive: true, force: true }); }
  }, 60_000);

  test("a processed source that no longer has the cited file blocks like changed text", async () => {
    const roots: string[] = [];
    try {
      const { root, repo } = await workspace(roots, async source => rm(join(source, "src/index.ts")));
      const error = await run(root, [{ id: "s", references: [repo] }], { processed: ["repo:20260903/revision-fixture"] }).result.catch(value => value);
      expect(error).toMatchObject({ reason: "processed-reference-stale" });
      expect(error.message).toContain("unavailable (source-file-missing)");
    } finally { for (const item of roots) await rm(item, { recursive: true, force: true }); }
  }, 60_000);

  test("a missing checkout blocks only a paragraph whose text changed", async () => {
    const roots: string[] = [];
    try {
      const { root, repo } = await workspace(roots, async source => writeFile(join(source, "README.md"), "unrelated\n"));
      await rm(join(root, "sources/repo/20260903/revision-fixture"), { recursive: true, force: true });
      const previous = [{ id: "edited", references: [repo] }, { id: "unedited", references: [repo] }];
      const error = await run(root, previous, { changed: ["edited"] }).result.catch(value => value);
      expect(error).toMatchObject({ reason: "reference-unverifiable", path: ["fragments", "edited", "references", 0] });
      expect(error.message).toContain("repo:20260903/revision-fixture");
      expect(await run(root, previous).result).toEqual(previous);
    } finally { for (const item of roots) await rm(item, { recursive: true, force: true }); }
  }, 60_000);
});


test("an unreadable source is one problem among the page's others, not the end of the check", async () => {
  const roots: string[] = [];
  try {
    const root = await prepareRevisionKnowledge(roots);
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    await writeFile(join(root, "sources/note/20260912/b.md"), "One\nTwo\n");
    await rm(join(root, "sources/repo/20260903/revision-fixture"), { recursive: true, force: true });
    const repo = "repo:20260903/revision-fixture", note = "note:20260912/b.md";
    const error = await prepareRevisionReferences({ projectRoot: root, sourceRefs: [repo, note], previous: [], sectionIds: ["s"],
      edits: [{ section_id: "s", references: [
        { source_ref: repo, locator: { path: "src/index.ts", start_line: 1, end_line: 1 } },
        { source_ref: note, locator: { path: "b.md", start_line: 8, end_line: 9 } },
        { source_ref: note, locator: { path: "b.md", quote: "Missing text" } },
      ] }] }).catch(value => value);
    expect(error).toBeInstanceOf(SubmissionInputErrors);
    const errors = (error as SubmissionInputErrors).errors;
    expect(errors.map(item => [item.reason, item.path])).toEqual([
      ["source-read-failed", ["sections", 0, "references", 0, "source_ref"]],
      ["locator-out-of-range", ["sections", 0, "references", 1, "locator"]],
      [undefined, ["sections", 0, "references", 2, "locator"]]]);
    expect(errors[0]!.message).toContain(`checkout of ${repo} is not accessible`);
  } finally { for (const item of roots) await rm(item, { recursive: true, force: true }); }
}, 60_000);

test("an incomplete captured document blocks an in-scope stale citation and reminds otherwise", async () => {
  const { initContextProject } = await import("../project/workspace.js");
  const { runCliInDir, writeCaptureProjectEntry } = await import("./projectCaptureFileV062Helpers.js");
  const root = await mkdtemp(join(tmpdir(), "revision-incomplete-"));
  try {
    const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs/intro.md"), "# Intro\n\nRegistered source content.\n");
    await runCliInDir(projectRoot, ["source", "add", "file", "product-docs", "--local", "../docs", "--format", "json"]);
    writeCaptureProjectEntry(projectRoot);
    await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
    // The capture is incomplete (as a partial Lark capture would be) and lacks the cited text.
    const manifestPath = join(projectRoot, "sources/file/product-docs/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.metadata.capture.report = { path: "capture-report.json", fidelityStatus: "complete", evidenceStatus: "complete",
      projectionStatus: "complete", resourceStatus: "warning" };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const cited = createArticleSourceReference("file:product-docs", { path: "intro.md", start_line: 3, end_line: 3 }, "# Intro\n\nEarlier content.\n");
    const input = { projectRoot, sourceRefs: ["file:product-docs"], previous: [{ id: "s", references: [cited] }], sectionIds: ["s"], edits: [] };
    const error = await prepareRevisionReferences({ ...input, processedScopes: ["file:product-docs"] }).catch(value => value);
    expect(error).toMatchObject({ reason: "processed-reference-stale" });
    expect(error.message).toContain("unavailable (source-capture-incomplete)");
    const reminders: ReferenceReminder[] = [];
    expect(await prepareRevisionReferences({ ...input, onReminder: item => reminders.push(item) })).toEqual([{ id: "s", references: [cited] }]);
    expect(reminders).toEqual([expect.objectContaining({ state: "unavailable", reason: "source-capture-incomplete" })]);
    // A path the document does not own names the document's files.
    const notOwned = await prepareRevisionReferences({ ...input, edits: [{ section_id: "s", references: [
      { source_ref: "file:product-docs", locator: { path: "assets/diagram.png", start_line: 1, end_line: 1 } }] }] }).catch(value => value);
    expect(notOwned.message).toContain("Source path assets/diagram.png is not owned by the registered document file:product-docs; cite one of its files: intro.md");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);

test("a revision may cite captured text but not a capture-gap placeholder", async () => {
  const root = await mkdtemp(join(tmpdir(), "revision-capture-gap-"));
  const sourceRef = "note:20260912/source.md";
  try {
    await mkdir(join(root, "sources/note/20260912"), { recursive: true });
    await writeFile(join(root, "sources/note/20260912/source.md"),
      "Main rule\n> Resource unavailable: Synced block (synced_block; permission denied). <!-- block-1 -->\n");
    const submit = (locator: { start_line: number; end_line: number } | { quote: string }) => prepareRevisionReferences({ projectRoot: root, sourceRefs: [sourceRef],
      previous: [], sectionIds: ["s"], edits: [{ section_id: "s", references: [{ source_ref: sourceRef, locator: { path: "source.md", ...locator } }] }] });
    expect((await submit({ start_line: 1, end_line: 1 }))[0]!.references).toHaveLength(1);
    await expect(submit({ start_line: 1, end_line: 2 })).rejects.toThrow("source.md:2 is a capture gap");
    await expect(submit({ quote: "Synced block" })).rejects.toThrow("is a capture gap");
    // In a table, a row with captured cells besides the gap stays citable; a row of gaps does not.
    await writeFile(join(root, "sources/note/20260912/source.md"), [
      "| 官号IM招募 | 私信主播 | > Resource unavailable: Whiteboard (whiteboard; export permission denied). <!-- lark:whiteboard:w1 --> |",
      "| | > Resource unavailable: Whiteboard (whiteboard; export permission denied). <!-- lark:whiteboard:w2 --><br><br> |", ""].join("\n"));
    expect((await submit({ start_line: 1, end_line: 1 }))[0]!.references).toHaveLength(1);
    await expect(submit({ start_line: 2, end_line: 2 })).rejects.toThrow("source.md:2 is a capture gap");
    // Prose that only starts like a placeholder is ordinary text.
    await writeFile(join(root, "sources/note/20260912/source.md"), "> Resource unavailable: explained in the guide\n");
    expect((await submit({ start_line: 1, end_line: 1 }))[0]!.references).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
