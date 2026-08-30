import { EdgeType, SymbolKind, Visibility } from "@c4a/core";
import { parseFile, type FileSystem, type RelationInfo, type SymbolInfo } from "@c4a/extract";
import {
  appendTypeRelations,
  classifyVariable,
  collectEnumValues,
  collectMembers,
  collectParams,
  containsJsx,
  countLines,
  createRelation,
  DECLARATION_TYPES,
  extractJSDoc,
  extractTypeAnnotation,
  extractUnionLiteralValues,
  findObjectTypeNodes,
  getCallableFromInitializer,
  getEndLine,
  getInitializer,
  getInitializerText,
  getInitializerTypeAnnotation,
  inferReturnType,
  getLine,
  getNameNodeText,
  getReturnType,
  resolveTypeBinding,
  type DeclarationRecord,
  type FileAnalysis,
  type ImportBinding,
  type SyntaxNode,
} from "./symbolExtractorAst.js";
import { analyzeCommonJsModule, type CommonJsModuleAnalysis } from "./commonJsModule.js";
import { isJsxLikePath } from "./ecmaScriptLanguage.js";
import { collectStaticCallRelations } from "./staticCallRelations.js";
import { collectImportBindings } from "./symbolExtractorImports.js";
import type { TsConfigPathResolver } from "./tsconfigPaths.js";
import { createEcmaScriptSourceFile, syntaxDiagnostics } from "./typescriptAst.js";

const analyzeDeclaration = (
  node: SyntaxNode,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
  importBindings: Map<string, ImportBinding>,
  relations: RelationInfo[],
) => {
  if (node.type === "lexical_declaration") {
    analyzeLexicalDeclaration(node, filePath, declarations, importBindings, relations);
    return;
  }

  const named = getNamedDeclaration(node);
  if (!named) return;
  const { name } = named;

  if (node.type === "function_declaration") {
    analyzeFunctionDeclaration(node, name, filePath, declarations, importBindings, relations);
    return;
  }

  const symbolDoc = extractJSDoc(node);

  if (node.type === "class_declaration") {
    analyzeClassDeclaration(node, name, symbolDoc, filePath, declarations, importBindings, relations);
    return;
  }

  if (node.type === "interface_declaration") {
    analyzeInterfaceDeclaration(node, name, symbolDoc, filePath, declarations, importBindings, relations);
    return;
  }

  if (node.type === "type_alias_declaration") {
    analyzeTypeAliasDeclaration(node, name, symbolDoc, filePath, declarations, importBindings, relations);
    return;
  }

  if (node.type === "enum_declaration") {
    analyzeEnumDeclaration(node, name, symbolDoc, filePath, declarations);
  }
};

const getNamedDeclaration = (node: SyntaxNode) => {
  const nameNode =
    node.childForFieldName("name") ??
    node.namedChildren.find((child) => child.type === "identifier" || child.type === "type_identifier");
  const name = getNameNodeText(nameNode);
  return name ? { name } : null;
};

const analyzeLexicalDeclaration = (
  node: SyntaxNode,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
  importBindings: Map<string, ImportBinding>,
  relations: RelationInfo[],
) => {
  for (const declarator of node.namedChildren.filter((child) => child.type === "variable_declarator")) {
    const nameNode = declarator.childForFieldName("name") ?? declarator.namedChildren[0];
    if (!nameNode) continue;
    const typeNode =
      declarator.childForFieldName("type") ??
      declarator.namedChildren.find((child) => child.type === "type_annotation") ??
      null;
    const initializer = getInitializer(declarator);
    const callable = getCallableFromInitializer(initializer);
    const paramsNode =
      callable?.childForFieldName("parameters") ??
      callable?.namedChildren.find((child) => child.type === "formal_parameters") ??
      null;
    const params = collectParams(paramsNode);
    const returnType = callable ? (getReturnType(callable) ?? inferReturnType(callable)) : null;
    const initializerTypeAnnotation = getInitializerTypeAnnotation(initializer);
    const typeAnnotation = extractTypeAnnotation(typeNode) ?? initializerTypeAnnotation;
    const initializerText = getInitializerText(initializer, {
      includeCallable: params.length === 0 && !returnType && !typeAnnotation,
    });
    const varDoc = extractJSDoc(node);
    declarations.set(nameNode.text, {
      info: {
        name: nameNode.text,
        kind: classifyVariable(nameNode.text, filePath),
        visibility: Visibility.Internal,
        file: filePath,
        line: getLine(declarator),
        endLine: getEndLine(declarator),
        ...(typeAnnotation ? { typeAnnotation } : {}),
        ...(params.length > 0 ? { params } : {}),
        ...(returnType ? { returnType } : {}),
        ...(initializerText ? { initializer: initializerText } : {}),
        ...(varDoc ? { doc: varDoc } : {}),
      },
    });
    for (const param of params) {
      appendTypeRelations(
        relations,
        EdgeType.ParamType,
        nameNode.text,
        param.type,
        importBindings,
        declarations,
        getLine(declarator),
      );
    }
    appendTypeRelations(relations, EdgeType.ReturnType, nameNode.text, returnType, importBindings, declarations, getLine(declarator));
    appendTypeRelations(relations, EdgeType.OfType, nameNode.text, typeAnnotation, importBindings, declarations, getLine(declarator));
  }
};

