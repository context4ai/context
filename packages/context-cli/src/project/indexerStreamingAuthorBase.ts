import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { buildIndexerRepairIntent, validateArticleStructureEntries } from "@c4a/context";
import { readKnowledgeStructure, type KnowledgeStructureInfo } from "./packageBuildInventory.js";

/** Reuse the existing repair input contract to bind approved prose into a later
 * wave. The normal layout matcher remains responsible for page identity. */
export async function streamingAuthorBase(root: string, articleIds: readonly string[], preparedStructure?: KnowledgeStructureInfo) {
  const structure = preparedStructure ?? await readKnowledgeStructure(root);
  const selected = validateArticleStructureEntries(structure.parsed?.articles ?? []).filter(article => articleIds.includes(article.article_id));
  if (!selected.length) return undefined;
  const pages = await Promise.all(selected.map(async view => {
    const path = String(view.path).replace(/^knowledge\//u, "");
    const base = resolve(root, "knowledge");
    const rel = relative(base, resolve(base, path));
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new TypeError("Approved page escapes knowledge root");
    return { path: `knowledge/${path}`, article_id: view.article_id, markdown: await readFile(join(base, path), "utf8") };
  }));
  return buildIndexerRepairIntent({ target_ref: selected[0]!.article_id,
    instruction: "Additional planning material now contributes to these existing articles. Start from the approved pages below, preserve their page and section identities and unaffected explanations, and integrate the new material. Do not replace an existing page with a summary or duplicate it under a new title. Regenerate program blocks through the selected template. Review the actual changes before delivery.",
    current_markdown: pages.map(page => `Approved page: ${page.path}\nArticle: ${page.article_id}\n\n${page.markdown}`).join("\n\n---\n\n"),
  });
}
