import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { PackageDefinition, ProjectedKnowledgeMapEntry } from "@c4a/context";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import { projectPackageKnowledgeMarkdown } from "./packageKnowledgeProjection.js";
import { readTranslatedArticle, readTranslatedMapTitles } from "./siteTranslation.js";
import { siteSections, type SitePage } from "./packageSite.js";

type KbSite = NonNullable<Extract<PackageDefinition, { kind: "package.kb" }>["site"]>;
export interface SiteNavItem { text: string; link: string; origin?: true; locales?: Record<string, string> }
export interface LocalizedSiteSummary { tag: string; path: string; translated: number; stale: number; missing: number }

const chineseTag = (tag: string) => tag.toLowerCase().startsWith("zh");

export function localeLabel(tag: string): string {
  const language = tag.split("-")[0]!;
  try { return new Intl.DisplayNames([language], { type: "language" }).of(language) ?? tag; } catch { return tag; }
}

/** More menu targets live outside the knowledge map; every target must resolve to a delivered article. */
export function siteMoreTargets(site: KbSite | undefined): Set<string> {
  return new Set((site?.more ?? []).flatMap(item => item.target ? [item.target.artifact_ref] : []));
}

export function siteNavigationConfig(site: KbSite, pages: readonly SitePage[]) {
  const byArtifact = new Map(pages.flatMap(page => page.artifact_ref ? [[page.artifact_ref, page] as const] : []));
  const more: SiteNavItem[] = (site.more ?? []).map(item => {
    if (item.target) {
      const page = byArtifact.get(item.target.artifact_ref);
      if (!page) throw new TypeError(`More menu target ${item.target.artifact_ref} is not a delivered article; approve it or remove it from site.more`);
      return { text: item.text, link: `/${page.site_path}`, ...(item.locales ? { locales: item.locales } : {}) };
    }
    return { text: item.text, link: item.link!, ...(item.link!.startsWith("/") ? { origin: true as const } : {}), ...(item.locales ? { locales: item.locales } : {}) };
  });
  const nav: SiteNavItem[] = (site.nav ?? []).map(item => ({ text: item.text, link: item.link,
    ...(item.link.startsWith("/") ? { origin: true as const } : {}), ...(item.locales ? { locales: item.locales } : {}) }));
  return { nav, more };
}

function prefixed(prefix: string, href: string): string {
  return href.startsWith("/pages/") || href.startsWith("/sections/") ? `/${prefix}${href}` : href;
}

function localizeLinks(body: string, prefix: string): string {
  let result = body;
  for (const link of markdownReaderLinks(result).reverse()) {
    const target = link.target.startsWith("<") ? link.target.slice(1, -1) : link.target;
    if (!/^\/(?:pages|sections)\//u.test(target)) continue;
    result = result.slice(0, link.start) + `${link.image ? "!" : ""}[${link.label}](<${prefixed(prefix, target)}>)` + result.slice(link.end);
  }
  return result;
}

/** Translations keep approved-article coordinates; resolve them against the same delivered pages. */
function translatedMarkdown(content: string, from: string, pages: ReadonlyMap<string, SitePage>, resources: ReadonlySet<string>, prefix: string): string {
  let body = projectPackageKnowledgeMarkdown(content).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "")
    .replace(/<!--\s*@include:/gu, "&lt;!-- @include:");
  for (const link of markdownReaderLinks(body).reverse()) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(link.target)) continue;
    const [pathPart, fragment] = link.target.split(/#(.*)/su);
    let path: string;
    try { path = posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(pathPart!.split("?")[0]!))); }
    catch { continue; }
    const page = pages.get(path);
    const asset = path.startsWith("assets/") && resources.has(`others/${path}`) ? `/resources/others/${path}` : undefined;
    const target = page ? `/${prefix}/${page.site_path}` : asset;
    if (!target) continue;
    body = body.slice(0, link.start) + `${link.image ? "!" : ""}[${link.label}](<${target}${fragment === undefined ? "" : `#${fragment}`}>)` + body.slice(link.end);
  }
  return body;
}

function notice(tag: string, state: "missing" | "stale", primary: string): string {
  const zh = chineseTag(tag);
  const [kind, title, text] = state === "missing"
    ? ["info", zh ? "尚未翻译" : "Not yet translated", zh ? "本页暂无译文，以下为原文。" : "This page has no translation yet; the original is shown below."]
    : ["warning", zh ? "译文可能已过时" : "Translation may be outdated", zh ? "原文已更新，译文尚未同步。" : "The original has changed since this translation."];
  return `::: ${kind} ${title}\n${text}[${zh ? "查看原文" : "View original"}](<${primary}>)\n:::\n\n`;
}

function localizeEntries(entries: ProjectedKnowledgeMapEntry[], prefix: string, titles: ReadonlyMap<string, string>,
  pageTitles: ReadonlyMap<string, string>, unplaced: string): ProjectedKnowledgeMapEntry[] {
  return entries.map(entry => {
    const href = entry.href ? prefixed(prefix, entry.href) : undefined;
    const pageTitle = entry.href ? pageTitles.get(entry.href.split("#")[0]!) : undefined;
    const title = entry.key === "unplaced-articles" ? unplaced : titles.get(entry.key) ?? pageTitle ?? entry.title;
    return { ...entry, title, ...(href ? { href } : {}), children: localizeEntries(entry.children, prefix, titles, pageTitles, unplaced) };
  });
}

