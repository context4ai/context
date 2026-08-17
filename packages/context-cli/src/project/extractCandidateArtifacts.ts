import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtractCustomPhaseDefinition, ExtractTsPhaseDefinition } from "@c4a/context";
import type { SymbolInfo } from "@c4a/extract";
import type { SourceSymbolSnapshot } from "./extractCandidateTypes.js";
import type {
  ExtractPhaseSourceFingerprintFile,
  ExtractPhaseSourceFingerprintRecord,
  ExtractSourceSymbolIndexEntry,
  ExtractSourceSymbolIndexFile,
} from "./extractCandidateTypes.js";

const SNAPSHOT_ROOT = join(".tmp", "context-runtime", "extract", "candidates");
const EXTRACT_SOURCE_FINGERPRINT_FILE = join(".tmp", "context-runtime", "extract", "source-fingerprints.json");
const EXTRACT_SOURCE_SYMBOL_INDEX_FILE = join(".tmp", "context-runtime", "extract", "source-symbols.json");

export function stableHash(value: unknown, length?: number): string {
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return length === undefined ? `sha256:${hash}` : hash.slice(0, length);
}

export function symbolShapeDigest(symbol: SymbolInfo): string {
  return stableHash({
    name: symbol.name,
    kind: symbol.kind,
    visibility: symbol.visibility,
    params: symbol.params,
    returnType: symbol.returnType,
    typeAnnotation: symbol.typeAnnotation,
    propsType: symbol.propsType,
    members: symbol.members?.map((member) => ({
      name: member.name,
      kind: member.kind,
    })),
  }, 12);
}

export function canonicalSourceRef(sourceName: string, symbol: SymbolInfo): string {
  const digest = symbolShapeDigest(symbol);
  return `repo:${sourceName}#symbol:${symbol.file}:${symbol.name}:${symbol.kind}@${digest}`;
}

export type CodeExtractionPhaseDefinition = ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition;

function transformFingerprint(phase: ExtractTsPhaseDefinition): string[] {
  const transforms = Array.isArray(phase.transform)
    ? phase.transform
    : phase.transform
      ? [phase.transform]
      : [];
  return transforms.map((transform) => String(transform));
}

