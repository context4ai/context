import { readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { assertManagedDocumentPath, type ManagedDocumentSourceType } from "@c4a/context";
import { createDocumentSnapshotManifest } from "@c4a/extract";

/** Rebuild only an in-memory descriptor from the readable source itself. */
export async function readManagedDocumentSnapshot(projectRoot: string, type: ManagedDocumentSourceType, name: string) {
  const absolutePath = await assertManagedDocumentPath(projectRoot, type, name);
  const markdown = await readFile(absolutePath, "utf8");
  const file = basename(name);
  const manifest = createDocumentSnapshotManifest({ sourceType: type, sourceName: name,
    capturedAt: (await stat(absolutePath)).mtime.toISOString(),
    files: [{ path: file, bytes: markdown, title: /^#\s+(.+)$/mu.exec(markdown)?.[1] ?? file,
      locator: `${type}:${name}` }] });
  return { manifest, materializedAt: `sources/${type}/${dirname(name)}`, markdown };
}
