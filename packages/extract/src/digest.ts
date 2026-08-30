import type { DigestData, ExtractionResult, SymbolDiff, SymbolInfo } from "./types.js";

const sortUniqueNames = (symbols: SymbolInfo[]) =>
  [...new Set(symbols.map((symbol) => symbol.name))].sort((left, right) => left.localeCompare(right));

/** Deduplicate symbols by (name, file, line) key, keeping first occurrence. */
const deduplicateSymbols = (symbols: SymbolInfo[]): SymbolInfo[] => {
  const seen = new Set<string>();
  return symbols.filter((s) => {
    const key = `${s.name}\0${s.file}\0${s.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const generateDigest = (result: ExtractionResult): DigestData => {
  const allSymbols = deduplicateSymbols(result.symbols);
  const exportedCount = allSymbols.filter((s) => s.visibility === "exported").length;
  const internalCount = allSymbols.length - exportedCount;

  return {
    version: "2",
    meta: result.meta,
    package: result.package,
    files: result.files,
    symbols: allSymbols,
    relations: result.relations,
    ...(result.coverage ? { coverage: result.coverage } : {}),
    stats: {
      files: result.stats.files,
      lines: result.stats.lines,
      exported_count: exportedCount,
      internal_count: internalCount,
      relations: result.stats.relations,
    },
  };
};

export const generateSymbolDiff = (
  current: DigestData,
  previous: DigestData | null,
): SymbolDiff => {
  const exported = (s: SymbolInfo) => s.visibility === "exported";
  const currentNames = sortUniqueNames(current.symbols.filter(exported));
  const previousNames = previous ? sortUniqueNames(previous.symbols.filter(exported)) : [];
  const previousSet = new Set(previousNames);
  const currentSet = new Set(currentNames);

  return {
    added: currentNames.filter((name) => !previousSet.has(name)),
    removed: previousNames.filter((name) => !currentSet.has(name)),
  };
};
