import * as ts from "typescript";
import { analyzeCommonJsModule } from "./commonJsModule.js";
import { EXTRACT_TS_CAPABILITIES, EXTRACT_TS_COVERAGE_TIER } from "./ecmaScriptLanguage.js";
import { createEcmaScriptSourceFile, syntaxDiagnostics } from "./typescriptAst.js";

export interface TypeScriptModuleExports {
  named: string[];
  wildcard: string[];
  targets: string[];
}

export interface EcmaScriptModuleExports extends TypeScriptModuleExports {
  coverageTier: typeof EXTRACT_TS_COVERAGE_TIER;
  capabilities: string[];
  disposition: "analyzed" | "unsupported";
  diagnostics: Array<{ code: string; line: number; column: number }>;
}

function exportedDeclarationName(statement: ts.Statement): string | undefined {
  const exported = ts.canHaveModifiers(statement)
    && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) return undefined;
  if (
    (ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement))
    && statement.name
  ) {
    return statement.name.text;
  }
  return undefined;
}

export function extractTypeScriptModuleExports(source: string, filePath = "module.ts"): TypeScriptModuleExports {
  const sourceFile = createEcmaScriptSourceFile(source, filePath);
  const named = new Set<string>();
  const wildcard = new Set<string>();
  const targets = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
      if (target) targets.add(target);
      if (!statement.exportClause) {
        if (target) wildcard.add(target);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) named.add(element.name.text);
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        named.add(statement.exportClause.name.text);
      }
      continue;
    }

    const declarationName = exportedDeclarationName(statement);
    if (declarationName) named.add(declarationName);
    if (ts.isVariableStatement(statement)
      && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) named.add(declaration.name.text);
      }
    }
  }

  return {
    named: [...named].sort(),
    wildcard: [...wildcard].sort(),
    targets: [...targets].sort(),
  };
}

export function extractEcmaScriptModuleExports(
  source: string,
  filePath = "module.ts",
): EcmaScriptModuleExports {
  const esm = extractTypeScriptModuleExports(source, filePath);
  const sourceFile = createEcmaScriptSourceFile(source, filePath);
  const commonJs = analyzeCommonJsModule(source, filePath);
  const diagnostics = [
    ...syntaxDiagnostics(sourceFile),
    ...commonJs.diagnostics,
  ].map(({ code, line, column }) => ({ code, line, column }));
  if (diagnostics.length > 0) {
    return {
      named: [],
      wildcard: [],
      targets: [],
      coverageTier: EXTRACT_TS_COVERAGE_TIER,
      capabilities: [...EXTRACT_TS_CAPABILITIES],
      disposition: "unsupported",
      diagnostics,
    };
  }
  return {
    named: [...new Set([
      ...esm.named,
      ...commonJs.exports.map((item) => item.exportedName),
    ])].sort(),
    wildcard: [...new Set([...esm.wildcard, ...commonJs.wildcardSources])].sort(),
    targets: [...new Set([
      ...esm.targets,
      ...commonJs.bindings.map((binding) => binding.source),
      ...commonJs.exports.flatMap((item) => item.source ? [item.source] : []),
      ...commonJs.wildcardSources,
    ])].sort(),
    coverageTier: EXTRACT_TS_COVERAGE_TIER,
    capabilities: [...EXTRACT_TS_CAPABILITIES],
    disposition: "analyzed",
    diagnostics,
  };
}
