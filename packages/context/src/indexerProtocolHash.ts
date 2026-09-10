import { createHash } from "node:crypto";

/** Hash canonical JSON without retaining a second object tree and full JSON string. */
export function hashCanonicalIndexerJson(value: unknown, fallback: (value: unknown) => string): string {
  const hash = createHash("sha256");
  let buffer = "";
  const unsupported = Symbol("non-json value");
  const active = new Set<object>();
  const append = (text: string) => {
    buffer += text;
    if (buffer.length >= 16384) {
      hash.update(buffer);
      buffer = "";
    }
  };
  const visit = (item: unknown): void => {
    if (item === null || typeof item !== "object") {
      const text = JSON.stringify(item);
      if (text === undefined) throw unsupported;
      append(text);
      return;
    }
    if (active.has(item)) throw unsupported;
    active.add(item);
    if (Array.isArray(item)) {
      append("[");
      for (let i = 0; i < item.length; i++) {
        if (i !== 0) append(",");
        const child: unknown = item[i];
        if (child === undefined || typeof child === "function" || typeof child === "symbol") append("null");
        else visit(child);
      }
      append("]");
    } else {
      // Object.fromEntries in the previous canonicalizer also reorders integer keys.
      const entries = Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      if (entries.some(([key, child]) => key === "toJSON" && typeof child === "function")) throw unsupported;
      const ordered = Object.fromEntries(entries);
      append("{");
      let first = true;
      for (const key of Object.keys(ordered)) {
        const child: unknown = ordered[key];
        if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
        if (!first) append(",");
        first = false;
        append(JSON.stringify(key));
        append(":");
        visit(child);
      }
      append("}");
    }
    active.delete(item);
  };
  try {
    visit(value);
    if (buffer) hash.update(buffer);
    return `sha256:${hash.digest("hex")}`;
  } catch (error) {
    if (error !== unsupported) throw error;
    return `sha256:${createHash("sha256").update(fallback(value)).digest("hex")}`;
  }
}
