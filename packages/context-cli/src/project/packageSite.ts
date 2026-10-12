import { resolveSiteTheme, siteThemeVariables } from "./siteTheme.js";
import { optionalRepoGit } from "./repoContentGit.js";
import { repoContentLabels } from "./repoContentPages.js";
import { importsLabels } from "./importsPages.js";
import { createHash } from "node:crypto";
import { packageSiteOutputDir } from "./packageOutputPaths.js";
import { readWorkspaceChangelog } from "./workspaceChangelog.js";
import { buildLlmsDocuments, writeLlmsDocuments, llmsArticles } from "./packageLlms.js";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink, cp, access, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { loadSourcesRegistry, projectKnowledgeMap, knowledgeMapTargetKey, type PackageDefinition, type PackageSiteDefinition, type KnowledgeMap, type ProjectedKnowledgeMapEntry } from "@c4a/context";
import { walkPackageFiles } from "./packageBuildReceipt.js";
import { packageKnowledgeOutputPath } from "./packageDistribution.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { knowledgeMapSectionAnchor } from "./packageKnowledgeMap.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { articleProvenanceMarkdown, siteArticleSources } from "./packageSiteSources.js";
import { siteMarkdownConfig, siteThemeCss, siteThemeScript, siteThemeLabels } from "./packageSiteTheme.js";
import { packageSiteBranding } from "./packageSiteBranding.js";
import { writeSiteExtensions, siteExtensionTargets, invalidSiteExtension } from "./packageSiteExtensions.js";
import { packageDistributionMetadataPath } from "./packageDistributionMetadata.js";
import { createLocaleMarker, createSiteLocalizer, escapeHtml, localizedHtml, restoreOriginNavLinks, siteLocaleCss, siteLocaleScript,
  siteMoreTargets, siteNavigationConfig, siteReaderLocales, type SiteNavItem } from "./packageSiteLocales.js";

