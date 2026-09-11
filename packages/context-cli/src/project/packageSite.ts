import { createHash } from "node:crypto";
import { packageSiteOutputDir } from "./packageOutputPaths.js";
import { readWorkspaceChangelog } from "./workspaceChangelog.js";
import { buildLlmsDocuments, writeLlmsDocuments, llmsArticles } from "./packageLlms.js";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, cp, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { loadSourcesRegistry, projectKnowledgeMap, knowledgeMapTargetKey, type PackageDefinition, type KnowledgeMap, type ProjectedKnowledgeMapEntry } from "@c4a/context";
import { walkPackageFiles } from "./packageBuildReceipt.js";
import { packageKnowledgeOutputPath } from "./packageDistribution.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { knowledgeMapSectionAnchor } from "./packageKnowledgeMap.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { siteArticleSources } from "./packageSiteSources.js";
import { siteMarkdownConfig, siteThemeCss, siteThemeScript, siteThemeLabels } from "./packageSiteTheme.js";

export const PACKAGE_SITE_VERSION = "vitepress-site-v20-llms-utf8";
const require = createRequire(import.meta.url);
export interface SitePage {
  artifact_ref?: string;
  approved_path?: string;
  package_path: string;
  site_path: string;
  title: string;
}
export function sitePagePath(identity: string): string {
  return `pages/${createHash("sha256").update(identity).digest("hex").slice(0, 32)}.html`;
}
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const mdLabel = (value: string) => value.replace(/[\\[\]<>`*]/gu, "\\$&").replace(/[\r\n]/gu, " ");

export function createSiteNavigation(pkg: PackageDefinition, selected: readonly ApprovedKnowledgeFile[], structure?: KnowledgeMap) {
  const targets = new Map<string, string>();
  const identities = new Set<string>();
  const pages: SitePage[] = selected.map(file => {
    const meta = parseKnowledgeFrontmatter(file.content);
    const artifact = typeof meta.artifact_ref === "string" ? meta.artifact_ref : undefined;
    if (artifact && identities.has(artifact)) throw new TypeError(`Duplicate website article identity: ${artifact}. Resolve the duplicate approved article before building.`);
    if (artifact) identities.add(artifact);
    const path = sitePagePath(artifact ?? `path:${file.relPath}`);
    if (artifact) {
      targets.set(artifact, `/${path}`);
      for (const match of file.content.matchAll(/<!--\s*context:section\b[^>]*\bid="([a-zA-Z0-9_-]+)"[^>]*-->/gu)) {
        targets.set(knowledgeMapTargetKey({ artifact_ref: artifact, section_key: match[1]! }), `/${path}#${knowledgeMapSectionAnchor(match[1]!)}`);
      }
    }
    return { ...(artifact ? { artifact_ref: artifact } : {}), approved_path: `knowledge/${file.relPath}`,
      package_path: packageKnowledgeOutputPath(pkg, file.relPath), site_path: path,
      title: typeof meta.title === "string" ? meta.title : posix.basename(file.relPath, ".md") };
  });
  const projection = structure ? projectKnowledgeMap(structure, targets) : { entries: [], warnings: [] };
  const linked = new Set<string>();
  const visit = (entries: ProjectedKnowledgeMapEntry[]) => entries.forEach(entry => {
    if (entry.href) linked.add(entry.href.split("#")[0]!);
    visit(entry.children);
  });
  visit(projection.entries);
  const remaining: ProjectedKnowledgeMapEntry[] = [];
  for (const page of pages) {
    if (linked.has(`/${page.site_path}`)) continue;
    remaining.push({ key: page.site_path, title: page.title, href: `/${page.site_path}`, children: [] });
  }
  const entries = [...projection.entries];
  const warnings: (typeof projection.warnings[number] | { code: "knowledge-map-placement-missing"; count: number; message: string })[] = [...projection.warnings];
  if (remaining.length) {
    entries.push({ key: "unplaced-articles", title: pkg.kind === "package.kb" && pkg.site?.lang?.startsWith("zh") ? "全部文章" : "All articles", children: remaining });
    warnings.push({ code: "knowledge-map-placement-missing", count: remaining.length, message: "Complete the knowledge map to organize website navigation." });
  }
  return { pages, entries, warnings };
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "");
}

/** Resolve links from the KB's delivered coordinates, never from source paths. */
export function siteMarkdown(content: string, from: string, pages: ReadonlyMap<string, SitePage>, files: ReadonlySet<string>): string {
  let body = stripFrontmatter(content).replace(/<!--\s*@include:/gu, "&lt;!-- @include:");
  for (const link of markdownReaderLinks(body).reverse()) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(link.target)) continue;
    const [pathPart, fragment] = link.target.split(/#(.*)/su);
    let path: string;
    try { path = posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(pathPart!.split("?")[0]!))); }
    catch { continue; }
    if (path.startsWith("../")) continue;
    const page = pages.get(path);
    const target = page ? `/${page.site_path}` : files.has(path) ? `/resources/${encodePath(path)}` : undefined;
    if (!target) continue;
    body = body.slice(0, link.start) + `${link.image ? "!" : ""}[${link.label}](<${target}${fragment === undefined ? "" : `#${fragment}`}>)` + body.slice(link.end);
  }
  return body;
}

