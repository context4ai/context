import type { ExtractionDiagnostic } from "@c4a/extract";
import ts from "typescript";
import { createEcmaScriptSourceFile, nodeLocation, staticStringValue } from "./typescriptAst.js";

export type CommonJsBinding = {
  localName: string;
  source: string;
  importedName: string;
  line: number;
};

export type CommonJsExport = {
  exportedName: string;
  localName?: string;
  source?: string;
  importedName?: string;
  line: number;
};

export type CommonJsSyntheticDeclaration = {
  name: string;
  kind: "function" | "class" | "variable";
  line: number;
  endLine: number;
  params: string[];
};

export type CommonJsModuleAnalysis = {
  bindings: CommonJsBinding[];
  exports: CommonJsExport[];
  wildcardSources: string[];
  syntheticDeclarations: CommonJsSyntheticDeclaration[];
  diagnostics: ExtractionDiagnostic[];
};

type RequireReference = { source: string; importedName: string };

const requireCall = (node: ts.Expression): ts.CallExpression | null =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require"
    ? node
    : null;

const requireReference = (node: ts.Expression): RequireReference | null => {
  const direct = requireCall(node);
  if (direct) {
    const source = staticStringValue(direct.arguments[0]);
    return source ? { source, importedName: "*" } : null;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const call = requireCall(node.expression);
    const source = call ? staticStringValue(call.arguments[0]) : null;
    return source ? { source, importedName: node.name.text } : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const call = requireCall(node.expression);
    const source = call ? staticStringValue(call.arguments[0]) : null;
    const importedName = staticStringValue(node.argumentExpression);
    return source && importedName ? { source, importedName } : null;
  }
  return null;
};

const isModuleExports = (node: ts.Expression): boolean => {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "module" &&
    node.name.text === "exports"
  ) return true;
  return ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "module" &&
    staticStringValue(node.argumentExpression) === "exports";
};

const isExportsObject = (node: ts.Expression): boolean =>
  (ts.isIdentifier(node) && node.text === "exports") || isModuleExports(node);

const isUnsupportedExportMutationCall = (node: ts.CallExpression): boolean => {
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Object" &&
    ["assign", "defineProperties", "defineProperty"].includes(node.expression.name.text) &&
    node.arguments[0] &&
    isExportsObject(node.arguments[0])
  ) {
    return !(node.expression.name.text === "defineProperty" && staticStringValue(node.arguments[1]) === "__esModule");
  }
  return ts.isIdentifier(node.expression) &&
    ["__createBinding", "__export", "__exportStar"].includes(node.expression.text) &&
    node.arguments.some(isExportsObject);
};

const commonJsExportTarget = (
  node: ts.Expression,
): { kind: "whole" | "named"; exportedName?: string } | null => {
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === "exports") {
      return { kind: "named", exportedName: node.name.text };
    }
    if (isModuleExports(node.expression)) {
      return { kind: "named", exportedName: node.name.text };
    }
    if (isModuleExports(node)) return { kind: "whole" };
  }
  if (ts.isElementAccessExpression(node)) {
    const property = staticStringValue(node.argumentExpression);
    if (ts.isIdentifier(node.expression) && node.expression.text === "exports" && property) {
      return { kind: "named", exportedName: property };
    }
    if (isModuleExports(node.expression) && property) {
      return { kind: "named", exportedName: property };
    }
    if (isModuleExports(node)) return { kind: "whole" };
  }
  return null;
};

const localReference = (
  expression: ts.Expression,
  bindings: ReadonlyMap<string, CommonJsBinding>,
): Omit<CommonJsExport, "exportedName" | "line"> | null => {
  if (ts.isIdentifier(expression)) {
    const binding = bindings.get(expression.text);
    if (binding) {
      return {
        source: binding.source,
        importedName: binding.importedName,
      };
    }
    return { localName: expression.text };
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const binding = bindings.get(expression.expression.text);
    if (binding) return { source: binding.source, importedName: expression.name.text };
  }
  const required = requireReference(expression);
  return required ? { source: required.source, importedName: required.importedName } : null;
};

