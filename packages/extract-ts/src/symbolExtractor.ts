import { Visibility } from "@c4a/core";
import type { EntryFile, ExtractionResult, FileSystem, RelationInfo } from "@c4a/extract";
import { enrichPublicContracts } from "./publicContracts.js";
import { traceExports } from "./exportTracer.js";
import { analyzeFile } from "./symbolExtractorAnalyze.js";
import { type FileAnalysis, type PackageInfo } from "./symbolExtractorAst.js";
import {
  ecmaScriptLanguage,
  EXTRACT_TS_CAPABILITIES,
  EXTRACT_TS_COVERAGE_TIER,
} from "./ecmaScriptLanguage.js";
import { loadTsConfigPathResolver } from "./tsconfigPaths.js";

const relationIdentity = (relation: RelationInfo): string => JSON.stringify([
  relation.type,
  relation.from,
  relation.to,
  relation.isExternal,
  relation.grounding,
  relation.confidence,
  relation.source,
  relation.file ?? null,
  relation.line ?? null,
]);

const uniqueRelations = (relations: readonly RelationInfo[]): RelationInfo[] => {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const identity = relationIdentity(relation);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

export const extractSymbols = async (
  entries: EntryFile[],
  fs: FileSystem,
  options: {
    packageInfo: PackageInfo;
    pluginId: string;
    analysisPaths?: readonly string[];
  },
): Promise<ExtractionResult> => {
  const resolver = await loadTsConfigPathResolver(fs);
  const exportedSymbols = [];
  const internalSymbols = [];
  const relations: RelationInfo[] = [];
  const filePaths = new Set<string>();
  const exportedDeclarationKeys = new Set<string>();
  const analyses = new Map<string, FileAnalysis>();
  const analysisScope = options.analysisPaths === undefined
    ? null
    : new Set(options.analysisPaths);
  const isInScope = (path: string) => analysisScope === null || analysisScope.has(path);

  for (const entry of entries) {
    const traced = await traceExports(entry.path, fs, resolver);
    traced.files.filter(isInScope).forEach((filePath) => filePaths.add(filePath));

    for (const filePath of traced.files.filter(isInScope)) {
      if (!analyses.has(filePath)) {
        analyses.set(filePath, await analyzeFile(filePath, fs, resolver));
      }
    }

    for (const tracedExport of traced.exports) {
      if (!isInScope(tracedExport.declarationFile)) continue;
      const analysis = analyses.get(tracedExport.declarationFile);
      const declaration = analysis?.declarations.get(tracedExport.localName);
      if (!declaration) continue;
      const declKey = `${tracedExport.declarationFile}::${tracedExport.localName}`;
      const exportKey = `${declKey}::${tracedExport.exportedName}`;
      if (exportedDeclarationKeys.has(exportKey)) {
        const existing = exportedSymbols.find((symbol) => symbol.file === tracedExport.declarationFile &&
          symbol.name === tracedExport.exportedName);
        if (existing !== undefined) existing.publicEntrypoints = [...new Set([...existing.publicEntrypoints, entry.path])].sort();
        continue;
      }
      exportedDeclarationKeys.add(declKey);
      exportedDeclarationKeys.add(exportKey);
      exportedSymbols.push({
        ...declaration.info,
        name: tracedExport.exportedName,
        visibility: Visibility.Exported,
        publicEntrypoints: [entry.path],
      });
    }
  }

  for (const filePath of [...(analysisScope ?? [])].sort()) {
    filePaths.add(filePath);
    if (!analyses.has(filePath)) {
      analyses.set(filePath, await analyzeFile(filePath, fs, resolver));
    }
  }

  for (const [filePath, analysis] of analyses) {
    relations.push(...analysis.relations);
    for (const [name, declaration] of analysis.declarations) {
      if (exportedDeclarationKeys.has(`${filePath}::${name}`)) continue;
      internalSymbols.push({
        ...declaration.info,
        visibility: Visibility.Internal,
      });
    }
  }

  const symbols = [...exportedSymbols, ...internalSymbols];
  await enrichPublicContracts({ symbols, paths: [...analyses.keys()], fs, resolver, relations });
  const deduplicatedRelations = uniqueRelations(relations);

  const files = [...filePaths]
    .sort()
    .map((filePath) => ({
      path: filePath,
      language: ecmaScriptLanguage(filePath),
      lines: analyses.get(filePath)?.lines ?? 0,
    }));
  const coverageFiles = files.map((file) => {
    const analysis = analyses.get(file.path);
    return {
      path: file.path,
      disposition: analysis?.disposition ?? "unsupported" as const,
      diagnosticCodes: analysis?.diagnostics.map((diagnostic) => diagnostic.code) ?? [
        "ecmascript-analysis-missing",
      ],
    };
  });
  const diagnostics = [...analyses.values()]
    .flatMap((analysis) => analysis.diagnostics)
    .sort((left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column
    );

  return {
    version: "2",
    meta: {
      extractedAt: new Date().toISOString(),
      pluginId: options.pluginId,
      commitHash: null,
      language: options.packageInfo.language,
    },
    package: options.packageInfo,
    files,
    symbols,
    relations: deduplicatedRelations,
    coverage: {
      tier: EXTRACT_TS_COVERAGE_TIER,
      capabilities: [...EXTRACT_TS_CAPABILITIES],
      files: coverageFiles,
      diagnostics,
    },
    stats: {
      files: files.length,
      lines: files.reduce((sum, file) => sum + file.lines, 0),
      exportedSymbols: exportedSymbols.length,
      internalSymbols: internalSymbols.length,
      relations: deduplicatedRelations.length,
    },
  };
};
