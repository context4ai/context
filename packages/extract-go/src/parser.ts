import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Language, Parser, type SyntaxNode } from "web-tree-sitter";
import type {
  GoCall,
  GoFileIndex,
  GoHttpFramework,
  GoHttpRoute,
  GoImport,
  GoSourceLocation,
  GoSymbol,
  GoSymbolKind,
} from "./types.js";

const resolveWasmPath = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

const localRuntimeWasm = resolveWasmPath("./wasm/tree-sitter.wasm");
await Parser.init(existsSync(localRuntimeWasm)
  ? { locateFile: (scriptName: string) => resolveWasmPath(`./wasm/${scriptName}`) }
  : undefined);
const parser = new Parser();
const goLanguage = await Language.load(resolveWasmPath("./wasm/tree-sitter-go.wasm"));
parser.setLanguage(goLanguage as unknown as NonNullable<Parser["language"]>);

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "Any", "Handle", "HandleFunc"]);

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isExported(name: string): boolean {
  return /^\p{Lu}/u.test(name);
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

function descendants(node: SyntaxNode, type: string): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  walk(node, (child) => {
    if (child.type === type) found.push(child);
  });
  return found;
}

function locationFor(filePath: string, node: SyntaxNode): GoSourceLocation {
  return {
    path: filePath,
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

function receiverName(node: SyntaxNode): string | undefined {
  const receiver = node.childForFieldName("receiver");
  const declaration = receiver?.namedChildren.find((child) => child.type === "parameter_declaration");
  const typeNode = declaration?.childForFieldName("type") ?? declaration?.namedChildren.at(-1);
  return typeNode ? compact(typeNode.text).replace(/^\*/u, "") : undefined;
}

function declarationName(node: SyntaxNode): string | undefined {
  const name = node.childForFieldName("name")?.text;
  if (!name) return undefined;
  const receiver = node.type === "method_declaration" ? receiverName(node) : undefined;
  return receiver ? `${receiver}.${name}` : name;
}

function enclosingDeclaration(node: SyntaxNode): SyntaxNode | undefined {
  let current = node.parent;
  while (current) {
    if (current.type === "function_declaration" || current.type === "method_declaration") return current;
    current = current.parent;
  }
  return undefined;
}

function documentationFor(node: SyntaxNode): string | undefined {
  const comments: string[] = [];
  let previous = node.previousNamedSibling;
  let expectedLine = node.startPosition.row;
  while (previous?.type === "comment" && previous.endPosition.row >= expectedLine - 1) {
    comments.unshift(previous.text.replace(/^\/\/[ ]?/u, "").replace(/^\/\*[ ]?|[ ]?\*\/$/gu, ""));
    expectedLine = previous.startPosition.row;
    previous = previous.previousNamedSibling;
  }
  const doc = comments.join("\n").trim();
  return doc.length > 0 ? doc : undefined;
}

function functionSignature(node: SyntaxNode): string {
  const body = node.childForFieldName("body");
  return compact(body ? node.text.slice(0, body.startIndex - node.startIndex) : node.text);
}

function symbolId(filePath: string, kind: GoSymbolKind, qualifiedName: string): string {
  return `go:${filePath}#${kind}:${qualifiedName}`;
}

function extractSymbols(root: SyntaxNode, filePath: string, packageName: string, exportedOnly: boolean): GoSymbol[] {
  const symbols: GoSymbol[] = [];
  for (const node of root.namedChildren) {
    if (node.type === "function_declaration" || node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (!name || (exportedOnly && !isExported(name))) continue;
      const receiver = node.type === "method_declaration" ? receiverName(node) : undefined;
      const qualifiedName = receiver ? `${receiver}.${name}` : name;
      const kind: GoSymbolKind = receiver ? "method" : "function";
      const doc = documentationFor(node);
      symbols.push({
        id: symbolId(filePath, kind, qualifiedName),
        kind,
        name,
        qualifiedName,
        package: packageName,
        ...(receiver ? { receiver } : {}),
        exported: isExported(name),
        signature: functionSignature(node),
        ...(doc ? { doc } : {}),
        location: locationFor(filePath, node),
      });
      continue;
    }
    if (node.type === "type_declaration") {
      for (const spec of descendants(node, "type_spec")) {
        const name = spec.childForFieldName("name")?.text;
        const typeNode = spec.childForFieldName("type");
        if (!name || !typeNode || (exportedOnly && !isExported(name))) continue;
        const kind: GoSymbolKind = typeNode.type === "struct_type" ? "struct" : typeNode.type === "interface_type" ? "interface" : "type";
        const doc = documentationFor(node);
        symbols.push({
          id: symbolId(filePath, kind, name),
          kind,
          name,
          qualifiedName: name,
          package: packageName,
          exported: isExported(name),
          signature: compact(`type ${name} ${typeNode.text}`),
          ...(doc ? { doc } : {}),
          location: locationFor(filePath, spec),
        });
      }
      continue;
    }
    const kind: GoSymbolKind | undefined = node.type === "const_declaration" ? "const" : node.type === "var_declaration" ? "var" : undefined;
    if (!kind) continue;
    for (const spec of descendants(node, kind === "const" ? "const_spec" : "var_spec")) {
      const nameNodes: SyntaxNode[] = [];
      let nameNode = spec.childForFieldName("name");
      while (nameNode?.type === "identifier") {
        nameNodes.push(nameNode);
        nameNode = nameNode.nextNamedSibling;
      }
      for (const nameNode of nameNodes) {
        const name = nameNode.text;
        if (exportedOnly && !isExported(name)) continue;
        const doc = documentationFor(node);
        symbols.push({
          id: symbolId(filePath, kind, name),
          kind,
          name,
          qualifiedName: name,
          package: packageName,
          exported: isExported(name),
          signature: compact(spec.text),
          ...(doc ? { doc } : {}),
          location: locationFor(filePath, spec),
        });
      }
    }
  }
  return symbols.sort((left, right) => left.id.localeCompare(right.id));
}

function unquoteGoString(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) return trimmed.slice(1, -1);
  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) return undefined;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
}

