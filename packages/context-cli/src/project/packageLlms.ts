import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { projectKnowledgeMap, knowledgeMapTargetKey, type PackageDefinition, type KnowledgeMap, type ProjectedKnowledgeMapEntry } from "@c4a/context";
import { packageKnowledgeOutputPath } from "./packageDistribution.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import { knowledgeMapSectionAnchor } from "./packageKnowledgeMap.js";

export const PACKAGE_LLMS_VERSION = "knowledge-map-llms-v1";
export interface LlmsArticle { identity: string; path: string; title: string; content: string; sections: string[] }
const label = (text: string) => text.replace(/[\\[\]<>`*]/gu, "\\$&").replace(/[\r\n]/gu, " ");
const articlePath = (identity: string) => `llms/pages/${createHash("sha256").update(identity).digest("hex").slice(0, 32)}.txt`;

export function llmsArticles(pkg: PackageDefinition, selected: readonly ApprovedKnowledgeFile[]): LlmsArticle[] {
  return selected.map(file => {
    const meta = parseKnowledgeFrontmatter(file.content);
    return { identity: typeof meta.artifact_ref === "string" ? meta.artifact_ref : `path:${file.relPath}`,
      path: packageKnowledgeOutputPath(pkg, file.relPath), content: file.content,
      title: typeof meta.title === "string" ? meta.title : posix.basename(file.relPath, ".md"),
      sections: [...file.content.matchAll(/<!--\s*context:section\b[^>]*\bid="([a-zA-Z0-9_-]+)"[^>]*-->/gu)].map(match => match[1]!) };
  });
}

/** Every placement appears in the index; each approved body appears once, in map order. */
export function buildLlmsDocuments(input: {
  title: string; articles: readonly LlmsArticle[]; map?: KnowledgeMap;
  base?: string; assetsPrefix?: string;
}) {
  const base = input.base ?? "";
  const targets = new Map<string, string>();
  const byIdentity = new Map(input.articles.map(article => [article.identity, article]));
  const byPath = new Map(input.articles.map(article => [article.path, article]));
  for (const article of input.articles) {
    const href = `${base}${articlePath(article.identity)}`;
    targets.set(article.identity, href);
    for (const section of article.sections) targets.set(knowledgeMapTargetKey({ artifact_ref: article.identity, section_key: section }), `${href}#${knowledgeMapSectionAnchor(section)}`);
  }
  const entries = input.map ? projectKnowledgeMap(input.map, targets).entries : [];
  const ordered: LlmsArticle[] = [];
  const seen = new Set<string>();
  const lines = ["## Knowledge map", ""];
  const identityByHref = new Map(input.articles.map(article => [targets.get(article.identity)!, article.identity]));
  function visit(items: ProjectedKnowledgeMapEntry[], depth: number) {
    for (const entry of items) {
      lines.push(`${"  ".repeat(depth)}- ${entry.href ? `[${label(entry.title)}](<${entry.href}>)` : label(entry.title)}`);
      const identity = entry.href && identityByHref.get(entry.href.split("#")[0]!);
      if (identity && !seen.has(identity)) { seen.add(identity); ordered.push(byIdentity.get(identity)!); }
      visit(entry.children, depth + 1);
    }
  }
  visit(entries, 0);
  // Legacy pages without registered identities still belong to the selected output.
  for (const article of input.articles) if (!seen.has(article.identity)) {
    seen.add(article.identity); ordered.push(article);
    lines.push(`- [${label(article.title)}](<${targets.get(article.identity)!}>)`);
  }
  function rewrite(article: LlmsArticle, outputPath: string) {
    let content = article.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "");
    for (const link of markdownReaderLinks(content).reverse()) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(link.target)) continue;
      const [raw, fragment] = link.target.split(/#(.*)/su);
      let path: string;
      try { path = posix.normalize(posix.join(posix.dirname(article.path), decodeURIComponent(raw!))); } catch { continue; }
      if (path.startsWith("../")) continue;
      const peer = byPath.get(path);
      const destination = peer ? articlePath(peer.identity) : `${input.assetsPrefix ?? ""}${path}`;
      const target = base ? `${base}${destination}` : posix.relative(posix.dirname(outputPath), destination);
      content = content.slice(0, link.start) + `${link.image ? "!" : ""}[${link.label}](<${target}${fragment === undefined ? "" : `#${fragment}`}>)` + content.slice(link.end);
    }
    return content.trim();
  }
  const files = new Map<string, string>();
  const navigationMarkdown = lines.join("\n") + "\n";
  files.set("llms.txt", [`# ${label(input.title)}`, "", "> Approved knowledge organized by knowledge-map.", "",
    `- [Full text](${base}llms-full.txt)`, `- [Changelog](${base ? `${base}changelog.html` : "CHANGELOG.md"})`, "",
    navigationMarkdown].join("\n"));
  files.set("llms-full.txt", [`# ${label(input.title)}`, ...ordered.map(article => `## ${label(article.title)}\n\n${rewrite(article, "llms-full.txt")}`)].join("\n\n---\n\n") + "\n");
  for (const article of ordered) files.set(articlePath(article.identity), rewrite(article, articlePath(article.identity)) + "\n");
  return { files, entries, articleCount: ordered.length, navigationMarkdown };
}

export async function writeLlmsDocuments(root: string, documents: ReturnType<typeof buildLlmsDocuments>, options: { preserveIndex?: boolean; utf8Bom?: boolean } = {}) {
  for (const [path, content] of documents.files) {
    let exists = false;
    try { await access(join(root, path)); exists = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (exists && path === "llms.txt" && options.preserveIndex) continue;
    if (exists) throw new Error(`Package template uses reserved LLMS output ${path}; rename that template output.`);
    await mkdir(dirname(join(root, path)), { recursive: true });
    // Static hosts may serve text/plain without a charset. A BOM identifies
    // website text as UTF-8 even when the browser's default encoding differs.
    await writeFile(join(root, path), options.utf8Bom ? "\uFEFF" + content.replace(/^\uFEFF/u, "") : content, "utf8");
  }
}
