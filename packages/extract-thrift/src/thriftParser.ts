import { posix } from "node:path";
import { lexThrift, ThriftSyntaxError, type ThriftToken } from "./thriftLexer.js";

export interface ThriftLocator { path: string; line: number; column: number }
export interface ThriftImport { path: string; resolved_path: string; locator: ThriftLocator }
export interface ThriftType { kind: "typedef" | "enum" | "struct" | "union" | "exception"; name: string; locator: ThriftLocator }
export interface ThriftMethod { name: string; return_type: string; oneway: boolean; locator: ThriftLocator }
export interface ThriftService { name: string; extends: string | null; methods: ThriftMethod[]; locator: ThriftLocator }
export interface ThriftAnnotation { owner: string; name: string; locator: ThriftLocator }
export interface ThriftDocument {
  path: string;
  disposition: "analyzed" | "unsupported" | "excluded";
  imports: ThriftImport[];
  namespaces: Array<{ scope: string; name: string; locator: ThriftLocator }>;
  types: ThriftType[];
  services: ThriftService[];
  annotations: ThriftAnnotation[];
  diagnostic: string | null;
}

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function matching(tokens: readonly ThriftToken[], start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index]!.value === open) depth += 1;
    else if (tokens[index]!.value === close && --depth === 0) return index;
  }
  const token = tokens[start]!;
  throw new ThriftSyntaxError(`unclosed ${open}`, token.line, token.column);
}

function tokenText(tokens: readonly ThriftToken[]): string {
  return tokens.map((token) => token.value).join("");
}

function fieldTypeEnd(tokens: readonly ThriftToken[], start: number): number {
  const token = tokens[start];
  if (!token) throw new ThriftSyntaxError("field type is missing", 1, 1);
  if (!["map", "set", "list"].includes(token.value)) return start + 1;
  const open = tokens.findIndex((candidate, index) => index > start && candidate.value === "<");
  if (open < 0) throw new ThriftSyntaxError(`${token.value} type arguments are missing`, token.line, token.column);
  return matching(tokens, open, "<", ">") + 1;
}

function constValueEnd(tokens: readonly ThriftToken[], start: number): number {
  const token = tokens[start];
  if (!token) throw new ThriftSyntaxError("const value is missing", 1, 1);
  if (token.value === "[") return matching(tokens, start, "[", "]") + 1;
  if (token.value === "{") return matching(tokens, start, "{", "}") + 1;
  return start + 1;
}

function parseAnnotationGroup(
  owner: string,
  path: string,
  tokens: readonly ThriftToken[],
  open: number,
): { annotations: ThriftAnnotation[]; next: number } {
  const close = matching(tokens, open, "(", ")");
  const annotations: ThriftAnnotation[] = [];
  let depth = 0;
  for (let index = open + 1; index < close; index += 1) {
    const token = tokens[index]!;
    if (["(", "[", "{", "<"].includes(token.value)) depth += 1;
    else if ([")", "]", "}", ">"].includes(token.value)) depth -= 1;
    else if (depth === 0 && token.kind === "identifier" && tokens[index + 1]?.value === "=") {
      annotations.push({ owner, name: token.value, locator: { path, line: token.line, column: token.column } });
    }
  }
  return { annotations, next: close + 1 };
}

function parseMethods(path: string, serviceName: string, tokens: readonly ThriftToken[]): {
  methods: ThriftMethod[];
  annotations: ThriftAnnotation[];
} {
  const methods: ThriftMethod[] = [];
  const annotations: ThriftAnnotation[] = [];
  let index = 0;
  while (index < tokens.length) {
    if (tokens[index]!.value === "(" ) {
      index = matching(tokens, index, "(", ")") + 1;
      continue;
    }
    const open = tokens.findIndex((token, candidate) => candidate >= index && token.value === "(");
    if (open < 1) break;
    const nameToken = tokens[open - 1]!;
    if (nameToken.kind !== "identifier" || nameToken.value === "throws") {
      index = open + 1;
      continue;
    }
    let signatureStart = index;
    while (signatureStart < open && [",", ";"].includes(tokens[signatureStart]!.value)) signatureStart += 1;
    const prefix = tokens.slice(signatureStart, open - 1);
    const oneway = prefix[0]?.value === "oneway";
    const returnTokens = oneway ? prefix.slice(1) : prefix;
    if (returnTokens.length === 0) throw new ThriftSyntaxError("method return type is missing", nameToken.line, nameToken.column);
    methods.push({
      name: nameToken.value,
      return_type: tokenText(returnTokens),
      oneway,
      locator: { path, line: nameToken.line, column: nameToken.column },
    });
    index = matching(tokens, open, "(", ")") + 1;
    if (tokens[index]?.value === "throws" && tokens[index + 1]?.value === "(") {
      index = matching(tokens, index + 1, "(", ")") + 1;
    }
    if (tokens[index]?.value === "(") {
      const parsed = parseAnnotationGroup(`service:${serviceName}:method:${nameToken.value}`, path, tokens, index);
      annotations.push(...parsed.annotations);
      index = parsed.next;
    }
    while ([",", ";"].includes(tokens[index]?.value ?? "")) index += 1;
  }
  return { methods, annotations };
}

function resolveInclude(importer: string, target: string, files: ReadonlySet<string>): string {
  if (!portablePath(target)) throw new TypeError(`include ${target} escapes registered source scope`);
  const relative = posix.normalize(posix.join(posix.dirname(importer), target));
  const candidates = [relative, target];
  const resolved = candidates.find((candidate) => portablePath(candidate) && files.has(candidate));
  if (!resolved) throw new TypeError(`include ${target} is missing from registered source scope`);
  return resolved;
}

