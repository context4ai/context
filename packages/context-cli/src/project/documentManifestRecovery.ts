import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocumentSnapshotManifest, type DocumentSourceType } from "@c4a/extract";
import { applyAtomicFileBatch } from "../lib/atomicFileBatch.js";
import {
  DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION,
  findDocumentSnapshotForSource,
  type DocumentSnapshotBatchManifest,
} from "./documentBatchManifest.js";

function recoverBatchEntries(value: unknown, sourceType: DocumentSourceType, sourceName: string) {
  const [batch, module, ...rest] = sourceName.split("/");
  if (batch === undefined || module === undefined || rest.length > 0 || !/^\d{8}$/u.test(batch)) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<DocumentSnapshotBatchManifest>;
  if (candidate.schema_version !== DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION ||
    candidate.source_type !== sourceType || candidate.batch !== batch ||
    candidate.sources === null || typeof candidate.sources !== "object" || Array.isArray(candidate.sources)) return null;
  const sources: DocumentSnapshotBatchManifest["sources"] = {};
  for (const [key, entry] of Object.entries(candidate.sources)) {
    try {
      const snapshot = parseDocumentSnapshotManifest(entry);
      if (snapshot.source_type === sourceType && snapshot.source_name === `${batch}/${key}` &&
        /^[a-z0-9][a-z0-9._-]*$/u.test(key)) sources[key] = snapshot;
    } catch {
      // Invalid entries remain unavailable and require their own capture. Never
      // remove their snapshot files using paths from a damaged manifest.
    }
  }
  return { schema_version: DOCUMENT_SNAPSHOT_BATCH_SCHEMA_VERSION, source_type: sourceType, batch, sources };
}

/** Capture may replace a damaged derived manifest, but cannot trust its paths
 * for cleanup. Keep its original bytes and any independently valid siblings. */
export async function readDocumentManifestForCapture(input: {
  projectRoot: string;
  manifestPath: string;
  sourceType: DocumentSourceType;
  sourceName: string;
}) {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(input.projectRoot, input.manifestPath));
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return { current: null, previous: null };
    }
    throw error;
  }
  let current: unknown = null;
  try {
    current = JSON.parse(bytes.toString("utf8")) as unknown;
    const previous = findDocumentSnapshotForSource(current, input.sourceName);
    if (previous !== null && previous.source_type !== input.sourceType) {
      throw new TypeError("snapshot source type does not match its registered source");
    }
    return { current, previous };
  } catch (error) {
    const digest = createHash("sha256").update(bytes).digest("hex");
    const backup = join(".tmp", "context-runtime", "recovery", "document-manifests", `${digest}.json`);
    await applyAtomicFileBatch({
      transactionRoot: join(input.projectRoot, ".tmp", "context-runtime", "recovery", "manifest-transactions"),
      writes: [{ path: join(input.projectRoot, backup), bytes }],
    });
    const recovered = recoverBatchEntries(current, input.sourceType, input.sourceName);
    return {
      current: recovered,
      previous: recovered === null ? null : findDocumentSnapshotForSource(recovered, input.sourceName),
      recovery: {
        backup,
        diagnostic: `Rebuilt the damaged snapshot manifest from its registered source; original saved at ${backup}. ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
