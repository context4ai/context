import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import type { PackageDefinition, ProjectedKnowledgeMapEntry } from "@c4a/context";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import { projectPackageKnowledgeMarkdown } from "./packageKnowledgeProjection.js";
import { readTranslatedArticle, readTranslatedMapTitles } from "./siteTranslation.js";
import type { SitePage } from "./packageSite.js";

type KbSite = NonNullable<Extract<PackageDefinition, { kind: "package.kb" }>["site"]>;
export interface SiteNavItem { text: string; link: string; origin?: true; position?: "start"; locales?: Record<string, string> }
export interface LocalizedSiteSummary { tag: string; translated: number; stale: number; missing: number }
export interface SiteReaderLocales {
  primary: string; tags: string[]; translated: boolean;
  labels: Record<string, string>; titles: Record<string, string>; preferenceKey: string;
}

const chineseTag = (tag: string) => tag.toLowerCase().startsWith("zh");
const htmlEscapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, char => htmlEscapes[char]!);

export function localeLabel(tag: string): string {
  const language = tag.split("-")[0]!;
  try { return new Intl.DisplayNames([language], { type: "language" }).of(language) ?? tag; } catch { return tag; }
}

/** Reader languages of one website, primary content language first. Sites
 * without translations still offer a Chinese and English interface. */
export function siteReaderLocales(site: KbSite, packageName: string): SiteReaderLocales {
  const primary = site.lang ?? "en-US";
  const extra = Object.keys(site.locales ?? {});
  const tags = extra.length ? [primary, ...extra] : [primary, chineseTag(primary) ? "en-US" : "zh-CN"];
  return { primary, tags, translated: extra.length > 0,
    labels: Object.fromEntries(tags.map(tag => [tag, site.locales?.[tag]?.label ?? localeLabel(tag)])),
    titles: Object.fromEntries(tags.map(tag => [tag, (tag === primary ? undefined : site.locales?.[tag]?.title) ?? site.title ?? packageName])),
    preferenceKey: site.localePreferenceKey ?? `context-locale:${packageName}:${site.base ?? "/"}` };
}

/** Runs before first paint: a saved choice wins, then the browser languages, then the primary language. */
export function siteLocaleScript(locales: SiteReaderLocales): string {
  const config = JSON.stringify({ key: locales.preferenceKey, tags: locales.tags, primary: locales.primary });
  return `(()=>{const c=${config};let l;try{l=localStorage.getItem(c.key)}catch{}` +
    `if(!c.tags.includes(l)){l=c.primary;for(const v of (navigator.languages||[navigator.language]).map(x=>String(x).toLowerCase())){` +
    `const m=c.tags.find(t=>t.toLowerCase()===v)||c.tags.find(t=>t.toLowerCase().split("-")[0]===v.split("-")[0]);if(m){l=m;break}}}` +
    `document.documentElement.dataset.contextLocale=l})();`;
}

/** Elements marked with `data-context-locales` show only for the listed reader languages. */
export function siteLocaleCss(locales: SiteReaderLocales): string {
  const hidden = (tag: string) => `[data-context-locales]:not([data-context-locales~="${tag}"])`;
  return `html:not([data-context-locale]) ${hidden(locales.primary)},\n` +
    locales.tags.map(tag => `html[data-context-locale="${tag}"] ${hidden(tag)}`).join(",\n") + " { display: none !important; }\n";
}

/** HTML text for VitePress labels rendered with v-html; identical texts collapse to one. */
export function localizedHtml(tags: readonly string[], text: (tag: string) => string): string {
  const values = tags.map(text);
  if (values.every(value => value === values[0])) return escapeHtml(values[0]!);
  return tags.map((tag, index) => `<span data-context-locales="${tag}" lang="${tag}">${escapeHtml(values[index]!)}</span>`).join("");
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
    ...(item.link.startsWith("/") ? { origin: true as const } : {}), ...(item.position === "start" ? { position: "start" as const } : {}),
    ...(item.locales ? { locales: item.locales } : {}) }));
  return { nav, more };
}

/** VitePress prefixes `base` onto every root-relative nav link during SSR; the
 * theme only swaps in the origin URL after mount. Restore the server markup so
 * crawlers, no-script readers and early clicks reach the origin path. */
export function restoreOriginNavLinks(html: string, base: string, links: readonly string[]): string {
  if (base === "/" || !links.length) return html;
  const prefixedHref = new Map(links.map(link => [`${base}${link.slice(1)}`, link]));
  return html.replace(/<a\b[^>]*>/gu, tag => {
    if (!/\starget="_self"/u.test(tag)) return tag;
    const href = tag.match(/\shref="([^"]*)"/u)?.[1];
    const link = href === undefined ? undefined : prefixedHref.get(href);
    if (link === undefined) return tag;
    return tag.replace(` href="${href}"`, ` href="${link}"`);
  });
}

