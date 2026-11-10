import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import YAML from "yaml";
import { createArticleSourceReference } from "@c4a/context";
import { applyProductionArticleEdits, type ProductionArticleBase } from "../project/productionArticleEdits.js";
import { durableContentDigest } from "../project/durableSingleFileTransaction.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";
import { prepareProductionArticle } from "../project/productionArticle.js";
import { productionTaskInput } from "../project/productionStage.js";

const reference = createArticleSourceReference("note:source.md", { path: "source.md", start_line: 1, end_line: 1 }, "Source text\n");
const wrap = (id: string, text: string) => `<!-- context:section id="${id}" -->\n${text}\n<!-- /context:section -->\n`;
const base: ProductionArticleBase = {
  markdown: `---\ntitle: Existing article\ndescription: Existing answer\n---\n\n# Original\n\n${wrap("a", "First.")}\n${wrap("b", "Second.")}\nFooter stays.\n`,
  sections: [{ id: "a", references: [reference] }, { id: "b", references: [] }],
};
function apply(edits: unknown, value = base) {
  const text = YAML.stringify({ edits });
  return applyProductionArticleEdits(value, { task: "revision", input: "current", edits: {
    path: "revision.yaml", text, bytes: Buffer.byteLength(text), digest: durableContentDigest(text),
  } });
}

test("reference-only edits preserve all article bytes and other citations", () => {
  const result = apply([{ replace: ["b"], with: [{ id: "b", references: [] }] }]);
  expect(result.files.content!.text).toBe(base.markdown);
  expect(result.retainedReferences.get("a")).toEqual([reference]);
  expect(result.retainedReferences.has("b")).toBe(false);
});

test("content edits preserve untouched fragments and never guess new citations", () => {
  const result = apply([{ replace: ["a"], with: [{ id: "a", markdown: "Revised." }] }]);
  expect(result.files.content!.text).toBe(base.markdown.replace("First.", "Revised."));
  expect(result.retainedReferences.get("a")).toEqual([reference]);
  expect(() => apply([{ replace: ["a"], with: [{ id: "new", markdown: "New." }] }])).toThrow("requires markdown and references");
});

test("explicit splits, adjacent merges, deletions and anchored insertions retain surrounding text", () => {
  const split = apply([{ replace: ["a"], with: [
    { id: "a1", markdown: "Part one", references: [] }, { id: "a2", markdown: "Part two", references: [] },
  ] }]);
  expect(approvedContextSectionsInMarkdown(split.files.content!.text).map(item => item.id)).toEqual(["a1", "a2", "b"]);
  const merged = apply([{ replace: ["a", "b"], with: [{ id: "merged", markdown: "Together", references: [] }] }]);
  expect(merged.files.content!.text).toContain("# Original\n\n");
  expect(merged.files.content!.text).toEndWith("\nFooter stays.\n");
  const deleted = apply([{ replace: ["b"], with: [] }]);
  expect(YAML.parse(deleted.files.references!.text).sections.map((item: { id: string }) => item.id)).toEqual(["a"]);
  const inserted = apply([{ replace: [], after: null, with: [{ id: "intro", markdown: "Introduction", references: [] }] },
    { replace: [], after: "b", with: [{ id: "end", markdown: "Conclusion", references: [] }] }]);
  expect(approvedContextSectionsInMarkdown(inserted.files.content!.text).map(item => item.id)).toEqual(["intro", "a", "b", "end"]);
});

test("ambiguous edits reject instead of dropping text or guessing positions", () => {
  const replacement = { replace: ["a"], with: [{ id: "a", markdown: "Revised." }] };
  expect(() => apply([replacement, replacement])).toThrow("repeated fragment");
  expect(() => apply([{ ...replacement, replace: ["unknown"] }])).toThrow("Unknown");
  expect(() => apply([{ replace: ["b", "a"], with: [] }])).toThrow("adjacent fragments");
  expect(() => apply([{ replace: ["a", "b"], with: [] }], {
    ...base, markdown: base.markdown.replace(wrap("b", "Second."), `## Keep this heading\n${wrap("b", "Second.")}`),
  })).toThrow("intervening article text");
  expect(() => apply([{ replace: [], after: "a", with: [{ id: "x", markdown: "X", references: [] }] }, replacement])).toThrow("anchor cannot also");
  expect(() => apply([{ replace: ["a"], with: [{ id: "b", markdown: "Oops", references: [] }] }])).toThrow("already exists");
  expect(() => apply([{ replace: ["a"], with: [{ id: "a", markdown: wrap("nested", "Oops") }] }])).toThrow("wrappers");
});

test("fenced marker examples are ordinary content and CRLF outside edited fragments survives", () => {
  const value = { ...base, markdown: base.markdown.replaceAll("\n", "\r\n") };
  const result = apply([{ replace: ["a"], with: [{ id: "a", markdown: `Example:\n\n\`\`\`md\n${wrap("example", "Literal")}\`\`\`` }] }], value);
  expect(result.files.content!.text).toContain(wrap("b", "Second.").replaceAll("\n", "\r\n"));
  expect(approvedContextSectionsInMarkdown(result.files.content!.text).map(item => item.id)).toEqual(["a", "b"]);
});

