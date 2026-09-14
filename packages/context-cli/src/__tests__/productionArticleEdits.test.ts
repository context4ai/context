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
  const refs = (count: number) => Array.from({ length: count }, (_, index) => ({ source_ref: "note:source.md",
    locator: { path: "source.md", start_line: index + 1, end_line: index + 1 } }));
  let reads = 0;
  await expect(prepareProductionArticle({ projectRoot: ".tmp/unused-production-references", task,
    approvedBaseDigest: null, sourceReader: async () => { reads++; return "Source text"; },
    files: { task: task.id, input: task.input, content: file("content.md", base.markdown),
      references: file("references.yaml", YAML.stringify({ sections: [
        { id: "a", references: [...refs(4), ...refs(4)] }, { id: "b", references: refs(5) },
      ] })) },
  })).rejects.toThrow("a: 4 distinct source regions (maximum 3); b: 5 distinct source regions (maximum 3)");
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
  })).rejects.toThrow("Retained source text changed");
});