const syntheticDeclaration = (
  name: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): CommonJsSyntheticDeclaration | null => {
  const location = nodeLocation(sourceFile, expression);
  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
    return {
      name,
      kind: "function",
      line: location.line,
      endLine: location.endLine,
      params: expression.parameters.map((parameter) => parameter.name.getText(sourceFile)),
    };
  }
  if (ts.isClassExpression(expression)) {
    return { name, kind: "class", line: location.line, endLine: location.endLine, params: [] };
  }
  if (
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression) ||
    ts.isLiteralExpression(expression)
  ) {
    return { name, kind: "variable", line: location.line, endLine: location.endLine, params: [] };
  }
  return null;
};

const pushExport = (
  result: CommonJsModuleAnalysis,
  exportedName: string,
  expression: ts.Expression,
  line: number,
  bindings: ReadonlyMap<string, CommonJsBinding>,
  sourceFile: ts.SourceFile,
): boolean => {
  const reference = localReference(expression, bindings);
  if (reference) {
    result.exports.push({ exportedName, ...reference, line });
    return true;
  }
  const synthetic = syntheticDeclaration(exportedName, expression, sourceFile);
  if (synthetic) {
    result.syntheticDeclarations.push(synthetic);
    result.exports.push({ exportedName, localName: exportedName, line });
    return true;
  }
  return false;
};

const appendUnsupportedExportDiagnostic = (
  result: CommonJsModuleAnalysis,
  sourceFile: ts.SourceFile,
  node: ts.Node,
) => {
  const location = nodeLocation(sourceFile, node);
  if (result.diagnostics.some((diagnostic) =>
    diagnostic.code === "dynamic-commonjs-require" &&
    diagnostic.line === location.line &&
    diagnostic.column === location.column
  )) return;
  result.diagnostics.push({
    code: "unsupported-commonjs-export-expression",
    severity: "error",
    file: sourceFile.fileName,
    line: location.line,
    column: location.column,
  });
};

const collectBindings = (sourceFile: ts.SourceFile): CommonJsBinding[] => {
  const bindings: CommonJsBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      const line = nodeLocation(sourceFile, declaration).line;
      if (ts.isIdentifier(declaration.name)) {
        const reference = requireReference(declaration.initializer);
        if (reference) bindings.push({ localName: declaration.name.text, ...reference, line });
        continue;
      }
      const direct = requireCall(declaration.initializer);
      const source = direct ? staticStringValue(direct.arguments[0]) : null;
      if (!source || !ts.isObjectBindingPattern(declaration.name)) continue;
      for (const element of declaration.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const importedName = element.propertyName?.getText(sourceFile) ?? element.name.text;
        bindings.push({ localName: element.name.text, source, importedName, line });
      }
    }
  }
  return bindings;
};

