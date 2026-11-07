import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { indexerProtocolDigest, mergeProcessedScopes, readProcessedScopes, validateArticleStructureEntries, type ArticleSourceReference, type ProcessedScope } from "@c4a/context";
import type { DocumentSnapshotManifest } from "@c4a/extract";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { inspectWorkspaceVersion, optionalWorkspaceText, workspaceContentSnapshot, writeWorkspaceVersionCheckpoint } from "./workspaceChangelog.js";
import { updateDocumentManifestFile } from "./documentBatchManifest.js";

const PATH = ".tmp/context-runtime/format-only-update.json";
const STRUCTURE = "knowledge/structure.yaml";
export interface FormatReferenceChange { article: string; section: string; before: ArticleSourceReference; after: ArticleSourceReference }
interface Capture { source: string; manifestPath: string; snapshot: DocumentSnapshotManifest; files: Record<string, string | null> }
interface Baseline {
  version: string; files: Record<string, string>; shared: Record<string, string>;
  captures: Record<string, Capture>; approvals: Record<string, string>;
  references: FormatReferenceChange[]; scopes: ProcessedScope[];
}
const digest = (bytes: string | Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
};
async function load(root: string): Promise<Baseline | undefined> {
  try {
    const value = JSON.parse(await readFile(join(root, PATH), "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value) || typeof value.version !== "string" || !value.shared || !value.files || !value.captures || !value.approvals || !Array.isArray(value.references) || !Array.isArray(value.scopes)) return undefined;
    return value;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
const save = (root: string, value: Baseline) => atomicWriteFile(join(root, PATH), JSON.stringify(value) + "\n");
export const invalidateFormatOnlyUpdate = (root: string) => rm(join(root, PATH), { force: true });
function appendReferenceChanges(baseline: Baseline, changes: readonly FormatReferenceChange[]): void {
  baseline.references = [...new Map([...baseline.references, ...changes].map(change => [
    indexerProtocolDigest([change.article, change.section, change.before, change.after]), change,
  ])).values()];
}

export async function recordFormatOnlyRelocations(root: string, changes: FormatReferenceChange[]): Promise<void> {
  const baseline = await load(root);
  if (!baseline || !changes.length) return;
  appendReferenceChanges(baseline, changes);
  await save(root, baseline);
}

/** Disposable baseline for one refresh, not a new version ledger. */
export async function beginFormatOnlyUpdate(root: string): Promise<void> {
  const existing = await load(root);
  if (await optionalWorkspaceText(root, "package.json") === undefined) return;
  const status = await inspectWorkspaceVersion(root);
  if (!status.current) return;
  if (existing && existing.version === status.version && same(existing.files, status.files)) return;
  const shared: Record<string, string> = {};
  for (const path of Object.keys(status.files).filter(path => path === STRUCTURE || /^sources\/.*\/manifest\.json$/u.test(path))) {
    shared[path] = await readFile(join(root, path), "utf8");
  }
  await save(root, { version: status.version, files: status.files, shared, captures: {}, approvals: {}, references: [], scopes: [] });
}

export async function recordFormatOnlyCapture(root: string, capture: Capture): Promise<void> {
  const baseline = await load(root);
  if (!baseline) return;
  baseline.captures[capture.source] = capture;
  delete baseline.approvals[capture.source];
  baseline.references = baseline.references.filter(change => change.before.source_ref !== capture.source);
  await save(root, baseline);
}

export async function approveFormatOnlyUpdate(root: string, input: {
  source: string; reason: string; references: FormatReferenceChange[]; scopes: readonly ProcessedScope[];
}): Promise<void> {
  const baseline = await load(root);
  if (!baseline) return; // No pre-capture current baseline: keep normal versioning.
  baseline.approvals[input.source] = input.reason;
  appendReferenceChanges(baseline, input.references);
  baseline.scopes = mergeProcessedScopes(baseline.scopes, input.scopes.filter(scope => scope.source_ref === input.source));
  await save(root, baseline);
}

/** Caller holds the existing workspace lock. Only exact expected results may
 * replace the disposable checkpoint; unrelated work remains unrecorded. */
export async function settleFormatOnlyUpdate(root: string): Promise<boolean> {
  const baseline = await load(root);
  if (!baseline || !Object.keys(baseline.approvals).length || !baseline.shared[STRUCTURE]) return false;
  const status = await inspectWorkspaceVersion(root);
  if (status.version !== baseline.version) return false;
  const expectedShared: Record<string, unknown> = {};
  const allowed = new Set<string>([STRUCTURE]);
  for (const source of Object.keys(baseline.approvals)) {
    const capture = baseline.captures[source];
    if (!capture) return false;
    allowed.add(capture.manifestPath);
    const old = expectedShared[capture.manifestPath] ?? (baseline.shared[capture.manifestPath] ? JSON.parse(baseline.shared[capture.manifestPath]!) : null);
    expectedShared[capture.manifestPath] = updateDocumentManifestFile({ current: old, snapshot: capture.snapshot });
    for (const [path, hash] of Object.entries(capture.files)) {
      allowed.add(path);
      try {
        const actual = await readFile(join(root, path));
        if (hash === null || digest(actual) !== hash) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (hash !== null) return false;
      }
    }
  }
  const currentFiles = await workspaceContentSnapshot(root);
  for (const path of new Set([...Object.keys(baseline.files), ...Object.keys(currentFiles)])) {
    if (!allowed.has(path) && baseline.files[path] !== currentFiles[path]) return false;
  }
  for (const [path, expected] of Object.entries(expectedShared)) {
    if (!same(expected, JSON.parse(await readFile(join(root, path), "utf8")))) return false;
  }
  const original = YAML.parse(baseline.shared[STRUCTURE]);
  const expected = structuredClone(original);
  for (const change of baseline.references) {
    if (!baseline.approvals[change.before.source_ref]) continue;
    const section = expected.articles?.find((article: { path: string }) => article.path === change.article)?.sections
      ?.find((item: { id: string }) => item.id === change.section);
    const index = section?.references?.findIndex((reference: ArticleSourceReference) => same(reference, change.before));
    if (index === undefined || index < 0) return false;
    section.references[index] = change.after;
  }
  expected.processed_scopes = mergeProcessedScopes(readProcessedScopes(original), baseline.scopes);
  const { approvedStructureInputHashFor } = await import("./close.js");
  if (original.input_hash === await approvedStructureInputHashFor(root, validateArticleStructureEntries(original.articles ?? []))) {
    expected.input_hash = await approvedStructureInputHashFor(root, validateArticleStructureEntries(expected.articles ?? []));
  }
  if (!same(expected, YAML.parse(await readFile(join(root, STRUCTURE), "utf8")))) return false;
  await writeWorkspaceVersionCheckpoint(root, status.version, status.content_digest, status.snapshot_format);
  await rm(join(root, PATH), { force: true });
  return true;
}
