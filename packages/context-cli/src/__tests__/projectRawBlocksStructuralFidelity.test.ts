import { describe, expect, test } from "bun:test";
import {
  diffRawBlocks,
  extractRawBlocks,
} from "../incremental/rawBlocks.js";

function textForBlock(markdown: string, block: {
  line_start: number;
  line_end: number;
}): string {
  return markdown
    .split("\n")
    .slice(block.line_start - 1, block.line_end)
    .join("\n");
}

describe("raw Markdown block structural fidelity", () => {
  test("keeps structural headings inside the first evidence span they introduce", () => {
    const markdown = [
      "# Handbook",
      "",
      "Opening text.",
      "",
      "## Installation",
      "",
      "Run the installer.",
      "",
      "Confirm the result.",
      "",
      "## Verification",
      "",
      "Run the check.",
    ].join("\n");

    const blocks = extractRawBlocks(markdown);
    const installation = blocks.find((block) =>
      block.heading_path.at(-1) === "Installation"
    );
    const verification = blocks.find((block) =>
      block.heading_path.at(-1) === "Verification"
    );

    expect(installation).toBeDefined();
    expect(verification).toBeDefined();
    expect(textForBlock(markdown, installation!)).toBe([
      "## Installation",
      "",
      "Run the installer.",
      "",
      "Confirm the result.",
    ].join("\n"));
    expect(textForBlock(markdown, verification!)).toBe([
      "## Verification",
      "",
      "Run the check.",
    ].join("\n"));
  });

  test("keeps heading rename detection based on unchanged body evidence", () => {
    const before = [
      "# Handbook",
      "",
      "## Installation",
      "",
      "Run the installer.",
    ].join("\n");
    const after = before.replace("## Installation", "## Setup");

    const diffs = diffRawBlocks(
      extractRawBlocks(before),
      extractRawBlocks(after),
    );

    expect(diffs.some((diff) => diff.status === "heading-renamed")).toBe(true);
    expect(diffs.some((diff) => diff.status === "changed")).toBe(false);
  });
});
