import type { CommonJsModuleAnalysis } from "./commonJsModule.js";

export type CommonJsTracedExport = {
  exportedName: string;
  localName: string;
  declarationFile: string;
};

export const traceCommonJsExports = async (input: {
  analysis: CommonJsModuleAnalysis;
  filePath: string;
  localDeclarations: ReadonlyMap<string, string>;
  traceImported: (source: string, importedName: string, exportedName: string) => Promise<CommonJsTracedExport[]>;
  traceWildcard: (source: string) => Promise<CommonJsTracedExport[]>;
}): Promise<CommonJsTracedExport[]> => {
  const traced: CommonJsTracedExport[] = [];
  for (const item of input.analysis.exports) {
    if (item.localName && input.localDeclarations.has(item.localName)) {
      traced.push({
        exportedName: item.exportedName,
        localName: item.localName,
        declarationFile: input.filePath,
      });
      continue;
    }
    if (item.source && item.importedName) {
      traced.push(...(await input.traceImported(item.source, item.importedName, item.exportedName)));
    }
  }
  for (const source of input.analysis.wildcardSources) {
    traced.push(...(await input.traceWildcard(source)));
  }
  return traced;
};
