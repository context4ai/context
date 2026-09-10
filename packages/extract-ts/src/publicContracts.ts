import { componentDefaultsFromBinding, componentLocalPropsNode, componentPropsNode } from "./componentContract.js";
import { federationContracts } from "./federationContracts.js";
import { posix } from "node:path";
import ts from "typescript";
import { EdgeType, SymbolKind, Visibility } from "@c4a/core";
import type { FileSystem, RelationInfo, SymbolInfo } from "@c4a/extract";
import { createRelation } from "./symbolExtractorAst.js";
import type { TsConfigPathResolver } from "./tsconfigPaths.js";
import { runtimeRegistrations } from "./runtimeRegistrations.js";

const format = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

function declarationAt(source: ts.SourceFile, symbol: SymbolInfo): ts.Node | undefined {
  const candidates: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (line > symbol.endLine) return;
    if (line === symbol.line && (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) ||
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node))) {
      candidates.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return candidates.find((node) => "name" in node && (node.name as ts.Node | undefined)?.getText(source) === symbol.name)
    ?? (candidates.length === 1 ? candidates[0] : undefined);
}

/** Explicit object members remain knowable when an intersection contains an
 * unavailable dependency. Do not traverse unions, conditional types or generic
 * arguments: their fields are not unconditionally part of the public contract. */
function declaredObjectTypes(node: ts.Node, checker: ts.TypeChecker, seen = new Set<ts.Node>()): Array<ts.TypeLiteralNode | ts.InterfaceDeclaration> {
  if (seen.has(node)) return [];
  seen.add(node);
  if (ts.isTypeAliasDeclaration(node)) return declaredObjectTypes(node.type, checker, seen);
  if (ts.isParenthesizedTypeNode(node)) return declaredObjectTypes(node.type, checker, seen);
  if (ts.isIntersectionTypeNode(node)) return node.types.flatMap(type => declaredObjectTypes(type, checker, seen));
  if (ts.isTypeReferenceNode(node) && !node.typeArguments?.length) {
    let symbol = checker.getSymbolAtLocation(node.typeName);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    return (symbol?.declarations ?? []).flatMap(declaration => declaredObjectTypes(declaration, checker, seen));
  }
  return ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node) ? [node] : [];
}

/** noLib can erase an array inside a union or function signature while leaving
 * the enclosing type apparently resolved. Keep the written contract in that
 * case; never publish a degraded checker representation as a complete type. */
