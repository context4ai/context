import { isDeepStrictEqual } from "node:util";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reading layout only: consecutive equal shapes share column names. Missing
 * fields, unknown extensions, values and member order remain distinguishable.
 * Never pass this representation to the renderer or result validator. */
export function compactReadingMembers(value: unknown): unknown {
  if (!object(value) || !Array.isArray(value.members) || value.members.length < 2 ||
      !value.members.every(object)) return value;
  const groups: { common: Record<string, unknown>; columns: string[]; rows: unknown[][] }[] = [];
  let start = 0;
  while (start < value.members.length) {
    const first = value.members[start]!;
    const keys = Object.keys(first).sort();
    let end = start + 1;
    while (end < value.members.length && isDeepStrictEqual(Object.keys(value.members[end]!).sort(), keys)) end++;
    const records = value.members.slice(start, end);
    const shared = keys.filter(key => records.every(record => isDeepStrictEqual(record[key], first[key])));
    const columns = keys.filter(key => !shared.includes(key));
    groups.push({ common: Object.fromEntries(shared.map(key => [key, first[key]])), columns,
      rows: records.map(record => columns.map(key => record[key])) });
    start = end;
  }
  const members = { groups };
  if (JSON.stringify(members).length >= JSON.stringify(value.members).length) return value;
  return { ...value, members };
}

export const MEMBER_ROWS_GUIDANCE = "Member groups preserve order: each row maps to columns and inherits that group's common fields. Missing fields remain absent; this is a reading layout, not a submission format.";

/** Keep short scalar rows on one line; retain indentation for nested records.
 * JSON serialization owns escaping and omission semantics. */
export function readingJson(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value));
  function render(value: unknown, depth: number): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    const compact = JSON.stringify(value);
    if (Array.isArray(value) && (value.length === 0 ||
        (compact.length <= 1200 && value.every(item => item === null || typeof item !== "object")))) return compact;
    const entries = Array.isArray(value) ? value.map(item => render(item, depth + 1)) :
      Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${render(item, depth + 1)}`);
    if (!entries.length) return compact;
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    return `${open}\n${entries.map(entry => `${"  ".repeat(depth + 1)}${entry}`).join(",\n")}\n${"  ".repeat(depth)}${close}`;
  }
  return render(normalized, 0);
}
