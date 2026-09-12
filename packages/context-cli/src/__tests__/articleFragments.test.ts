import { expect, test } from "bun:test";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";
import { prepareRevisionMarkdown } from "../project/approvedRevisionEdits.js";

const wrap = (id: string, body: string) => `<!-- context:section id="${id}" -->\n\n${body}\n\n<!-- /context:section -->\n`;

test("fragment parsing ignores markers shown inside fenced examples", () => {
  const example = "```md\n" + wrap("example", "Example only") + "```";
  const markdown = "# Title\n\n" + wrap("actual", example);
  const fragments = approvedContextSectionsInMarkdown(markdown);
  expect(fragments.map(fragment => fragment.id)).toEqual(["actual"]);
  expect(fragments[0]!.readerVisibleBody).toBe(example);
  expect(markdown.slice(fragments[0]!.bodyStart, fragments[0]!.bodyEnd).trim()).toBe(example);
});

test("fragment edits preserve untouched bytes and do not edit fenced examples", () => {
  const example = "```md\n" + wrap("example", "Example only") + "```";
  const before = "# Title\n\n" + wrap("first", example) + wrap("second", "Existing content");
  const result = prepareRevisionMarkdown(before, {
    sections: [{ section_id: "second", content: [{ markdown: "Updated content" }] }],
  }, []);
  expect(result).toBe(before.replace("Existing content", "Updated content"));
  expect(approvedContextSectionsInMarkdown(result).map(fragment => fragment.id)).toEqual(["first", "second"]);
});

test("invalid, nested and unclosed fragment markers cannot silently lose references", () => {
  expect(() => approvedContextSectionsInMarkdown('<!-- context:section id="a" -->\ntext')).toThrow("Unclosed");
  expect(() => approvedContextSectionsInMarkdown(wrap("a", wrap("b", "text")))).toThrow("Nested");
  expect(() => approvedContextSectionsInMarkdown('<!-- context:section kind="content" -->\n')).toThrow("Invalid");
});