function sidebar(entries: ProjectedKnowledgeMapEntry[]): unknown[] {
  return entries.map(entry => ({ text: entry.title, ...(entry.href ? { link: entry.href } : {}),
    ...(entry.children.length ? { collapsed: true, items: sidebar(entry.children) } : {}) }));
}

export function siteSections(entries: ProjectedKnowledgeMapEntry[]) {
  const pageLinks = (entry: ProjectedKnowledgeMapEntry): string[] => [
    ...(entry.href ? [entry.href.split("#")[0]!] : []), ...entry.children.flatMap(pageLinks),
  ];
  return entries.map(entry => ({ key: entry.key, title: entry.title,
    href: `/sections/${createHash("sha256").update(entry.key).digest("hex").slice(0, 20)}.html`,
    pages: [...new Set(pageLinks(entry))],
    items: sidebar(entry.href ? [entry] : entry.children),
    entries: entry.href ? [entry] : entry.children,
  }));
}

async function compileSite(root: string, outDir: string) {
  const vitepressRoot = dirname(require.resolve("vitepress/package.json"));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.versions.bun ? "node" : process.execPath,
      [join(vitepressRoot, "bin/vitepress.js"), "build", root, "--outDir", outDir], { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const receive = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-16000); process.stderr.write(chunk); };
    child.stdout.on("data", receive); child.stderr.on("data", receive);
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
      if (code === 0) resolve();
      else reject(new Error(`Website build failed (${signal ?? code}). Existing package was preserved. Fix the reported rendering error and rerun context build.\n${tail}`));
    });
  });
}

