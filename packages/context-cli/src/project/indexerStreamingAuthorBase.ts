import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { buildIndexerRepairIntent } from "@c4a/context";
import { readKnowledgeStructure, type KnowledgeStructureInfo } from "./packageBuildInventory.js";

/** Reuse the existing repair input contract to bind approved prose into a later
 * wave. The normal layout matcher remains responsible for page identity. */
export async function streamingAuthorBase(root: string, nodeRef: string, preparedStructure?: KnowledgeStructureInfo) {
  const structure = preparedStructure ?? await readKnowledgeStructure(root);
  const views = (Array.isArray(structure.parsed?.views) ? structure.parsed.views : []) as Array<Record<string, unknown>>;
  const selected = views.filter(view => view.node_ref === nodeRef && typeof view.path === "string");
  if (!selected.length) return undefined;
  const pages = await Promise.all(selected.map(async view => {
    const path = String(view.path).replace(/^knowledge\//u, "");
    const base = resolve(root, "knowledge");
    const rel = relative(base, resolve(base, path));
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new TypeError("Approved page escapes knowledge root");
    return { path: `knowledge/${path}`, view_ref: view.view_ref, markdown: await readFile(join(base, path), "utf8") };
  }));
  return buildIndexerRepairIntent({ target_ref: nodeRef,
    instruction: "Additional planning material now contributes to this existing subject. Start from the approved pages below, preserve their page and section identities and unaffected explanations, and integrate the new material. Do not replace an existing page with a summary or duplicate it under a new title. Regenerate program blocks through the selected template. Review the actual changes before delivery.",
    current_markdown: pages.map(page => `Approved page: ${page.path}\nView: ${String(page.view_ref)}\n\n${page.markdown}`).join("\n\n---\n\n"),
  });
}