export async function writeLocalizedSite(input: {
  projectRoot: string; temporary: string; root: string; site: KbSite; packageName: string;
  selected: readonly ApprovedKnowledgeFile[]; byPath: ReadonlyMap<string, SitePage>; entries: ProjectedKnowledgeMapEntry[];
  resources: ReadonlySet<string>; contextHome: Record<string, unknown>; primaryBody: (page: SitePage, content: string) => string;
  pageFrontmatter: (page: SitePage, title: string) => string;
}) {
  const locales: Record<string, unknown> = {};
  const summaries: LocalizedSiteSummary[] = [];
  const configured = Object.entries(input.site.locales ?? {});
  if (configured.length === 0) return { locales: undefined, summaries };
  const primaryLang = input.site.lang ?? "en-US";
  locales.root = { lang: primaryLang };
  const byApproved = new Map([...input.byPath.values()].flatMap(page => page.approved_path ? [[page.approved_path.slice("knowledge/".length), page] as const] : []));
  const files = new Map(input.selected.map(file => [file.relPath, file]));
  for (const [tag, locale] of configured) {
    const prefix = locale.path;
    const summary: LocalizedSiteSummary = { tag, path: prefix, translated: 0, stale: 0, missing: 0 };
    const pageTitles = new Map<string, string>();
    await mkdir(join(input.temporary, prefix, "pages"), { recursive: true });
    for (const page of input.byPath.values()) {
      const file = page.approved_path ? files.get(page.approved_path.slice("knowledge/".length)) : undefined;
      const translation = file ? await readTranslatedArticle(input.projectRoot, tag, file) : undefined;
      let title = page.title;
      let body: string;
      if (translation && file) {
        title = translation.title;
        pageTitles.set(`/${page.site_path}`, title);
        body = (translation.current ? "" : notice(tag, "stale", `/${page.site_path}`)) +
          translatedMarkdown(`---\ntitle: ${JSON.stringify(translation.title)}\n---\n${translation.body}`, file.relPath, byApproved, input.resources, prefix);
        if (translation.current) summary.translated += 1; else summary.stale += 1;
      } else {
        const content = await readFile(join(input.root, page.package_path), "utf8");
        body = (file ? notice(tag, "missing", `/${page.site_path}`) : "") + localizeLinks(input.primaryBody(page, content), prefix);
        if (file) summary.missing += 1;
      }
      const destination = join(input.temporary, prefix, page.site_path.replace(/\.html$/u, ".md"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, `${input.pageFrontmatter(page, title)}\n${body}`);
    }
    const mapTitles = await readTranslatedMapTitles(input.projectRoot, tag);
    const zh = chineseTag(tag);
    const sections = siteSections(localizeEntries(input.entries, prefix, mapTitles, pageTitles, zh ? "全部文章" : "All articles"))
      .map(section => ({ ...section, href: `/${prefix}${section.href}` }));
    await mkdir(join(input.temporary, prefix, "sections"), { recursive: true });
    for (const section of sections) {
      const lines = [`# ${section.title}`, ""];
      const menu = (entries: ProjectedKnowledgeMapEntry[], level: number) => entries.forEach(entry => {
        lines.push(`${"  ".repeat(level)}- ${entry.href ? `[${entry.title}](${entry.href})` : entry.title}`);
        menu(entry.children, level + 1);
      });
      menu(section.entries, 0);
      await writeFile(join(input.temporary, section.href.slice(1).replace(/\.html$/u, ".md")), lines.join("\n") + "\n");
    }
    const firstSection = sections[0]?.href ?? "/llms/index.html";
    const home = locale.home;
    const name = home?.title ?? locale.title ?? input.site.title ?? input.packageName;
    const hero = { name, text: home?.slogan ?? (zh ? "从知识地图开始探索" : "Explore from the knowledge map"),
      tagline: home?.description ?? locale.description ?? "",
      actions: home?.actions ?? [{ theme: "brand", text: zh ? "浏览知识" : "Browse knowledge", link: firstSection },
        { theme: "alt", text: "LLM Docs", link: "/llms/index.html" }] };
    const homeHero = input.site.extensions?.slots?.banner === undefined ? `hero: ${JSON.stringify(hero)}\n` : "";
    await writeFile(join(input.temporary, prefix, "index.md"), `---\nlayout: home\ntitle: ${JSON.stringify(name)}\n${homeHero}---\n`);
    locales[prefix] = { lang: tag, link: `/${prefix}/`,
      ...(locale.title ? { title: locale.title } : {}), ...(locale.description ? { description: locale.description } : {}),
      themeConfig: { contextSections: sections.map(({ key, title, href, pages, items }) => ({ key, title, href, pages, items })),
        sidebar: sections[0]?.items ?? [],
        ...(home?.resources ? { contextHome: { ...input.contextHome, resources: home.resources } } : {}) } };
    summaries.push(summary);
  }
  return { locales, summaries };
}