function extractImports(root: SyntaxNode): GoImport[] {
  const imports: GoImport[] = [];
  for (const spec of descendants(root, "import_spec")) {
    const pathNode = spec.childForFieldName("path") ?? spec.namedChildren.find((child) => child.type.endsWith("string_literal"));
    const importPath = pathNode ? unquoteGoString(pathNode.text) : undefined;
    if (!importPath) continue;
    const explicitAlias = spec.childForFieldName("name")?.text;
    const alias = explicitAlias && explicitAlias !== "." && explicitAlias !== "_"
      ? explicitAlias
      : importPath.split("/").at(-1) ?? importPath;
    imports.push({ alias, path: importPath });
  }
  return imports.sort((left, right) => left.alias.localeCompare(right.alias) || left.path.localeCompare(right.path));
}

function frameworkFromImports(imports: readonly GoImport[], method: string): GoHttpFramework {
  const paths = imports.map((item) => item.path);
  if (method === "Handle" || method === "HandleFunc") return paths.includes("net/http") ? "net-http" : "unknown";
  const candidates: GoHttpFramework[] = [];
  if (paths.some((value) => value.includes("cloudwego/hertz"))) candidates.push("hertz");
  if (paths.some((value) => value.includes("gin-gonic/gin"))) candidates.push("gin");
  if (paths.some((value) => value.includes("labstack/echo"))) candidates.push("echo");
  if (paths.some((value) => value.includes("go-chi/chi"))) candidates.push("chi");
  if (candidates.length === 1) return candidates[0]!;
  return "unknown";
}

function joinRoutePath(prefix: string, suffix: string): string {
  return `${prefix.replace(/\/$/u, "")}/${suffix.replace(/^\//u, "")}`.replace(/\/{2,}/gu, "/") || "/";
}

function scopedReceiver(enclosingSymbol: string | undefined, receiver: string): string {
  return `${enclosingSymbol ?? "<package>"}\u0000${receiver}`;
}

