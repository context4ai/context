import { EdgeSource, EdgeType, Grounding, SymbolKind, Visibility } from "@c4a/core";
import type { ExtractionResult, RelationInfo, SymbolInfo } from "@c4a/extract";
import type Parser from "web-tree-sitter";

export type SyntaxNode = Parser.SyntaxNode;
export type PackageInfo = ExtractionResult["package"];
export type ImportBinding = { isExternal: boolean; typeOnly: boolean };
export type DeclarationRecord = { info: SymbolInfo };
export type FileAnalysis = {
  declarations: Map<string, DeclarationRecord>;
  importBindings: Map<string, ImportBinding>;
  relations: RelationInfo[];
  lines: number;
};

export const DECLARATION_TYPES = new Set([
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "lexical_declaration",
]);

const BUILTIN_TYPES = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Map",
  "Number",
  "Object",
  "Promise",
  "ReadonlyArray",
  "Record",
  "Set",
  "String",
  "unknown",
  "void",
  "string",
  "number",
  "boolean",
  "null",
  "undefined",
  "never",
  "any",
]);

export const countLines = (source: string) => {
  if (!source) return 0;
  return source.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).length;
};

export const createRelation = (
  type: RelationInfo["type"],
  from: string,
  to: string,
  isExternal: boolean,
  line?: number,
): RelationInfo => ({
  type,
  from,
  to,
  isExternal,
  grounding: Grounding.Code,
  confidence: 1,
  source: EdgeSource.Ast,
  ...(line ? { line } : {}),
});

export const getLine = (node: SyntaxNode) => node.startPosition.row + 1;
export const getEndLine = (node: SyntaxNode) => node.endPosition.row + 1;

/** Extract JSDoc comment (/** ... *​/) from the node directly above.
 *  Returns cleaned text without delimiters, or undefined if none found. */
export const extractJSDoc = (node: SyntaxNode): string | undefined => {
  const prev = node.previousNamedSibling ?? node.parent?.previousNamedSibling;
  if (!prev || prev.type !== "comment") return undefined;
  const text = prev.text;
  if (!text.startsWith("/**")) return undefined;
  const cleaned = text
    .replace(/^\/\*\*\s*/, "")
    .replace(/\s*\*\/$/, "")
    .replace(/^\s*\* ?/gm, "")
    .trim();
  return cleaned || undefined;
};

export const extractTypeAnnotation = (node: SyntaxNode | null) => {
  if (!node) return null;
  return node.text.replace(/^:\s*/, "").trim() || null;
};

export const getNameNodeText = (node: SyntaxNode | null | undefined) =>
  node?.text?.trim() ? node.text.trim() : null;

export const getReturnType = (node: SyntaxNode) => {
  const returnNode =
    node.childForFieldName("return_type") ??
    node.namedChildren.find((child) => child.type === "type_annotation") ??
    null;
  return extractTypeAnnotation(returnNode);
};

export const getInitializer = (node: SyntaxNode) =>
  node.childForFieldName("value") ??
  node.namedChildren.find((child) =>
    child.type === "arrow_function" ||
    child.type === "function" ||
    child.type === "call_expression",
  ) ??
  null;

export const getCallableFromInitializer = (node: SyntaxNode | null): SyntaxNode | null => {
  if (!node) return null;
  if (node.type === "arrow_function" || node.type === "function") return node;
  if (node.type === "call_expression") {
    return node.namedChildren.find((child) => child.type === "arrow_function" || child.type === "function") ?? null;
  }
  return null;
};

export const getInitializerTypeAnnotation = (node: SyntaxNode | null) => {
  if (!node || node.type !== "call_expression") return null;
  const typeArguments = node.namedChildren.find((child) => child.type === "type_arguments") ?? null;
  if (!typeArguments) return null;
  const callee = node.namedChildren.find((child) => child.type !== "type_arguments" && child.type !== "arguments") ?? null;
  const calleeText = callee?.text?.trim();
  return calleeText ? `${calleeText}${typeArguments.text}` : typeArguments.text;
};

export const getInitializerText = (node: SyntaxNode | null, options: { includeCallable?: boolean } = {}) => {
  if (!node) return null;
  if ((node.type === "arrow_function" || node.type === "function") && !options.includeCallable) return null;
  const text = node.text.trim();
  if ((node.type === "arrow_function" || node.type === "function") && text.length > 600) return null;
  return text.length > 0 ? text : null;
};

