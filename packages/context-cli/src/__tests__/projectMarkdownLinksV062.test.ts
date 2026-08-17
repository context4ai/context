import { describe, expect, test } from "bun:test";
import {
  markdownInlineLinks,
  replaceMarkdownInlineLinkTargets,
} from "../project/markdownLinks.js";

describe("0.6.2 Markdown link parsing", () => {
  test("parses escaped and nested link labels without treating code as links", () => {
    const markdown = [
      "![Diagram \\[group\\]](assets/example/materialized/image/example.png)",
      "",
      "`![Code](assets/example/materialized/image/code.png)`",
      "",
      "```md",
      "![Fence](assets/example/materialized/image/fence.png)",
      "```",
    ].join("\n");

    expect(markdownInlineLinks(markdown)).toEqual([
      expect.objectContaining({
        image: true,
        label: "Diagram [group]",
        target: "assets/example/materialized/image/example.png",
        line: 1,
      }),
    ]);
    expect(replaceMarkdownInlineLinkTargets(markdown, () => "../assets/image/projected.png"))
      .toContain("![Diagram \\[group\\]](../assets/image/projected.png)");
    expect(replaceMarkdownInlineLinkTargets(markdown, () => "../assets/image/projected.png"))
      .toContain("`![Code](assets/example/materialized/image/code.png)`");
  });

  test("preserves optional titles and balanced parentheses when replacing a destination", () => {
    const markdown = "[Reference](assets/docs/file(1).md \"Title\")";
    expect(markdownInlineLinks(markdown)[0]).toMatchObject({
      image: false,
      target: "assets/docs/file(1).md",
    });
    expect(replaceMarkdownInlineLinkTargets(markdown, () => "../assets/file.md"))
      .toBe("[Reference](../assets/file.md \"Title\")");
  });
});
