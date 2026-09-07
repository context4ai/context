import ts from "typescript";
import { SymbolKind, Visibility } from "@c4a/core";
import type { SymbolInfo } from "@c4a/extract";

/** Preserve literal deployment declarations from actual federation factories.
 * Dynamic configuration remains source material for semantic explanation. */
export function federationContracts(source: ts.SourceFile): SymbolInfo[] {
  const factories = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (module === "webpack" && clause?.name !== undefined) factories.add(`${clause.name.text}.container.ModuleFederationPlugin`);
    if (!["webpack", "@module-federation/enhanced/webpack", "@module-federation/enhanced/rspack", "@module-federation/vite"].includes(module)) continue;
    if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const item of clause.namedBindings.elements) {
        if (["ModuleFederationPlugin", "federation"].includes((item.propertyName ?? item.name).text)) factories.add(item.name.text);
        if (module === "webpack" && (item.propertyName ?? item.name).text === "container") factories.add(`${item.name.text}.ModuleFederationPlugin`);
      }
    }
  }
  const results: SymbolInfo[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && factories.has(node.expression.getText(source))) {
      const config = node.arguments?.[0];
      if (config !== undefined && ts.isObjectLiteralExpression(config)) {
        const members: SymbolInfo[] = [];
        for (const property of config.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = property.name.getText(source).replace(/^['"]|['"]$/gu, "");
          if (!["name", "filename", "exposes", "remotes", "shared"].includes(key)) continue;
          const properties = ts.isObjectLiteralExpression(property.initializer)
            ? property.initializer.properties.filter(ts.isPropertyAssignment) : [property];
          for (const value of properties) members.push({
            name: value === property ? key : `${key}.${value.name.getText(source).replace(/^['"]|['"]$/gu, "")}`,
            kind: SymbolKind.Config, visibility: Visibility.Exported,
            file: source.fileName.replace(/^\//u, ""),
            line: source.getLineAndCharacterOfPosition(value.getStart()).line + 1,
            endLine: source.getLineAndCharacterOfPosition(value.end).line + 1,
            typeAnnotation: value.initializer.getText(source),
          });
        }
        results.push({ name: "Module federation configuration", kind: SymbolKind.Config,
          visibility: Visibility.Exported, file: source.fileName.replace(/^\//u, ""),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
          signature: node.expression.getText(source), members });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return results;
}
