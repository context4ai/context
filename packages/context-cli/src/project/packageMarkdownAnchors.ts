import { posix } from "node:path";
import { readFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { markdownReaderLinks } from "./markdownLinks.js";
import { walkPackageFiles } from "./packageBuildReceipt.js";

interface Node {
  type?: string;
  value?: string;
  alt?: string;
  children?: Node[];
}

export interface PackageMarkdownLinkWarning {
  code: "package-link-page-missing" | "package-link-anchor-unresolved";
  path: string;
  target: string;
}

/** A portable Markdown heading convention, plus explicit HTML anchors. Other
 * renderers may use different slugs, so unresolved anchors are advisory only. */
export function packageMarkdownAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const used = new Set<string>();
  const text = (node: Node): string => node.type === "html" ? "" :
    node.value ?? node.alt ?? (node.children ?? []).map(text).join("");
  const visit = (node: Node): void => {
    if (node.type === "heading") {
      const base = text(node).toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/gu, "-");
      let slug = base;
      for (let occurrence = 1; used.has(slug); occurrence++) slug = `${base}-${occurrence}`;
      used.add(slug);
      anchors.add(slug);
    }
    if (node.type === "html") {
      for (const match of (node.value ?? "").matchAll(/<[a-z][^>]*\s(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/giu)) {
        anchors.add(match[1] ?? match[2] ?? match[3]!);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(unified().use(remarkParse).parse(markdown) as Node);
  return anchors;
}

/** Inspect final package coordinates, never fetch external links or broaden
 * the package selection. Covers inline and reference-style navigation. */
export function inspectPackageMarkdownLinks(pages: ReadonlyMap<string, string>): PackageMarkdownLinkWarning[] {
  const anchors = new Map([...pages].map(([path, markdown]) => [path, packageMarkdownAnchors(markdown)]));
  const warnings: PackageMarkdownLinkWarning[] = [];
  for (const [path, markdown] of pages) {
    for (const link of markdownReaderLinks(markdown)) {
      if (link.image || /^(?:[a-z][a-z\d+.-]*:|\/)/iu.test(link.target)) continue;
      const hash = link.target.indexOf("#");
      const beforeHash = hash < 0 ? link.target : link.target.slice(0, hash);
      const rawPath = beforeHash.split("?")[0]!;
      let destination: string, fragment: string;
      try {
        destination = rawPath ? posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(rawPath))) : path;
        fragment = hash < 0 ? "" : decodeURIComponent(link.target.slice(hash + 1));
      } catch { continue; }
      if (!/\.md$/iu.test(destination)) continue;
      const target = anchors.get(destination);
      if (!target) warnings.push({ code: "package-link-page-missing", path, target: link.target });
      else if (fragment && !target.has(fragment)) warnings.push({ code: "package-link-anchor-unresolved", path, target: link.target });
    }
  }
  return warnings;
}

export async function inspectPackageMarkdownDirectory(root: string): Promise<PackageMarkdownLinkWarning[]> {
  const files = (await walkPackageFiles(root)).filter(file => /\.md$/iu.test(file.relPath));
  const pages = new Map<string, string>();
  // Bound simultaneous file reads for large knowledge packages.
  for (let offset = 0; offset < files.length; offset += 16) {
    const batch = await Promise.allSettled(files.slice(offset, offset + 16).map(async file =>
      [file.relPath, await readFile(file.absPath, "utf8")] as const));
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      pages.set(...result.value);
    }
  }
  return inspectPackageMarkdownLinks(pages);
}
