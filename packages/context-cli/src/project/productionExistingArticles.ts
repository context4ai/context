import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { productionApprovedTargetsIndex } from "./productionArticleTarget.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";

/** Read only the bounded frontmatter, not every article body during planning.
 * A malformed header is reported as a navigation gap, never invented prose. */
async function readerHeader(root: string, path: string): Promise<{ title: string; description: string }> {
  const absolute = await safeProjectTarget(root, join("knowledge", path));
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new TypeError("Article is not a regular file");
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, Math.min(4096, buffer.length - bytes), bytes);
      bytes += read.bytesRead;
      const text = buffer.toString("utf8", 0, bytes);
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
      if (match) {
        const header: unknown = YAML.parse(match[1]!);
        if (!header || typeof header !== "object" || !("title" in header) || !("description" in header) ||
          typeof header.title !== "string" || typeof header.description !== "string") throw new TypeError("Article title or description is missing");
        return { title: header.title, description: header.description };
      }
      if (!read.bytesRead || !text.startsWith("---")) break;
    }
    throw new TypeError("Article frontmatter is missing, incomplete or exceeds the navigation read budget");
  } finally { await handle.close(); }
}

function inline(value: string): string { return value.replace(/\s+/gu, " ").trim(); }

/** Derived navigation only. Stable identity and references remain in the
 * formal article structure; no additional persistent topic index is created. */
export async function productionExistingArticleNavigation(projectRoot: string): Promise<Map<string, string>> {
  const index = productionApprovedTargetsIndex(await readApprovedKnowledgeMetadataIndex(projectRoot));
  const articles = [...index.byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const files = new Map<string, string>();
  const pageSize = 64;
  const pages: string[] = [];
  for (let offset = 0; offset < articles.length; offset += pageSize) {
    const filename = `existing-articles-${offset / pageSize + 1}.md`;
    const content = ["# Existing article topics", "", "These are existing reader topics, not a required physical code layout. Reuse or propose a better grouping when the supplied material supports it.", ""];
    for (const article of articles.slice(offset, offset + pageSize)) {
      let header: string;
      try {
        const reader = await readerHeader(projectRoot, article.path);
        header = `### ${inline(reader.title)}\n\n${inline(reader.description)}`;
      } catch (error) {
        header = `### ${article.path}\n\nNavigation gap: ${error instanceof Error ? error.message : String(error)}`;
      }
      const references = new Set(article.sections.flatMap(section => section.references.map(reference =>
        `${reference.source_ref}: ${reference.locator.path}`)));
      content.push(header, "", `Article: ${article.article_id}`, `Path: knowledge/${article.path}`, `Visibility: ${article.visibility}`,
        `Referenced source files: ${references.size}`, ...[...references].slice(0, 32).map(reference => `- ${reference}`),
        ...(references.size > 32 ? ["Additional reference locations are available in knowledge/structure.yaml for this article."] : []), "");
    }
    files.set(filename, `${content.join("\n")}\n`);
    pages.push(`- [Articles ${offset + 1}–${Math.min(offset + pageSize, articles.length)}](${filename})`);
  }
  files.set("existing-articles.md", ["# Existing article navigation", "", `Articles: ${articles.length}`, "",
    ...pages, ...(articles.length ? [] : ["No formal articles exist yet. Plan new topics from the authorized material."]), "",
    "Only titles, descriptions and reference navigation were prepared. Read an article's relevant body before proposing a substantive revision. The structure is a starting point, not a restriction on business terminology.", ""].join("\n"));
  return files;
}
