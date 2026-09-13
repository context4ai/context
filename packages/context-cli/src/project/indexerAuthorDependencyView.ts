import { compareIndexerCanonicalText, type IndexerParserFact } from "@c4a/context";
import type { ProjectIndexerParserFactsSourceBinding } from "./indexerMainSourceAdapter.js";

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function relationSourceSymbols(input: {
  file: ProjectIndexerParserFactsSourceBinding["parser_fact_view"]["files"][number];
  relation: IndexerParserFact;
}): IndexerParserFact[] {
  const payload = jsonObject(input.relation.payload);
  if (typeof payload.from !== "string" || payload.from.length === 0) return [];
  const candidates = input.file.facts.filter((fact) => {
    if (fact.kind !== "code-symbol") return false;
    return jsonObject(fact.payload).name === payload.from;
  });
  const line = positiveInteger(payload.line);
  if (line === null) return candidates;
  const containing = candidates.filter((fact) => {
    const symbol = jsonObject(fact.payload);
    const start = positiveInteger(symbol.line);
    const end = positiveInteger(symbol.endLine) ?? positiveInteger(symbol.end_line);
    return start !== null && end !== null && start <= line && end >= line;
  });
  return containing.length > 0 ? containing : candidates;
}

export function selectProjectIndexerAuthorRelationFacts(input: {
  files: ProjectIndexerParserFactsSourceBinding["parser_fact_view"]["files"];
  owned_member_ids: ReadonlySet<string>;
}): IndexerParserFact[] {
  const selected = new Map<string, IndexerParserFact>();
  for (const file of input.files) {
    for (const fact of file.facts) {
      if (fact.kind !== "code-relation") continue;
      const payload = jsonObject(fact.payload);
      const from = typeof payload.from === "string" ? payload.from : null;
      if (from === file.normalized_path) {
        if (input.owned_member_ids.has(file.file_ref)) selected.set(fact.fact_ref, fact);
        continue;
      }
      const sourceSymbols = relationSourceSymbols({ file, relation: fact });
      if (
        sourceSymbols.length > 0 &&
        sourceSymbols.every((symbol) => input.owned_member_ids.has(symbol.fact_ref))
      ) {
        selected.set(fact.fact_ref, fact);
      }
    }
  }
  return [...selected.values()].sort((left, right) =>
    compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
  );
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