export const inferReturnType = (node: SyntaxNode | null): string | null => {
  if (!node) return null;
  return containsJsx(node) ? "JSX.Element" : null;
};

const containsJsx = (node: SyntaxNode): boolean => {
  if (node.type.startsWith("jsx_")) return true;
  return node.namedChildren.some(containsJsx);
};

const getTypeNames = (typeText: string | null | undefined) => {
  if (!typeText) return [];
  const matches = typeText.match(/\b[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*\b/g) ?? [];
  return [...new Set(matches)].filter((match) => !BUILTIN_TYPES.has(match));
};

export const resolveTypeBinding = (
  typeName: string,
  importBindings: Map<string, ImportBinding>,
  declarations: Map<string, DeclarationRecord>,
) => {
  const localName = typeName.split(".")[0] ?? typeName;
  const importBinding = importBindings.get(localName);
  if (importBinding) return importBinding.isExternal;
  if (declarations.has(localName)) return false;
  return false;
};

export const appendTypeRelations = (
  relations: RelationInfo[],
  relationType: RelationInfo["type"],
  from: string,
  typeText: string | null | undefined,
  importBindings: Map<string, ImportBinding>,
  declarations: Map<string, DeclarationRecord>,
  line: number,
) => {
  for (const typeName of getTypeNames(typeText)) {
    relations.push(
      createRelation(
        relationType,
        from,
        typeName,
        resolveTypeBinding(typeName, importBindings, declarations),
        line,
      ),
    );
  }
};

export const classifyVariable = (name: string, filePath: string) => {
  if (filePath.endsWith(".tsx") && /^[A-Z]/.test(name)) {
    return SymbolKind.Component;
  }
  return SymbolKind.Variable;
};

export const collectParams = (node: SyntaxNode | null) => {
  if (!node) return [];
  return node.namedChildren.map((child) => {
    const wrapper = child;
    const target =
      child.type === "required_parameter" || child.type === "optional_parameter"
        ? (child.namedChildren[0] ?? child)
        : child;
    const nameNode =
      target.childForFieldName("name") ??
      target.namedChildren.find((candidate) =>
        candidate.type === "identifier" || candidate.type === "property_identifier",
      ) ??
      target.namedChildren[0] ??
      target;
    const typeNode =
      wrapper.childForFieldName("type") ??
      wrapper.namedChildren.find((candidate) => candidate.type === "type_annotation") ??
      target.childForFieldName("type") ??
      target.namedChildren.find((candidate) => candidate.type === "type_annotation") ??
      null;

    return {
      name: nameNode.text,
      type: extractTypeAnnotation(typeNode),
    };
  });
};

export const collectMembers = (
  node: SyntaxNode | null,
  declarations: Map<string, DeclarationRecord>,
  importBindings: Map<string, ImportBinding>,
  ownerName: string,
  relations: RelationInfo[],
) => {
  if (!node) return undefined;

  const members: SymbolInfo[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "public_field_definition" || child.type === "property_signature") {
      const nameNode =
        child.childForFieldName("name") ??
        child.namedChildren.find((candidate) =>
          candidate.type === "property_identifier" || candidate.type === "identifier",
        );
      if (!nameNode) continue;
      const typeNode =
        child.childForFieldName("type") ??
        child.namedChildren.find((candidate) => candidate.type === "type_annotation") ??
        null;
      const typeAnnotation = extractTypeAnnotation(typeNode);
      const propDoc = extractJSDoc(child);
      members.push({
        name: nameNode.text,
        kind: SymbolKind.Prop,
        visibility: Visibility.Internal,
        file: "",
        line: getLine(child),
        endLine: getEndLine(child),
        ...(typeAnnotation ? { typeAnnotation } : {}),
        ...(propDoc ? { doc: propDoc } : {}),
      });
      appendTypeRelations(relations, EdgeType.OfType, ownerName, typeAnnotation, importBindings, declarations, getLine(child));
      continue;
    }

    const indexMember = indexSignatureMember(child);
    if (indexMember) {
      members.push(indexMember.info);
      appendTypeRelations(relations, EdgeType.OfType, ownerName, indexMember.typeAnnotation, importBindings, declarations, getLine(child));
      continue;
    }

    if (child.type === "method_definition" || child.type === "method_signature") {
      const nameNode =
        child.childForFieldName("name") ??
        child.namedChildren.find((candidate) =>
          candidate.type === "property_identifier" || candidate.type === "identifier",
        );
      if (!nameNode) continue;

      const paramsNode =
        child.childForFieldName("parameters") ??
        child.namedChildren.find((candidate) => candidate.type === "formal_parameters") ??
        null;
      const params = collectParams(paramsNode);
      const returnType = getReturnType(child);
      const methodDoc = extractJSDoc(child);
      members.push({
        name: nameNode.text,
        kind: SymbolKind.Method,
        visibility: Visibility.Internal,
        file: "",
        line: getLine(child),
        endLine: getEndLine(child),
        ...(params.length > 0 ? { params } : {}),
        ...(returnType ? { returnType } : {}),
        ...(methodDoc ? { doc: methodDoc } : {}),
      });
      for (const param of params) {
        appendTypeRelations(relations, EdgeType.ParamType, ownerName, param.type, importBindings, declarations, getLine(child));
      }
      appendTypeRelations(relations, EdgeType.ReturnType, ownerName, returnType, importBindings, declarations, getLine(child));
    }
  }

  return members.length > 0 ? members : undefined;
};

