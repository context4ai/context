import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { siteMarkdownConfig } from "../project/packageSiteTheme.js";

test("site prose and code preserve braces without compiling them as Vue expressions", async () => {
  // Isolate Vite from Jiti's process-wide Error hooks used by other integration
  // fixtures, and exercise the same Node runtime as installed builds.
  const script = `
  import assert from 'node:assert/strict';
  import {createRequire} from 'node:module';
  import {createMarkdownRenderer} from ${JSON.stringify(import.meta.resolve("vitepress"))};
  const require = createRequire(${JSON.stringify(import.meta.resolve("vitepress"))});
  const { compileTemplate } = require("vue/compiler-sfc");
  const renderer = await createMarkdownRenderer(process.cwd(), ({${siteMarkdownConfig}}));
  const samples = ${JSON.stringify([
    'Example: `<C renderXXX={{xxx: <view />}} />`',
    "Literal {{ missing.property }} and {% template %}",
    "    <C renderXXX={{xxx: <view />}} />\n",
    "```jsx\n<C renderXXX={{xxx: <view />}} />\n```",
    '<details>\n<summary>{{ invalid: expression }}</summary>\n\n`<C renderXXX={{xxx: <view />}} />`\n\n</details>',
  ])};
  const example = "<C renderXXX={{xxx: <view />}} />";
  for (const markdown of samples) {
    const html = renderer.render(markdown);
    const result = compileTemplate({ source: html, filename: "literal.vue", id: "literal" });
    assert.deepEqual(result.errors, []);
    assert.ok(html.replace(/&#123;/gu, "{").includes("{{"));
  }
  const inline = renderer.render(String.fromCharCode(96) + example + String.fromCharCode(96));
  assert.ok(inline.replace(/&#123;/gu, "{").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .includes('<code>' + example + '</code>'));
  console.log('literal rendering verified');`;
  const result = await promisify(execFile)("node", ["--input-type=module", "-e", script], {timeout: 20000});
  expect(result.stdout).toContain("literal rendering verified");
}, 25000);
