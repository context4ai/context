import { expect, test } from "bun:test";
import { markdownInlineLinks, markdownReaderLinks } from "../project/markdownLinks.js";

test("link-free Markdown does not invent inline or reference links", () => {
  for (const text of ["", "# Heading\nPlain prose", "<https://example.test>", "```\nconst value = 42;\n```", "!["]) {
    expect(markdownInlineLinks(text)).toEqual([]);
    expect(markdownReaderLinks(text)).toEqual([]);
  }
});

test("one Markdown tree preserves reference links, images, escaped labels and fenced examples", () => {
  const text = "[Inline](guide.md#section)\n[Reference][target]\n![Image][asset]\n\n[target]: other.md\n[asset]: image.png\n\n```md\n[Fake](missing.md)\n```\n";
  expect(markdownInlineLinks(text).map(link => link.target)).toEqual(["guide.md#section"]);
  expect(markdownReaderLinks(text).map(link => [link.image, link.target])).toEqual([
    [false, "guide.md#section"], [false, "other.md"], [true, "image.png"],
  ]);
});
