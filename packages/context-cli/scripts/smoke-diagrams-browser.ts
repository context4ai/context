import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { kbPackage } from "@c4a/context";
import { renderReviewMarkdown } from "../src/project/reviewMarkdown.js";
import { DIAGRAM_STYLES } from "../src/project/diagramStyles.js";
import { packageKnowledgeOutputPath } from "../src/project/packageDistribution.js";
import { writePackageSite } from "../src/project/packageSite.js";
import { prepareRevisionKnowledge } from "../src/__tests__/initialRevisionKnowledge.fixture.js";
import { readCandidateRecords, writeCandidateRecords } from "../src/project/candidateLedger.js";
import { writeReviewHtml } from "../src/project/reviewHtml.js";

const repo = resolve(import.meta.dir, "../../..");
const output = resolve(repo, ".tmp/diagram-browser");
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, "workspace-"));
const markdown = (await Promise.all(["diagrams.md", "diagram-topology-examples.md", "diagram-behavior-examples.md"].map(file =>
  readFile(resolve(repo, "plugins/context/skills/context-code-indexer/references", file), "utf8")))).join("\n");
const diagrams = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/gu)].map(match => match[1]!);
const cases = [...diagrams, 'flowchart LR\nsubgraph outer["跨区域请求处理与存储"]\nsubgraph inner["内部处理流程"]\na["提交包含长中文标签的请求"] -->|"验证并传递请求参数"| b["Asynchronous request processing and durable state"]\nend\nb --> c["结果持久化并通知调用方"]\nend', 'flowchart LR\nA["<img src=x onerror=alert(1)>"] --> B', 'flowchart LR\nA[broken'];
const article = cases.map(source => '```mermaid\n'+source+'\n```').join("\n\n");
const browserAsset = await readFile(resolve(repo, "packages/context-cli/dist/browser/diagrams.js"), "utf8");
await writeFile(join(root, "diagrams.html"), `<!doctype html><html lang="zh"><meta charset="utf-8"><style>body{margin:24px;font-family:system-ui}body.dark{background:#171b24;--bg:#171b24;--text:#e2e4ed;--line:#303440;--muted:#a1a6b7;--blue:#8eb7ff}pre{overflow:auto}${DIAGRAM_STYLES}</style><main>${renderReviewMarkdown(article)}</main><script>${browserAsset}</script><script>globalThis.done=contextDiagramViewer.render(document,{dark:false,language:'zh'});</script></html>`);
const pkg = kbPackage({ name: "diagrams", template: "src/templates", site: { title: "Diagram reading", lang: "zh-CN", base: "/dist/diagrams-site/" } });
const selected = ["first", "second"].map(name => ({ relPath: `architecture/${name}.md`, absPath: "/unused", content: `---\ntitle: ${name}\n---\n# ${name}\n\n${article}` }));
for (const file of selected) {
  const path = join(root, pkg.outDir, packageKnowledgeOutputPath(pkg, file.relPath));
  await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, file.content);
}
await mkdir(join(root, "src/site"), { recursive: true });
const testTheme = { light: { brand: "#6750a4", surface: "#f3effa" }, dark: { brand: "#d0bcff", surface: "#292030" } };
await writeFile(join(root, "src/site/theme.json"), JSON.stringify(testTheme));
const site = await writePackageSite({ projectRoot: root, pkg, selected });
const reviewRoot = await prepareRevisionKnowledge([]);
await mkdir(join(reviewRoot, "src/site"), { recursive: true });
await writeFile(join(reviewRoot, "src/site/theme.json"), JSON.stringify(testTheme));
const records = await readCandidateRecords(reviewRoot);
await writeCandidateRecords(reviewRoot, records.map(record => ({ ...record, body: record.body+'\n'+article,
  indexer_candidate: { ...record.indexer_candidate, sections: record.indexer_candidate.sections.map((section,index) => {
    const markdown = section.markdown + (index === 0 ? '\n'+article : '');
    return { ...section, markdown, markdown_digest: 'sha256:'+createHash('sha256').update(markdown).digest('hex') };
  }) },
})));
const review = await writeReviewHtml({ projectRoot: reviewRoot, all: true });
if (process.env.DIAGRAM_BUILT_CLI) execFileSync("node", [resolve(process.env.DIAGRAM_BUILT_CLI), "review", "html", "--all", "--format", "json"], { cwd: reviewRoot, timeout: 30000, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" } });
await writeFile(join(root, "review.html"), await readFile(review.path));
const types: Record<string,string> = { ".html":"text/html", ".js":"application/javascript", ".css":"text/css", ".svg":"image/svg+xml" };
const server = createServer(async (req,res) => {
  try { const path = resolve(root, '.'+new URL(req.url!, 'http://localhost').pathname); if (!path.startsWith(root+'/')) throw new Error('outside'); res.setHeader('content-type',types[extname(path)]??'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.statusCode=404;res.end('missing'); }
});
await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
const port=(server.address() as {port:number}).port;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[];const network:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{ if(new URL(route.request().url()).hostname!=='127.0.0.1'){network.push(route.request().url());return route.abort()}return route.continue()});
try {
  await page.goto(`http://127.0.0.1:${port}/diagrams.html`);
  await page.evaluate('done');
  assert.equal(await page.locator('.context-diagram-canvas svg').count(),cases.length-2);
  assert.equal(await page.locator('.context-show-source').count(),2);
  assert.equal(await page.locator('img').count(),0);
  assert.deepEqual(await page.locator('.language-mermaid > pre code').allTextContents(),cases);
  const first=page.locator('.context-diagram-shell').first();
  await first.hover();
  await first.getByRole('button',{name:'100%',exact:true}).click();
  assert.equal(await first.locator('.context-diagram-percent').textContent(),'100%');
  await first.getByRole('button',{name:'放大',exact:true}).click();
  assert.equal(await first.locator('.context-diagram-percent').textContent(),'120%');
  await first.getByRole('button',{name:'全屏',exact:true}).click();
  assert.equal(await page.locator('.context-diagram-expanded').count(),1);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.context-diagram-expanded').count(),0);
  await first.getByRole('button',{name:'源码',exact:true}).click();
  await first.locator('.context-diagram-source').waitFor({state:'visible'});
  assert.equal(await first.locator('.context-diagram-viewport').isVisible(),false);
  await first.getByRole('button',{name:'图表',exact:true}).click();
  for (const button of await page.getByRole('button',{name:'布局',exact:true}).all()) { await button.locator('..').locator('..').locator('..').hover(); assert.equal(await button.textContent(), '紧凑风格'); await button.click(); }
  await page.waitForFunction(() => [...document.querySelectorAll('.context-diagram-status')].every(el => (el as HTMLElement).hidden || el.textContent?.includes('无法')));
  assert.equal(await page.locator('.context-diagram-canvas svg').count(),cases.length-2);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await first.locator(".context-diagram-original").isVisible(), width > 700);
    assert.equal(await first.locator(".context-diagram-source-toggle").isVisible(), width > 700);
    await page.evaluate(async()=>{document.body.classList.add('dark');await (globalThis as any).contextDiagramViewer.render(document,{dark:true,language:'en'})});
    assert.equal(await page.locator('.context-diagram-canvas svg').count(),cases.length-2);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:join(output,`diagrams-${width}.png`)});
  }
  // Exercise the actual single-file Review with all requests disabled.
  await page.unroute('**/*'); await page.route('**/*',route=>route.request().url().startsWith('file:')?route.continue():route.abort());
  await page.goto('file://'+join(root,'review.html'));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--blue').trim()), '#6750a4');
  await page.getByRole('button',{name:/Answer overview/}).first().click();
  await page.waitForFunction((count)=>document.querySelectorAll('.context-diagram-canvas svg').length===count,cases.length-2);
  await page.locator('#theme').click();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--blue').trim()), '#d0bcff');
  await page.locator('#home').click();
  await page.getByRole('button',{name:/Answer usage/}).first().click();
  await page.waitForFunction((count)=>document.querySelectorAll('.context-diagram-canvas svg').length===count,cases.length-2);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(output,'review.png')});
  // Verify the actual generated VitePress theme, not only the shared viewer.
  await page.unroute('**/*');
  const pagePath=site.pages[0]!.site_path;
  await page.goto(`http://127.0.0.1:${port}/dist/diagrams-site/${pagePath}`);
  await page.waitForFunction((count)=>document.querySelectorAll('.context-diagram-canvas svg').length===count,cases.length-2);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--vp-c-brand-1').trim()), '#6750a4');
  assert.ok(await page.locator('.context-diagram-canvas svg').first().evaluate(e=>e.outerHTML.includes('#f3effa')));
  await page.screenshot({path:join(output,'site.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  await writeFile(join(output,'result.json'),JSON.stringify({cases:cases.length,rendered:cases.length-2,invalidFallback:2,offlineReview:true,site:true,errors,network},null,2));
  console.log(`PASS: ${cases.length-2} diagrams, syntax fallback, both layouts, source preservation, zoom/fullscreen, dark/mobile, offline Review and built site`);
} catch(error) {
  await writeFile(join(output,'failure.json'),JSON.stringify({url:page.url(),errors,message:String(error),dom:await page.evaluate(()=>({sources:document.querySelectorAll('.language-mermaid').length,svg:document.querySelectorAll('.context-diagram-canvas svg').length,notices:[...document.querySelectorAll('.context-diagram-status')].filter(el=>!(el as HTMLElement).hidden).map(el=>(el as HTMLElement).title)}))},null,2));
  await page.screenshot({path:join(output,'failure.png')});throw error;
} finally {await browser.close();server.close();await rm(reviewRoot,{recursive:true,force:true});}
