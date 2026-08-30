import { EdgeType, Visibility } from "@c4a/core";
import type { EntryFile, ExtractionResult, FileSystem, RelationInfo } from "@c4a/extract";
import { traceExports } from "./exportTracer.js";
import { analyzeFile } from "./symbolExtractorAnalyze.js";
import { createRelation, type FileAnalysis, type PackageInfo } from "./symbolExtractorAst.js";
import {
  ecmaScriptLanguage,
  EXTRACT_TS_CAPABILITIES,
  EXTRACT_TS_COVERAGE_TIER,
} from "./ecmaScriptLanguage.js";
import { loadTsConfigPathResolver } from "./tsconfigPaths.js";

export const extractSymbols = async (
  entries: EntryFile[],
  fs: FileSystem,
  options: { packageInfo: PackageInfo; pluginId: string },
): Promise<ExtractionResult> => {
  const resolver = await loadTsConfigPathResolver(fs);
  const exportedSymbols = [];
  const internalSymbols = [];
  const relations: RelationInfo[] = [];
  const filePaths = new Set<string>();
  const exportedDeclarationKeys = new Set<string>();
  const analyses = new Map<string, FileAnalysis>();

  for (const entry of entries) {
    const traced = await traceExports(entry.path, fs, resolver);
    traced.files.forEach((filePath) => filePaths.add(filePath));

    for (const filePath of traced.files) {
      if (!analyses.has(filePath)) {
        analyses.set(filePath, await analyzeFile(filePath, fs, resolver));
      }
    }

    for (const tracedExport of traced.exports) {
      const analysis = analyses.get(tracedExport.declarationFile);
      const declaration = analysis?.declarations.get(tracedExport.localName);
      if (!declaration) continue;
      const declKey = `${tracedExport.declarationFile}::${tracedExport.localName}`;
      const exportKey = `${declKey}::${tracedExport.exportedName}`;
      if (exportedDeclarationKeys.has(exportKey)) continue;
      exportedDeclarationKeys.add(declKey);
      exportedDeclarationKeys.add(exportKey);
      exportedSymbols.push({
        ...declaration.info,
        name: tracedExport.exportedName,
        visibility: Visibility.Exported,
      });
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
  const typeDeclarations = new Map<string, string>();
  for (const analysis of analyses.values()) {
    for (const [name, decl] of analysis.declarations) {
      if (decl.info.kind === "interface" || decl.info.kind === "type") {
        typeDeclarations.set(name, decl.info.file);
      }
    }
  }
  for (const sym of symbols) {
    if (sym.kind !== "component") continue;

    let propsTypeName: string | undefined;
    if (sym.typeAnnotation) {
      const genericBody = /<(.+)>/u.exec(sym.typeAnnotation)?.[1];
      const genericNames = genericBody?.match(/\b[A-Z][A-Za-z0-9_]*\b/gu) ?? [];
      propsTypeName = genericNames.filter((name) => typeDeclarations.has(name)).at(-1);
    }

    if (!propsTypeName) {
      const conventionName = `${sym.name}Props`;
      if (typeDeclarations.has(conventionName)) {
        propsTypeName = conventionName;
      }
    }

    if (propsTypeName) {
      sym.propsType = propsTypeName;
      relations.push(createRelation(EdgeType.OfType, sym.name, propsTypeName, false, sym.line));
    }
  }

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
    relations,
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
      relations: relations.length,
    },
  };
};
