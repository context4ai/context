import { expect, test } from "bun:test";
import YAML from "yaml";
import { prefetchProductionArticleSources } from "../project/productionArticle.js";
import { productionTaskInput } from "../project/productionStage.js";
import { durableContentDigest } from "../project/durableSingleFileTransaction.js";

function input(paths: string[]) {
  const planned = { id: "task", article_id: "article", path: "architecture/page.md", question: "Explain",
    sources: [{ scope: "note:source", baseline: `sha256:${"a".repeat(64)}` }],
    base: null, batch: "one", after: [], status: "issued" as const };
  const task = { ...planned, input: productionTaskInput(planned) };
  const file = (text: string) => ({ path: "draft.md", text, bytes: Buffer.byteLength(text), digest: durableContentDigest(text) });
  const references = paths.map(path => ({ source_ref: "note:source", locator: { path, start_line: 1, end_line: 1 } }));
  return { task, files: { task: task.id, input: task.input, content: file("Article"),
    references: file(YAML.stringify({ sections: [{ id: "a", references }] })) } };
}

test("prefetch deduplicates references, bounds concurrency and drains failed reads", async () => {
  const paths = Array.from({ length: 19 }, (_, i) => `file-${i}.md`);
  let active = 0, peak = 0;
  const completed: string[] = [];
  await prefetchProductionArticleSources([input([...paths, ...paths])], async (source, path, captured) => {
    expect(source).toBe("note:source"); expect(captured).toBe(true);
    active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (path === "file-2.md") throw new Error("Missing source");
      return "Source";
    } finally { completed.push(path); active--; }
  });
  expect(active).toBe(0);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
  expect(completed.sort()).toEqual(paths.sort());
});

test("unauthorized, malformed and fragment-edit inputs do not prefetch", async () => {
  const outside = input(["source.md"]);
  outside.files.references.text = outside.files.references.text.replace("note:source", "note:outside");
  const malformed = input(["source.md"]);
  malformed.files.references.text = "not a reference declaration";
  const edit = input(["source.md"]);
  let calls = 0;
  await prefetchProductionArticleSources([outside, malformed, { ...edit, files: { ...edit.files, edits: edit.files.content } }],
    async () => { calls++; return "Source"; });
  expect(calls).toBe(0);
});