test("reports every oversized fragment together before reading sources", async () => {
  const planned = { id: "check", article_id: "article:existing", path: "architecture/existing.md", question: "Clarify",
    sources: [{ scope: "note:source.md", baseline: `sha256:${"a".repeat(64)}` }],
    base: `sha256:${"b".repeat(64)}`, batch: "one", after: [], status: "issued" as const };
  const task = { ...planned, input: productionTaskInput(planned) };
  const file = (path: string, text: string) => ({ path, text, bytes: Buffer.byteLength(text), digest: durableContentDigest(text) });
  const refs = (count: number, path = "source.md") => Array.from({ length: count }, (_, index) => ({ source_ref: "note:source.md",
    locator: { path, start_line: index + 1, end_line: index + 1 } }));
  let reads = 0;
  await expect(prepareProductionArticle({ projectRoot: ".tmp/unused-production-references", task,
    approvedBaseDigest: null, sourceReader: async () => { reads++; return "Source text"; },
    files: { task: task.id, input: task.input, content: file("content.md", base.markdown),
      references: file("references.yaml", YAML.stringify({ sections: [
        { id: "a", references: [...refs(9), ...refs(9)] },
        { id: "b", references: ["one.md", "two.md", "three.md", "four.md", "five.md", "six.md"].flatMap(path => refs(1, path)) },
      ] })) },
  })).rejects.toThrow("a: 9 distinct source regions (maximum 8); b: 6 distinct source files (maximum 5)");
  expect(reads).toBe(0);
});

test("a body-only edit cannot silently accept changed retained evidence", async () => {
  const planned = { id: "revision", article_id: "article:existing", path: "architecture/existing.md", question: "Clarify",
    sources: [{ scope: "note:source.md", baseline: `sha256:${"a".repeat(64)}` }],
    base: `sha256:${"b".repeat(64)}`, batch: "one", after: [], status: "issued" as const };
  const task = { ...planned, input: productionTaskInput(planned) };
  const text = YAML.stringify({ edits: [{ replace: ["a"], with: [{ id: "a", markdown: "New phrasing" }] }] });
  await expect(prepareProductionArticle({ projectRoot: ".tmp/unused-production-references", task, base,
    approvedBaseDigest: null, sourceReader: async () => "Changed source text\n",
    files: { task: task.id, input: task.input, edits: {
      path: "edits.yaml", text, digest: durableContentDigest(text), bytes: Buffer.byteLength(text),
    } },
  })).rejects.toThrow("repeats an earlier citation, which is not-found");
});

test("only validated citations grant inherited authority, including repair-draft edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusted-citations-"));
  try {
  const planned = { id: "revision", article_id: "article:existing", path: "architecture/existing.md", question: "Clarify",
    sources: [], base: `sha256:${"b".repeat(64)}`, batch: "one", after: [], status: "issued" as const };
  const task = { ...planned, input: productionTaskInput(planned) };
  const run = (trustedBase?: ProductionArticleBase, source = "Source text\n", explicit = false) => {
    const text = YAML.stringify({ edits: [{ replace: ["a"], with: [{ id: "a", markdown: "Rephrased",
      ...(explicit ? { references: [{ source_ref: reference.source_ref, locator: reference.locator }] } : {}) }] }] });
    // A failed complete draft retains coordinates but has no validated digest.
    const repair = { ...base, sections: base.sections.map(section => ({ ...section,
      references: section.references.map(ref => ({ source_ref: ref.source_ref, locator: ref.locator })) })) };
    return prepareProductionArticle({ projectRoot: root, task, base: repair,
      ...(trustedBase ? { trustedBase } : {}), approvedBaseDigest: null, sourceReader: async () => source,
      files: { task: task.id, input: task.input, edits: { path: "edits.yaml", text, digest: durableContentDigest(text), bytes: Buffer.byteLength(text) } } });
  };
  expect((await run(base)).source_refs).toEqual([reference.source_ref]);
  await expect(run()).rejects.toThrow("outside this task");
  await expect(run(base, "Changed evidence\n")).rejects.toThrow("repeats an earlier citation, which is not-found");
  await expect(run(base, "Source text\n", true)).rejects.toThrow("outside this task");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repeated earlier lines keep, follow a unique move, or report why — all fragments at once", async () => {
  const cite = (line: number, text: string) => createArticleSourceReference("note:source.md", { path: "source.md", start_line: line, end_line: line }, text);
  const old = "Alpha rule\nBeta rule\nGamma rule\nDelta rule\n";
  const trusted: ProductionArticleBase = {
    markdown: `---\ntitle: Existing article\ndescription: Existing answer\n---\n\n${wrap("a", "A.")}\n${wrap("b", "B.")}\n${wrap("c", "C.")}\n${wrap("d", "D.")}\n`,
    sections: [{ id: "a", references: [cite(1, old)] }, { id: "b", references: [cite(2, old)] },
      { id: "c", references: [cite(3, old)] }, { id: "d", references: [cite(4, old)] }],
  };
  const planned = { id: "revision", article_id: "article:existing", path: "architecture/existing.md", question: "Clarify",
    sources: [{ scope: "note:source.md", baseline: `sha256:${"a".repeat(64)}` }],
    base: `sha256:${"b".repeat(64)}`, batch: "one", after: [], status: "issued" as const };
  const task = { ...planned, input: productionTaskInput(planned) };
  // Every fragment resubmits its earlier lines explicitly, as the 1106 agent did.
  const references = YAML.stringify({ sections: trusted.sections.map(section => ({ id: section.id,
    references: section.references.map(ref => ({ source_ref: ref.source_ref, locator: ref.locator })) })) });
  const submit = (current: string) => prepareProductionArticle({ projectRoot: ".tmp/unused-production-references", task,
    base: trusted, trustedBase: trusted, approvedBaseDigest: null, preview: true, sourceReader: async () => current,
    files: { task: task.id, input: task.input,
      content: { path: "article.md", text: trusted.markdown, digest: durableContentDigest(trusted.markdown), bytes: Buffer.byteLength(trusted.markdown) },
      references: { path: "references.yaml", text: references, digest: durableContentDigest(references), bytes: Buffer.byteLength(references) } } });
  // a stays, b moved once (a line inserted above), c changed, d now appears twice.
  const current = "Alpha rule\nInserted line\nBeta rule\nGamma changed\nDelta rule\nDelta rule\n";
  const error = await submit(current).catch(value => value);
  expect(error.detail.problems.map((item: { section: string }) => item.section)).toEqual(["c", "d"]);
  expect(error.detail.problems[0].message).toContain("source.md:3-3 repeats an earlier citation, which is not-found");
  expect(error.detail.problems[1].message).toContain("source.md:4-4 repeats an earlier citation, which is ambiguous");
  // With c and d resolved, a keeps its lines and b follows its unique move instead of re-signing line 2.
  const candidate = await submit("Alpha rule\nInserted line\nBeta rule\nGamma rule\nDelta rule\n");
  const lines = candidate.indexer_candidate!.sections.map(section => section.references.map(ref => ref.locator.start_line));
  expect(lines).toEqual([[1], [3], [4], [5]]);
});

