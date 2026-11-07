import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { computeDocumentContentHash, type DocumentSnapshotManifest } from "@c4a/extract";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { readDocumentSourcesRegistry } from "./documentSources.js";
import { readDocumentSnapshotForSource } from "./documentBatchManifest.js";
import { documentSnapshotFidelityState, readDocumentSnapshotCaptureReport } from "./documentSnapshotFidelity.js";

function cachePath(root: string, name: string) {
  const key = createHash("sha256").update(name).digest("hex");
  return join(root, ".tmp/context-runtime/lark-revisions", `${key}.json`);
}

/** Validate every persisted file before using a remote-revision shortcut. */
export async function larkSnapshotFingerprint(root: string, materializedAt: string, snapshot: DocumentSnapshotManifest) {
  const digest = createHash("sha256").update(JSON.stringify(snapshot));
  for (const file of [...snapshot.files, ...(snapshot.assets ?? [])].sort((a, b) => a.path.localeCompare(b.path))) {
    if (file.content_hash === undefined) continue;
    let bytes: Buffer;
    try { bytes = await readFile(join(root, materializedAt, file.path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    if (computeDocumentContentHash(bytes) !== file.content_hash) return undefined;
    digest.update(file.path).update("\0").update(bytes).update("\0");
  }
  // Old captures can be internally hash-consistent but have an incomplete
  // body. Only usable local evidence without readiness blockers can authorize
  // the shortcut; nonblocking missing resources use the explicit refresh action.
  let state;
  try {
    state = documentSnapshotFidelityState(snapshot, readDocumentSnapshotCaptureReport({
      projectRoot: root, materializedAt, manifest: snapshot,
    }));
  } catch { return undefined; }
  if (!state.report || state.report.evidence_status === "error" || state.report.projection_status === "error" || state.blocking.length > 0) return undefined;
  return digest.digest("hex");
}

export async function checkedLarkRevision(root: string, name: string, fingerprint: string) {
  try {
    const value = JSON.parse(await readFile(cachePath(root, name), "utf8"));
    return value.fingerprint === fingerprint && typeof value.revision === "string" ? value.revision as string : undefined;
  } catch { return undefined; }
}

export async function rememberCheckedLarkRevision(root: string, name: string, revision: string, fingerprint: string) {
  await atomicWriteFile(cachePath(root, name), JSON.stringify({ revision, fingerprint }) + "\n");
}

/** Revision and fetch time are observations; all other snapshot facts matter. */
export function larkSnapshotComparable(snapshot: DocumentSnapshotManifest) {
  const { captured_at: _time, ...value } = snapshot;
  void _time;
  const source = value.metadata?.source;
  if (!source) return JSON.stringify(value);
  const { revisionId: _revision, ...identity } = source;
  void _revision;
  return JSON.stringify({ ...value, metadata: { ...value.metadata, source: identity } });
}

export async function readMissingLarkResources(root: string) {
  const { larks } = await readDocumentSourcesRegistry(root);
  const result = [];
  for (const source of larks) {
    const manifest = await readDocumentSnapshotForSource(join(root, source.snapshot?.manifest ?? `${source.materializedAt}/manifest.json`), source.name);
    if (!manifest) continue;
    const state = documentSnapshotFidelityState(manifest, readDocumentSnapshotCaptureReport({ projectRoot: root, materializedAt: source.materializedAt, manifest }));
    const items = state.resourceMaterialization?.items.filter(item => item.status === "failed") ?? [];
    if (items.length) result.push({ source: `lark:${source.name}`, items, retry_action: {
      command: `context run capture:lark:${source.name} --input - --format json`,
      input: { refresh_sources: [`lark:${source.name}`] },
    } });
  }
  return result;
}
