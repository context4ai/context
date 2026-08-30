import { EdgeType } from "@c4a/core";
import type { RelationInfo } from "@c4a/extract";
import ts from "typescript";
import { createRelation, type ImportBinding } from "./symbolExtractorAst.js";
import { createEcmaScriptSourceFile, nodeLocation, staticStringValue } from "./typescriptAst.js";

const callTarget = (expression: ts.LeftHandSideExpression, sourceFile: ts.SourceFile): string | null => {
  if (ts.isIdentifier(expression)) return expression.text === "require" ? null : expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.getText(sourceFile).replace(/\s+/gu, "");
  if (ts.isElementAccessExpression(expression)) {
    const property = staticStringValue(expression.argumentExpression);
    return property
      ? `${expression.expression.getText(sourceFile).replace(/\s+/gu, "")}.${property}`
      : null;
  }
  return null;
};

const rootIdentifier = (expression: ts.LeftHandSideExpression): string | null => {
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
};

const declarationName = (node: ts.Node, sourceFile: ts.SourceFile): string | null => {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isClassDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const parent = node.parent;
    if (parent && ts.isClassDeclaration(parent) && parent.name) return parent.name.text;
    return node.name?.getText(sourceFile) ?? null;
  }
  return null;
};

export const collectStaticCallRelations = (
  source: string,
  filePath: string,
  importBindings: ReadonlyMap<string, ImportBinding>,
): RelationInfo[] => {
  const sourceFile = createEcmaScriptSourceFile(source, filePath);
  const relations: RelationInfo[] = [];

  const visit = (node: ts.Node, owner: string) => {
    const namedOwner = declarationName(node, sourceFile) ?? owner;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = callTarget(node.expression, sourceFile);
      if (target) {
        const root = rootIdentifier(node.expression);
        const isExternal = root ? (importBindings.get(root)?.isExternal ?? false) : false;
        relations.push(createRelation(
          EdgeType.Calls,
          namedOwner,
          target,
          isExternal,
          nodeLocation(sourceFile, node).line,
        ));
      }
    }
    ts.forEachChild(node, (child) => visit(child, namedOwner));
  };
  visit(sourceFile, filePath);

  const seen = new Set<string>();
  return relations
    .sort((left, right) =>
      (left.line ?? 0) - (right.line ?? 0) ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to)
    )
    .filter((relation) => {
      const key = `${relation.from}\0${relation.to}\0${relation.line ?? 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};