export async function writePackageSite(input: {
  projectRoot: string; pkg: PackageDefinition; selected: readonly ApprovedKnowledgeFile[]; structure?: KnowledgeMap;
}) {
  if (input.pkg.kind !== "package.kb" || !input.pkg.site) return;
  const { pkg, projectRoot, selected, structure } = input;
  const options = pkg.site!;
  const base = options.base ?? "/";
  const history = await readWorkspaceChangelog(projectRoot);
  const historyDate = history[0]?.date ?? null;
  const root = join(projectRoot, pkg.outDir);
  const output = join(projectRoot, packageSiteOutputDir(pkg));
  try { await access(output); throw new Error("Website output already exists; build through the staged package workflow."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporaryRoot = join(projectRoot, ".tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(join(temporaryRoot, "website-"));
  try {
    const registry = await loadSourcesRegistry({ rootDir: projectRoot });
    const sourceContent = new Map(selected.map(file => [packageKnowledgeOutputPath(pkg, file.relPath), file.content]));
    const mapping = createSiteNavigation(pkg, selected, structure);
    const delivered = await walkPackageFiles(root);
    const byPath = new Map(mapping.pages.map(page => [page.package_path, page]));
    // Preserve linked package reference pages without exposing packaging directories as navigation.
    for (const file of delivered) {
      if (!/^(?:skills|wikis|guides|rules|feats)\/.*\.md$/u.test(file.relPath) || byPath.has(file.relPath)) continue;
      const content = await readFile(file.absPath, "utf8");
      const meta = parseKnowledgeFrontmatter(content);
      const page = { package_path: file.relPath, site_path: sitePagePath(`index:${file.relPath}`),
        title: typeof meta.title === "string" ? meta.title : typeof meta.name === "string" ? meta.name :
          /^#\s+(.+)$/mu.exec(content)?.[1] ?? posix.basename(file.relPath, ".md") };
      byPath.set(file.relPath, page);
    }
    const sections = siteSections(mapping.entries);
    const resources = new Set(delivered.filter(file => file.relPath.startsWith("others/assets/") ||
      (file.relPath.startsWith("skills/") && !file.relPath.endsWith(".md"))).map(file => file.relPath));
    const configRoot = join(temporary, ".vitepress");
    await mkdir(join(configRoot, "theme"), { recursive: true });
    await mkdir(join(temporary, "node_modules"), { recursive: true });
    const vitepressRoot = dirname(require.resolve("vitepress/package.json"));
    const vueRequire = createRequire(join(vitepressRoot, "package.json"));
    for (const [name, path] of [["vitepress", vitepressRoot], ["vue", dirname(vueRequire.resolve("vue/package.json"))],
      ["mermaid", dirname(require.resolve("mermaid/package.json"))]]) {
      await symlink(path!, join(temporary, "node_modules", name!), "dir");
    }
    await writeFile(join(configRoot, "theme/index.js"), siteThemeScript);
    await writeFile(join(configRoot, "theme/style.css"), siteThemeCss);
    const config = { title: options.title ?? pkg.name, description: options.description ?? "", lang: options.lang ?? "en-US", base,
      appearance: { initialValue: "light", valueDark: "dark", valueLight: "light", storageKey: `context-theme:${pkg.name}:${base}` },
      ignoreDeadLinks: true, cleanUrls: false, router: { prefetchLinks: false }, vite: { build: { chunkSizeWarningLimit: 2000 } },
      themeConfig: { ...siteThemeLabels(options.lang ?? "en-US"), contextUpdated: historyDate,
        contextSections: sections.map(({ key, title, href, pages, items }) => ({ key, title, href, pages, items })),
        sidebar: sections[0]?.items ?? [],
        nav: [...sections.map(section => ({ text: section.title, link: section.href })), { text: "LLM Docs", link: "/llms/index.html" }, { text: "Changelog", link: "/changelog.html" }],
      } };
    await writeFile(join(configRoot, "config.mjs"), `export default { ...${JSON.stringify(config)}, markdown: { ${siteMarkdownConfig} } };\n`);
    await mkdir(join(temporary, "pages"), { recursive: true });
    for (const page of byPath.values()) {
      const content = await readFile(join(root, page.package_path), "utf8");
      // Only the presentation title is passed as frontmatter; source frontmatter
      // cannot supply scripts, layouts, imports or head tags to the compiler.
      const body = siteMarkdown(content, page.package_path, byPath, resources);
      const original = sourceContent.get(page.package_path) ?? content;
      const sources = siteArticleSources(original, registry);
      const timestamp = parseKnowledgeFrontmatter(original).timestamp;
      const updated = typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
        ? new Date(timestamp).toISOString() : null;
      await writeFile(join(temporary, page.site_path.replace(/\.html$/u, ".md")),
        `---\ntitle: ${JSON.stringify(page.title)}\ncontextSources: ${JSON.stringify(sources)}\ncontextUpdated: ${JSON.stringify(updated)}\n---\n\n${body}`);
    }
    const menu = (lines: string[], entries: ProjectedKnowledgeMapEntry[], level: number) => entries.forEach(entry => {
      lines.push(`${"  ".repeat(level)}- ${entry.href ? `[${mdLabel(entry.title)}](${entry.href})` : mdLabel(entry.title)}`);
      menu(lines, entry.children, level + 1);
    });
    await mkdir(join(temporary, "sections"), { recursive: true });
    for (const section of sections) {
      const lines = [`# ${mdLabel(section.title)}`, ""];
      menu(lines, section.entries, 0);
      await writeFile(join(temporary, section.href.slice(1).replace(/\.html$/u, ".md")), lines.join("\n") + "\n");
    }
    const home: string[] = [`# ${mdLabel(options.title ?? pkg.name)}`, "", mdLabel(options.description ?? ""), ""];
    for (const section of sections) home.push(`- [${mdLabel(section.title)}](${section.href})`);
    await writeFile(join(temporary, "index.md"), home.join("\n") + "\n");
    await writeFile(join(temporary, "changelog.md"), `---\ntitle: Changelog\ncontextHistory: ${JSON.stringify(Buffer.from(JSON.stringify(history)).toString("base64"))}\n---\n\n# Changelog\n`);
    const llms = buildLlmsDocuments({ title: options.title ?? pkg.name, base, assetsPrefix: "resources/",
      articles: await Promise.all(llmsArticles(pkg, selected).map(async article => ({ ...article,
        content: await readFile(join(root, article.path), "utf8") }))), ...(structure ? { map: structure } : {}) });
    await writeLlmsDocuments(join(temporary, "public"), llms, { utf8Bom: true });
    await mkdir(join(temporary, "llms"), { recursive: true });
    // VitePress applies base to root-relative Markdown links itself; the raw
    // text index needs that base explicitly, but the HTML landing page does not.
    let landingNavigation = llms.navigationMarkdown;
    for (const link of markdownReaderLinks(landingNavigation).reverse()) {
      if (!link.target.startsWith(base)) continue;
      landingNavigation = landingNavigation.slice(0, link.start) +
        `[${link.label}](</${link.target.slice(base.length)}>)` + landingNavigation.slice(link.end);
    }
    await writeFile(join(temporary, "llms/index.md"), `---\ntitle: LLM Docs\n---\n\n# LLM Docs\n\n` +
      `[Knowledge index](/llms.txt) · [Full text](/llms-full.txt)\n\n` + landingNavigation);
    for (const path of resources) {
      const destination = join(temporary, "public/resources", path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(root, path), destination);
    }
    await compileSite(temporary, output);
    await writeFile(join(output, "context-site-map.json"), JSON.stringify({ protocol: "context.site-output/v1",
      knowledge_map_revision: structure?.revision ?? null, base, llms: { index: "llms.txt", full: "llms-full.txt", home: "llms/index.html", articles: llms.articleCount }, pages: [...byPath.values()], entries: mapping.entries,
      sections: sections.map(({ key, title, href, pages, items }) => ({ key, title, href, pages, items })), warnings: mapping.warnings }, null, 2) + "\n");
    return mapping;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
