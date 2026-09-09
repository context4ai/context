import type { IndexerAuthorizedWorksetView } from "@c4a/context";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

// Only known parser payload shapes are projected. An extension using the same
// kind with additional fields remains intact; this is not a prose quality filter.
const PAYLOAD_FIELDS: Record<string, readonly string[]> = {
  "code-symbol": ["name", "kind", "visibility", "file", "line", "endLine", "members", "params",
    "returnType", "typeAnnotation", "extends", "implements", "doc", "propsType", "unionValues", "initializer", "signature"],
  "code-relation": ["type", "from", "to", "file", "isExternal", "grounding", "confidence", "source", "line"],
  "config-value": ["config_ref", "key_path", "value_type", "classification", "boundary_candidate", "value_digest", "normalized_value", "locator"],
  "source-file": ["path", "language", "lines", "line", "endLine"],
  "source-loc": ["lines"],
};

/** Replace redundant parser records with navigation ONLY when the matching
 * captured source can actually be read. Canonical Views and submission aliases
 * stay unchanged. No additional registry, gate or persistent audit is involved. */
export function projectIndexerAuthorFactReading(view: IndexerAuthorizedWorksetView) {
  const readable = new Map<string, { path: string; source_ref: string; module_ref: unknown;
    read_path?: string; ranges: { start_line: number; end_line: number }[];
    symbols: Record<string, unknown>[]; dependencies: Record<string, unknown>[] }>();
  const keyOf = (source: unknown, module: unknown, path: unknown) => JSON.stringify([source, module, path]);
  for (const item of view.items) {
    if (item.category !== "source-text") continue;
    const value = record(item.value);
    if (typeof value.path !== "string" || typeof value.source_ref !== "string") continue;
    const ranges = Array.isArray(value.spans) ? value.spans.flatMap((span) => {
      const range = record(span);
      return typeof range.text === "string" && typeof range.start_line === "number" && typeof range.end_line === "number"
        ? [{ start_line: range.start_line, end_line: range.end_line }] : [];
    }) : [];
    readable.set(keyOf(value.source_ref, value.module_ref, value.path), {
      path: value.path, source_ref: value.source_ref, module_ref: value.module_ref, ranges,
      ...(typeof value.read_path === "string" && value.read_path.length > 0 ? { read_path: value.read_path } : {}),
      symbols: [], dependencies: [],
    });
  }
  const omitted = new Set<string>();
  for (const item of view.items) {
    if (item.category !== "fact") continue;
    const fact = record(item.value);
    const fields = Object.hasOwn(PAYLOAD_FIELDS, String(fact.kind)) ? PAYLOAD_FIELDS[String(fact.kind)] : undefined;
    const payload = record(fact.payload);
    if (fields === undefined || Object.keys(payload).length === 0 ||
        Object.keys(payload).some((key) => !fields.includes(key))) continue;
    const locator = record(fact.locator);
    const file = readable.get(keyOf(locator.source_ref, locator.module_ref, locator.normalized_path));
    if (file === undefined) continue;
    const start = payload.line;
    const end = payload.endLine ?? start;
    const inlineCovered = typeof start === "number" && typeof end === "number" && file.ranges.some((range) =>
      range.start_line <= start && range.end_line >= end);
    // A call line alone or a config hash is not a replacement for complete
    // source access. Older partial Views without a read path keep their facts.
    if (file.read_path === undefined && !(fact.kind === "code-symbol" && inlineCovered)) continue;
    if (fact.kind === "code-symbol") {
      // A readable local declaration does not replace inherited members or
      // extracted parameter/default documentation. Keep those facts intact.
      if (["members", "params"].some(key => Array.isArray(payload[key]) && (payload[key] as unknown[]).length > 0) || payload.doc !== undefined) continue;
      if (typeof payload.name !== "string" || typeof payload.kind !== "string") continue;
      const keys = ["name", "kind", "visibility", "line", "endLine", "signature", "propsType", "typeAnnotation", "params", "returnType", "extends", "implements"];
      file.symbols.push(Object.fromEntries(keys.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])));
    } else if (fact.kind === "code-relation") {
      if (typeof payload.type !== "string" || typeof payload.from !== "string" || typeof payload.to !== "string") continue;
      if (["imports", "imports_type", "depends_on", "extends", "implements"].includes(payload.type)) {
        file.dependencies.push(Object.fromEntries(["type", "from", "to", "line", "isExternal"]
          .filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])));
      }
    } else if (fact.kind === "config-value" && !Array.isArray(payload.key_path) && typeof payload.key_path !== "string") {
      continue;
    }
    omitted.add(item.ref);
  }
  const navigation = [...readable.values()].filter((file) => file.symbols.length > 0 || file.dependencies.length > 0)
    .map(({ ranges: _ranges, ...file }) => {
      void _ranges;
      return { ...file, dependencies: [...new Map(file.dependencies.map((value) => [JSON.stringify(value), value])).values()] };
    });
  return { omitted, navigation };
}
