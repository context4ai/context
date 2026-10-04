import { describe, expect, test } from "bun:test";
import {
  markdownInlineLinks,
  markdownLinkDestination,
  markdownReaderLinks,
  replaceMarkdownInlineLinkTargets,
} from "../project/markdownLinks.js";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { unified } from "unified";

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

  test("replaces nested image and outer link targets independently without touching labels or titles", () => {
    const markdown = "[![Logo \\[small\\]](old.png \"Image title\")](old.md 'Link title')";
    const rewritten = replaceMarkdownInlineLinkTargets(markdown, link => link.image ? "new.png" : "https://example.org/guide");
    expect(rewritten).toBe("[![Logo \\[small\\]](new.png \"Image title\")](https://example.org/guide 'Link title')");
    expect(markdownReaderLinks(rewritten)).toEqual([
      expect.objectContaining({ image: false, label: "![Logo \\[small\\]](new.png \"Image title\")", target: "https://example.org/guide" }),
      expect.objectContaining({ image: true, label: "Logo [small]", target: "new.png" }),
    ]);
  });

  test("rewrites reference definitions once while keeping every reference form and title", () => {
    const markdown = [
      "[Guide][target] ![Logo][target] [target][] [target]",
      "",
      "[target]:",
      "  <old.md> \"Shared title\"",
      "",
      "`[fake]: old.md`",
      "",
      "```md",
      "[fake]: old.md",
      "```",
    ].join("\n");
    const seen: string[] = [];
    const rewritten = replaceMarkdownInlineLinkTargets(markdown, link => { seen.push(link.target); return "https://example.org/guide"; });
    expect(seen).toEqual(["old.md"]);
    expect(rewritten).toBe(markdown.replace("<old.md>", "<https://example.org/guide>"));
    expect(markdownReaderLinks(rewritten).map(link => link.target)).toEqual(Array(4).fill("https://example.org/guide"));
  });

  test("definition labels do not consume a bracket-colon sequence inside their URL", () => {
    const markdown = "[Guide][target]\n\n[target]: https://example.org/a[b]:c \"Title\"";
    expect(replaceMarkdownInlineLinkTargets(markdown, () => "https://example.org/new"))
      .toBe("[Guide][target]\n\n[target]: https://example.org/new \"Title\"");
  });

  test("new destinations cannot terminate a link, inject a title or decode literal entities", () => {
    const url = "https://example.org/a)b\\c <d>|e?literal=&amp;&value=2";
    const encoded = "https://example.org/a%29b%5Cc%20%3Cd%3E%7Ce?literal=&amp;amp;&value=2";
    expect(markdownLinkDestination(url)).toBe(encoded);
    expect(markdownLinkDestination("https://example.org/?a=1&copy=2&x=&#38;"))
      .toBe("https://example.org/?a=1&copy=2&x=&amp;#38;");
    for (const markdown of ["[Guide](old.md \"Title\")", "[Guide](<old.md> \"Title\")"]) {
      const rewritten = replaceMarkdownInlineLinkTargets(markdown, () => url);
      expect(rewritten).toBe(markdown.replace("old.md", encoded));
      const [link] = markdownInlineLinks(rewritten);
      expect(link?.target).toBe(encoded.replace(/&amp;/gu, "&"));
      expect(decodeURI(link!.target)).toBe(url);
    }
  });

  test("escaped local paths resolve as URLs and keep their image syntax after projection", () => {
    const markdown = "![Diagram](assets/file\\(1\\).png \"Keep title\")\n\n[Download](<assets/a&copy;.png>)";
    const targets: string[] = [];
    const rewritten = replaceMarkdownInlineLinkTargets(markdown, link => {
      targets.push(link.target);
      return link.target.replace("assets/", "../images/");
    });
    expect(targets).toEqual(["assets/file(1).png", "assets/a©.png"]);
    expect(rewritten).toBe("![Diagram](../images/file%281%29.png \"Keep title\")\n\n[Download](<../images/a©.png>)");
    expect(markdownInlineLinks(rewritten).map(link => decodeURI(link.target))).toEqual(["../images/file(1).png", "../images/a©.png"]);
    expect(replaceMarkdownInlineLinkTargets(markdown, link => link.target)).toBe(markdown);
  });

  test("serialized pipe URLs remain one GFM table cell", () => {
    const url = "https://example.org/guide?q=a|b&literal=&copy;";
    const markdown = `| Name | Purpose |\n| --- | --- |\n| [Guide](<${markdownLinkDestination(url)}>) | Exact purpose |\n`;
    const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
    const table = tree.children[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("Expected a table");
    expect(table.children[1]?.children).toHaveLength(2);
    expect(markdownReaderLinks(markdown)[0]?.target).toBe("https://example.org/guide?q=a%7Cb&literal=&copy;");
  });
});
