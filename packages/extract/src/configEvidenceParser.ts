import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import { getStaticTOMLValue, parseTOML, type AST as TOMLAST } from "toml-eslint-parser";
import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  parseDocument,
  type Document,
  type ParsedNode,
} from "yaml";
import type {
  ConfigAllowlistedScalar,
  ConfigBoundaryCandidate,
  ConfigDiagnostic,
  ConfigDocumentCatalog,
  ConfigFormat,
  ConfigLocator,
  ConfigParseOptions,
  ConfigScalarAllowlistEntry,
  ConfigValueClassification,
  ConfigValueFact,
  ConfigValueType,
} from "./configEvidenceTypes.js";

const SECRET_TOKEN = /^(?:password|passwd|pwd|secret|token|credential|credentials|authorization|cookie)$/u;
const SECRET_COMPOUND = /^(?:api-key|access-key|private-key|client-secret|access-token|refresh-token)$/u;
const SECRET_VALUE = /^(?:[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@)|[?&](?:access_token|refresh_token|api_key|password|secret)=/iu;
const REFERENCE_KEY = /(?:path|file|url|uri|endpoint|module|package|import|include|extends|schema|ref)$/iu;
const REFERENCE_VALUE = /^(?:[a-z][a-z0-9+.-]*:\/\/|\.\.?(?:\/|$)|[~@]?[a-z0-9_.-]+\/[a-z0-9_./-]+|[a-z0-9_.-]+\.(?:json|ya?ml|toml|js|mjs|cjs|ts|tsx|css|scss))$/iu;
const BOUNDARY_PATTERNS: ReadonlyArray<readonly [ConfigBoundaryCandidate, RegExp]> = [
  ["entry", /^(?:entry|entries|main|bootstrap|startup)$/iu],
  ["route", /^(?:route|routes|router|routing|path)$/iu],
  ["build", /^(?:build|bundle|bundler|compiler|compile|output|outdir|target)$/iu],
  ["protocol", /^(?:protocol|schema|schemas|api|rpc|openapi|graphql|protobuf|thrift)$/iu],
  ["runtime", /^(?:runtime|host|port|server|environment|env|command|args)$/iu],
  ["dependency", /^(?:dependencies|dependency|imports|includes|extends|plugins)$/iu],
];

interface Location {
  line: number;
  column: number;
}

interface ParseContext {
  path: string;
  format: Exclude<ConfigFormat, "excluded">;
  configRef: string;
  allowlist: ReadonlyMap<string, ConfigScalarAllowlistEntry>;
  diagnostics: ConfigDiagnostic[];
  values: ConfigValueFact[];
}

function pathIdentity(path: readonly string[]): string {
  return JSON.stringify(path);
}

function qualifiedItemPath(path: readonly string[]): string {
  if (path.length === 0) return "config:/";
  return `config:/${path.map((segment) => segment.replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/")}`;
}

function locator(filePath: string, keyPath: readonly string[], location: Location): ConfigLocator {
  return {
    path: filePath,
    line: Math.max(1, location.line),
    column: Math.max(1, location.column),
    qualified_item_path: qualifiedItemPath(keyPath),
  };
}

function normalizedKeySegment(segment: string): string {
  return segment.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").replace(/[^A-Za-z0-9]+/gu, "-").toLowerCase();
}

function secretLike(keyPath: readonly string[], value?: unknown): boolean {
  const keySecret = keyPath.some((segment) => {
    const normalized = normalizedKeySegment(segment);
    return SECRET_COMPOUND.test(normalized) || normalized.split("-").some((token) => SECRET_TOKEN.test(token));
  });
  return keySecret || (typeof value === "string" && SECRET_VALUE.test(value));
}

function boundaryCandidate(keyPath: readonly string[]): ConfigBoundaryCandidate | null {
  for (let index = keyPath.length - 1; index >= 0; index -= 1) {
    const segment = keyPath[index]!;
    for (const [candidate, pattern] of BOUNDARY_PATTERNS) {
      if (pattern.test(segment)) return candidate;
    }
  }
  return null;
}

function valueType(value: unknown): ConfigValueType {
  if (value === null) return "null";
  if (value instanceof Date) return "datetime";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  return "number";
}

function digestableScalar(value: unknown): unknown {
  if (typeof value === "bigint") return { integer: value.toString() };
  if (value instanceof Date) return { datetime: value.toISOString() };
  return value;
}

function allowlistedScalar(value: unknown): ConfigAllowlistedScalar | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  return undefined;
}

