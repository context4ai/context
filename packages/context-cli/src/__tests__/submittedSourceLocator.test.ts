import { expect, test } from "bun:test";
import { articleSourceLocatorSchema, approvedRevisionSemanticInputSchema } from "@c4a/context";
import { resolveSubmittedSourceLocator, submittedSourceLocatorSchema } from "../project/submittedSourceLocator.js";

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
