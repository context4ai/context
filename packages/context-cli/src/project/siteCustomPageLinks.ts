import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'" };

function decode(value: string): string {
  const text = value.replace(/&(amp|lt|gt|quot|#39|apos);/gu, (_, name: string) => ENTITIES[name] ?? _);
  try { return decodeURIComponent(text); } catch { return text; }
}

/** Page anchors: element ids, decoded the way a browser resolves a fragment. */
export function htmlAnchorIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/gu)].map(match => decode(match[1]!)));
}

/** Links inside the rendered page body; navigation and theme chrome are left to the theme. */
export function htmlContentLinks(html: string): string[] {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>", start);
  const body = start >= 0 && end > start ? html.slice(start, end) : html;
  return [...body.matchAll(/<a\s[^>]*href="([^"]*)"/gu)].map(match => decode(match[1]!));
}

/** Broken internal links and anchors on the website's custom pages.
 * Approved articles are checked when they are written; custom pages are trusted
 * Markdown that no other step reads, so the build checks them here. */
export async function customPageLinkProblems(output: string, base: string, keys: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  const anchors = new Map<string, Set<string>>();
  const idsOf = async (file: string) => {
    let ids = anchors.get(file);
    if (!ids) { ids = htmlAnchorIds(await readFile(join(output, file), "utf8")); anchors.set(file, ids); }
    return ids;
  };
  const prefix = base.endsWith("/") ? base : `${base}/`;
  for (const key of keys) {
    const page = `custom/${key}.html`;
    if (!existsSync(join(output, page))) continue;
    for (const href of htmlContentLinks(await readFile(join(output, page), "utf8"))) {
      if (!href || /^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith("//")) continue;
      const [rawPath = "", fragment] = href.split("#", 2) as [string, string | undefined];
      const path = rawPath.split("?", 1)[0]!;
      let target: string;
      if (path === "") target = page;
      else if (path.startsWith("/")) {
        if (!path.startsWith(prefix) && `${path}/` !== prefix) continue; // another application on the same host
        target = path.slice(prefix.length);
      } else target = posix.normalize(posix.join(posix.dirname(page), path));
      if (target === "" || target.endsWith("/")) target += "index.html";
      else if (!posix.extname(target)) target += ".html";
      if (target.startsWith("..") || !existsSync(join(output, target))) { problems.push(`${page}: link ${href} has no target`); continue; }
      if (fragment && target.endsWith(".html") && !(await idsOf(target)).has(decode(fragment))) {
        problems.push(`${page}: link ${href} points to a missing anchor in ${target}`);
      }
    }
  }
  return problems;
}