/** Translations keep approved-article coordinates; resolve them against the same delivered pages. */
function translatedMarkdown(content: string, from: string, pages: ReadonlyMap<string, SitePage>, resources: ReadonlySet<string>): string {
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
    const target = page ? `/${page.site_path}` : asset;
    if (!target) continue;
    body = body.slice(0, link.start) + `${link.image ? "!" : ""}[${link.label}](<${target}${fragment === undefined ? "" : `#${fragment}`}>)` + body.slice(link.end);
  }
  return body;
}

/** Marker lines the website Markdown renderer turns into language blocks. The
 * per-build nonce keeps knowledge text from opening or closing a block. */
export function createLocaleMarker() {
  return `context-locale-${randomBytes(8).toString("hex")}`;
}

function notice(tag: string, state: "missing" | "stale", marker: string): string {
  const zh = chineseTag(tag);
  if (state === "missing") return `::: info ${zh ? "尚未翻译" : "Not yet translated"}\n${zh ? "本页暂无译文，以下为原文。" : "This page has no translation yet; the original is shown below."}\n:::\n\n`;
  return `::: warning ${zh ? "译文可能已过时" : "Translation may be outdated"}\n${zh ? "原文已更新，译文尚未同步。" : "The original has changed since this translation."}\n\n` +
    `<!-- ${marker}:original ${zh ? "查看原文" : "View original"} -->\n:::\n\n`;
}

export async function createSiteLocalizer(input: {
  projectRoot: string; readers: SiteReaderLocales; marker: string; selected: readonly ApprovedKnowledgeFile[];
  byPath: ReadonlyMap<string, SitePage>; resources: ReadonlySet<string>;
}) {
  const { readers, marker } = input;
  const extra = readers.translated ? readers.tags.slice(1) : [];
  const contentTags = extra.length ? readers.tags : [readers.primary];
  const byApproved = new Map([...input.byPath.values()].flatMap(page => page.approved_path ? [[page.approved_path.slice("knowledge/".length), page] as const] : []));
  const files = new Map(input.selected.map(file => [file.relPath, file]));
  const summaries: LocalizedSiteSummary[] = extra.map(tag => ({ tag, translated: 0, stale: 0, missing: 0 }));
  const pageTitles = new Map(extra.map(tag => [tag, new Map<string, string>()]));
  const mapTitles = new Map(await Promise.all(extra.map(async tag => [tag, await readTranslatedMapTitles(input.projectRoot, tag)] as const)));
  const block = (tags: readonly string[], body: string) => `\n<!-- ${marker} ${tags.join(" ")} -->\n\n${body.trim()}\n\n<!-- /${marker} -->\n`;
  /** One block per distinct rendering; a single rendering needs no block. */
  const variants = (render: (tag: string) => string) => {
    const groups = new Map<string, string[]>();
    for (const tag of contentTags) {
      const body = render(tag);
      groups.set(body, [...groups.get(body) ?? [], tag]);
    }
    return groups.size === 1 ? [...groups.keys()][0]! : [...groups].map(([body, tags]) => block(tags, body)).join("");
  };
  const entryTitle = (tag: string, entry: ProjectedKnowledgeMapEntry) => {
    if (tag === readers.primary) return entry.title;
    if (entry.key === "unplaced-articles") return chineseTag(tag) ? "全部文章" : "All articles";
    return mapTitles.get(tag)?.get(entry.key) ?? (entry.href ? pageTitles.get(tag)?.get(entry.href.split("#")[0]!) : undefined) ?? entry.title;
  };
  return {
    summaries, variants, entryTitle,
    /** Sidebar and navigation label; call after every page is localized. */
    label: (entry: ProjectedKnowledgeMapEntry) => localizedHtml(contentTags, tag => entryTitle(tag, entry)),
    titles: (entry: ProjectedKnowledgeMapEntry) => Object.fromEntries(contentTags.map(tag => [tag, entryTitle(tag, entry)])),
    /** The original serves every language without a translation, below its notice. */
    async page(page: SitePage, primary: string) {
      if (!extra.length) return { body: primary };
      const file = page.approved_path ? files.get(page.approved_path.slice("knowledge/".length)) : undefined;
      const original = [readers.primary];
      const notices: string[] = [];
      const translations: string[] = [];
      const titles: Record<string, string> = { [readers.primary]: page.title };
      for (const [index, tag] of extra.entries()) {
        const translation = file ? await readTranslatedArticle(input.projectRoot, tag, file) : undefined;
        if (!translation || !file) {
          original.push(tag);
          if (file) { summaries[index]!.missing += 1; notices.push(block([tag], notice(tag, "missing", marker))); }
          continue;
        }
        titles[tag] = translation.title;
        pageTitles.get(tag)!.set(`/${page.site_path}`, translation.title);
        if (translation.current) summaries[index]!.translated += 1; else summaries[index]!.stale += 1;
        translations.push(block([tag], (translation.current ? "" : notice(tag, "stale", marker)) +
          translatedMarkdown(`---\ntitle: ${JSON.stringify(translation.title)}\n---\n${translation.body}`, file.relPath, byApproved, input.resources)));
      }
      return { body: notices.join("") + block(original, primary) + translations.join(""), titles };
    },
  };
}
