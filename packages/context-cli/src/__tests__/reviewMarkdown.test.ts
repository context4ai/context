import { expect, test } from "bun:test";
import { renderReviewMarkdown } from "../project/reviewMarkdown.js";
test("renders reader-facing headings, tables, lists and code", () => {
  const html = renderReviewMarkdown('# Guide\n\n| Name | Type |\n| --- | --- |\n| items | `Item[]` |\n\n- Example\n\n```ts\nconst x = "<sample>";\n```');
  expect(html).toContain('<h1>Guide</h1>');
  expect(html).toContain('<table>');
  expect(html).toContain('<code>Item[]</code>');
  expect(html).toContain('<li>');
  expect(html).toContain('&lt;sample&gt;');
});
test("source HTML and dangerous links never execute; reference links remain readable", () => {
  const html = renderReviewMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n[good][ref]\n\n[ref]: https://example.com\n\n![image](https://example.com/image.png)');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('href="https://example.com"');
  expect(html).not.toContain('<img');
  expect(html).toContain('image.png');
});

test("page title appears once, with a fallback only when the body has no page heading", () => {
  const titled = renderReviewMarkdown("# Guide\n\nSummary.\n\n## Details\n\nBody.", "Guide");
  expect(titled.match(/<h1>/gu)).toHaveLength(1);
  expect(titled.match(/Summary\./gu)).toHaveLength(1);
  const untitled = renderReviewMarkdown("## Details\n\nBody.", "Guide");
  expect(untitled).toStartWith("<h1>Guide</h1>");
  expect(untitled).toContain("<h2>Details</h2>");
});
