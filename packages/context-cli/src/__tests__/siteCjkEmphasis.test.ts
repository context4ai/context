import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { siteMarkdownConfig } from "../project/packageSiteTheme.js";

test("site emphasis closes after CJK punctuation and leaves other text as CommonMark renders it", async () => {
  const script = `
  import assert from 'node:assert/strict';
  import {createMarkdownRenderer} from ${JSON.stringify(import.meta.resolve("vitepress"))};
  const site = await createMarkdownRenderer(process.cwd(), ({${siteMarkdownConfig}}));
  const stock = await createMarkdownRenderer(process.cwd(), {});
  const fixed = ${JSON.stringify([
    ["**用知识包还是 MCP？**在本地写代码", "<strong>用知识包还是 MCP？</strong>在本地写代码"],
    ["部署后**（运维）、**再验收", "部署后<strong>（运维）、</strong>再验收"],
    ["先看**“证据链”**再回答", "先看<strong>“证据链”</strong>再回答"],
    ["*注意：*これは", "<em>注意：</em>これは"],
    ["**확인？**다음", "<strong>확인？</strong>다음"],
    ["**𠀀？**在", "<strong>𠀀？</strong>在"],
  ])};
  for (const [markdown, html] of fixed) assert.equal(site.renderInline(markdown), html, markdown);
  const unchanged = ${JSON.stringify([
    "**Use MCP?**Then", "snake_case_name and 变量_名称_中", "a * b * c", "**bold** and *em*", "中文**加粗**中文",
    "**粗体** 后", "2*3*4", "价格 * 数量", "**未闭合？", "__init__ 方法", "a**b**c", "**中**", "* 列表",
  ])};
  for (const markdown of unchanged) assert.equal(site.renderInline(markdown), stock.renderInline(markdown), markdown);
  console.log('cjk emphasis verified');`;
  const result = await promisify(execFile)("node", ["--input-type=module", "-e", script], {timeout: 20000});
  expect(result.stdout).toContain("cjk emphasis verified");
}, 25000);
