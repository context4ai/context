import { isDeepStrictEqual } from "node:util";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The current choices and all executable limits stay visible. The full menu is
 * a discoverable detail, not a second source of submission authority. */
export function projectAuthorAuthority(value: Record<string, unknown>) {
  if (typeof object(value.page_plan).artifact_intent !== "string" && !Array.isArray(object(value.page_plan).articles)) return undefined;
  const projected = { ...value };
  for (const key of ["allowed_artifact_intents", "available_templates", "primary_artifact_guidance"]) delete projected[key];
  if (value.artifact_policy_eligibility !== undefined) {
    const eligibility = { ...object(value.artifact_policy_eligibility) };
    for (const key of ["protocol", "eligibility_digest", "operator_contract_digest", "profile_contract_digest", "provider_supported_variants"]) delete eligibility[key];
    projected.artifact_policy_eligibility = eligibility;
  }
  return projected;
}

/** No semantic merging: reuse only a unique same-file Props declaration with
 * exactly equal original members. Differences in defaults/docs/locations win
 * over size reduction. The target itself must keep its own members. */
export function reuseAuthorMembers(entries: readonly unknown[]) {
  return entries.map(entry => {
    const item = object(entry), payload = object(item.payload);
    if (item.kind !== "code-symbol" || typeof payload.propsType !== "string" || !Array.isArray(payload.members) || payload.members.length === 0) return entry;
    const matches = entries.map(object).filter(target => {
      const candidate = object(target.payload);
      return target !== entry && target.kind === "code-symbol" && candidate.name === payload.propsType &&
        ["type", "type-alias", "interface"].includes(String(candidate.kind)) && candidate.propsType === undefined &&
        isDeepStrictEqual(candidate.members, payload.members);
    });
    if (matches.length !== 1) return entry;
    const { members: _members, ...rest } = payload;
    void _members;
    return { ...item, payload: { ...rest, members_from: matches[0]!.ref } };
  });
}

const STYLE_NAMES = ["name", "class_names", "id_names", "attribute_names", "pseudo_classes", "type_names"];
const STYLE_KINDS = new Set(["style-selector", "style-component-candidate", "style-token-reference", "style-variant-state"]);

/** Only built-in records with known fields become name/location rows. Custom
 * extensions remain explicit; a style name never implies public API status. */
export function projectAuthorStyleNames(entries: readonly unknown[], memberIds?: ReadonlySet<string>) {
  const output: unknown[] = [];
  const groups = new Map<string, { kind: string; columns: string[]; rows: unknown[][]; position_columns?: string[] }>();
  for (const entry of entries) {
    const item = object(entry), payload = object(item.payload);
    const keys = [...STYLE_NAMES, "locator", "basis", "evidence_kind", "owner_qualified_item_path"];
    if (!STYLE_KINDS.has(String(item.kind)) || Object.keys(payload).some(key => !keys.includes(key)) ||
        Object.keys(item).some(key => !["ref", "kind", "denominator", "locator", "payload"].includes(key)) ||
        Object.keys(object(item.locator)).length > 0) {
      output.push(entry);
      continue;
    }
    const names = Object.fromEntries(STYLE_NAMES.filter(key => payload[key] !== undefined &&
      !(Array.isArray(payload[key]) && payload[key].length === 0)).map(key => [key, payload[key]]));
    const kind = String(item.kind);
    // Only inventory members need an ID for disposition. Supporting style
    // records remain discoverable by names/positions and in the full detail;
    // never manufacture a short ID which the submission schema cannot resolve.
    const needsRef = memberIds === undefined || memberIds.has(String(item.ref));
    const key = JSON.stringify([kind, needsRef]);
    const group = groups.get(key) ?? { kind, columns: [...(needsRef ? ["ref"] : []), "names", "position", "denominator"], rows: [] };
    if (!groups.has(key)) { groups.set(key, group); output.push(group); }
    group.rows.push([...(needsRef ? [item.ref] : []), names, payload.locator ?? {}, item.denominator ?? null]);
  }
  for (const group of groups.values()) {
    // Repeated locator property names are a layout concern, not a new locator
    // protocol. Keep unknown locator extensions explicitly in their objects.
    const index = group.columns.indexOf("position");
    if (group.rows.some(row => row[index] === null || typeof row[index] !== "object" || Array.isArray(row[index]))) continue;
    const positions = group.rows.map(row => object(row[index]));
    if (positions.some(position => Object.keys(position).some(key => !["line", "end_line", "column"].includes(key)))) continue;
    group.position_columns = ["line", "end_line", "column"];
    group.rows = group.rows.map((row, i) => row.map((value, j) => j === index
      ? [positions[i]!.line ?? null, positions[i]!.end_line ?? null, positions[i]!.column ?? null] : value));
  }
  return output;
}

/** Lossless layout for repeated record shapes. Keep heterogeneous/custom
 * records in their original form instead of filling absent fields with null. */
export function authorRecordRows(values: readonly unknown[]) {
  if (values.length < 2 || values.some(value => value === null || typeof value !== "object" || Array.isArray(value))) return values;
  const columns = Object.keys(object(values[0])).sort();
  if (values.some(value => !isDeepStrictEqual(Object.keys(object(value)).sort(), columns))) return values;
  return { columns, rows: values.map(value => columns.map(key => object(value)[key])) };
}

export function authorOptionalSource(path: string, spans: unknown) {
  if (/\.(css|scss|sass|less)$/iu.test(path)) return {
    kind: "style",
    hint: "Style names and member IDs below are navigation, not public API classification. Do not open every stylesheet because it has inventory IDs. Use the accepted plan and supplied evidence for supporting/catalog decisions; read relevant rules only when a planned claim or unresolved disposition needs layout, state, theme, override or accessibility details. Names alone prove neither behavior nor exclusion.",
  };
  if (!/(^|\/)package\.json$/u.test(path)) return undefined;
  // Captured ranges need not form a whole JSON document. Never reconstruct
  // omitted braces/values or read the live checkout to fill the holes.
  let fields: Record<string, unknown> | undefined;
  try {
    const ranges = Array.isArray(spans) ? spans.map(object) : [];
    if (ranges.length === 1 && ranges[0]!.start_line === 1 && typeof ranges[0]!.text === "string") {
      const manifest = object(JSON.parse(ranges[0]!.text));
      const keys = ["name", "version", "type", "exports", "main", "module", "types", "typings", "browser", "imports", "peerDependencies", "engines", "os", "cpu", "sideEffects"];
      fields = Object.fromEntries(keys.filter(key => manifest[key] !== undefined).map(key => [key, manifest[key]]));
    }
  } catch { /* Partial/invalid captured JSON is available through the detail. */ }
  return { kind: "package", ...(fields ? { fields } : {}),
    hint: "Use the captured fields below for the facts they explicitly contain; read the full manifest only for needed fields or conditions absent here. Scripts, development dependencies and other fields are available in the full source; absence from this brief does not mean absence from the package.",
  };
}