test("captured text is citable, a capture-gap placeholder is not", async () => {
  const planned = { id: "check", article_id: "article:existing", path: "architecture/existing.md", question: "Clarify",
    sources: [{ scope: "note:source.md", baseline: `sha256:${"a".repeat(64)}` }],
    base: `sha256:${"b".repeat(64)}`, batch: "one", after: [], status: "issued" as const };
  const task = { ...planned, input: productionTaskInput(planned) };
  const source = "Main rule\n> Resource unavailable: Synced block (synced_block; permission denied). <!-- block-1 -->\nNext rule\n";
  const file = (path: string, text: string) => ({ path, text, bytes: Buffer.byteLength(text), digest: durableContentDigest(text) });
  const submit = (start: number, end: number) => {
    const references = YAML.stringify({ sections: [{ id: "a", references: [{ source_ref: "note:source.md", locator: { path: "source.md", start_line: start, end_line: end } }] },
      { id: "b", references: [] }] });
    return prepareProductionArticle({ projectRoot: ".tmp/unused-production-references", task, approvedBaseDigest: null, preview: true,
      sourceReader: async () => source, files: { task: task.id, input: task.input,
        content: file("content.md", base.markdown), references: file("references.yaml", references) } });
  };
  expect((await submit(1, 1)).source_refs).toEqual(["note:source.md"]);
  await expect(submit(1, 3)).rejects.toThrow("source.md:2 is a capture gap");
});

test("an unauthorized source names the requirement to extend and every task the amendment replaces", async () => {
  const planned = { id: "revision", article_id: "article:existing", path: "architecture/existing.md", question: "Clarify",
    sources: [{ scope: "note:own.md", baseline: `sha256:${"a".repeat(64)}` }],
    base: `sha256:${"b".repeat(64)}`, batch: "one", after: [], status: "issued" as const };
  const task = { ...planned, input: productionTaskInput(planned) };
  const file = (path: string, text: string) => ({ path, text, bytes: Buffer.byteLength(text), digest: durableContentDigest(text) });
  const references = YAML.stringify({ sections: [{ id: "a", references: [{ source_ref: "note:source.md", locator: { path: "source.md", start_line: 1, end_line: 1 } }] },
    { id: "b", references: [] }] });
  await expect(prepareProductionArticle({ projectRoot: ".tmp/unused-production-references", task, approvedBaseDigest: null, preview: true,
    sourceReader: async () => "Source text\n", authorization: async () => ({ requirements: ["guild"], dependents: ["s2", "s3"] }),
    files: { task: task.id, input: task.input, content: file("content.md", base.markdown), references: file("references.yaml", references) } }))
    .rejects.toThrow("Cite only note:own.md, or authorize it: add note:source.md to evidence_source_scope of requirement guild in src/indexers.yaml, "
      + "then submit a plan amendment whose replaces lists revision, s2, s3 (this task and the tasks that depend on it)");
});