export function extractPhaseSourceFingerprint(input: {
  phase: CodeExtractionPhaseDefinition;
  sources: ReadonlyArray<{
    record: {
      name: string;
      git: { ref: string };
      subpath?: string;
    };
    status: { head?: string; scopeHash?: string; materializedAt: string };
  }>;
}): ExtractPhaseSourceFingerprintRecord {
  const sources = input.sources
    .map((source) => ({
      name: source.record.name,
      ref: source.record.git.ref,
      ...(source.status.head !== undefined ? { head: source.status.head } : {}),
      ...(source.record.subpath !== undefined ? { subpath: source.record.subpath } : {}),
      scopeHash: source.status.scopeHash ?? "unknown",
      materializedAt: source.status.materializedAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const freshnessSources = sources.map((source) => ({
    name: source.name,
    ...(source.subpath !== undefined ? { subpath: source.subpath } : {}),
    scopeHash: source.scopeHash,
    materializedAt: source.materializedAt,
  }));
  const phase = input.phase.kind === "phase.extract.ts"
    ? {
        kind: input.phase.kind,
        id: input.phase.id,
        source: input.phase.source.kind === "source.collection"
          ? { kind: input.phase.source.kind, type: input.phase.source.type }
          : {
              kind: input.phase.source.kind,
              name: input.phase.source.name,
              materializedAt: input.phase.source.materializedAt,
            },
        collection: input.phase.collection,
        include: [...input.phase.include],
        mode: input.phase.mode,
        ...(input.phase.entries !== undefined ? { entries: [...input.phase.entries] } : {}),
        exportedOnly: input.phase.exportedOnly,
        transform: transformFingerprint(input.phase),
      }
    : {
        kind: input.phase.kind,
        id: input.phase.id,
        sources: input.phase.sources.map((source) => source.kind === "source.collection"
          ? { kind: source.kind, type: source.type }
          : { kind: source.kind, name: source.name, materializedAt: source.materializedAt }),
        collection: input.phase.collection,
        extractor: String(input.phase.extract),
      };
  const fingerprint = stableHash({
    phase,
    sources: freshnessSources,
  });
  return {
    phaseId: input.phase.id,
    collection: input.phase.collection,
    fingerprint,
    sources,
    updatedAt: new Date().toISOString(),
  };
}

export async function readExtractSourceFingerprints(projectRoot: string): Promise<ExtractPhaseSourceFingerprintFile> {
  const filePath = join(projectRoot, EXTRACT_SOURCE_FINGERPRINT_FILE);
  if (!existsSync(filePath)) return { version: 1, phases: {} };
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { version: 1, phases: {} };
    const version = (parsed as { version?: unknown }).version;
    const phases = (parsed as { phases?: unknown }).phases;
    if (version !== 1 || phases === null || typeof phases !== "object" || Array.isArray(phases)) {
      return { version: 1, phases: {} };
    }
    return parsed as ExtractPhaseSourceFingerprintFile;
  } catch {
    return { version: 1, phases: {} };
  }
}

export async function writeExtractSourceFingerprint(input: {
  projectRoot: string;
  record: ExtractPhaseSourceFingerprintRecord;
}): Promise<void> {
  const filePath = join(input.projectRoot, EXTRACT_SOURCE_FINGERPRINT_FILE);
  const current = await readExtractSourceFingerprints(input.projectRoot);
  const next: ExtractPhaseSourceFingerprintFile = {
    version: 1,
    phases: {
      ...current.phases,
      [input.record.phaseId]: input.record,
    },
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function readExtractSourceSymbolIndex(projectRoot: string): Promise<ExtractSourceSymbolIndexFile | null> {
  const filePath = join(projectRoot, EXTRACT_SOURCE_SYMBOL_INDEX_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const version = (parsed as { version?: unknown }).version;
    const phaseFingerprints = (parsed as { phaseFingerprints?: unknown }).phaseFingerprints;
    const symbols = (parsed as { symbols?: unknown }).symbols;
    if (version !== 2 || !Array.isArray(symbols)) return null;
    const normalizedPhaseFingerprints: Record<string, string> = {};
    if (phaseFingerprints !== undefined) {
      if (phaseFingerprints === null || typeof phaseFingerprints !== "object" || Array.isArray(phaseFingerprints)) return null;
      for (const [phaseId, fingerprint] of Object.entries(phaseFingerprints)) {
        if (typeof fingerprint !== "string") return null;
        normalizedPhaseFingerprints[phaseId] = fingerprint;
      }
    }
    const entries = symbols.filter((entry): entry is ExtractSourceSymbolIndexEntry => (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as { source?: unknown }).source === "string" &&
      typeof (entry as { file?: unknown }).file === "string" &&
      typeof (entry as { name?: unknown }).name === "string" &&
      typeof (entry as { kind?: unknown }).kind === "string" &&
      typeof (entry as { digest?: unknown }).digest === "string"
    ));
    if (entries.length !== symbols.length) return null;
    return {
      version: 2,
      phaseFingerprints: normalizedPhaseFingerprints,
      symbols: entries,
    };
  } catch {
    return null;
  }
}

export async function writeExtractSourceSymbolIndex(input: {
  projectRoot: string;
  phaseFingerprint: ExtractPhaseSourceFingerprintRecord;
  sourceNames: ReadonlySet<string>;
  symbols: readonly ExtractSourceSymbolIndexEntry[];
  removeSymbols?: readonly ExtractSourceSymbolIndexEntry[];
}): Promise<void> {
  const filePath = join(input.projectRoot, EXTRACT_SOURCE_SYMBOL_INDEX_FILE);
  const current = await readExtractSourceSymbolIndex(input.projectRoot);
  const removedKeys = new Set((input.removeSymbols ?? []).map((entry) =>
    `${entry.source}\u0000${entry.file}\u0000${entry.name}\u0000${entry.kind}\u0000${entry.digest}`
  ));
  const mergedSymbols = [
    ...(current?.symbols ?? []).filter((entry) => (
      !input.sourceNames.has(entry.source) &&
      !removedKeys.has(`${entry.source}\u0000${entry.file}\u0000${entry.name}\u0000${entry.kind}\u0000${entry.digest}`)
    )),
    ...input.symbols,
  ];
  const nextSymbols = [...new Map(mergedSymbols.map((entry) => [
    `${entry.source}\u0000${entry.file}\u0000${entry.name}\u0000${entry.kind}\u0000${entry.digest}`,
    entry,
  ])).values()].sort((left, right) =>
    `${left.source}:${left.file}:${left.name}:${left.kind}:${left.digest}`.localeCompare(`${right.source}:${right.file}:${right.name}:${right.kind}:${right.digest}`)
  );
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    version: 2,
    phaseFingerprints: {
      ...(current?.phaseFingerprints ?? {}),
      [input.phaseFingerprint.phaseId]: input.phaseFingerprint.fingerprint,
    },
    symbols: nextSymbols,
  }, null, 2)}\n`, "utf8");
}

export async function writeCandidateSnapshot(input: SourceSymbolSnapshot & {
  projectRoot: string;
  runId: string;
  phaseFingerprint: ExtractPhaseSourceFingerprintRecord;
}): Promise<void> {
  await writeCodeCandidateSnapshot({
    projectRoot: input.projectRoot,
    candidate: input.candidate,
    sourceName: input.source.name,
    symbol: {
      name: input.symbol.name,
      kind: input.symbol.kind,
      visibility: input.symbol.visibility,
      file: input.symbol.file,
      line: input.symbol.line,
      ...(input.symbol.members !== undefined
        ? { members: input.symbol.members.map((member) => ({ name: member.name, kind: member.kind })) }
        : {}),
    },
    markdown: input.markdown,
    runId: input.runId,
    phaseFingerprint: input.phaseFingerprint,
  });
}

export async function writeCodeCandidateSnapshot(input: {
  projectRoot: string;
  candidate: SourceSymbolSnapshot["candidate"];
  sourceName: string;
  symbol?: {
    name: string;
    kind: string;
    visibility: string;
    file: string;
    line: number;
    members?: Array<{ name?: string; kind?: string }>;
  };
  markdown: string;
  runId: string;
  phaseFingerprint: ExtractPhaseSourceFingerprintRecord;
}): Promise<void> {
  const snapshotPath = join(input.projectRoot, SNAPSHOT_ROOT, `${input.candidate.candidate_id}.json`);
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify({
    candidate_id: input.candidate.candidate_id,
    node_ref: input.candidate.node_ref,
    view_ref: input.candidate.view_ref,
    collection: input.candidate.collection,
    source: input.sourceName,
    source_refs: input.candidate.source_refs,
    phase_id: input.phaseFingerprint.phaseId,
    phase_fingerprint: input.phaseFingerprint.fingerprint,
    ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
    markdown: input.markdown,
    run_id: input.runId,
  }, null, 2)}\n`, "utf8");
}

function isSafeSnapshotId(id: string): boolean {
  return id.length > 0 &&
    !id.startsWith("/") &&
    !/^[a-zA-Z]:[\\/]/u.test(id) &&
    id.split(/[\\/]+/u).every((part) => part.length > 0 && part !== "." && part !== "..");
}

export async function removeCandidateSnapshot(projectRoot: string, id: string): Promise<void> {
  if (!isSafeSnapshotId(id)) return;
  const snapshotPath = join(projectRoot, SNAPSHOT_ROOT, `${id}.json`);
  await rm(snapshotPath, { force: true });
  await removeEmptySnapshotDirs(projectRoot, dirname(snapshotPath));
}

async function removeEmptySnapshotDirs(projectRoot: string, startDir: string): Promise<void> {
  const root = join(projectRoot, SNAPSHOT_ROOT);
  let current = startDir;
  while (current.startsWith(root) && current !== root) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}
