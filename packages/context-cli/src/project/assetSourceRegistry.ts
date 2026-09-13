// Source snapshot access for asset projection, not article evidence validation.
import { join } from "node:path";
import { loadSourcesRegistry, type FileSourceRegistryEntry, type LarkSourceRegistryEntry } from "@c4a/context";
import type { DocumentSourceType } from "@c4a/extract";
import { buildCommittedEvidenceIndex } from "./documentEvidenceIndex.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";

type DocumentSourceRegistryEntry = Pick<FileSourceRegistryEntry | LarkSourceRegistryEntry, "id" | "name" | "materializedAt" | "snapshot">;

export interface SourceRegistryLookup {
  loaded: boolean;
  names: {
    repo: ReadonlySet<string>;
    file: ReadonlySet<string>;
    lark: ReadonlySet<string>;
    note: ReadonlySet<string>;
    sessions: ReadonlySet<string>;
  };
  documents: {
    file: ReadonlyMap<string, DocumentSourceRegistryEntry>;
    lark: ReadonlyMap<string, DocumentSourceRegistryEntry>;
    note: ReadonlyMap<string, DocumentSourceRegistryEntry>;
    sessions: ReadonlyMap<string, DocumentSourceRegistryEntry>;
  };
}

type CommittedEvidenceIndexResult = Awaited<ReturnType<typeof buildCommittedEvidenceIndex>>;

export interface EvidenceIndexCache {
  entries: Map<string, Promise<CommittedEvidenceIndexResult>>;
  ignoredPaths: Map<string, Promise<boolean>>;
}


function emptySourceRegistryLookup(loaded: boolean): SourceRegistryLookup {
  return {
    loaded,
    names: {
      repo: new Set(),
      file: new Set(),
      lark: new Set(), note: new Set(), sessions: new Set(),
    },
    documents: {
      file: new Map(),
      lark: new Map(), note: new Map(), sessions: new Map(),
    },
  };
}

function sourceEntryMap(entries: readonly DocumentSourceRegistryEntry[]): ReadonlyMap<string, DocumentSourceRegistryEntry> {
  const map = new Map<string, DocumentSourceRegistryEntry>();
  for (const entry of entries) {
    map.set(entry.name, entry);
    map.set(entry.id, entry);
  }
  return map;
}

function sourceRegistryIssuePath(message: string): string {
  if (message.includes("sources/file/index.yaml")) return "sources/file/index.yaml";
  if (message.includes("sources/lark/index.yaml")) return "sources/lark/index.yaml";
  if (message.includes("sources/repo/index.yaml")) return "sources/repo/index.yaml";
  return "sources";
}

export async function loadSourceRegistryLookup(projectRoot: string, issues: ProjectVerifyIssue[]): Promise<SourceRegistryLookup> {
  try {
    const registry = await loadSourcesRegistry({ rootDir: projectRoot });
    return {
      loaded: true,
      names: {
        repo: new Set(registry.repos.flatMap((source) => [source.name, source.id])),
        file: new Set(registry.files.flatMap((source) => [source.name, source.id])),
        lark: new Set(registry.larks.flatMap((source) => [source.name, source.id])),
        note: new Set(registry.notes.map((source) => source.name)),
        sessions: new Set(registry.sessions.map((source) => source.name)),
      },
      documents: {
        file: sourceEntryMap(registry.files),
        lark: sourceEntryMap(registry.larks),
        note: sourceEntryMap(registry.notes),
        sessions: sourceEntryMap(registry.sessions),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({
      severity: "error",
      code: "sources-registry-invalid",
      path: sourceRegistryIssuePath(message),
      message,
    });
    return emptySourceRegistryLookup(false);
  }
}

export function hasRegisteredSource(registry: SourceRegistryLookup, sourceType: "repo" | DocumentSourceType, sourceName: string): boolean {
  return registry.names[sourceType].has(sourceName);
}

export function registeredDocumentSource(
  registry: SourceRegistryLookup,
  sourceType: DocumentSourceType,
  sourceName: string,
): DocumentSourceRegistryEntry | undefined {
  return registry.documents[sourceType].get(sourceName);
}

export function defaultDocumentMaterializedAt(sourceType: DocumentSourceType, sourceName: string): string {
  return join("sources", sourceType, sourceName);
}

export function defaultDocumentManifest(materializedAt: string): string {
  return join(materializedAt, "manifest.json");
}


export async function getCommittedEvidenceIndex(input: {
  projectRoot: string;
  sourceType: DocumentSourceType;
  sourceName: string;
  materializedAt: string;
  manifestPath: string;
  cache: EvidenceIndexCache;
}): Promise<CommittedEvidenceIndexResult> {
  const key = `${input.sourceType}:${input.sourceName}:${input.materializedAt}:${input.manifestPath}`;
  const existing = input.cache.entries.get(key);
  if (existing !== undefined) return existing;
  const promise = buildCommittedEvidenceIndex({
    projectRoot: input.projectRoot,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    materializedAt: input.materializedAt,
    manifestPath: input.manifestPath,
    writeRuntimeIndex: false,
  });
  input.cache.entries.set(key, promise);
  return promise;
}