const indexSignatureMember = (node: SyntaxNode) => {
  if (node.type !== "index_signature") return null;
  const match = /^\s*(\[[^\]]+\])\s*:?\s*([^;]+)?;?\s*$/u.exec(node.text);
  const name = match?.[1]?.trim();
  const typeAnnotation = match?.[2]?.trim();
  if (!name) return null;
  const propDoc = extractJSDoc(node);
  return {
    info: {
      name,
      kind: SymbolKind.Prop,
      visibility: Visibility.Internal,
      file: "",
      line: getLine(node),
      endLine: getEndLine(node),
      ...(typeAnnotation ? { typeAnnotation } : {}),
      ...(propDoc ? { doc: propDoc } : {}),
    },
    typeAnnotation,
  };
};

export const collectEnumValues = (node: SyntaxNode) => {
  const body = node.namedChildren.find((child) => child.type === "enum_body") ?? null;
  if (!body) return undefined;
  const values: string[] = [];
  for (const member of body.namedChildren.filter((child) => child.type === "enum_assignment" || child.type === "property_identifier")) {
    if (member.type === "property_identifier") {
      values.push(member.text);
      continue;
    }
    const name = member.childForFieldName("name")?.text ?? member.namedChildren[0]?.text;
    if (!name) continue;
    const valueNode =
      member.childForFieldName("value") ??
      member.namedChildren.find((child) => child !== member.childForFieldName("name")) ??
      null;
    const rawValue = valueNode?.text.replace(/^['"]|['"]$/gu, "");
    values.push(rawValue ? `${name} = ${rawValue}` : name);
  }
  return values.length > 0 ? values : undefined;
};

export const extractUnionLiteralValues = (typeNode: SyntaxNode | null): string[] | undefined => {
  if (!typeNode) return undefined;
  if (typeNode.type === "literal_type") {
    const text = typeNode.text.replace(/^['"]|['"]$/g, "");
    return text ? [text] : undefined;
  }
  if (typeNode.type === "union_type") {
    const values: string[] = [];
    for (const child of typeNode.namedChildren) {
      if (child.type === "literal_type") {
        const text = child.text.replace(/^['"]|['"]$/g, "");
        if (text) values.push(text);
      } else if (child.type === "union_type") {
        const nested = extractUnionLiteralValues(child);
        if (!nested) return undefined;
        values.push(...nested);
      } else {
        return undefined;
      }
    }
    return values.length > 0 ? values : undefined;
  }
  return undefined;
};

export const findObjectTypeNodes = (node: SyntaxNode | null): SyntaxNode[] => {
  if (!node) return [];
  if (node.type === "object_type") return [node];
  if (node.type === "intersection_type" || node.type === "union_type") {
    return node.namedChildren.flatMap(findObjectTypeNodes);
  }
  if (node.type === "parenthesized_type" && node.namedChildCount > 0) {
    return findObjectTypeNodes(node.namedChildren[0]!);
  }
  return [];
};