function emptyDocument(path: string, disposition: ThriftDocument["disposition"], diagnostic: string | null): ThriftDocument {
  return { path, disposition, imports: [], namespaces: [], types: [], services: [], annotations: [], diagnostic };
}

export function parseThriftSources(files: Readonly<Record<string, string>>): ThriftDocument[] {
  const paths = Object.keys(files).sort();
  const fileSet = new Set(paths);
  if (paths.some((path) => !portablePath(path))) throw new TypeError("Thrift source paths must be portable relative paths");
  return paths.map(
    // The dispatcher mirrors the finite top-level alternatives in the Apache Thrift grammar.
    // eslint-disable-next-line complexity
    (path) => {
    if (!path.endsWith(".thrift")) return emptyDocument(path, "excluded", null);
    try {
      const tokens = lexThrift(files[path]!);
      const document = emptyDocument(path, "analyzed", null);
      let index = 0;
      while (index < tokens.length) {
        const token = tokens[index]!;
        if ([",", ";"].includes(token.value)) { index += 1; continue; }
        if (token.value === "include") {
          const target = tokens[index + 1];
          if (target?.kind !== "string") throw new ThriftSyntaxError("include path is missing", token.line, token.column);
          document.imports.push({ path: target.value, resolved_path: resolveInclude(path, target.value, fileSet), locator: { path, line: token.line, column: token.column } });
          index += 2;
          continue;
        }
        if (token.value === "cpp_include") { index += 2; continue; }
        if (token.value === "namespace") {
          const scope = tokens[index + 1];
          const name = tokens[index + 2];
          if (!scope || !name) throw new ThriftSyntaxError("namespace is incomplete", token.line, token.column);
          document.namespaces.push({ scope: scope.value, name: name.value, locator: { path, line: token.line, column: token.column } });
          index += 3;
          continue;
        }
        if (["struct", "union", "exception", "enum"].includes(token.value)) {
          const name = tokens[index + 1];
          if (name?.kind !== "identifier") throw new ThriftSyntaxError(`${token.value} name is missing`, token.line, token.column);
          const open = tokens.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.value === "{");
          if (open < 0) throw new ThriftSyntaxError(`${token.value} body is missing`, token.line, token.column);
          document.types.push({ kind: token.value as ThriftType["kind"], name: name.value, locator: { path, line: name.line, column: name.column } });
          index = matching(tokens, open, "{", "}") + 1;
          if (tokens[index]?.value === "(") {
            const parsed = parseAnnotationGroup(`type:${name.value}`, path, tokens, index);
            document.annotations.push(...parsed.annotations);
            index = parsed.next;
          }
          continue;
        }
        if (token.value === "typedef") {
          const nameIndex = fieldTypeEnd(tokens, index + 1);
          const name = tokens[nameIndex];
          if (name?.kind !== "identifier") throw new ThriftSyntaxError("typedef name is missing", token.line, token.column);
          document.types.push({ kind: "typedef", name: name.value, locator: { path, line: name.line, column: name.column } });
          index = nameIndex + 1;
          if (tokens[index]?.value === "(") {
            const parsed = parseAnnotationGroup(`type:${name.value}`, path, tokens, index);
            document.annotations.push(...parsed.annotations);
            index = parsed.next;
          }
          while ([",", ";"].includes(tokens[index]?.value ?? "")) index += 1;
          continue;
        }
        if (token.value === "service") {
          const name = tokens[index + 1];
          if (name?.kind !== "identifier") throw new ThriftSyntaxError("service name is missing", token.line, token.column);
          let cursor = index + 2;
          let extended: string | null = null;
          if (tokens[cursor]?.value === "extends") {
            cursor += 1;
            extended = tokens[cursor]?.value ?? null;
            cursor += 1;
          }
          if (tokens[cursor]?.value !== "{") throw new ThriftSyntaxError("service body is missing", name.line, name.column);
          const close = matching(tokens, cursor, "{", "}");
          const parsedMethods = parseMethods(path, name.value, tokens.slice(cursor + 1, close));
          document.services.push({ name: name.value, extends: extended, methods: parsedMethods.methods, locator: { path, line: name.line, column: name.column } });
          document.annotations.push(...parsedMethods.annotations);
          index = close + 1;
          if (tokens[index]?.value === "(") {
            const parsed = parseAnnotationGroup(`service:${name.value}`, path, tokens, index);
            document.annotations.push(...parsed.annotations);
            index = parsed.next;
          }
          continue;
        }
        if (token.value === "const") {
          const nameIndex = fieldTypeEnd(tokens, index + 1);
          const equalsIndex = nameIndex + 1;
          if (tokens[nameIndex]?.kind !== "identifier" || tokens[equalsIndex]?.value !== "=") {
            throw new ThriftSyntaxError("const declaration is incomplete", token.line, token.column);
          }
          index = constValueEnd(tokens, equalsIndex + 1);
          while ([",", ";"].includes(tokens[index]?.value ?? "")) index += 1;
          continue;
        }
        throw new ThriftSyntaxError(`unsupported top-level construct ${token.value}`, token.line, token.column);
      }
      return document;
    } catch (error) {
      return emptyDocument(path, "unsupported", error instanceof Error ? error.message : String(error));
    }
    },
  );
}
