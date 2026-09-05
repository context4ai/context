import { describe, expect, test } from "bun:test";
import { renderMarkdownSection } from "../project/markdownPageTitle.js";

describe("semantic Markdown section rendering", () => {
  test("preserves a complete opening without repeating its title or introduction", () => {
    const markdown = "# Selection guide\n\nAuthored introduction.\n\n## Choose a mode\n\nUse the standard mode.";
    expect(renderMarkdownSection({
      markdown, heading: "Choose a mode", pageTitle: "Selection guide", summary: "Metadata summary.",
    })).toBe(markdown);
  });

  test("assembles a title, summary and heading when only the body was supplied", () => {
    expect(renderMarkdownSection({
      markdown: "Use the standard mode.", heading: "Choose a mode",
      pageTitle: "Selection guide", summary: "Introduction.",
    })).toBe("# Selection guide\n\nIntroduction.\n\n## Choose a mode\n\nUse the standard mode.");
  });

  test("adds the page opening but not a duplicate existing section heading", () => {
    expect(renderMarkdownSection({
      markdown: "## Choose a mode\n\nBody.", heading: "Choose a mode", pageTitle: "Selection guide",
    })).toBe("# Selection guide\n\n## Choose a mode\n\nBody.");
  });

  test("preserves later section headings and nested headings", () => {
    const markdown = "## Constraints\n\n### Server\n\nKeep pagination remote.";
    expect(renderMarkdownSection({ markdown, heading: "Constraints" })).toBe(markdown);
  });

  test("adds the heading for a later body-only section", () => {
    expect(renderMarkdownSection({ markdown: "Keep pagination remote.", heading: "Constraints" }))
      .toBe("## Constraints\n\nKeep pagination remote.");
  });

  test("keeps an optional opening summary when a page title was not supplied", () => {
    expect(renderMarkdownSection({ markdown: "Body.", heading: "Overview", summary: "Summary." }))
      .toBe("Summary.\n\n## Overview\n\nBody.");
  });

  test("ignores leading comments and blank lines while keeping their content", () => {
    const markdown = "<!-- source context\ncontinued -->\n\n# Selection guide\n\nIntroduction.";
    expect(renderMarkdownSection({ markdown, heading: "Introduction", pageTitle: "Selection guide" }))
      .toBe(markdown);
  });

  test("does not mistake a code block containing headings for the reader heading", () => {
    const markdown = "```md\n## Constraints\n```";
    expect(renderMarkdownSection({ markdown, heading: "Constraints" }))
      .toBe(`## Constraints\n\n${markdown}`);
  });

  test("does not drop a distinct nested heading or its content", () => {
    expect(renderMarkdownSection({ markdown: "### Nested example\n\nBody.", heading: "Examples" }))
      .toBe("## Examples\n\n### Nested example\n\nBody.");
  });

  test("compares display whitespace without rewriting authored heading text", () => {
    const markdown = "##  API   options\r\n\r\nBody.";
    expect(renderMarkdownSection({ markdown, heading: "API options" })).toBe(markdown);
  });
});