function extractCallsAndRoutes(root: SyntaxNode, filePath: string, imports: readonly GoImport[]): { calls: GoCall[]; routes: GoHttpRoute[] } {
  const importMap = new Map(imports.map((item) => [item.alias, item.path]));
  const groups = new Map<string, string>();
  const middleware = new Map<string, string[]>();
  const calls: GoCall[] = [];
  const routes: GoHttpRoute[] = [];
  for (const call of descendants(root, "call_expression").sort((left, right) => left.startIndex - right.startIndex)) {
    const functionNode = call.childForFieldName("function");
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    if (!functionNode) continue;
    const functionText = compact(functionNode.text);
    const selectorPath = [...functionText.matchAll(/[A-Za-z_]\w*/gu)].map((match) => match[0]);
    const selector = /^[A-Za-z_]\w*(?:\.|\()/u.test(functionText) && selectorPath.length >= 2
      ? selectorPath
      : undefined;
    const declaration = enclosingDeclaration(call);
    const enclosingSymbol = declaration ? declarationName(declaration) : undefined;
    let assignment = call.parent;
    while (assignment && assignment.type !== "short_var_declaration" && assignment.type !== "assignment_statement" && assignment.type !== "expression_statement") {
      assignment = assignment.parent;
    }
    const assignedTo = assignment && assignment.type !== "expression_statement"
      ? assignment.text.match(/^\s*([A-Za-z_]\w*)\s*(?::=|=)/u)?.[1]
      : undefined;
    if (selector) {
      const receiver = selector[0]!;
      const method = selector.at(-1)!;
      const callee = functionText;
      const importPath = importMap.get(receiver);
      calls.push({
        id: `go:${filePath}#call:${callee}@${call.startPosition.row + 1}`,
        callee,
        selectorPath: selector,
        receiver,
        method,
        arguments: args.map((arg) => compact(arg.text)),
        ...(assignedTo ? { assignedTo } : {}),
        ...(importPath ? { importPath } : {}),
        ...(enclosingSymbol ? { enclosingSymbol } : {}),
        location: locationFor(filePath, call),
      });
      if ((method === "Group" || method === "Route") && args[0]) {
        const prefix = unquoteGoString(args[0].text);
        const variable = assignedTo;
        if (prefix !== undefined && variable) {
          const variableKey = scopedReceiver(enclosingSymbol, variable);
          groups.set(
            variableKey,
            joinRoutePath(groups.get(scopedReceiver(enclosingSymbol, receiver)) ?? "", prefix),
          );
          middleware.delete(variableKey);
        }
      }
      if (method === "Use") {
        const key = scopedReceiver(enclosingSymbol, receiver);
        middleware.set(key, [...(middleware.get(key) ?? []), ...args.map((arg) => compact(arg.text))]);
      }
      if (HTTP_METHODS.has(method) && args[0]) {
        const routePath = unquoteGoString(args[0].text);
        if (routePath !== undefined) {
          const framework = frameworkFromImports(imports, method);
          const isNetHttpHandle = framework === "net-http" && (method === "Handle" || method === "HandleFunc");
          const receiverKey = scopedReceiver(enclosingSymbol, receiver);
          routes.push({
            id: `go:${filePath}#route:${method}:${joinRoutePath(groups.get(receiverKey) ?? "", routePath)}@${call.startPosition.row + 1}`,
            framework,
            method: isNetHttpHandle ? "ANY" : method.toUpperCase(),
            path: joinRoutePath(groups.get(receiverKey) ?? "", routePath),
            handler: args[1]?.text ?? "",
            receiver,
            arguments: args.map((arg) => compact(arg.text)),
            middleware: [...(middleware.get(receiverKey) ?? []), ...args.slice(2).map((arg) => compact(arg.text))],
            ...(enclosingSymbol ? { enclosingSymbol } : {}),
            location: locationFor(filePath, call),
          });
        }
      }
    }
  }
  return {
    calls: calls.sort((left, right) => left.id.localeCompare(right.id)),
    routes: routes.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function countParseErrors(root: SyntaxNode): number {
  let count = 0;
  walk(root, (node) => {
    const missing = (node as unknown as { isMissing: boolean | (() => boolean) }).isMissing;
    if (node.type === "ERROR" || (typeof missing === "function" ? missing.call(node) : missing)) count += 1;
  });
  return count;
}

export function indexGoSource(source: string, filePath: string, options: { exportedOnly?: boolean } = {}): GoFileIndex {
  const tree = parser.parse(source);
  if (!tree) throw new Error(`Go parser returned no syntax tree for ${filePath}`);
  const root = tree.rootNode;
  const packageName = descendants(root, "package_identifier")[0]?.text ?? "unknown";
  const imports = extractImports(root);
  const relations = extractCallsAndRoutes(root, filePath, imports);
  return {
    path: filePath,
    package: packageName,
    imports,
    symbols: extractSymbols(root, filePath, packageName, options.exportedOnly ?? false),
    calls: relations.calls,
    routes: relations.routes,
    parseErrors: countParseErrors(root),
    lines: source.length === 0 ? 0 : source.split(/\r\n|\r|\n/u).length,
  };
}
