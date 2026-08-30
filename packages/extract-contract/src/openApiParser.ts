import { posix } from "node:path";
import { LineCounter, isNode, parseDocument, type Document } from "yaml";
import type {
  ContractDocumentCatalog,
  ContractEndpoint,
  ContractLocator,
  ContractOperation,
  ContractType,
} from "./contractTypes.js";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace", "query"]);

type JsonRecord = Record<string, unknown>;
interface ParsedYaml {
  path: string;
  source: string;
  lineCounter: LineCounter;
  document: Document;
  root: unknown;
  marker: boolean;
  parseError: string | null;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function empty(path: string): ContractDocumentCatalog {
  return { path, format: "excluded", version: null, disposition: "excluded", endpoints: [], operations: [], types: [], references: [], diagnostics: [] };
}

function pointerPath(pointer: string): string[] | null {
  if (pointer === "" || pointer === "#") return [];
  if (!pointer.startsWith("#/")) return null;
  try {
    return decodeURIComponent(pointer.slice(2)).split("/").map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
  } catch {
    return null;
  }
}

function valueAt(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const part of path) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(part)) return undefined;
      current = current[Number(part)];
      if (current === undefined) return undefined;
      continue;
    }
    const item = record(current);
    if (item === null || !(part in item)) return undefined;
    current = item[part];
  }
  return current;
}

function yamlLocator(parsed: ParsedYaml, path: readonly string[], qualifiedItemPath: string): ContractLocator {
  const yamlNode = parsed.document.getIn(path, true);
  const offset = isNode(yamlNode) && Array.isArray(yamlNode.range) ? yamlNode.range[0] : 0;
  const position = parsed.lineCounter.linePos(offset ?? 0);
  return { path: parsed.path, line: position.line, column: position.col, qualified_item_path: qualifiedItemPath };
}

function parseYaml(path: string, source: string): ParsedYaml {
  const marker = /(?:^|[,{\n]\s*)(?:openapi|swagger)\s*[:=]/iu.test(source) || /["'](?:openapi|swagger)["']\s*:/iu.test(source);
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter, strict: true, uniqueKeys: true });
  let root: unknown = null;
  let parseError = document.errors.map((error) => error.message).join("; ") || null;
  if (parseError === null) {
    try {
      root = document.toJS({ maxAliasCount: 100 });
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  return { path, source, lineCounter, document, root, marker, parseError };
}

function collectRefs(parsed: ParsedYaml): Array<{ raw: string; path: string[]; locator: ContractLocator; underBaseId: boolean }> {
  const refs: Array<{ raw: string; path: string[]; locator: ContractLocator; underBaseId: boolean }> = [];
  const visit = (value: unknown, path: string[], inheritedBaseId: boolean): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)], inheritedBaseId));
      return;
    }
    const item = record(value);
    if (item === null) return;
    const underBaseId = inheritedBaseId || typeof item.$id === "string";
    for (const [key, child] of Object.entries(item)) {
      const childPath = [...path, key];
      if ((key === "$ref" || key === "$dynamicRef") && typeof child === "string") {
        refs.push({ raw: child, path: childPath, locator: yamlLocator(parsed, childPath, `ref:${refs.length + 1}`), underBaseId });
      }
      visit(child, childPath, underBaseId);
    }
  };
  visit(parsed.root, [], false);
  return refs;
}

function schemaTypes(parsed: ParsedYaml, root: JsonRecord): ContractType[] {
  const candidates: Array<{ path: string[]; value: unknown }> = [];
  const components = record(root.components);
  const schemas = record(components?.schemas);
  const definitions = record(root.definitions);
  if (schemas !== null) candidates.push(...Object.entries(schemas).map(([name, value]) => ({ path: ["components", "schemas", name], value })));
  if (definitions !== null) candidates.push(...Object.entries(definitions).map(([name, value]) => ({ path: ["definitions", name], value })));
  return candidates.map(({ path, value }) => {
    const name = path.at(-1)!;
    const schema = record(value);
    return {
      type_ref: `${parsed.path}#/${path.join("/")}`,
      protocol: "openapi",
      kind: typeof schema?.type === "string" ? schema.type : "schema",
      name,
      extension: false,
      field_names: Object.keys(record(schema?.properties) ?? {}).sort(),
      locator: yamlLocator(parsed, path, `schema:${name}`),
    };
  });
}