const analyzeFunctionDeclaration = (
  node: SyntaxNode,
  name: string,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
  importBindings: Map<string, ImportBinding>,
  relations: RelationInfo[],
) => {
  const paramsNode =
    node.childForFieldName("parameters") ??
    node.namedChildren.find((child) => child.type === "formal_parameters") ??
    null;
  const params = collectParams(paramsNode);
  const returnType = getReturnType(node);
  const funcDoc = extractJSDoc(node);
  const signature = `${name}(${params.map((param) => `${param.name}${param.type ? `: ${param.type}` : ""}`).join(", ")})`;
  declarations.set(name, {
    info: {
      name,
      kind: isJsxLikePath(filePath) && /^[A-Z]/u.test(name) && containsJsx(node)
        ? SymbolKind.Component
        : SymbolKind.Function,
      visibility: Visibility.Internal,
      file: filePath,
      line: getLine(node),
      endLine: getEndLine(node),
      signature,
      ...(params.length > 0 ? { params } : {}),
      ...(returnType ? { returnType } : {}),
      ...(funcDoc ? { doc: funcDoc } : {}),
    },
  });
  for (const param of params) {
    appendTypeRelations(relations, EdgeType.ParamType, name, param.type, importBindings, declarations, getLine(node));
  }
  appendTypeRelations(relations, EdgeType.ReturnType, name, returnType, importBindings, declarations, getLine(node));
};

const analyzeClassDeclaration = (
  node: SyntaxNode,
  name: string,
  symbolDoc: string | undefined,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
  importBindings: Map<string, ImportBinding>,
  relations: RelationInfo[],
) => {
  const heritage = node.namedChildren.find((child) => child.type === "class_heritage") ?? null;
  const extendsClause = heritage?.namedChildren.find((child) => child.type === "extends_clause") ?? null;
  const implementsClause = heritage?.namedChildren.find((child) => child.type === "implements_clause") ?? null;
  const extendsValue = extendsClause?.namedChildren[0]?.text ?? null;
  const implementsValues = implementsClause?.namedChildren.map((child) => child.text) ?? [];
  const body = node.namedChildren.find((child) => child.type === "class_body") ?? null;
  const members = collectMembers(body, declarations, importBindings, name, relations);

  declarations.set(name, {
    info: {
      name,
      kind: SymbolKind.Class,
      visibility: Visibility.Internal,
      file: filePath,
      line: getLine(node),
      endLine: getEndLine(node),
      ...(members ? { members: members.map((member) => ({ ...member, file: filePath })) } : {}),
      ...(extendsValue ? { extends: extendsValue } : {}),
      ...(implementsValues.length > 0 ? { implements: implementsValues } : {}),
      ...(symbolDoc ? { doc: symbolDoc } : {}),
    },
  });
  if (extendsValue) {
    relations.push(
      createRelation(
        EdgeType.Extends,
        name,
        extendsValue,
        resolveTypeBinding(extendsValue, importBindings, declarations),
        getLine(node),
      ),
    );
  }
  for (const item of implementsValues) {
    relations.push(
      createRelation(EdgeType.Implements, name, item, resolveTypeBinding(item, importBindings, declarations), getLine(node)),
    );
  }
};

const analyzeInterfaceDeclaration = (
  node: SyntaxNode,
  name: string,
  symbolDoc: string | undefined,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
  importBindings: Map<string, ImportBinding>,
  relations: RelationInfo[],
) => {
  const body = node.namedChildren.find((child) => child.type === "interface_body") ?? null;
  const members = collectMembers(body, declarations, importBindings, name, relations);
  declarations.set(name, {
    info: {
      name,
      kind: SymbolKind.Interface,
      visibility: Visibility.Internal,
      file: filePath,
      line: getLine(node),
      endLine: getEndLine(node),
      ...(members ? { members: members.map((member) => ({ ...member, file: filePath })) } : {}),
      ...(symbolDoc ? { doc: symbolDoc } : {}),
    },
  });
};

