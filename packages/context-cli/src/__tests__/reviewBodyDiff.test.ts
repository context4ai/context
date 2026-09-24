import { expect, test } from "bun:test";
import { reviewBodyDiff, reviewHtmlJson } from "../project/reviewSiteModel.js";
test("report data escapes script boundaries", () => {
  expect(reviewHtmlJson({ instruction: "</script>" })).not.toContain("</script>");
});
test("diff omits unchanged text, retains modified and removed blocks without splitting fences", () => {
  const old = "## API\n\nSame paragraph\n\nOld parameter\n\n```sh\n# comment\nrun\n```";
  const next = old.replace("Old parameter", "New parameter");
  const html = reviewBodyDiff(old, next);
  expect(html).toContain("New parameter");
  expect(html).toContain("Old parameter");
  expect(html).not.toContain("Same paragraph");
  expect(html).not.toContain("# comment");
  expect(reviewBodyDiff("", "```sh\n# comment\nrun\n```")).toContain("<pre><code># comment\nrun</code></pre>");
});
