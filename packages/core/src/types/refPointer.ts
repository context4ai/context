export type EntityRefPointer = `ref:entity:${string}`;

export type RefPointer =
  | EntityRefPointer
  | `ref:relation:${string}`
  | `ref:content:${string}`;

export type SourceRefSpan = {
  start: number;
  end: number;
};

export type SourceRef = {
  ref: RefPointer;
  span?: SourceRefSpan;
};

export interface ResolvedRef {
  type: "entity" | "relation" | "content";
  id: string;
  exists: boolean;
  summary?: {
    name?: string;
    entity_type?: string;
    byte_size?: number;
  };
}

const REF_POINTER_PATTERN = /^ref:(entity|relation|content):(.+)$/;

type ParsedRef = { type: "entity" | "relation" | "content"; id: string };

export function parseRef(pointer: string): ParsedRef | null {
  const match = REF_POINTER_PATTERN.exec(pointer);
  if (!match) {
    return null;
  }
  const [, type, id] = match;
  if (!id) {
    return null;
  }
  return { type: type as ParsedRef["type"], id };
}

export function buildRef(
  type: ParsedRef["type"],
  id: string,
): RefPointer {
  return `ref:${type}:${id}` as RefPointer;
}

export function isRefPointer(value: unknown): value is RefPointer {
  return typeof value === "string" && parseRef(value) !== null;
}

export function extractAllRefs(
  data: unknown,
): { pointer: RefPointer; fieldPath: string }[] {
  const results: { pointer: RefPointer; fieldPath: string }[] = [];

  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (isRefPointer(value)) {
        results.push({ pointer: value, fieldPath: path });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const nextPath = path ? `${path}[${index}]` : `[${index}]`;
        visit(item, nextPath);
      });
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        visit(entry, nextPath);
      }
    }
  };

  visit(data, "");
  return results;
}
