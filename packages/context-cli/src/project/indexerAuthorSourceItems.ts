import type { IndexerAuthorizedWorksetView } from "@c4a/context";

export interface AuthorSourceItem {
  ref: string;
  path: string;
  source_ref: string;
  ranges: { start_line: number; end_line: number }[];
}

/** Reader navigation only. Never expand a file selection into all parser facts
 * or evidence identities; the author chooses actual regions in references. */
export function buildIndexerAuthorSourceItems(input: { view: IndexerAuthorizedWorksetView }) {
  const choices: AuthorSourceItem[] = [];
  for (const item of input.view.items) {
    if (item.category !== "source-text" && item.category !== "document") continue;
    const value = item.value as Record<string, unknown>;
    if (typeof value.path !== "string" || typeof value.source_ref !== "string") continue;
    const spans = Array.isArray(value.spans) ? value.spans : [];
    const ranges = spans.flatMap(span => {
      if (!span || typeof span !== "object") return [];
      const region = span as Record<string, unknown>;
      return typeof region.start_line === "number" && typeof region.end_line === "number"
        ? [{ start_line: region.start_line, end_line: region.end_line }] : [];
    });
    choices.push({ ref: item.ref, path: value.path, source_ref: value.source_ref, ranges });
  }
  return { choices };
}