function scalarEqual(left: ConfigAllowlistedScalar, right: ConfigAllowlistedScalar): boolean {
  return Object.is(left, right);
}

function classify(
  keyPath: readonly string[],
  value: unknown,
  isContainer: boolean,
  isSecret: boolean,
  exposed: boolean,
): ConfigValueClassification {
  if (isContainer) return "container";
  if (isSecret) return "secret-like";
  if (exposed) return "enum-allowlisted";
  const finalKey = keyPath.at(-1) ?? "";
  if (typeof value === "string" && (REFERENCE_KEY.test(finalKey) || REFERENCE_VALUE.test(value))) {
    return "reference-like";
  }
  return "scalar";
}

function addValue(context: ParseContext, keyPath: string[], value: unknown, location: Location): void {
  const type = valueType(value);
  const isContainer = type === "object" || type === "array";
  const allowlist = context.allowlist.get(pathIdentity(keyPath));
  const scalar = allowlistedScalar(value);
  const isSecret = secretLike(keyPath, value);
  const exposed = !isSecret && scalar !== undefined && allowlist !== undefined &&
    allowlist.allowed_values.some((allowed) => scalarEqual(allowed, scalar));
  if (allowlist && scalar !== undefined && !exposed && !isSecret) {
    context.diagnostics.push({
      code: "config-enum-value-not-allowlisted",
      severity: "warning",
      locator: locator(context.path, keyPath, location),
      detail: "configured enum allowlist does not include the parsed scalar",
    });
  }
  const classification = classify(keyPath, value, isContainer, isSecret, exposed);
  const digestSafe = !(typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))));
  context.values.push({
    config_ref: context.configRef,
    key_path: keyPath,
    value_type: type,
    classification,
    boundary_candidate: boundaryCandidate(keyPath),
    value_digest: isContainer || classification === "secret-like" || !digestSafe
      ? null
      : indexerEvidenceAdapterProtocolDigest({ type, value: digestableScalar(value) }),
    ...(exposed ? { normalized_value: scalar } : {}),
    locator: locator(context.path, keyPath, location),
  });
}

function walkValue(
  context: ParseContext,
  value: unknown,
  keyPath: string[],
  locate: (path: readonly string[]) => Location,
): void {
  addValue(context, keyPath, value, locate(keyPath));
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkValue(context, item, [...keyPath, String(index)], locate));
    return;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      walkValue(context, item, [...keyPath, key], locate);
    }
  }
}

function validateYamlKeys(node: ParsedNode | null | undefined): void {
  if (!node) return;
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        throw new TypeError("YAML mapping keys must be scalar strings");
      }
      validateYamlKeys(pair.value as ParsedNode | null);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) validateYamlKeys(item as ParsedNode | null);
  }
}

function yamlLocation(
  document: Document.Parsed,
  lineCounter: LineCounter,
  logicalPath: readonly string[],
  documentPrefixLength: number,
): Location {
  const yamlPath = logicalPath.slice(documentPrefixLength).map((segment) => /^\d+$/u.test(segment) ? Number(segment) : segment);
  const node = document.getIn(yamlPath, true) as ParsedNode | undefined;
  const offset = node?.range?.[0] ?? document.contents?.range?.[0] ?? 0;
  const position = lineCounter.linePos(offset);
  return { line: position.line, column: position.col };
}

function parseYamlLike(
  context: ParseContext,
  source: string,
  strictJson: boolean,
): void {
  if (strictJson) JSON.parse(source);
  const lineCounter = new LineCounter();
  const documents = strictJson
    ? [parseDocument(source, { lineCounter, schema: "json", strict: true, uniqueKeys: true })]
    : parseAllDocuments(source, { lineCounter, strict: true, uniqueKeys: true });
  if (documents.length === 0) throw new TypeError("configuration document is empty");
  for (const [documentIndex, document] of documents.entries()) {
    if (document.errors.length > 0) throw new TypeError("configuration syntax is invalid");
    validateYamlKeys(document.contents);
    const value = document.toJS({ maxAliasCount: 100 }) as unknown;
    const prefix = documents.length > 1 ? ["$document", String(documentIndex)] : [];
    walkValue(context, value, prefix, (path) => yamlLocation(document, lineCounter, path, prefix.length));
  }
}

function tomlKey(node: TOMLAST.TOMLKey): string[] {
  return node.keys.map((item) => item.type === "TOMLBare" ? item.name : item.value);
}

