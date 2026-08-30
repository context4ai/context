import { posix } from "node:path";
import { lexProto, ProtoSyntaxError, type ProtoToken } from "./protoLexer.js";

export interface ProtoLocator { path: string; line: number; column: number }
export interface ProtoImport { path: string; resolved_path: string; modifier: "normal" | "public" | "weak" | "option"; locator: ProtoLocator }
export interface ProtoOption { owner: string; name: string; locator: ProtoLocator }
export interface ProtoType { kind: "message" | "enum"; name: string; qualified_name: string; locator: ProtoLocator }
export interface ProtoMethod { name: string; input_type: string; output_type: string; client_streaming: boolean; server_streaming: boolean; locator: ProtoLocator }
export interface ProtoService { name: string; methods: ProtoMethod[]; locator: ProtoLocator }
export interface ProtoDocument {
  path: string;
  disposition: "analyzed" | "unsupported" | "excluded";
  syntax: string | null;
  package: string | null;
  imports: ProtoImport[];
  options: ProtoOption[];
  types: ProtoType[];
  services: ProtoService[];
  diagnostic: string | null;
}

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function matching(tokens: readonly ProtoToken[], start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index]!.value === open) depth += 1;
    else if (tokens[index]!.value === close && --depth === 0) return index;
  }
  const token = tokens[start]!;
  throw new ProtoSyntaxError(`unclosed ${open}`, token.line, token.column);
}

function joined(tokens: readonly ProtoToken[]): string {
  return tokens.map((token) => token.value).join("");
}

function resolveImport(target: string, roots: readonly string[], files: ReadonlySet<string>): string {
  if (!portablePath(target)) throw new TypeError(`import ${target} escapes registered source scope`);
  for (const root of roots) {
    if (root !== "" && !portablePath(root)) throw new TypeError(`invalid Proto import root ${root}`);
    const candidate = root === "" ? target : posix.join(root, target);
    if (portablePath(candidate) && files.has(candidate)) return candidate;
  }
  throw new TypeError(`import ${target} is missing from registered source scope`);
}

class ProtoDocumentParser {
  private index = 0;
  private readonly document: ProtoDocument;

  constructor(
    private readonly path: string,
    private readonly tokens: readonly ProtoToken[],
    private readonly roots: readonly string[],
    private readonly files: ReadonlySet<string>,
  ) {
    this.document = { path, disposition: "analyzed", syntax: null, package: null, imports: [], options: [], types: [], services: [], diagnostic: null };
  }

  parse(): ProtoDocument {
    while (this.index < this.tokens.length) this.parseTopLevel();
    return this.document;
  }

