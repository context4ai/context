import type { ProtoDocument } from "@c4a/extract-proto";
import type { ThriftDocument } from "@c4a/extract-thrift";
import { posix } from "node:path";

/** Discover imports with the parser's lexer, not text matching: comments and
 * string contents are not imports. Only captured paths may be loaded. */
export async function loadRevisionProtocolDependencies(
  capability: string, loadedModule: Record<string, unknown>, initial: Record<string, string>,
  trackedPaths: readonly string[], readSource: (path: string) => Promise<string>,
): Promise<Record<string, string>> {
  const isProto = capability === "parser.proto";
  const exportName = isProto ? "lexProto" : "lexThrift";
  const lexer = loadedModule[exportName];
  if (typeof lexer !== "function") throw new TypeError(`${capability} package has no ${exportName}`);
  const lex = lexer as (text: string) => Array<{ kind: string; value: string }>;
  const tracked = new Set(trackedPaths);
  const texts = { ...initial };
  const queue = Object.keys(texts);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const path = queue[cursor]!;
    const tokens = lex(texts[path]!);
    let depth = 0;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (token.kind === "symbol" && token.value === "{") depth++;
      if (token.kind === "symbol" && token.value === "}") depth--;
      if (depth !== 0 || token.kind !== "identifier" || token.value !== (isProto ? "import" : "include")) continue;
      let target = tokens[index + 1];
      if (isProto && target?.kind === "identifier" && ["public", "weak", "option"].includes(target.value)) target = tokens[index + 2];
      if (target?.kind !== "string") continue; // The parser supplies the syntax diagnostic.
      const name = target.value;
      if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..")) {
        throw new TypeError(`Protocol import ${name} in ${path} escapes the captured source scope`);
      }
      const candidates = isProto ? [name] : [posix.join(posix.dirname(path), name), name];
      const dependency = candidates.find(candidate => tracked.has(candidate));
      if (!dependency) throw new TypeError(`Protocol import ${name} in ${path} is missing from the captured source scope`);
      if (!Object.hasOwn(texts, dependency)) {
        texts[dependency] = await readSource(dependency);
        queue.push(dependency);
      }
    }
  }
  return texts;
}

/** Parse only the supplied protocol files. No evidence-adapter invocation,
 * Provider receipt or persistent production attribution is required. */
export function revisionProtocolDeclarations(
  capability: string, loadedModule: Record<string, unknown>, texts: Record<string, string>,
  selectedPaths: readonly string[] = Object.keys(texts),
): Array<{ file: string; line: number; name: string; value: unknown }> {
  const exportName = capability === "parser.proto" ? "parseProtoSources" : "parseThriftSources";
  const parse = loadedModule[exportName];
  if (typeof parse !== "function") throw new TypeError(`${capability} package has no ${exportName}`);
  const documents = (parse as (files: Record<string, string>) => Array<ProtoDocument | ThriftDocument>)(texts);
  return documents.flatMap(document => {
    if (document.disposition !== "analyzed") {
      throw new TypeError(`Cannot regenerate ${document.path}: ${document.diagnostic ?? document.disposition}. Existing article unchanged.`);
    }
    if (!selectedPaths.includes(document.path)) return [];
    return [
      ...document.types.map(item => ({ file: document.path, line: item.locator.line,
        name: "qualified_name" in item ? item.qualified_name : item.name, value: item })),
      ...document.services.flatMap(service => service.methods.map(method => ({
        file: document.path, line: method.locator.line, name: `${service.name}.${method.name}`,
        value: { ...method, name: `${service.name}.${method.name}` },
      }))),
    ];
  });
}
