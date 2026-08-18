import * as ts from "typescript";

export interface TypeScriptModuleExports {
  named: string[];
  wildcard: string[];
  targets: string[];
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
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
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