const analyzeTypeAliasDeclaration = (
  node: SyntaxNode,
  name: string,
  symbolDoc: string | undefined,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
  importBindings: Map<string, ImportBinding>,
  relations: RelationInfo[],
) => {
  const typeNode = node.childForFieldName("value") ?? node.namedChildren.find((c) => c.type !== "type_identifier" && c.type !== "type_parameters") ?? null;
  const typeAnnotation = typeNode?.text ?? null;
  const objectTypeNodes = findObjectTypeNodes(typeNode);
  let members: SymbolInfo[] | undefined;
  if (objectTypeNodes.length > 0) {
    const allMembers: SymbolInfo[] = [];
    for (const objNode of objectTypeNodes) {
      const extractedMembers = collectMembers(objNode, declarations, importBindings, name, relations);
      if (extractedMembers) allMembers.push(...extractedMembers);
    }
    members = allMembers.length > 0 ? allMembers : undefined;
  }
  const unionValues = extractUnionLiteralValues(typeNode);

  declarations.set(name, {
    info: {
      name,
      kind: SymbolKind.Type,
      visibility: Visibility.Internal,
      file: filePath,
      line: getLine(node),
      endLine: getEndLine(node),
      ...(members ? { members: members.map((member) => ({ ...member, file: filePath })) } : {}),
      ...(unionValues ? { unionValues } : {}),
      ...(typeAnnotation && !unionValues ? { typeAnnotation } : {}),
      ...(symbolDoc ? { doc: symbolDoc } : {}),
    },
  });
  appendTypeRelations(relations, EdgeType.OfType, name, typeAnnotation, importBindings, declarations, getLine(node));
};

const analyzeEnumDeclaration = (
  node: SyntaxNode,
  name: string,
  symbolDoc: string | undefined,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
) => {
  const enumValues = collectEnumValues(node);
  declarations.set(name, {
    info: {
      name,
      kind: SymbolKind.Enum,
      visibility: Visibility.Internal,
      file: filePath,
      line: getLine(node),
      endLine: getEndLine(node),
      ...(enumValues ? { unionValues: enumValues } : {}),
      ...(symbolDoc ? { doc: symbolDoc } : {}),
    },
  });
};

const appendCommonJsSyntheticDeclarations = (
  commonJs: CommonJsModuleAnalysis,
  filePath: string,
  declarations: Map<string, DeclarationRecord>,
) => {
  for (const declaration of commonJs.syntheticDeclarations) {
    if (declarations.has(declaration.name)) continue;
    declarations.set(declaration.name, {
      info: {
        name: declaration.name,
        kind: declaration.kind === "function"
          ? (isJsxLikePath(filePath) && /^[A-Z]/u.test(declaration.name)
            ? SymbolKind.Component
            : SymbolKind.Function)
          : declaration.kind === "class"
            ? SymbolKind.Class
            : SymbolKind.Variable,
        visibility: Visibility.Internal,
        file: filePath,
        line: declaration.line,
        endLine: declaration.endLine,
        ...(declaration.params.length > 0
          ? { params: declaration.params.map((name) => ({ name, type: null })) }
          : {}),
      },
    });
  }
};

export const analyzeFile = async (
  filePath: string,
  fs: FileSystem,
  resolver: TsConfigPathResolver = { mappings: [] },
): Promise<FileAnalysis> => {
  const source = await fs.readFile(filePath);
  const sourceFile = createEcmaScriptSourceFile(source, filePath);
  const commonJs = analyzeCommonJsModule(source, filePath);
  const tree = await parseFile(source, isJsxLikePath(filePath));
  if (!tree) {
    const diagnostics = syntaxDiagnostics(sourceFile);
    if (diagnostics.length === 0) {
      diagnostics.push({
        code: "ecmascript-parser-unsupported",
        severity: "error",
        file: filePath,
        line: 1,
        column: 1,
      });
    }
    return {
      declarations: new Map(),
      importBindings: new Map(),
      relations: [],
      lines: countLines(source),
      disposition: "unsupported",
      diagnostics,
    };
  }

  if (commonJs.diagnostics.length > 0) {
    return {
      declarations: new Map(),
      importBindings: new Map(),
      relations: [],
      lines: countLines(source),
      disposition: "unsupported",
      diagnostics: commonJs.diagnostics,
    };
  }

  const root = tree.rootNode;
  const relations: RelationInfo[] = [];
  const importBindings = await collectImportBindings(root, filePath, fs, resolver, relations, commonJs);
  const declarations = new Map<string, DeclarationRecord>();

  for (const relation of relations) {
    if (relation.from === "") {
      relation.from = filePath;
    }
  }

  for (const child of root.namedChildren) {
    if (DECLARATION_TYPES.has(child.type)) {
      analyzeDeclaration(child, filePath, declarations, importBindings, relations);
      continue;
    }

    if (child.type !== "export_statement") continue;
    const declaration = child.namedChildren.find((node) => DECLARATION_TYPES.has(node.type));
    if (declaration) {
      analyzeDeclaration(declaration, filePath, declarations, importBindings, relations);
    }
  }

  appendCommonJsSyntheticDeclarations(commonJs, filePath, declarations);
  relations.push(...collectStaticCallRelations(source, filePath, importBindings));

  return {
    declarations,
    importBindings,
    relations,
    lines: countLines(source),
    disposition: "analyzed",
    diagnostics: [],
  };
};
