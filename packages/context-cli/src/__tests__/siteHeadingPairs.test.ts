import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { siteMarkdownConfig, siteMarkdownImports } from "../project/packageSiteTheme.js";

test("renderer pairs repeated translated headings only when section shapes agree", async () => {
  const block = (locale: string, body: string) => `<!-- context-test ${locale} -->\n\n<a id="section-a"></a>\n\n${body}\n\n<!-- /context-test -->\n`;
  const script = `
    ${siteMarkdownImports(import.meta.resolve("markdown-it-cjk-friendly")).trimEnd()}
    import assert from 'node:assert/strict';
    import {createMarkdownRenderer} from ${JSON.stringify(import.meta.resolve("vitepress"))};
    const contextLocaleMarker = 'context-test';
    const renderer = await createMarkdownRenderer(process.cwd(), ({${siteMarkdownConfig}}));
    const good = renderer.render(${JSON.stringify(block("en", "## Same\n\n## Same") + block("zh-CN", "## 相同\n\n## 相同"))});
    assert.equal((good.match(/data-context-heading="section-a\\/1"/g) || []).length, 2);
    assert.equal((good.match(/data-context-heading="section-a\\/2"/g) || []).length, 2);
    const bad = renderer.render(${JSON.stringify(block("en", "## First\n\n### Detail") + block("zh-CN", "## 第一\n\n## 详情"))});
    assert.ok(!bad.includes('data-context-heading'));
    console.log('heading pairing verified');
  `;
  const result = await promisify(execFile)("node", ["--input-type=module", "-e", script], { timeout: 20000 });
  expect(result.stdout).toContain("heading pairing verified");
}, 25000);