function pathCatalog(parsed: ParsedYaml, root: JsonRecord, key: "paths" | "webhooks"): {
  endpoints: ContractEndpoint[];
  operations: ContractOperation[];
} {
  const endpoints: ContractEndpoint[] = [];
  const operations: ContractOperation[] = [];
  const paths = record(root[key]);
  if (paths === null) return { endpoints, operations };
  for (const [route, rawPathItem] of Object.entries(paths).sort(([left], [right]) => left.localeCompare(right))) {
    const pathItem = record(rawPathItem);
    if (pathItem === null) continue;
    const parent = key === "paths" ? route : `webhook:${route}`;
    endpoints.push({ endpoint_ref: `${parsed.path}#${key}:${route}`, protocol: "openapi", path_or_type: parent, locator: yamlLocator(parsed, [key, route], `endpoint:${parent}`) });
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const operation = record(rawOperation);
      if (operation === null) continue;
      const operationId = typeof operation.operationId === "string" ? operation.operationId : `${method.toLowerCase()} ${parent}`;
      operations.push({
        operation_ref: `${parsed.path}#${key}:${route}:${method.toLowerCase()}`,
        protocol: "openapi",
        operation_kind: key === "paths" ? method.toLowerCase() : `webhook-${method.toLowerCase()}`,
        name: operationId,
        parent,
        deprecated: operation.deprecated === true,
        locator: yamlLocator(parsed, [key, route, method], `operation:${method.toLowerCase()}:${parent}`),
      });
    }
  }
  return { endpoints, operations };
}

function refTarget(importer: string, raw: string): { targetPath: string; pointer: string; external: boolean } | null {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw) || raw.startsWith("/") || raw.includes("?")) return null;
  const [rawPath = "", fragment] = raw.split("#", 2);
  const pointer = fragment === undefined ? "" : `#${fragment}`;
  if (rawPath === "") return { targetPath: importer, pointer, external: false };
  if (!portablePath(rawPath)) return null;
  const targetPath = posix.normalize(posix.join(posix.dirname(importer), rawPath));
  return portablePath(targetPath) ? { targetPath, pointer, external: true } : null;
}

function cycleMembers(graph: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const cycles = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (file: string): void => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      stack.slice(start).forEach((member) => cycles.add(member));
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of graph.keys()) visit(file);
  return cycles;
}

