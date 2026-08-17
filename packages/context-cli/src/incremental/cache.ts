import { contentHash } from "@c4a/core";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { findNearestWorkspace, findWorkspaceAt } from "../lib/workspaceLayout.js";
import { workspaceLocalUserCacheRoot } from "../lib/userCache.js";
import {
  createEmptyIncrementalState,
  createUnknownIncrementalState,
  writeIncrementalState,
} from "./state.js";
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  INCREMENTAL_SCHEMA_VERSION,
  RETRIEVAL_SCHEMA_VERSION,
  type CasIndex,
  type ContextCacheManifestPaths,
  type IncrementalCacheCounts,
  type IncrementalCacheManifest,
  type IncrementalCachePaths,
  type IncrementalInputSummary,
  type IncrementalState,
  type RetrievalCacheCounts,
  type RetrievalInputSummary,
} from "./types.js";

export interface IncrementalCachePathInput {
  workspaceRoot: string;
  cacheHome?: string;
}

export type ReadIncrementalCacheStatus = "ready" | "missing" | "stale" | "unknown" | "invalid";

export interface ReadIncrementalCacheResult {
  status: ReadIncrementalCacheStatus;
  paths: IncrementalCachePaths;
  canRebuild: boolean;
  reason: string;
  manifest?: IncrementalCacheManifest;
}

export interface RebuildProviderContext {
  paths: IncrementalCachePaths;
  workspaceRoot: string;
  inputSummary: IncrementalInputSummary;
  now: Date;
}

export interface IncrementalCacheProviders {
  casIndex?: (ctx: RebuildProviderContext) => Promise<CasIndex> | CasIndex;
  sourceDigests?: (ctx: RebuildProviderContext) => Promise<unknown> | unknown;
  rawBlocks?: (ctx: RebuildProviderContext) => Promise<unknown> | unknown;
  sectionFingerprints?: (ctx: RebuildProviderContext) => Promise<unknown> | unknown;
  state?: (ctx: RebuildProviderContext) => Promise<IncrementalState> | IncrementalState;
}

export interface RebuildIncrementalCacheInput extends IncrementalCachePathInput {
  inputSummary?: IncrementalInputSummary;
  providers?: IncrementalCacheProviders;
  now?: Date;
}

export interface RebuildIncrementalCacheResult {
  status: "ready" | "unknown";
  paths: IncrementalCachePaths;
  manifest: IncrementalCacheManifest;
  missingProviders: string[];
}

const PROCESS_START_CWD = process.cwd();

function resolveCachePath(value: string): string {
  return isAbsolute(value) ? value : resolve(PROCESS_START_CWD, value);
}

function workspaceCacheHome(workspaceRoot: string): string {
  const location = findWorkspaceAt(workspaceRoot);
  return workspaceLocalUserCacheRoot(location?.ctxDir ?? join(workspaceRoot, ".context"));
}

export function resolveCacheHome(input: { cacheHome?: string; workspaceRoot?: string } = {}): string {
  const explicit = input.cacheHome ?? process.env.C4A_CONTEXT_CACHE_HOME;
  if (explicit !== undefined) return resolveCachePath(explicit);
  if (input.workspaceRoot !== undefined) return workspaceCacheHome(resolveCachePath(input.workspaceRoot));
  const nearest = findNearestWorkspace(process.cwd());
  return workspaceLocalUserCacheRoot(nearest?.ctxDir ?? join(process.cwd(), ".context"));
}