const collectDynamicDiagnostics = (sourceFile: ts.SourceFile): ExtractionDiagnostic[] => {
  const diagnostics: ExtractionDiagnostic[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      if (staticStringValue(node.arguments[0]) === null) {
        const location = nodeLocation(sourceFile, node);
        diagnostics.push({
          code: "dynamic-commonjs-require",
          severity: "error",
          file: sourceFile.fileName,
          line: location.line,
          column: location.column,
        });
      }
    }
    if (ts.isCallExpression(node) && isUnsupportedExportMutationCall(node)) {
      const location = nodeLocation(sourceFile, node);
      diagnostics.push({
        code: "unsupported-commonjs-export-form",
        severity: "error",
        file: sourceFile.fileName,
        line: location.line,
        column: location.column,
      });
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isElementAccessExpression(node.left)) {
        const isCommonJsTarget =
          (ts.isIdentifier(node.left.expression) && node.left.expression.text === "exports") ||
          isModuleExports(node.left.expression) ||
          isModuleExports(node.left);
        if (isCommonJsTarget && commonJsExportTarget(node.left) === null) {
        const location = nodeLocation(sourceFile, node.left);
        diagnostics.push({
          code: "dynamic-commonjs-export",
          severity: "error",
          file: sourceFile.fileName,
          line: location.line,
          column: location.column,
        });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return diagnostics;
};

export const analyzeCommonJsModule = (
  source: string,
  filePath: string,
): CommonJsModuleAnalysis => {
  const sourceFile = createEcmaScriptSourceFile(source, filePath);
  const bindings = collectBindings(sourceFile);
  const bindingMap = new Map(bindings.map((binding) => [binding.localName, binding]));
  const result: CommonJsModuleAnalysis = {
    bindings,
    exports: [],
    wildcardSources: [],
    syntheticDeclarations: [],
    diagnostics: collectDynamicDiagnostics(sourceFile),
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
    const assignment = statement.expression;
    if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const target = commonJsExportTarget(assignment.left);
    if (!target) continue;
    const line = nodeLocation(sourceFile, assignment).line;

    if (target.kind === "named") {
      if (!pushExport(result, target.exportedName!, assignment.right, line, bindingMap, sourceFile)) {
        appendUnsupportedExportDiagnostic(result, sourceFile, assignment.right);
      }
      continue;
    }

    const directRequire = requireReference(assignment.right);
    if (directRequire?.importedName === "*") {
      result.wildcardSources.push(directRequire.source);
      continue;
    }
    if (ts.isObjectLiteralExpression(assignment.right)) {
      for (const property of assignment.right.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          pushExport(result, property.name.text, property.name, line, bindingMap, sourceFile);
          continue;
        }
        if (ts.isPropertyAssignment(property)) {
          const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            ? property.name.text
            : null;
          if (name) {
            if (!pushExport(result, name, property.initializer, line, bindingMap, sourceFile)) {
              appendUnsupportedExportDiagnostic(result, sourceFile, property.initializer);
            }
          } else {
            appendUnsupportedExportDiagnostic(result, sourceFile, property);
          }
          continue;
        }
        if (ts.isMethodDeclaration(property) && property.name && ts.isIdentifier(property.name)) {
          const location = nodeLocation(sourceFile, property);
          result.syntheticDeclarations.push({
            name: property.name.text,
            kind: "function",
            line: location.line,
            endLine: location.endLine,
            params: property.parameters.map((parameter) => parameter.name.getText(sourceFile)),
          });
          result.exports.push({
            exportedName: property.name.text,
            localName: property.name.text,
            line,
          });
          continue;
        }
        appendUnsupportedExportDiagnostic(result, sourceFile, property);
      }
      continue;
    }
    if (ts.isIdentifier(assignment.right)) {
      const binding = bindingMap.get(assignment.right.text);
      if (binding?.importedName === "*") {
        result.wildcardSources.push(binding.source);
        continue;
      }
      if (!pushExport(result, assignment.right.text, assignment.right, line, bindingMap, sourceFile)) {
        appendUnsupportedExportDiagnostic(result, sourceFile, assignment.right);
      }
      continue;
    }
    if (!pushExport(result, "default", assignment.right, line, bindingMap, sourceFile)) {
      appendUnsupportedExportDiagnostic(result, sourceFile, assignment.right);
    }
  }

  result.bindings.sort((left, right) => left.localName.localeCompare(right.localName));
  result.exports.sort((left, right) =>
    left.exportedName.localeCompare(right.exportedName) || left.line - right.line
  );
  result.wildcardSources = [...new Set(result.wildcardSources)].sort();
  result.syntheticDeclarations.sort((left, right) => left.name.localeCompare(right.name));
  result.diagnostics.sort((left, right) => left.line - right.line || left.column - right.column);
  return result;
};