// Include shipped presentation assets: theme-only upgrades must invalidate an
// existing site's receipt even when its knowledge and configuration are unchanged.
export const PACKAGE_SITE_VERSION = `vitepress-site-v49-locale-home-fallback:${createHash("sha256")
  .update(JSON.stringify([siteThemeVariables.toString(), siteMarkdownConfig, siteThemeCss, siteThemeScript, siteThemeLabels("zh"), siteThemeLabels("en")]))
  .digest("hex")}`;
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
    const artifact = file.article?.article_id;
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
  for (const [key, href] of siteExtensionTargets(pkg.kind === "package.kb" ? pkg.site : undefined)) {
    if (identities.has(key)) invalidSiteExtension(`Website page ${key} conflicts with an approved article identity`);
    targets.set(key, href);
  }
  for (const entry of structure?.entries ?? []) {
    if (entry.target?.artifact_ref.startsWith("site:") && !targets.has(entry.target.artifact_ref)) {
      invalidSiteExtension(`Unknown site page ${entry.target.artifact_ref}; declare it in site.extensions.pages`);
    }
    if (entry.target?.artifact_ref.startsWith("site:") && entry.target.section_key) {
      invalidSiteExtension(`Website page ${entry.target.artifact_ref} does not support knowledge section_key targets`);
    }
  }
  const projection = structure ? projectKnowledgeMap(structure, targets) : { entries: [], warnings: [] };
  const linked = new Set<string>();
  const visit = (entries: ProjectedKnowledgeMapEntry[]) => entries.forEach(entry => {
    if (entry.href) linked.add(entry.href.split("#")[0]!);
    visit(entry.children);
  });
  visit(projection.entries);
  const remaining: ProjectedKnowledgeMapEntry[] = [];
  const moreTargets = siteMoreTargets(pkg.kind === "package.kb" ? pkg.site : undefined);
  for (const target of moreTargets) {
    if (!identities.has(target)) invalidSiteExtension(`More menu target ${target} is not a delivered article; approve it or remove it from site.more`);
  }
  for (const page of pages) {
    if (linked.has(`/${page.site_path}`) || (page.artifact_ref !== undefined && moreTargets.has(page.artifact_ref))) continue;
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

function sidebar(entries: ProjectedKnowledgeMapEntry[], label: (entry: ProjectedKnowledgeMapEntry) => string = entry => entry.title): unknown[] {
  return entries.map(entry => ({ text: label(entry), ...(entry.href ? { link: entry.href } : {}),
    // Explicit empty items keep VitePress from wrapping sibling leaves in an
    // anonymous group, which would introduce an extra indentation level.
    items: sidebar(entry.children, label), ...(entry.children.length ? { collapsed: true } : {}) }));
}

export function siteSections(entries: ProjectedKnowledgeMapEntry[]) {
  const directoriesFirst = (siblings: ProjectedKnowledgeMapEntry[]): ProjectedKnowledgeMapEntry[] => {
    const ordered = [...siblings.filter(entry => entry.children.length > 0),
      ...siblings.filter(entry => entry.children.length === 0)];
    return ordered.map(entry => ({ ...entry, children: directoriesFirst(entry.children) }));
  };
  const pageLinks = (entry: ProjectedKnowledgeMapEntry): string[] => [
    ...(entry.href ? [entry.href.split("#")[0]!] : []), ...entry.children.flatMap(pageLinks),
  ];
  // Keep top navigation order; partition each section recursively without
  // changing the authored map or the order within directories and articles.
  return entries.map(entry => ({ ...entry, children: directoriesFirst(entry.children) })).map(entry => ({ key: entry.key, title: entry.title, entry,
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

/** Each homepage field falls back from the reader language to the site's own setting, then to the built-in default. */
export function siteHomeHero(options: PackageSiteDefinition,
  input: { tag: string; primary: string; packageName: string; firstSection: string }) {
  const chinese = input.tag.toLowerCase().startsWith("zh");
  const locale = input.tag === input.primary ? undefined : options.locales?.[input.tag];
  const own = locale?.home;
  const featured = (own?.resources ?? options.home?.resources ?? []).filter(resource => resource.featured && resource.href);
  return {
    name: own?.title ?? locale?.title ?? options.home?.title ?? options.title ?? input.packageName,
    text: own?.slogan ?? options.home?.slogan ?? (chinese ? "从知识地图开始探索" : "Explore from the knowledge map"),
    tagline: own?.description ?? locale?.description ?? options.home?.description ?? options.description ?? "",
    actions: own?.actions ?? options.home?.actions ?? [
      { theme: "brand" as const, text: chinese ? "浏览知识" : "Browse knowledge", link: input.firstSection },
      ...featured.map(resource => ({ theme: "alt" as const, text: resource.title, link: resource.href! })),
      { theme: "alt" as const, text: "LLM Docs", link: "/llms/index.html" },
    ],
  };
}

export async function writePackageSite(input: {
  projectRoot: string; pkg: PackageDefinition; selected: readonly ApprovedKnowledgeFile[]; structure?: KnowledgeMap; siteUrl?: string;
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
    const repositoryRemote = await optionalRepoGit(projectRoot, ["remote", "get-url", "origin"]);
    const sourceContent = new Map(selected.map(file => [packageKnowledgeOutputPath(pkg, file.relPath), file]));
    const mapping = createSiteNavigation(pkg, selected, structure);
    const delivered = await walkPackageFiles(root);
    const byPath = new Map(mapping.pages.map(page => [page.package_path, page]));
    // Preserve linked package reference pages without exposing packaging directories as navigation.
    for (const file of delivered) {
      if (/^wikis\/repo-content(?:\/|\.md$)/u.test(file.relPath) && typeof pkg.repoContentPage !== "object") continue;
      if (file.relPath === "wikis/imports.md" && typeof pkg.importsPage !== "object") continue;
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
      ["@mermaid-js/layout-elk", dirname(require.resolve("@mermaid-js/layout-elk/package.json"))],
      ["mermaid", dirname(require.resolve("mermaid/package.json"))]]) {
      await mkdir(dirname(join(temporary, "node_modules", name!)), { recursive: true });
      await symlink(path!, join(temporary, "node_modules", name!), "dir");
    }
    const readers = siteReaderLocales(options, pkg.name);
    const marker = createLocaleMarker();
    await writeFile(join(configRoot, "theme/index.js"), siteThemeScript);
    await writeFile(join(configRoot, "theme/style.css"), siteThemeCss + siteLocaleCss(readers) +
      siteThemeVariables(await resolveSiteTheme(projectRoot, options.theme, true)));
    await writeSiteExtensions(projectRoot, temporary, options.extensions);
    const localizer = await createSiteLocalizer({ projectRoot, readers, marker, selected, byPath, resources });
    await mkdir(join(temporary, "pages"), { recursive: true });
    const primaryBody = (page: SitePage, packageContent: string) => {
      let content = packageContent;
      if (page.package_path === "wikis/index.md" && typeof pkg.repoContentPage !== "object") {
        content = content.replace(/^.*\]\((?:<)?(?:\.\/)?repo-content\.md(?:>)?\).*\n?/gmu, "");
      }
      if (page.package_path === "wikis/index.md" && typeof pkg.importsPage !== "object") {
        content = content.replace(/^.*\]\((?:<)?(?:\.\/)?imports\.md(?:>)?\).*\n?/gmu, "");
      }
      // Only the presentation title is passed as frontmatter; source frontmatter
      // cannot supply scripts, layouts, imports or head tags to the compiler.
      const original = sourceContent.get(page.package_path);
      const provenance = articleProvenanceMarkdown(original?.article, registry, repositoryRemote);
      const pageContent = provenance && content.endsWith(provenance) ? content.slice(0, -provenance.length) : content;
      return siteMarkdown(pageContent, page.package_path, byPath, resources);
    };
    const pageFrontmatter = (page: SitePage, content: string, titles?: Record<string, string>) => {
      const original = sourceContent.get(page.package_path);
      const sources = siteArticleSources(original?.article, registry, repositoryRemote);
      const timestamp = parseKnowledgeFrontmatter(original?.content ?? content).timestamp;
      const updated = typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
        ? new Date(timestamp).toISOString() : null;
      return `---\ntitle: ${JSON.stringify(page.title)}\n${titles ? `contextTitles: ${JSON.stringify(titles)}\n` : ""}` +
        `contextSources: ${JSON.stringify(sources)}\ncontextUpdated: ${JSON.stringify(updated)}\n---\n`;
    };
    for (const page of byPath.values()) {
      const content = await readFile(join(root, page.package_path), "utf8");
      const localized = await localizer.page(page, primaryBody(page, content));
      await writeFile(join(temporary, page.site_path.replace(/\.html$/u, ".md")),
        `${pageFrontmatter(page, content, localized.titles)}\n${localized.body}`);
    }
    // Labels read translated page titles, so they follow the pages.
    const themeSections = sections.map(section => ({ key: section.key, title: section.title, titles: localizer.titles(section.entry),
      label: localizer.label(section.entry), href: section.href, pages: section.pages, items: sidebar(section.entries, localizer.label) }));
    const navigation = siteNavigationConfig(options, mapping.pages);
    const navText = ({ locales, ...item }: SiteNavItem) => ({ ...item, text: localizedHtml(readers.tags, tag => locales?.[tag] ?? item.text) });
    const localeResources = Object.values(options.locales ?? {}).some(locale => locale.home?.resources) ? Object.fromEntries(readers.tags.map(tag =>
      [tag, (tag === readers.primary ? undefined : options.locales?.[tag]?.home?.resources) ?? options.home?.resources ?? []])) : undefined;
    const appearanceKey = `context-theme:${pkg.name}:${base}`;
    const config = { title: options.title ?? pkg.name, description: options.description ?? "", lang: readers.primary, base,
      appearance: { initialValue: "auto", valueDark: "dark", valueLight: "light", storageKey: appearanceKey },
      // VitePress's pre-paint script reads its default key; apply the site key before first paint too.
      // Without a saved choice ("auto" included) the site follows the system scheme.
      head: [["script", { id: "context-appearance" },
        `(()=>{let v=null;try{v=localStorage.getItem(${JSON.stringify(appearanceKey)})}catch{}document.documentElement.classList.toggle("dark",v==="dark"||(v!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))})();`],
        ["script", { id: "context-locale" }, siteLocaleScript(readers)]],
      srcExclude: ["_site/**/*.md"],
      ignoreDeadLinks: true, cleanUrls: false, router: { prefetchLinks: false }, vite: {
        resolve: { dedupe: ["vue", "vitepress"] }, build: { chunkSizeWarningLimit: 2000 } },
      themeConfig: { ...siteThemeLabels("zh"), contextUpdated: historyDate,
        contextUiLabels: { zh: siteThemeLabels("zh"), en: siteThemeLabels("en") },
        contextSections: themeSections,
        contextHome: { resources: options.home?.resources ?? [], ...(localeResources ? { localeResources } : {}), branding: packageSiteBranding },
        sidebar: themeSections[0]?.items ?? [],
        nav: [...themeSections.map(section => ({ text: section.label, link: section.href })),
          ...(typeof pkg.repoContentPage === "object" && byPath.has("wikis/repo-content.md")
            ? [{ text: escapeHtml((await repoContentLabels(projectRoot)).title), link: `/${byPath.get("wikis/repo-content.md")!.site_path}` }] : []),
          ...(typeof pkg.importsPage === "object" && byPath.has("wikis/imports.md")
            ? [{ text: escapeHtml((await importsLabels(projectRoot)).title), link: `/${byPath.get("wikis/imports.md")!.site_path}` }] : []),
          { text: "More", items: [{ text: "LLM Docs", link: "/llms/index.html" }, { text: "Changelog", link: "/changelog.html" }] }],
        contextNav: navigation.nav.map(navText), contextMore: navigation.more.map(navText),
        ...(options.socialLinks ? { socialLinks: options.socialLinks } : {}),
        // A target keeps the router from resolving the link inside the site base.
        ...(options.titleLink ? { logoLink: { link: options.titleLink, target: "_self" } } : {}),
        ...(options.extensions?.slots?.brand ? { siteTitle: false } : {}),
        contextLocales: { primary: readers.primary, tags: readers.tags, labels: readers.labels, titles: readers.titles, preferenceKey: readers.preferenceKey },
      } };
    await writeFile(join(configRoot, "config.mjs"), `const contextLocaleMarker = ${JSON.stringify(readers.translated ? marker : null)};\n` +
      `export default { ...${JSON.stringify(config)}, markdown: { ${siteMarkdownConfig} } };\n`);
    const menu = (lines: string[], entries: ProjectedKnowledgeMapEntry[], level: number, tag: string) => entries.forEach(entry => {
      const title = mdLabel(localizer.entryTitle(tag, entry));
      lines.push(`${"  ".repeat(level)}- ${entry.href ? `[${title}](${entry.href})` : title}`);
      menu(lines, entry.children, level + 1, tag);
    });
    await mkdir(join(temporary, "sections"), { recursive: true });
    for (const section of sections) {
      await writeFile(join(temporary, section.href.slice(1).replace(/\.html$/u, ".md")), localizer.variants(tag => {
        const lines = [`# ${mdLabel(localizer.entryTitle(tag, section.entry))}`, ""];
        menu(lines, section.entries, 0, tag);
        return lines.join("\n") + "\n";
      }));
    }
    const firstSection = sections[0]?.href ?? "/llms/index.html";
    const heroTags = readers.translated ? readers.tags : [readers.primary];
    const heroes = new Map(heroTags.map(tag => [tag, siteHomeHero(options, { tag, primary: readers.primary, packageName: pkg.name, firstSection })]));
    const hero = { name: localizedHtml(heroTags, tag => heroes.get(tag)!.name), text: localizedHtml(heroTags, tag => heroes.get(tag)!.text),
      tagline: localizedHtml(heroTags, tag => heroes.get(tag)!.tagline), actions: heroes.get(readers.primary)!.actions };
    const heroActions = readers.translated ? `contextHeroActions: ${JSON.stringify(Object.fromEntries([...heroes].map(([tag, value]) => [tag, value.actions])))}\n` : "";
    const homeHero = options.extensions?.slots?.banner === undefined ? `hero: ${JSON.stringify(hero)}\n${heroActions}` : "";
    await writeFile(join(temporary, "index.md"),
      `---\nlayout: home\ntitle: ${JSON.stringify(options.home?.title ?? options.title ?? pkg.name)}\n${homeHero}---\n`);
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
    const originLinks = [...navigation.nav, ...navigation.more].filter(item => item.origin).map(item => item.link);
    // Some deployment stores reject zero-byte objects. Preserve URLs and only
    // fill formats where a comment is valid; never invent JSON or binary data.
    for (const file of await walkPackageFiles(output)) {
      const extension = posix.extname(file.relPath).toLowerCase();
      if (extension === ".html" && originLinks.length) {
        const html = await readFile(file.absPath, "utf8");
        const restored = restoreOriginNavLinks(html, base, originLinks);
        if (restored !== html) await writeFile(file.absPath, restored);
      }
      const placeholder = [".css", ".js", ".mjs", ".cjs"].includes(extension)
        ? "/* Intentionally empty. */\n"
        : [".html", ".htm"].includes(extension) ? "<!-- Intentionally empty. -->\n" : null;
      if (placeholder !== null && (await stat(file.absPath)).size === 0) {
        await writeFile(file.absPath, placeholder);
      }
    }
    const siteMapContent = JSON.stringify({ ...(input.siteUrl ? { site_url: input.siteUrl } : {}), protocol: "context.site-output/v1",
      knowledge_map_revision: structure?.revision ?? null, base, llms: { index: "llms.txt", full: "llms-full.txt", home: "llms/index.html", articles: llms.articleCount }, pages: [...byPath.values()], entries: mapping.entries,
      sections: sections.map(({ key, title, href, pages, items }) => ({ key, title, href, pages, items })),
      ...(localizer.summaries.length ? { locales: localizer.summaries } : {}), warnings: mapping.warnings }, null, 2) + "\n";
    const packageSiteMap = join(projectRoot, pkg.outDir, "context-site-map.json");
    const distributedSiteMap = join(
      projectRoot,
      pkg.outDir,
      packageDistributionMetadataPath("context-site-map.json"),
    );
    await mkdir(dirname(distributedSiteMap), { recursive: true });
    await Promise.all([
      writeFile(join(output, "context-site-map.json"), siteMapContent),
      writeFile(packageSiteMap, siteMapContent),
      writeFile(distributedSiteMap, siteMapContent),
    ]);
    return mapping;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
