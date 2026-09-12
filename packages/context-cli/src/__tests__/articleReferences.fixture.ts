import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArticleSourceReference, IndexerAuthorizedWorksetView } from "@c4a/context";

/** Small test sources are cited directly, using the same captured file exposed
 * to Author. This helper never fabricates parser facts or evidence aliases. */
export async function fixtureArticleReferences(projectRoot: string, view: IndexerAuthorizedWorksetView,
  preferredPath?: string): Promise<Array<Omit<ArticleSourceReference, "content_digest">>> {
  const documents = view.items.filter(item => item.category === "document");
  const access = view.items.filter(item => item.category === "source-access");
  const candidates = [
    ...documents.map(item => {
      const value = item.value as Record<string, unknown>;
      return { source_ref: String(value.source_ref), path: String(value.path),
        file: resolve(projectRoot, String(value.content_path)) };
    }),
    ...access.flatMap(item => {
      const value = item.value as Record<string, unknown>;
      return (value.paths as string[]).map(path => ({ source_ref: String(value.source_ref), path,
        file: resolve(String(value.captured_root), path) }));
    }),
  ];
  const selected = preferredPath ? candidates.find(item => item.path === preferredPath) : candidates[0];
  if (!selected) throw new Error(`Fixture source is not exposed to Author: ${preferredPath ?? "first source"}`);
  const text = await readFile(selected.file, "utf8");
  return [{ source_ref: selected.source_ref, locator: { path: selected.path, start_line: 1,
    end_line: Math.max(1, text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length) } }];
}
