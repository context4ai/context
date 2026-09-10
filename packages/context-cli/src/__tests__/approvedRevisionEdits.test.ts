import { expect, test } from "bun:test";
import { prepareRevisionMarkdown } from "../project/approvedRevisionEdits.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";
import { parseIndexerCurrentActionSubmission } from "@c4a/context";

const section = (id: string, body: string) => `<!-- context:section id="${id}" source_ref="repo:source#symbol" -->\n\n${body}\n\n<!-- /context:section -->`;
const base = `---\ntitle: Guide\n---\n${section("first", "Original.")}\n${section("second", "Untouched.")}`;
const token = "{{context:program:abc}}";
const blocks = [{ token, source_ref: "repo:source", fact_ref: "fact:one", markdown: "| Field | Type |\n| --- | --- |\n| value | string |" }];

test("section edits preserve all untouched bytes and source scope while using current programs", () => {
  const input = { sections: [{ section_id: "first", content: [{ markdown: "Changed." }, { program: token }] }] };
  const result = prepareRevisionMarkdown(base, input, blocks);
  expect(result).toContain(section("second", "Untouched."));
  expect(result).toStartWith("---\ntitle: Guide\n---\n");
  expect(result).toContain(blocks[0]!.markdown);
  expect(result).not.toContain("Original.");
  expect(approvedContextSectionsInMarkdown(result).map(item => item.refs)).toEqual([["repo:source#symbol"], ["repo:source#symbol"]]);
  expect(parseIndexerCurrentActionSubmission({ stage: "approved-revision", ...input })).toEqual({ stage: "approved-revision", ...input });
});

test("ambiguous selections, unknown programs, and mixing full and partial edits are rejected", () => {
  const edit = { section_id: "first", content: [{ markdown: "New" }] };
  expect(() => prepareRevisionMarkdown(base, { sections: [edit, edit] }, blocks)).toThrow();
  expect(() => prepareRevisionMarkdown(base, { sections: [{ ...edit, section_id: "missing" }] }, blocks)).toThrow();
  expect(() => prepareRevisionMarkdown(base, { sections: [{ ...edit, content: [{ program: "wrong" }] }] }, blocks)).toThrow();
  expect(() => parseIndexerCurrentActionSubmission({ stage: "approved-revision", markdown: base, sections: [edit] })).toThrow();
  expect(prepareRevisionMarkdown(base, { markdown: base }, blocks)).toBe(base);
});
