import { expect, spyOn, test } from "bun:test";
import { inspectPackageMarkdownLinks, packageMarkdownAnchors } from "../project/packageMarkdownAnchors.js";

test("reader anchors include repeated Unicode headings and explicit identities, excluding code samples", () => {
  const anchors = packageMarkdownAnchors([
    "# 调用 `open()`", "## Usage", "## Usage", "## Usage-1", '<a id="member:open"></a>',
    "```md", "# Not a heading", '<a id="not-real"></a>', "```",
  ].join("\n"));
  expect([...anchors]).toEqual(["调用-open", "usage", "usage-1", "usage-1-1", "member:open"]);
});

test("page-only links need no target body lookup and repeated fragment links share one target lookup", () => {
  const pages = new Map([
    ["index.md", "[Page](page.md)\n[Empty](empty.md)"],
    ["page.md", "# First\n# Second"],
    ["empty.md", ""],
  ]);
  const lookup = spyOn(pages, "get");
  try {
    expect(inspectPackageMarkdownLinks(pages)).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
    pages.set("index.md", "[First](page.md#first)\n[Second](page.md#second)\n[Missing](absent.md)");
    expect(inspectPackageMarkdownLinks(pages)).toEqual([
      { code: "package-link-page-missing", path: "index.md", target: "absent.md" },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("page.md");
  } finally { lookup.mockRestore(); }
});

test("final package body and reference navigation report missing pages and sections without rejecting content", () => {
  const warnings = inspectPackageMarkdownLinks(new Map([
    ["index.md", "[Guide][guide]\n\n[guide]: guides/use.md#usage\n\n[Gone](guides/gone.md)"],
    ["guides/use.md", "# Usage\n\n[API](../wikis/api.md#member%3Aopen)\n[Local](#usage)\n[Stale](#old)\n[Web](https://example.test/guide.md#missing)\n![Image](missing.md)"],
    ["wikis/api.md", '<a id="member:open"></a>\n\n# API'],
  ]));
  expect(warnings).toEqual([
    { code: "package-link-page-missing", path: "index.md", target: "guides/gone.md" },
    { code: "package-link-anchor-unresolved", path: "guides/use.md", target: "#old" },
  ]);
});