function tomlLocations(ast: TOMLAST.TOMLProgram): Map<string, Location> {
  const locations = new Map<string, Location>();
  const remember = (path: readonly string[], node: TOMLAST.TOMLNode): void => {
    locations.set(pathIdentity(path), { line: node.loc.start.line, column: node.loc.start.column + 1 });
  };
  const walkContent = (node: TOMLAST.TOMLContentNode, path: string[]): void => {
    remember(path, node);
    if (node.type === "TOMLArray") {
      node.elements.forEach((element, index) => walkContent(element, [...path, String(index)]));
    } else if (node.type === "TOMLInlineTable") {
      for (const item of node.body) {
        const itemPath = [...path, ...tomlKey(item.key)];
        remember(itemPath, item.key);
        walkContent(item.value, itemPath);
      }
    }
  };
  remember([], ast);
  for (const item of ast.body[0].body) {
    if (item.type === "TOMLKeyValue") {
      const itemPath = tomlKey(item.key);
      remember(itemPath, item.key);
      walkContent(item.value, itemPath);
      continue;
    }
    const tablePath = item.resolvedKey.map(String);
    remember(tablePath, item.key);
    for (const entry of item.body) {
      const entryPath = [...tablePath, ...tomlKey(entry.key)];
      remember(entryPath, entry.key);
      walkContent(entry.value, entryPath);
    }
  }
  return locations;
}

function parseToml(context: ParseContext, source: string): void {
  const ast = parseTOML(source, { tomlVersion: "1.0.0" });
  const value = getStaticTOMLValue(ast) as unknown;
  const locations = tomlLocations(ast);
  walkValue(context, value, [], (path) => locations.get(pathIdentity(path)) ?? { line: 1, column: 1 });
}

function detectFormat(path: string): ConfigFormat {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".toml")) return "toml";
  return "excluded";
}

function validatePath(path: string): void {
  const segments = path.split("/");
  if (!path || path.includes("\\") || path.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new TypeError(`config path must be a portable relative path: ${path}`);
  }
}

function validatedAllowlists(options: ConfigParseOptions): Map<string, Map<string, ConfigScalarAllowlistEntry>> {
  const byFile = new Map<string, Map<string, ConfigScalarAllowlistEntry>>();
  for (const entry of options.non_sensitive_enums ?? []) {
    validatePath(entry.path);
    if (entry.key_path.length === 0) throw new TypeError("config enum allowlist cannot target the document root");
    if (secretLike(entry.key_path)) throw new TypeError("config enum allowlist cannot target a secret-like key path");
    if (entry.allowed_values.length === 0) throw new TypeError("config enum allowlist must declare at least one value");
    const identities = entry.allowed_values.map((value) => JSON.stringify([typeof value, value]));
    if (new Set(identities).size !== identities.length) throw new TypeError("config enum allowlist contains duplicate values");
    const fileEntries = byFile.get(entry.path) ?? new Map<string, ConfigScalarAllowlistEntry>();
    const identity = pathIdentity(entry.key_path);
    if (fileEntries.has(identity)) throw new TypeError("config enum allowlist contains a duplicate file and key path");
    fileEntries.set(identity, entry);
    byFile.set(entry.path, fileEntries);
  }
  return byFile;
}

function parseOne(path: string, source: string, format: ConfigFormat, allowlist: ReadonlyMap<string, ConfigScalarAllowlistEntry>): ConfigDocumentCatalog {
  if (format === "excluded") return { path, format, disposition: "excluded", values: [], diagnostics: [] };
  const context: ParseContext = {
    path,
    format,
    configRef: `config:${indexerEvidenceAdapterProtocolDigest({ path, format })}`,
    allowlist,
    diagnostics: [],
    values: [],
  };
  try {
    if (format === "toml") parseToml(context, source);
    else parseYamlLike(context, source, format === "json");
    return { path, format, disposition: "analyzed", values: context.values, diagnostics: context.diagnostics };
  } catch {
    const root = locator(path, [], { line: 1, column: 1 });
    return {
      path,
      format,
      disposition: "unsupported",
      values: [],
      diagnostics: [{ code: "config-source-unsupported", severity: "error", locator: root, detail: `${format} configuration could not be analyzed` }],
    };
  }
}

export function parseConfigSources(
  files: Readonly<Record<string, string>>,
  options: ConfigParseOptions = {},
): ConfigDocumentCatalog[] {
  const allowlists = validatedAllowlists(options);
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, source]) => {
      validatePath(path);
      return parseOne(path, source, detectFormat(path), allowlists.get(path) ?? new Map());
    });
}
