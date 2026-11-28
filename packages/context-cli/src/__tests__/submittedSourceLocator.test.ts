import { expect, test } from "bun:test";
import { articleSourceLocatorSchema, approvedRevisionSemanticInputSchema } from "@c4a/context";
import { exactQuoteLocator, resolveSubmittedSourceLocator, submittedSourceLocatorSchema } from "../project/submittedSourceLocator.js";

test("headings resolve sections, ignore fences and stop at same or higher level", () => {
  const text = "# Start\nIntro\n## Usage\nUse it\n### Detail\nMore\n\n## End\nDone\n";
  expect(resolveSubmittedSourceLocator({ path: "guide.md", heading: "Usage" }, text)).toEqual({ path: "guide.md", start_line: 3, end_line: 6 });
  expect(resolveSubmittedSourceLocator({ path: "guide.md", heading: "Usage" }, "```md\n## Usage\n```\n## Usage\nReal\n")).toEqual({ path: "guide.md", start_line: 4, end_line: 5 });
  expect(() => resolveSubmittedSourceLocator({ path: "guide.md", heading: "Usage" }, "## Usage\nA\n## Usage\nB")).toThrow("1-2, 3-4");
  expect(() => resolveSubmittedSourceLocator({ path: "code.ts", heading: "Usage" }, text)).toThrow("Markdown");
});

test("a heading may include its ATX marker, which also selects the level", () => {
  const text = "# Usage\nTop\n## Usage\nNested\n";
  expect(resolveSubmittedSourceLocator({ path: "guide.md", heading: "## Usage" }, text)).toEqual({ path: "guide.md", start_line: 3, end_line: 4 });
  expect(resolveSubmittedSourceLocator({ path: "guide.md", heading: "# Usage" }, text)).toEqual({ path: "guide.md", start_line: 1, end_line: 4 });
  expect(() => resolveSubmittedSourceLocator({ path: "guide.md", heading: "Usage" }, text)).toThrow("2 regions");
  expect(() => resolveSubmittedSourceLocator({ path: "guide.md", heading: "### Usage" }, text)).toThrow("candidates: none");
});

test("quote is exact and unique, with normalized line endings and overlapping matches", () => {
  expect(resolveSubmittedSourceLocator({ path: "guide.md", quote: "使用\n方法" }, "前言\r\n使用\r\n方法\r\n尾声")).toEqual({ path: "guide.md", start_line: 2, end_line: 3 });
  expect(() => resolveSubmittedSourceLocator({ path: "a.ts", quote: "aa" }, "aaa")).toThrow("2 regions");
  expect(() => resolveSubmittedSourceLocator({ path: "a.ts", quote: "missing" }, "text")).toThrow("candidates: none");
  expect(submittedSourceLocatorSchema.safeParse({ path: "guide.md", heading: "A", quote: "A" }).success).toBe(false);
  expect(submittedSourceLocatorSchema.safeParse({ path: "../guide.md", quote: "A" }).success).toBe(false);
});

test("author schema accepts symbolic inputs without changing durable locator schema", () => {
  const locator = { path: "guide.md", quote: "Unique" };
  expect(approvedRevisionSemanticInputSchema.safeParse({ stage: "approved-revision", sections: [{ section_id: "a", references: [{ source_ref: "note:a", locator }] }] }).success).toBe(true);
  expect(articleSourceLocatorSchema.safeParse(locator).success).toBe(false);
});

test("an exact quote locator resolves back to the same lines or is not offered", () => {
  const at = (start_line: number, end_line: number) => ({ path: "a.md", start_line, end_line });
  expect(exactQuoteLocator(at(2, 3), "# A\nNew one\nNew two\n", 2_000)).toEqual({ path: "a.md", quote: "New one\nNew two" });
  expect(exactQuoteLocator(at(2, 2), "# A\r\nNew one\r\n", 2_000)).toEqual({ path: "a.md", quote: "New one" });
  // Only quotes that resolve back to the same lines are offered: a leading empty line
  // does; a trailing one would end a line early.
  expect(exactQuoteLocator(at(2, 3), "# A\n\nNew one\n", 2_000)).toEqual({ path: "a.md", quote: "\nNew one" });
  expect(resolveSubmittedSourceLocator({ path: "a.md", quote: "\nNew one" }, "# A\n\nNew one\n")).toEqual(at(2, 3));
  expect(resolveSubmittedSourceLocator({ path: "a.md", quote: "New one\n" }, "# A\nNew one\n\nMore\n")).toEqual(at(2, 2));
  expect(exactQuoteLocator(at(2, 3), "# A\nNew one\n\nMore\n", 2_000)).toBeUndefined();
  // Repeated text, a capture gap, an empty or too long region, or lines beyond the file.
  expect(exactQuoteLocator(at(2, 2), "Same\nSame\n", 2_000)).toBeUndefined();
  expect(exactQuoteLocator(at(2, 2), "# A\n> Resource unavailable: Board (whiteboard; denied). <!-- wb:1 -->\n", 2_000)).toBeUndefined();
  expect(exactQuoteLocator(at(2, 2), "# A\n   \n", 2_000)).toBeUndefined();
  expect(exactQuoteLocator(at(2, 2), `# A\n${"x".repeat(30)}\n`, 20)).toBeUndefined();
  expect(exactQuoteLocator(at(4, 5), "# A\nB\n", 2_000)).toBeUndefined();
});
