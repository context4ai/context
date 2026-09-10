import { readdir, lstat, realpath, readFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";

import { readSessionChanges, type SessionChange } from "./sessionMetadata.js";

export type ManagedDocumentSourceType = "note" | "sessions";
export interface ManagedDocumentSourceEntry {
  id: string;
  name: string;
  namespace: string;
  module: string;
  materializedAt: string;
  changes?: SessionChange[];
}

/** A readable dated filename is the identity; no registry or content hash is
 * added to the name. Paths are deliberately limited to these managed roots. */
export function assertManagedDocumentName(name: string): void {
  if (!/^\d{8}\/[^/\\\x00-\x1f\s:#?]+\.md$/u.test(name) || name.includes("/..")) {
    throw new TypeError("Managed document name must be YYYYMMDD/semantic-name.md inside sources/note or sources/sessions");
  }
  const date = name.slice(0, 8);
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10).replaceAll("-", "") !== date) {
    throw new TypeError("Managed document date must be a valid YYYYMMDD date");
  }
}

export async function assertManagedDocumentPath(rootDir: string, type: ManagedDocumentSourceType, name: string): Promise<string> {
  assertManagedDocumentName(name);
  const root = await realpath(rootDir);
  const parts = ["sources", type, ...name.split("/")];
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new TypeError("Managed document paths must not traverse symlinks");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  const rel = relative(root, path);
  if (isAbsolute(rel) || rel.startsWith("../")) throw new TypeError("Managed document path leaves its workspace");
  return path;
}

export async function discoverManagedDocuments(rootDir: string, type: ManagedDocumentSourceType): Promise<ManagedDocumentSourceEntry[]> {
  const base = join(rootDir, "sources", type);
  await assertManagedDocumentPath(rootDir, type, "20000101/discovery.md");
  let dates;
  try { dates = await readdir(base, { withFileTypes: true }); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []; throw error; }
  const entries: ManagedDocumentSourceEntry[] = [];
  for (const date of dates.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!date.isDirectory() || !/^\d{8}$/u.test(date.name)) continue;
    for (const file of (await readdir(join(base, date.name), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.endsWith(".md")) continue;
      const name = `${date.name}/${file.name}`;
      await assertManagedDocumentPath(rootDir, type, name);
      const changes = type === "sessions"
        ? readSessionChanges(await readFile(join(base, name), "utf8")) : undefined;
      entries.push({ ...(changes === undefined ? {} : { changes }), id: name, name, namespace: date.name, module: file.name,
        materializedAt: `sources/${type}/${name}` });
    }
  }
  return entries;
}