function memberTypeText(checker: ts.TypeChecker, type: ts.Type, member: ts.Node, annotation: ts.TypeNode | undefined): {
  text: string; complete: boolean;
} {
  const text = checker.typeToString(type, member, format);
  if (annotation === undefined) return { text, complete: (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0 };
  if (annotation.kind === ts.SyntaxKind.AnyKeyword || annotation.kind === ts.SyntaxKind.UnknownKeyword) {
    return { text: annotation.getText(), complete: true };
  }
  let incomplete = (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
    || (text === "{}" && !ts.isTypeLiteralNode(annotation));
  const visit = (node: ts.Node) => {
    if (ts.isArrayTypeNode(node) || ts.isTupleTypeNode(node) || ts.isTypeReferenceNode(node)) {
      const resolved = checker.getTypeFromTypeNode(node);
      const rendered = checker.typeToString(resolved, node, format);
      if ((resolved.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
        || (ts.isArrayTypeNode(node) && rendered === "{}")) incomplete = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(annotation);
  return { text: incomplete ? annotation.getText() : text, complete: !incomplete };
}

function callable(node: ts.Node): ts.SignatureDeclaration | undefined {
  if (ts.isFunctionDeclaration(node)) return node;
  if (!ts.isVariableDeclaration(node)) return undefined;
  let value = node.initializer;
  if (value !== undefined && ts.isCallExpression(value)) {
    value = value.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
  }
  return value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : undefined;
}

/** One checker per extraction, with a closed in-memory filesystem. It cannot
 * traverse dependencies outside the already authorized parser selection. */
export async function enrichPublicContracts(input: {
  symbols: SymbolInfo[];
  paths: readonly string[];
  fs: FileSystem;
  resolver?: TsConfigPathResolver;
  relations?: RelationInfo[];
}): Promise<void> {
  const sources = new Map<string, ts.SourceFile>();
  for (const path of input.paths) {
    const source = await input.fs.readFile(path);
    const absolute = posix.resolve("/", path);
    sources.set(absolute, ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true));
  }
  const options: ts.CompilerOptions = { noLib: true, skipLibCheck: true, allowJs: true,
    jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Node10,
    baseUrl: "/", paths: Object.fromEntries((input.resolver?.mappings ?? []).map((mapping) =>
      [mapping.pattern, mapping.targets.map((target) => posix.resolve("/", target))])),
  };
  const host: ts.CompilerHost = {
    getSourceFile: (path) => sources.get(posix.resolve("/", path)),
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (path) => sources.has(posix.resolve("/", path)),
    readFile: (path) => sources.get(posix.resolve("/", path))?.text,
    getCanonicalFileName: (path) => posix.resolve("/", path),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  for (const source of sources.values()) input.symbols.push(...runtimeRegistrations(source), ...federationContracts(source));
  // Internal source directories often have no public contract to resolve.
  // Registration extraction above remains syntax-based and must still run.
  if (!input.symbols.some(symbol => symbol.visibility === Visibility.Exported)) return;
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  const diagnosticsByFile = new Map<string, readonly ts.Diagnostic[]>();
  for (const symbol of input.symbols) {
    if (symbol.visibility !== Visibility.Exported) continue;
    const source = sources.get(posix.resolve("/", symbol.file));
    if (source === undefined) continue;
    const declaration = declarationAt(source, symbol);
    if (declaration === undefined) continue;
    symbol.contractResolution = "declaration-only";
    const fn = callable(declaration);
    if (fn !== undefined) {
      symbol.params = fn.parameters.map((parameter) => ({
        name: parameter.name.getText(source),
        type: parameter.type?.getText(source) ?? checker.typeToString(checker.getTypeAtLocation(parameter), parameter, format),
        optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
        rest: parameter.dotDotDotToken !== undefined,
        ...(parameter.initializer === undefined ? {} : { defaultValue: parameter.initializer.getText(source) }),
      }));
      if (fn.typeParameters !== undefined) symbol.typeParameters = `<${fn.typeParameters.map((item) => item.getText(source)).join(", ")}>`;
    }
    const valueType = checker.getTypeAtLocation(declaration);
    const signatures = valueType.getCallSignatures();
    const declaredSignatures = signatures.flatMap((signature) => {
      const declared = signature.getDeclaration();
      if (declared === undefined || !sources.has(declared.getSourceFile().fileName)) return [];
      const body = "body" in declared ? declared.body as ts.Node | undefined : undefined;
      return [declared.getSourceFile().text.slice(declared.getStart(), body?.pos ?? declared.getEnd()).trim().replace(/;$/u, "")];
    });
    // A checker can infer `any` from missing JSX/runtime libraries. Preserve
    // written signatures instead of publishing such inference as a declaration.
    if (declaredSignatures.length > 1) symbol.overloads = declaredSignatures;
    let contractType: ts.Type | undefined;
    let localProps: ts.TypeNode | undefined;
    if (symbol.kind === SymbolKind.Component) {
      const parameter = signatures[0]?.parameters[0];
      if (parameter !== undefined) {
        contractType = checker.getTypeOfSymbolAtLocation(parameter, declaration);
        symbol.propsType = checker.typeToString(contractType, declaration, format);
      }
      // Generic wrappers can be unresolved without their external library.
      // A directly typed callable parameter is still an authoritative link.
      const annotation = fn?.parameters[0]?.type
        ?? (ts.isVariableDeclaration(declaration) ? componentPropsNode(declaration.type) : undefined);
      if (annotation !== undefined) {
        contractType = checker.getTypeFromTypeNode(annotation);
        symbol.propsType = annotation.getText(source);
        localProps = componentLocalPropsNode(annotation, checker);
      }
    } else if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) {
      contractType = checker.getTypeAtLocation(declaration);
    }
    if (contractType === undefined) continue;
    const unresolved = (contractType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    const localType = unresolved && localProps !== undefined ? checker.getTypeFromTypeNode(localProps) : undefined;
    const knownType = localType ?? contractType;
    const properties = (knownType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
      ? declaredObjectTypes(localProps ?? declaration, checker).flatMap((node) => checker.getPropertiesOfType(checker.getTypeAtLocation(node)))
      : checker.getPropertiesOfType(knownType);
    if (properties.length === 0) continue;
    if (symbol.kind === SymbolKind.Component && symbol.propsType !== undefined && input.relations !== undefined) {
      const typeSymbol = knownType.aliasSymbol ?? knownType.getSymbol();
      const declaration = typeSymbol?.declarations?.[0];
      if (typeSymbol !== undefined && declaration !== undefined) input.relations.push({ ...createRelation(
        EdgeType.OfType, symbol.name, typeSymbol.name,
        !sources.has(declaration.getSourceFile().fileName), symbol.line), file: symbol.file });
    }
    const pattern = fn?.parameters[0]?.name;
    const defaults = pattern === undefined ? {} : componentDefaultsFromBinding(pattern, source);
    const members: SymbolInfo[] = [];
    let completeMembers = true;
    for (const property of properties) {
      const member = property.valueDeclaration ?? property.declarations?.[0];
      if (member === undefined || !sources.has(member.getSourceFile().fileName)) continue;
      const memberSource = member.getSourceFile();
      const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, member);
      const annotation = "type" in member ? member.type as ts.TypeNode | undefined : undefined;
      const documentedDefault = ts.getJSDocTags(member).find((tag) => tag.tagName.text === "default" || tag.tagName.text === "defaultValue");
      const defaultComment = documentedDefault?.comment;
      const defaultText = typeof defaultComment === "string" ? defaultComment.trim()
        : defaultComment === undefined ? undefined : defaultComment.map((part) => part.getText(memberSource)).join("").trim();
      const defaultValue = (Object.hasOwn(defaults, property.name) ? defaults[property.name] : undefined) ?? (defaultText || undefined);
      const hidden = ts.getJSDocTags(member).some((tag) => ["internal", "private"].includes(tag.tagName.text))
        || modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword
          || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
      if (hidden) continue;
      const renderedType = memberTypeText(checker, propertyType, member, annotation);
      completeMembers &&= renderedType.complete;
      members.push({ name: property.name, kind: SymbolKind.Prop, visibility: Visibility.Exported,
        file: posix.relative("/", memberSource.fileName),
        line: memberSource.getLineAndCharacterOfPosition(member.getStart()).line + 1,
        endLine: memberSource.getLineAndCharacterOfPosition(member.getEnd()).line + 1,
        optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
        ...(defaultValue === undefined ? {} : { defaultValue }),
        readonly: modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
        typeAnnotation: renderedType.text,
        doc: ts.displayPartsToString(property.getDocumentationComment(checker)),
      });
    }
    if (properties.length > 0) {
      symbol.members = members;
      // Unresolved heritage remains visible in the declaration; never advertise
      // a complete inherited contract on the basis of local fields alone.
      let diagnostics = diagnosticsByFile.get(source.fileName);
      if (diagnostics === undefined) {
        diagnostics = program.getSemanticDiagnostics(source);
        diagnosticsByFile.set(source.fileName, diagnostics);
      }
      symbol.contractResolution = !unresolved && completeMembers && diagnostics.length === 0 ? "resolved" : "declaration-only";
    }
  }
}
