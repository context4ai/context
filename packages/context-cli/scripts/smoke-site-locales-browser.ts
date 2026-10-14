import { projectPackageKnowledgeMarkdown } from "../src/project/packageKnowledgeProjection.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { kbPackage } from "@c4a/context";
import { createSiteNavigation, writePackageSite } from "../src/project/packageSite.js";
import { packageSiteOutputDir } from "../src/project/packageOutputPaths.js";
import { approvedArticleDigest } from "../src/project/siteTranslation.js";

const root = await mkdtemp(resolve(".tmp/site-locales-browser-"));
const wrap = (id: string, body: string) => `<!-- context:section id="${id}" -->\n${body}\n<!-- /context:section -->\n`;
const article = (name: string, chinese: boolean) => `---\ntitle: ${name}\n---\n# ${name}\n` +
  wrap("intro", `${chinese ? "[去目标]" : "[Go]"}(b.md#target)\n\n${chinese ? "[本页目标]" : "[Local]"}(#target)\n\n` + Array.from({ length: 35 }, (_, i) => `${chinese ? "示例正文" : "Example prose"} ${i}.`).join("\n\n")) +
  wrap("target", `## ${chinese ? "目标" : "Target"}\n\n${chinese ? "目标正文" : "Target body"}\n\n## ${chinese ? "其他" : "Other"}\n\n` + Array.from({ length: 35 }, (_, i) => `Paragraph ${i}.`).join("\n\n"));
const pkg = kbPackage({ name: "locales", template: "src/templates", site: { base: "/", lang: "en", locales: { "zh-CN": { title: "文档" } } } });
const selected = ["a", "b"].map(name => ({ relPath: `codeindex/${name}.md`, absPath: "/unused", content: article(name, false),
  article: { article_id: `article:${name}`, path: `codeindex/${name}.md`, collection: "codeindex" as const, visibility: "public", sections: [] } }));
const mapping = createSiteNavigation(pkg, selected);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const server = createServer();
try {
  for (const page of mapping.pages) {
    const file = selected.find(item => `knowledge/${item.relPath}` === page.approved_path)!;
    const path = join(root, pkg.outDir, page.package_path);
    await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, projectPackageKnowledgeMarkdown(file.content));
    const translated = join(root, "translations/zh-CN", file.relPath);
    await mkdir(join(translated, ".."), { recursive: true });
    await writeFile(translated, article(file.article.article_id.slice(-1), true).replace("---\n#", `translation:\n  source_digest: ${approvedArticleDigest(file.content)}\n---\n#`));
  }
  await writePackageSite({ projectRoot: root, pkg, selected });
  const output = resolve(root, packageSiteOutputDir(pkg));
  server.on("request", async (request, response) => {
    try {
      const path = resolve(output, "." + decodeURIComponent(new URL(request.url!, "http://localhost").pathname));
      if (!path.startsWith(output + sep)) { response.writeHead(403).end(); return; }
      const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
      response.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", error => console.log("PAGE ERROR", error.message));
  page.on("console", message => { if (message.type() === "error") console.log("CONSOLE ERROR", message.text()); });
  page.on("response", response => { if (response.status() >= 400) console.log("HTTP", response.status(), response.url()); });
  await page.addInitScript(() => localStorage.setItem("context-locale", "zh-CN"));
  const url = (name: string) => origin + "/" + mapping.pages.find(p => p.artifact_ref === `article:${name}`)!.site_path;
  const check = async () => {
    console.log("Checking", page.url());
    try {
    await page.waitForFunction(() => {
      const heading = document.querySelector('[data-context-locales="zh-CN"] [data-context-heading="section-target/1"]');
      const top = heading?.getBoundingClientRect().top ?? -1000;
      return document.documentElement.dataset.contextLocale === "zh-CN" && top >= 0 && top < 180;
    }, undefined, { timeout: 5000 });
    } catch (error) {
      console.log(JSON.stringify(await page.evaluate(() => ({ locale: document.documentElement.dataset.contextLocale,
        headings: [...document.querySelectorAll('.VPDoc h2')].map(e => ({ id: e.id, key: (e as HTMLElement).dataset.contextHeading, top: e.getBoundingClientRect().top, visible: !!e.getClientRects().length,
          locale: (e.closest('[data-context-locales]') as HTMLElement)?.dataset.contextLocales })) })), null, 2));
      throw error;
    }
    assert.equal(await page.locator("html").getAttribute("data-context-locale"), "zh-CN");
  };
  await page.goto(url("a"));
  await page.getByRole("link", { name: "去目标", exact: true }).click(); await check();
  await page.getByRole("link", { name: "本页目标", exact: true }).click(); await check();
  await page.getByRole("link", { name: "本页目标", exact: true }).click(); await check();
  await page.goto(url("a") + "#target"); await check();
  await page.getByRole("link", { name: "去目标", exact: true }).click(); await check();
  await page.goBack(); await check();
  await page.goForward(); await check();
  console.log("PASS: cross-page, same-page, repeated hash, direct URL, back and forward keep Chinese and the target heading.");
} finally {
  await browser?.close();
  await new Promise<void>(done => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
}