function analyzeDocument(input: {
  parsed: ParsedYaml;
  primary: boolean;
  candidates: ReadonlyMap<string, ParsedYaml>;
  reachable: Set<string>;
  graph: Map<string, Set<string>>;
  queue: string[];
}): ContractDocumentCatalog {
  const { parsed } = input;
  const catalog = empty(parsed.path);
  catalog.format = input.primary ? "openapi" : "openapi-fragment";
  catalog.disposition = "analyzed";
  if (parsed.parseError !== null) {
    catalog.disposition = "unsupported";
    catalog.diagnostics.push({ code: "contract-source-unsupported", severity: "error", locator: { path: parsed.path, line: 1, column: 1, qualified_item_path: "file" }, detail: parsed.parseError });
    return catalog;
  }
  const root = record(parsed.root);
  if (input.primary && root === null) {
    catalog.disposition = "unsupported";
    catalog.diagnostics.push({ code: "contract-source-unsupported", severity: "error", locator: { path: parsed.path, line: 1, column: 1, qualified_item_path: "file" }, detail: "contract document root must be an object" });
    return catalog;
  }
  if (root !== null) {
    catalog.version = typeof root.openapi === "string" ? root.openapi : typeof root.swagger === "string" ? root.swagger : null;
    const pathFacts = pathCatalog(parsed, root, "paths");
    const webhookFacts = pathCatalog(parsed, root, "webhooks");
    catalog.endpoints.push(...pathFacts.endpoints, ...webhookFacts.endpoints);
    catalog.operations.push(...pathFacts.operations, ...webhookFacts.operations);
    catalog.types.push(...schemaTypes(parsed, root));
  }
  for (const ref of collectRefs(parsed)) {
    if (ref.underBaseId && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(ref.raw) && !ref.raw.startsWith("#")) {
      catalog.disposition = "unsupported";
      catalog.diagnostics.push({ code: "openapi-ref-base-uri-unsupported", severity: "error", locator: ref.locator, detail: `relative ref under $id requires an explicit registered URI mapping: ${ref.raw}` });
      continue;
    }
    const target = refTarget(parsed.path, ref.raw);
    if (target === null) {
      catalog.disposition = "unsupported";
      catalog.diagnostics.push({ code: "openapi-ref-out-of-scope", severity: "error", locator: ref.locator, detail: `reference leaves registered source scope: ${ref.raw}` });
      continue;
    }
    const targetDocument = input.candidates.get(target.targetPath);
    if (targetDocument === undefined) {
      catalog.disposition = "unsupported";
      catalog.diagnostics.push({ code: "openapi-ref-missing", severity: "error", locator: ref.locator, detail: `reference target is not registered: ${target.targetPath}` });
      continue;
    }
    if (target.external) {
      const edges = input.graph.get(parsed.path) ?? new Set<string>();
      edges.add(target.targetPath);
      input.graph.set(parsed.path, edges);
      if (!input.reachable.has(target.targetPath)) {
        input.reachable.add(target.targetPath);
        input.queue.push(target.targetPath);
      }
    }
    const segments = pointerPath(target.pointer);
    if (segments === null || targetDocument.parseError !== null || valueAt(targetDocument.root, segments) === undefined) {
      catalog.disposition = "unsupported";
      catalog.diagnostics.push({ code: "openapi-ref-pointer-missing", severity: "error", locator: ref.locator, detail: `reference pointer is missing: ${target.targetPath}${target.pointer}` });
      continue;
    }
    catalog.references.push({
      reference_ref: `${parsed.path}#ref:${catalog.references.length + 1}`,
      protocol: "openapi",
      target_path: target.targetPath,
      target_item_path: segments.length === 0 ? "root" : segments.join("/"),
      locator: ref.locator,
    });
  }
  return catalog;
}

export function parseOpenApiSources(files: Readonly<Record<string, string>>): Map<string, ContractDocumentCatalog> {
  const candidates = new Map<string, ParsedYaml>();
  for (const [path, source] of Object.entries(files)) {
    if (/\.(?:json|ya?ml)$/iu.test(path)) candidates.set(path, parseYaml(path, source));
  }
  const roots = [...candidates.values()].filter((item) => record(item.root)?.openapi !== undefined || record(item.root)?.swagger !== undefined || (item.marker && item.parseError !== null));
  const rootPaths = new Set(roots.map((item) => item.path));
  const reachable = new Set(rootPaths);
  const graph = new Map<string, Set<string>>();
  const catalogs = new Map<string, ContractDocumentCatalog>();
  const queue = [...reachable];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const parsed = candidates.get(path)!;
    catalogs.set(path, analyzeDocument({ parsed, primary: rootPaths.has(path), candidates, reachable, graph, queue }));
  }
  const cycles = cycleMembers(graph);
  for (const path of cycles) {
    const catalog = catalogs.get(path);
    if (catalog === undefined) continue;
    catalog.disposition = "unsupported";
    catalog.diagnostics.push({ code: "openapi-external-ref-cycle", severity: "error", locator: { path, line: 1, column: 1, qualified_item_path: "file" }, detail: "external reference graph contains a cycle" });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [path, targets] of graph) {
      const catalog = catalogs.get(path);
      if (catalog === undefined || catalog.disposition === "unsupported") continue;
      const unsupportedTarget = [...targets].find((target) => catalogs.get(target)?.disposition === "unsupported");
      if (unsupportedTarget === undefined) continue;
      catalog.disposition = "unsupported";
      catalog.diagnostics.push({
        code: "openapi-ref-target-unsupported",
        severity: "error",
        locator: { path, line: 1, column: 1, qualified_item_path: "file" },
        detail: `external reference target is unsupported: ${unsupportedTarget}`,
      });
      changed = true;
    }
  }
  for (const path of candidates.keys()) if (!catalogs.has(path)) catalogs.set(path, empty(path));
  return catalogs;
}
