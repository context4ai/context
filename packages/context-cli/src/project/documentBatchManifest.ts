import { readFile } from "node:fs/promises";
import {
  parseDocumentSnapshotManifest,
  type DocumentSnapshotManifest,
  type DocumentSourceType,
} from "@c4a/extract";

export const DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION = "context.document-snapshot-batch.v1" as const;

export interface DocumentSnapshotBatchManifest {
  schema_version: typeof DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION;
  source_type: DocumentSourceType;
  batch: string;
  sources: Record<string, DocumentSnapshotManifest>;
}

function batchIdentity(sourceName: string): { batch: string; module: string } | undefined {
  const [batch, module, ...rest] = sourceName.split("/");
  if (batch === undefined || module === undefined || rest.length > 0 || !/^\d{8}$/u.test(batch)) return undefined;
  return { batch, module };
}

export function parseDocumentSnapshotBatchManifest(value: unknown): DocumentSnapshotBatchManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("document snapshot batch manifest must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schema_version !== DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION) {
    throw new TypeError(`unsupported document snapshot batch schema: ${String(record.schema_version)}`);
  }
  if ((record.source_type !== "file" && record.source_type !== "lark") ||
    typeof record.batch !== "string" || !/^\d{8}$/u.test(record.batch) ||
    record.sources === null || typeof record.sources !== "object" || Array.isArray(record.sources)) {
    throw new TypeError("document snapshot batch manifest metadata is invalid");
  }
  const sources = Object.fromEntries(Object.entries(record.sources as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([module, snapshot]) => [module, parseDocumentSnapshotManifest(snapshot)]));
  return {
    schema_version: DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION,
    source_type: record.source_type,
    batch: record.batch,
    sources,
  };
}

export function findDocumentSnapshotForSource(value: unknown, sourceName: string): DocumentSnapshotManifest | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).schema_version === DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION) {
    const identity = batchIdentity(sourceName);
    if (identity === undefined) throw new TypeError(`batch manifest cannot resolve non-batch source: ${sourceName}`);
    const batch = parseDocumentSnapshotBatchManifest(value);
    const snapshot = batch.sources[identity.module];
    if (snapshot === undefined) return null;
    if (snapshot.source_name !== sourceName) throw new TypeError(`document snapshot batch source entry does not match ${sourceName}`);
    return snapshot;
  }
  const snapshot = parseDocumentSnapshotManifest(value);
  if (snapshot.source_name !== sourceName) {
    throw new TypeError(`document snapshot is for ${snapshot.source_name}, expected ${sourceName}`);
  }
  return snapshot;
}

export function parseDocumentSnapshotForSource(value: unknown, sourceName: string): DocumentSnapshotManifest {
  const snapshot = findDocumentSnapshotForSource(value, sourceName);
  if (snapshot === null) throw new TypeError(`document snapshot batch has no source entry for ${sourceName}`);
  return snapshot;
}

export async function readDocumentSnapshotForSource(
  path: string,
  sourceName: string,
): Promise<DocumentSnapshotManifest | null> {
  try {
    return parseDocumentSnapshotForSource(JSON.parse(await readFile(path, "utf8")) as unknown, sourceName);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

export async function readDocumentManifestFile(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

export function updateDocumentManifestFile(input: {
  current: unknown | null;
  snapshot: DocumentSnapshotManifest;
}): DocumentSnapshotManifest | DocumentSnapshotBatchManifest {
  const identity = batchIdentity(input.snapshot.source_name);
  if (identity === undefined) return input.snapshot;
  const existing = input.current === null
    ? undefined
    : parseDocumentSnapshotBatchManifest(input.current);
  if (existing !== undefined &&
    (existing.source_type !== input.snapshot.source_type || existing.batch !== identity.batch)) {
    throw new TypeError(`document snapshot batch identity mismatch for ${input.snapshot.source_name}`);
  }
  return {
    schema_version: DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION,
    source_type: input.snapshot.source_type,
    batch: identity.batch,
    sources: Object.fromEntries(Object.entries({
      ...(existing?.sources ?? {}),
      [identity.module]: input.snapshot,
    }).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export interface DocumentManifestRemoval {
  snapshot: DocumentSnapshotManifest | null;
  next: DocumentSnapshotManifest | DocumentSnapshotBatchManifest | null;
  remainingSources: number;
}

/**
 * Remove one source-owned snapshot entry without inferring ownership from a
 * shared materialization directory. A missing batch entry means that source
 * has never produced a snapshot and therefore owns no materialized files.
 */
export function removeDocumentSnapshotFromManifestFile(input: {
  current: unknown | null;
  sourceName: string;
}): DocumentManifestRemoval {
  if (input.current === null) {
    return { snapshot: null, next: null, remainingSources: 0 };
  }
  if (input.current !== null && typeof input.current === "object" && !Array.isArray(input.current) &&
    (input.current as Record<string, unknown>).schema_version === DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION) {
    const identity = batchIdentity(input.sourceName);
    if (identity === undefined) throw new TypeError(`batch manifest cannot resolve non-batch source: ${input.sourceName}`);
    const batch = parseDocumentSnapshotBatchManifest(input.current);
    if (batch.batch !== identity.batch) {
      throw new TypeError(`document snapshot batch identity mismatch for ${input.sourceName}`);
    }
    const snapshot = batch.sources[identity.module] ?? null;
    if (snapshot !== null && snapshot.source_name !== input.sourceName) {
      throw new TypeError(`document snapshot batch source entry does not match ${input.sourceName}`);
    }
    const sources = Object.fromEntries(Object.entries(batch.sources)
      .filter(([module]) => module !== identity.module)
      .sort(([left], [right]) => left.localeCompare(right)));
    const remainingSources = Object.keys(sources).length;
    return {
      snapshot,
      next: remainingSources === 0 ? null : { ...batch, sources },
      remainingSources,
    };
  }
  const snapshot = parseDocumentSnapshotManifest(input.current);
  if (snapshot.source_name !== input.sourceName) {
    throw new TypeError(`document snapshot is for ${snapshot.source_name}, expected ${input.sourceName}`);
  }
  return { snapshot, next: null, remainingSources: 0 };
}

export function renderDocumentManifestFile(value: DocumentSnapshotManifest | DocumentSnapshotBatchManifest): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
