import ts from "typescript";
import { SymbolKind, Visibility } from "@c4a/core";
import type { SymbolInfo } from "@c4a/extract";

/** Only statically registered receivers from supported imported factories.
 * Names such as service/client/router alone never imply an inbound API. */
export function runtimeRegistrations(source: ts.SourceFile): SymbolInfo[] {
  const imports = new Map<string, string>();
  const receivers = new Map<string, string>();
  const middleware = new Map<string, string[]>();
  const result: SymbolInfo[] = [];
  const supported = new Set(["express", "fastify", "hono", "node-cron", "node:events", "events"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (!supported.has(module)) continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) imports.set(clause.name.text, module);
    if (clause?.namedBindings !== undefined) {
      if (ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, module);
      else for (const item of clause.namedBindings.elements) imports.set(item.name.text, module);
    }
  }
  const rootName = (node: ts.Expression): string | undefined => ts.isIdentifier(node) ? node.text
    : ts.isPropertyAccessExpression(node) ? rootName(node.expression) : undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined &&
      (ts.isCallExpression(node.initializer) || ts.isNewExpression(node.initializer))) {
      const root = rootName(node.initializer.expression);
      const module = root === undefined ? undefined : imports.get(root);
      if (module !== undefined) receivers.set(node.name.text, module);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression.getText(source);
      const module = receivers.get(receiver) ?? imports.get(receiver);
      const operation = node.expression.name.text;
      if (module !== undefined) {
        const args = node.arguments;
        const http = ["express", "fastify", "hono"].includes(module);
        if (http && operation === "use") {
          // A mounted subrouter is retained as an expression; no guessed path
          // concatenation or dynamic middleware evaluation.
          middleware.set(receiver, [...(middleware.get(receiver) ?? []), ...args.map((arg) => arg.getText(source))]);
        }
        const kind = http && ["get", "post", "put", "patch", "delete", "head", "options", "all"].includes(operation)
          ? "http" : module === "node-cron" && operation === "schedule" ? "schedule"
          : ["events", "node:events"].includes(module) && ["on", "once"].includes(operation) ? "event" : undefined;
        const first = args[0];
        if (kind !== undefined && first !== undefined && ts.isStringLiteralLike(first) && args.length >= 2) {
          const handler = args.at(-1)!.getText(source);
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          result.push({ name: `${kind === "http" ? operation.toUpperCase() : kind} ${first.text}`,
            kind: kind === "http" ? SymbolKind.Endpoint : SymbolKind.Process,
            visibility: Visibility.Exported, file: source.fileName.replace(/^\//u, ""),
            line, endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
            signature: `${operation} ${first.text} → ${handler}`,
            registration: { kind, key: first.text, handler,
              ...(kind === "http" ? { method: operation.toUpperCase() } : {}),
              middleware: [...(middleware.get(receiver) ?? []), ...args.slice(1, -1).map((arg) => arg.getText(source))] },
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
