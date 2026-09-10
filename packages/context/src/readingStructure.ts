import { z } from "zod";
import { indexerProtocolDigest } from "./indexerProtocolCommon.js";

/** Reader organization is independent of collections, source ownership and outputs. */
export const readingStructureEntrySchema = z.object({
  key: z.string().min(1),
  parent: z.string().min(1).nullable(),
  title: z.string().min(1),
  order: z.number().finite().default(0),
  target: z.object({
    artifact_ref: z.string().min(1),
    section_key: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();
export const readingStructureUpdateSchema = z.object({
  expected_revision: z.string().nullable(),
  upsert: z.array(readingStructureEntrySchema).default([]),
  remove: z.array(z.string().min(1)).default([]),
}).strict();
export const readingStructureSchema = z.object({
  protocol: z.literal("context.reading-structure/v1"),
  revision: z.string().min(1),
  entries: z.array(readingStructureEntrySchema),
}).strict();
export type ReadingStructure = z.infer<typeof readingStructureSchema>;
export type ReadingStructureUpdate = z.infer<typeof readingStructureUpdateSchema>;

function validateEntries(entries: ReadingStructure["entries"]): void {
  const indexed = new Map(entries.map(entry => [entry.key, entry]));
  if (indexed.size !== entries.length) throw new TypeError("reading entries must have unique keys");
  for (const entry of entries) {
    const visited = new Set<string>();
    let current: typeof entry | undefined = entry;
    while (current !== undefined) {
      if (visited.has(current.key)) throw new TypeError("reading structure contains a parent cycle");
      visited.add(current.key);
      if (current.parent === null) break;
      const parent = indexed.get(current.parent);
      if (parent === undefined) throw new TypeError(`reading entry ${current.key} has an unknown parent`);
      current = parent;
    }
  }
}

export function validateReadingStructure(value: unknown): ReadingStructure {
  const result = readingStructureSchema.parse(value);
  validateEntries(result.entries);
  const { revision, ...payload } = result;
  if (indexerProtocolDigest(payload) !== revision) throw new TypeError("reading structure revision does not match its content");
  return result;
}

export function updateReadingStructure(current: ReadingStructure | undefined, value: unknown): ReadingStructure {
  const update = readingStructureUpdateSchema.parse(value);
  if ((current?.revision ?? null) !== update.expected_revision) throw new TypeError("reading structure changed; reread the current structure before applying this edit");
  const keys = update.upsert.map(entry => entry.key);
  if (new Set(keys).size !== keys.length || new Set(update.remove).size !== update.remove.length || keys.some(key => update.remove.includes(key))) {
    throw new TypeError("reading structure update contains conflicting entry identities");
  }
  const entries = new Map(current?.entries.map(entry => [entry.key, entry]) ?? []);
  for (const key of update.remove) entries.delete(key);
  for (const entry of update.upsert) entries.set(entry.key, entry);
  const payload = { protocol: "context.reading-structure/v1" as const,
    entries: [...entries.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) };
  validateEntries(payload.entries);
  return { ...payload, revision: indexerProtocolDigest(payload) };
}

export interface ProjectedReadingEntry {
  key: string; title: string; href?: string; children: ProjectedReadingEntry[];
}

/** Target availability belongs to each channel. Omit pending/excluded entries and
 * empty groups without mutating shared organization or another channel's map. */
export function projectReadingStructure(structure: ReadingStructure, targets: ReadonlyMap<string, string>) {
  const children = new Map<string | null, ReadingStructure["entries"]>();
  for (const entry of structure.entries) children.set(entry.parent, [...children.get(entry.parent) ?? [], entry]);
  const warnings: Array<{ entry: string; code: "reading-target-unavailable"; target: string }> = [];
  function project(parent: string | null): ProjectedReadingEntry[] {
    return (children.get(parent) ?? []).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).flatMap(entry => {
      const descendants = project(entry.key);
      const identity = entry.target === undefined ? undefined : readingTargetKey(entry.target);
      const href = identity === undefined ? undefined : targets.get(identity);
      if (identity !== undefined && href === undefined) warnings.push({ entry: entry.key, code: "reading-target-unavailable", target: identity });
      if (href === undefined && descendants.length === 0) return [];
      return [{ key: entry.key, title: entry.title, ...(href === undefined ? {} : { href }), children: descendants }];
    });
  }
  return { entries: project(null), warnings };
}

export function readingTargetKey(target: { artifact_ref: string; section_key?: string | undefined }): string {
  return target.section_key === undefined ? target.artifact_ref : `${target.artifact_ref}#${encodeURIComponent(target.section_key)}`;
}
