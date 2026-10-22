import { expect, test } from "bun:test";
import { withCommandReadCache } from "../project/commandReadCache.js";
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


test("command-local link reuse isolates callers and distinguishes changed input", async () => {
  const original = "[Guide](guide.md)\n![Asset](image.png)";
  const expected = markdownInlineLinks(original);
  await withCommandReadCache(async () => {
    const first = markdownInlineLinks(original);
    first[0]!.target = "mutated.md";
    first.reverse();
    first.pop();
    expect(markdownInlineLinks(original)).toEqual(expected);
    expect(markdownInlineLinks(original.replace("guide.md", "updated.md"))[0]!.target).toBe("updated.md");
    expect(markdownInlineLinks(original)).toEqual(expected);
    expect(markdownInlineLinks("```md\n[Guide](guide.md)\n```\n")).toEqual([]);
  });
  await withCommandReadCache(async () => {
    expect(markdownInlineLinks(original)).toEqual(expected);
  });
});