  private token(offset = 0): ProtoToken | undefined { return this.tokens[this.index + offset]; }
  private take(value?: string): ProtoToken {
    const token = this.token();
    if (!token || (value !== undefined && token.value !== value)) {
      const anchor = token ?? this.tokens.at(-1) ?? { line: 1, column: 1 };
      throw new ProtoSyntaxError(`expected ${value ?? "token"}`, anchor.line, anchor.column);
    }
    this.index += 1;
    return token;
  }
  private identifier(label: string): ProtoToken {
    const token = this.take();
    if (token.kind !== "identifier") throw new ProtoSyntaxError(`${label} is missing`, token.line, token.column);
    return token;
  }
  private throughSemicolon(): ProtoToken[] {
    const start = this.index;
    const depths: Record<string, number> = { "(": 0, "[": 0, "{": 0, "<": 0 };
    const closes: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };
    while (this.index < this.tokens.length) {
      const value = this.take().value;
      if (value in depths) depths[value] = (depths[value] ?? 0) + 1;
      else if (value in closes) depths[closes[value]!] = (depths[closes[value]!] ?? 0) - 1;
      if (value === ";" && Object.values(depths).every((depth) => depth === 0)) return this.tokens.slice(start, this.index - 1);
    }
    const anchor = this.tokens[start] ?? { line: 1, column: 1 };
    throw new ProtoSyntaxError("statement is missing semicolon", anchor.line, anchor.column);
  }

  private parseTopLevel(): void {
    const token = this.token()!;
    if (token.value === ";") { this.index += 1; return; }
    if (token.value === "syntax" || token.value === "edition") {
      const keyword = this.take().value;
      this.take("=");
      const value = this.take();
      if (value.kind !== "string") throw new ProtoSyntaxError(`${keyword} value must be a string`, value.line, value.column);
      this.document.syntax = keyword === "edition" ? `edition:${value.value}` : value.value;
      this.take(";");
      return;
    }
    if (token.value === "package") {
      this.take();
      this.document.package = joined(this.throughSemicolon());
      return;
    }
    if (token.value === "import") { this.parseImport(); return; }
    if (token.value === "option") { this.parseOption("file"); return; }
    if (token.value === "message" || token.value === "enum") { this.parseType(""); return; }
    if (token.value === "service") { this.parseService(); return; }
    if (token.value === "extend") { this.skipDeclaration(); return; }
    throw new ProtoSyntaxError(`unsupported top-level construct ${token.value}`, token.line, token.column);
  }

  private parseImport(): void {
    const keyword = this.take("import");
    let modifier: ProtoImport["modifier"] = "normal";
    if (["public", "weak", "option"].includes(this.token()?.value ?? "")) modifier = this.take().value as ProtoImport["modifier"];
    const target = this.take();
    if (target.kind !== "string") throw new ProtoSyntaxError("import path is missing", keyword.line, keyword.column);
    this.take(";");
    this.document.imports.push({ path: target.value, resolved_path: resolveImport(target.value, this.roots, this.files), modifier, locator: { path: this.path, line: keyword.line, column: keyword.column } });
  }

  private parseOption(owner: string): void {
    const keyword = this.take("option");
    const nameStart = this.index;
    while (this.token() && this.token()!.value !== "=") this.index += 1;
    this.take("=");
    const name = joined(this.tokens.slice(nameStart, this.index - 1));
    this.throughSemicolon();
    if (!name) throw new ProtoSyntaxError("option name is missing", keyword.line, keyword.column);
    this.document.options.push({ owner, name, locator: { path: this.path, line: keyword.line, column: keyword.column } });
  }

  private parseType(prefix: string): void {
    const kind = this.take().value as ProtoType["kind"];
    const name = this.identifier(`${kind} name`);
    const qualifiedName = prefix ? `${prefix}.${name.value}` : name.value;
    this.document.types.push({ kind, name: name.value, qualified_name: qualifiedName, locator: { path: this.path, line: name.line, column: name.column } });
    this.take("{");
    while (this.token() && this.token()!.value !== "}") {
      if (this.token()!.value === ";") { this.index += 1; continue; }
      if (this.token()!.value === "message" || this.token()!.value === "enum") { this.parseType(qualifiedName); continue; }
      if (this.token()!.value === "option") { this.parseOption(`type:${qualifiedName}`); continue; }
      this.skipDeclaration();
    }
    this.take("}");
  }

  private parseService(): void {
    this.take("service");
    const name = this.identifier("service name");
    const service: ProtoService = { name: name.value, methods: [], locator: { path: this.path, line: name.line, column: name.column } };
    this.take("{");
    while (this.token() && this.token()!.value !== "}") {
      if (this.token()!.value === ";") { this.index += 1; continue; }
      if (this.token()!.value === "option") { this.parseOption(`service:${name.value}`); continue; }
      if (this.token()!.value !== "rpc") throw new ProtoSyntaxError(`unsupported service construct ${this.token()!.value}`, this.token()!.line, this.token()!.column);
      service.methods.push(this.parseRpc());
    }
    this.take("}");
    this.document.services.push(service);
  }

  private parseRpc(): ProtoMethod {
    this.take("rpc");
    const name = this.identifier("rpc name");
    this.take("(");
    const clientStreaming = this.token()?.value === "stream" && Boolean(this.take());
    const inputStart = this.index;
    while (this.token() && this.token()!.value !== ")") this.index += 1;
    const inputType = joined(this.tokens.slice(inputStart, this.index));
    this.take(")");
    this.take("returns");
    this.take("(");
    const serverStreaming = this.token()?.value === "stream" && Boolean(this.take());
    const outputStart = this.index;
    while (this.token() && this.token()!.value !== ")") this.index += 1;
    const outputType = joined(this.tokens.slice(outputStart, this.index));
    this.take(")");
    if (!inputType || !outputType) throw new ProtoSyntaxError("rpc input or output type is missing", name.line, name.column);
    if (this.token()?.value === ";") this.index += 1;
    else if (this.token()?.value === "{") {
      this.take("{");
      while (this.token() && this.token()!.value !== "}") {
        if (this.token()!.value === "option") this.parseOption(`rpc:${name.value}`);
        else this.skipDeclaration();
      }
      this.take("}");
    } else throw new ProtoSyntaxError("rpc terminator is missing", name.line, name.column);
    return { name: name.value, input_type: inputType, output_type: outputType, client_streaming: clientStreaming, server_streaming: serverStreaming, locator: { path: this.path, line: name.line, column: name.column } };
  }

  private skipDeclaration(): void {
    const start = this.index;
    while (this.token() && this.token()!.value !== ";" && this.token()!.value !== "{") this.index += 1;
    if (!this.token()) {
      const anchor = this.tokens[start] ?? { line: 1, column: 1 };
      throw new ProtoSyntaxError("declaration is incomplete", anchor.line, anchor.column);
    }
    if (this.token()!.value === ";") { this.index += 1; return; }
    const close = matching(this.tokens, this.index, "{", "}");
    this.index = close + 1;
    if (this.token()?.value === ";") this.index += 1;
  }
}

function emptyDocument(path: string, disposition: ProtoDocument["disposition"], diagnostic: string | null): ProtoDocument {
  return { path, disposition, syntax: null, package: null, imports: [], options: [], types: [], services: [], diagnostic };
}

export function parseProtoSources(
  files: Readonly<Record<string, string>>,
  options: { import_roots?: readonly string[] } = {},
): ProtoDocument[] {
  const paths = Object.keys(files).sort();
  if (paths.some((path) => !portablePath(path))) throw new TypeError("Proto source paths must be portable relative paths");
  const fileSet = new Set(paths);
  const roots = options.import_roots ?? [""];
  return paths.map((path) => {
    if (!path.endsWith(".proto")) return emptyDocument(path, "excluded", null);
    try {
      return new ProtoDocumentParser(path, lexProto(files[path]!), roots, fileSet).parse();
    } catch (error) {
      return emptyDocument(path, "unsupported", error instanceof Error ? error.message : String(error));
    }
  });
}