export async function getIncrementalCachePaths(input: IncrementalCachePathInput): Promise<IncrementalCachePaths> {
  const workspaceRoot = await realpath(input.workspaceRoot);
  const projectId = contentHash(workspaceRoot).slice(0, 32);
  const cacheHome = resolveCacheHome({ ...input, workspaceRoot });
  const cacheRoot = join(cacheHome, "retrieval", projectId);
  return {
    projectId,
    workspaceRoot,
    cacheRoot,
    manifest: join(cacheRoot, "manifest.json"),
    casIndex: join(cacheRoot, "cas-index.json"),
    sourceDigests: join(cacheRoot, "source-digests.json"),
    rawBlocks: join(cacheRoot, "raw-blocks.json"),
    sectionFingerprints: join(cacheRoot, "section-fingerprints.json"),
    state: join(cacheRoot, "incremental-state.json"),
    nodes: join(cacheRoot, "nodes.json"),
    sections: join(cacheRoot, "sections.json"),
    sources: join(cacheRoot, "sources.json"),
    graph: join(cacheRoot, "graph.json"),
    terms: join(cacheRoot, "terms.json"),
    archives: join(cacheRoot, "archives.json"),
    decisions: join(cacheRoot, "decisions.json"),
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) out[key] = sortJson(child);
  }
  return out;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function defaultInputSummary(paths: IncrementalCachePaths): IncrementalInputSummary {
  return { workspace_root: paths.workspaceRoot };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isManifestFiles(value: unknown): value is IncrementalCacheManifest["files"] {
  if (!isObject(value)) return false;
  return typeof value.cas_index === "string" &&
    typeof value.source_digests === "string" &&
    typeof value.raw_blocks === "string" &&
    typeof value.section_fingerprints === "string" &&
    typeof value.incremental_state === "string";
}

function isManifestCounts(value: unknown): value is IncrementalCacheCounts {
  if (!isObject(value)) return false;
  return typeof value.content_hashes === "number" &&
    typeof value.snapshots === "number" &&
    typeof value.origins === "number" &&
    typeof value.source_digests === "number" &&
    typeof value.raw_blocks === "number" &&
    typeof value.section_fingerprints === "number" &&
    typeof value.state_unknown_inputs === "number";
}

function isRetrievalCounts(value: unknown): value is RetrievalCacheCounts {
  if (!isObject(value)) return false;
  return typeof value.nodes === "number" &&
    typeof value.sections === "number" &&
    typeof value.sources === "number" &&
    typeof value.graph_edges === "number" &&
    typeof value.terms === "number" &&
    typeof value.archives === "number" &&
    typeof value.decisions === "number";
}

function isManifestPaths(value: unknown): value is ContextCacheManifestPaths {
  if (!isObject(value)) return false;
  return typeof value.cas_index === "string" &&
    typeof value.source_digests === "string" &&
    typeof value.raw_blocks === "string" &&
    typeof value.section_fingerprints === "string" &&
    typeof value.incremental_state === "string" &&
    typeof value.nodes === "string" &&
    typeof value.sections === "string" &&
    typeof value.sources === "string" &&
    typeof value.graph === "string" &&
    typeof value.terms === "string" &&
    typeof value.archives === "string" &&
    typeof value.decisions === "string";
}

export function isContextCacheManifest(value: unknown): value is IncrementalCacheManifest {
  if (!isObject(value)) return false;
  const incremental = value.incremental;
  const retrieval = value.retrieval;
  return value.schema_version === CONTEXT_CACHE_SCHEMA_VERSION &&
    typeof value.project_id === "string" &&
    typeof value.workspace_root === "string" &&
    isObject(value.input_summary) &&
    (value.status === "ready" || value.status === "unknown") &&
    isManifestFiles(value.files) &&
    isManifestCounts(value.counts) &&
    typeof value.updated_at === "string" &&
    isObject(incremental) &&
    incremental.schema === INCREMENTAL_SCHEMA_VERSION &&
    isObject(incremental.inputs) &&
    isManifestCounts(incremental.counts) &&
    (incremental.status === "ready" || incremental.status === "unknown") &&
    typeof incremental.updated_at === "string" &&
    isObject(retrieval) &&
    retrieval.schema === RETRIEVAL_SCHEMA_VERSION &&
    isObject(retrieval.inputs) &&
    isRetrievalCounts(retrieval.counts) &&
    (retrieval.status === "ready" || retrieval.status === "stale" || retrieval.status === "unknown") &&
    typeof retrieval.updated_at === "string" &&
    isManifestPaths(value.paths);
}

function isRebuildableUnknownReason(reason: string | undefined): boolean {
  return reason === "incremental-cache-not-built" ||
    (typeof reason === "string" && reason.startsWith("providers-missing:"));
}

export async function writeIncrementalCacheAtomic(
  filePath: string,
  payload: unknown,
  options: { beforeRename?: (tmpPath: string) => Promise<void> | void } = {},
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await options.beforeRename?.(tmpPath);
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

export async function readIncrementalCache(input: IncrementalCachePathInput & {
  inputSummary?: IncrementalInputSummary;
}): Promise<ReadIncrementalCacheResult> {
  const paths = await getIncrementalCachePaths(input);
  const expectedSummary = input.inputSummary ?? defaultInputSummary(paths);

  let raw: string;
  try {
    raw = await readFile(paths.manifest, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: "missing", paths, canRebuild: true, reason: "manifest-missing" };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", paths, canRebuild: true, reason: "manifest-json-invalid" };
  }

  if (!isContextCacheManifest(parsed)) {
    return { status: "stale", paths, canRebuild: true, reason: "manifest-schema-mismatch" };
  }
  if (parsed.project_id !== paths.projectId) {
    return { status: "stale", paths, canRebuild: true, reason: "project-id-mismatch", manifest: parsed };
  }
  if (parsed.workspace_root !== paths.workspaceRoot) {
    return { status: "stale", paths, canRebuild: true, reason: "workspace-root-mismatch", manifest: parsed };
  }
  if (stableJson(parsed.incremental.inputs) !== stableJson(expectedSummary)) {
    return { status: "stale", paths, canRebuild: true, reason: "input-summary-changed", manifest: parsed };
  }
  if (parsed.status === "unknown") {
    const reason = parsed.reason ?? "cache-baseline-unknown";
    return { status: "unknown", paths, canRebuild: isRebuildableUnknownReason(reason), reason, manifest: parsed };
  }
  return { status: "ready", paths, canRebuild: false, reason: "ready", manifest: parsed };
}

export function emptyCounts(): IncrementalCacheCounts {
  return {
    content_hashes: 0,
    snapshots: 0,
    origins: 0,
    source_digests: 0,
    raw_blocks: 0,
    section_fingerprints: 0,
    state_unknown_inputs: 0,
  };
}

export function emptyRetrievalCounts(): RetrievalCacheCounts {
  return {
    nodes: 0,
    sections: 0,
    sources: 0,
    graph_edges: 0,
    terms: 0,
    archives: 0,
    decisions: 0,
  };
}

function cacheFiles(): IncrementalCacheManifest["files"] {
  return {
    cas_index: "cas-index.json",
    source_digests: "source-digests.json",
    raw_blocks: "raw-blocks.json",
    section_fingerprints: "section-fingerprints.json",
    incremental_state: "incremental-state.json",
  };
}

export function contextCacheManifestPaths(): ContextCacheManifestPaths {
  return {
    ...cacheFiles(),
    nodes: "nodes.json",
    sections: "sections.json",
    sources: "sources.json",
    graph: "graph.json",
    terms: "terms.json",
    archives: "archives.json",
    decisions: "decisions.json",
  };
}

export function createContextCacheManifest(input: {
  paths: IncrementalCachePaths;
  incrementalInputs: IncrementalInputSummary;
  incrementalCounts: IncrementalCacheCounts;
  incrementalStatus: "ready" | "unknown";
  updatedAt: string;
  incrementalReason?: string;
  retrievalInputs?: RetrievalInputSummary;
  retrievalCounts?: RetrievalCacheCounts;
  retrievalStatus?: "ready" | "stale" | "unknown";
  retrievalReason?: string;
}): IncrementalCacheManifest {
  const retrievalInputs = input.retrievalInputs ?? { workspace_root: input.paths.workspaceRoot };
  const retrievalCounts = input.retrievalCounts ?? emptyRetrievalCounts();
  const retrievalStatus = input.retrievalStatus ?? "unknown";
  const manifest: IncrementalCacheManifest = {
    schema_version: CONTEXT_CACHE_SCHEMA_VERSION,
    project_id: input.paths.projectId,
    workspace_root: input.paths.workspaceRoot,
    input_summary: input.incrementalInputs,
    status: input.incrementalStatus,
    ...(input.incrementalReason !== undefined ? { reason: input.incrementalReason } : {}),
    files: cacheFiles(),
    counts: input.incrementalCounts,
    updated_at: input.updatedAt,
    incremental: {
      schema: INCREMENTAL_SCHEMA_VERSION,
      inputs: input.incrementalInputs,
      counts: input.incrementalCounts,
      status: input.incrementalStatus,
      ...(input.incrementalReason !== undefined ? { reason: input.incrementalReason } : {}),
      updated_at: input.updatedAt,
    },
    retrieval: {
      schema: RETRIEVAL_SCHEMA_VERSION,
      inputs: retrievalInputs,
      counts: retrievalCounts,
      status: retrievalStatus,
      ...(input.retrievalReason !== undefined ? { reason: input.retrievalReason } : {}),
      updated_at: input.updatedAt,
    },
    paths: contextCacheManifestPaths(),
  };
  return manifest;
}

function countTopLevelRecords(value: unknown): number {
  if (!isObject(value)) return 0;
  if (isObject(value.sources)) return Object.keys(value.sources).length;
  if (isObject(value.snapshots)) {
    let blockCount = 0;
    for (const snapshot of Object.values(value.snapshots)) {
      if (isObject(snapshot) && Array.isArray(snapshot.blocks)) {
        blockCount += snapshot.blocks.length;
      }
    }
    return blockCount > 0 ? blockCount : Object.keys(value.snapshots).length;
  }
  if (Array.isArray(value.sections)) return value.sections.length;
  return Object.keys(value).length;
}

export async function rebuildIncrementalCache(input: RebuildIncrementalCacheInput): Promise<RebuildIncrementalCacheResult> {
  const paths = await getIncrementalCachePaths(input);
  const now = input.now ?? new Date();
  const inputSummary = input.inputSummary ?? defaultInputSummary(paths);
  const providers = input.providers ?? {};
  const ctx: RebuildProviderContext = {
    paths,
    workspaceRoot: paths.workspaceRoot,
    inputSummary,
    now,
  };
  const missingProviders: string[] = [];
  const counts = emptyCounts();

  let reason: string | undefined;
  if (providers.casIndex) {
    const casIndex = await providers.casIndex(ctx);
    counts.content_hashes = casIndex.counts.content_hashes;
    counts.snapshots = casIndex.counts.snapshots;
    counts.origins = casIndex.counts.origins;
    await writeIncrementalCacheAtomic(paths.casIndex, casIndex);
  } else {
    missingProviders.push("casIndex");
  }

  if (providers.sourceDigests) {
    const sourceDigests = await providers.sourceDigests(ctx);
    counts.source_digests = countTopLevelRecords(sourceDigests);
    await writeIncrementalCacheAtomic(paths.sourceDigests, sourceDigests);
  } else {
    missingProviders.push("sourceDigests");
  }

  if (providers.rawBlocks) {
    const rawBlocks = await providers.rawBlocks(ctx);
    counts.raw_blocks = countTopLevelRecords(rawBlocks);
    await writeIncrementalCacheAtomic(paths.rawBlocks, rawBlocks);
  } else {
    missingProviders.push("rawBlocks");
  }

  if (providers.sectionFingerprints) {
    const sectionFingerprints = await providers.sectionFingerprints(ctx);
    counts.section_fingerprints = countTopLevelRecords(sectionFingerprints);
    await writeIncrementalCacheAtomic(paths.sectionFingerprints, sectionFingerprints);
  } else {
    missingProviders.push("sectionFingerprints");
  }

  reason = missingProviders.length > 0
    ? `providers-missing:${missingProviders.join(",")}`
    : undefined;
  const state = providers.state
    ? await providers.state(ctx)
    : reason
      ? createUnknownIncrementalState({ reason, scope: "cache-rebuild", now })
      : createEmptyIncrementalState(now);
  counts.state_unknown_inputs = state.unknown_inputs.length;
  await writeIncrementalState(paths.state, state);

  const manifest = createContextCacheManifest({
    paths,
    incrementalInputs: inputSummary,
    incrementalCounts: counts,
    incrementalStatus: reason ? "unknown" : "ready",
    ...(reason !== undefined ? { incrementalReason: reason } : {}),
    updatedAt: now.toISOString(),
  });
  await writeIncrementalCacheAtomic(paths.manifest, manifest);

  return {
    status: manifest.status,
    paths,
    manifest,
    missingProviders,
  };
}
