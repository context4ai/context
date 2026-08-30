import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type {
  ExtractCustomPhaseDefinition,
  ExtractTsPhaseDefinition,
  PhaseDefinition,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import {
  prepareExtractCustomPhase,
  type ExtractCustomPreparedRun,
} from "./customExtractCandidates.js";
import {
  extractPhaseSourceFingerprint,
  prepareExtractTsPhase,
} from "./extractCandidates.js";
import { selectRepoSourcesForExtraction } from "./extractSourceSelection.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import type {
  ExtractionBatchPreview,
  ExtractionPhasePreview,
  ExtractTsPreparedRun,
} from "./extractCandidateTypes.js";

export const EXTRACTION_PREVIEW_ROOT = ".tmp/context-runtime/extract/previews" as const;
const EXTRACTION_BATCH_PREVIEW_FILE = join(EXTRACTION_PREVIEW_ROOT, "batch.json");
const EXTRACTION_PREVIEW_INPUT_VERSION = "context.extraction-preview-input.v1";

type CodeExtractionPhase = ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition;
type PreparedExtraction = ExtractTsPreparedRun | ExtractCustomPreparedRun;

interface ExtractionPhaseCacheFile {
  version: 2;
  phaseId: string;
  phaseKind: CodeExtractionPhase["kind"];
  fingerprint: string;
  preview: ExtractionPhasePreview;
  prepared?: PreparedExtraction;
}

interface ExtractionBatchCacheFile {
  version: 3;
  preview: ExtractionBatchPreview;
  phaseFingerprints: Record<string, string>;
}

export interface ExtractionPreviewState {
  current: boolean;
  capabilityClear: boolean;
  ownershipClear: boolean;
  scaleClear: boolean;
  digest?: string;
  report?: ExtractionBatchPreview;
}

function isCodeExtractionPhase(phase: PhaseDefinition): phase is CodeExtractionPhase {
  return phase.kind === "phase.extract.ts" || phase.kind === "phase.extract.custom";
}

function phaseCachePath(projectRoot: string, fingerprint: string): string {
  return join(projectRoot, EXTRACTION_PREVIEW_ROOT, `${fingerprint.replace(/^sha256:/u, "")}.json`);
}

async function parseJson<T>(path: string): Promise<T | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function reusablePreview(preview: ExtractionPhasePreview): boolean {
  return preview.indexUnits.every((unit) =>
    unit.plan === "declared" &&
    unit.scale !== "blocked" &&
    unit.capability !== "material-required" &&
    !unit.risks.includes("module-classification-required") &&
    !unit.risks.includes("ownership-ambiguous")
  );
}

async function listProjectInputFiles(projectRoot: string): Promise<string[]> {
  const files = ["package.json", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
    .filter((path) => existsSync(join(projectRoot, path)));
  const sourceRoot = join(projectRoot, "src");
  const visit = async (directory: string): Promise<void> => {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(projectRoot, path));
    }
  };
  await visit(sourceRoot);
  return files.sort();
}

async function projectInputDigest(projectRoot: string): Promise<string> {
  const files = await listProjectInputFiles(projectRoot);
  const content: Array<{ path: string; value: string }> = [];
  for (const path of files) {
    content.push({ path, value: await readFile(join(projectRoot, path), "utf8") });
  }
  return stableHash({ version: EXTRACTION_PREVIEW_INPUT_VERSION, files: content });
}

async function previewFingerprint(input: {
  projectRoot: string;
  phase: CodeExtractionPhase;
  projectDigest?: string;
}): Promise<string> {
  const sources = await selectRepoSourcesForExtraction({
    projectRoot: input.projectRoot,
    phase: input.phase,
    materialize: false,
  });
  const sourceFingerprint = extractPhaseSourceFingerprint({ phase: input.phase, sources }).fingerprint;
  return stableHash({
    version: EXTRACTION_PREVIEW_INPUT_VERSION,
    sourceFingerprint,
    projectInputDigest: input.projectDigest ?? await projectInputDigest(input.projectRoot),
  });
}

async function readCurrentPhaseCache(input: {
  projectRoot: string;
  phase: CodeExtractionPhase;
  projectDigest?: string;
}): Promise<ExtractionPhaseCacheFile | undefined> {
  const fingerprint = await previewFingerprint(input);
  const cached = await parseJson<ExtractionPhaseCacheFile>(
    phaseCachePath(input.projectRoot, fingerprint),
  );
  if (
    cached?.version !== 2 ||
    cached.phaseId !== input.phase.id ||
    cached.phaseKind !== input.phase.kind
  ) return undefined;
  return cached.fingerprint === fingerprint ? cached : undefined;
}

async function writePhaseCache(input: {
  projectRoot: string;
  phase: CodeExtractionPhase;
  prepared: PreparedExtraction;
  projectDigest?: string;
}): Promise<ExtractionPhaseCacheFile> {
  const preview = input.prepared.preview;
  const fingerprint = await previewFingerprint({
    projectRoot: input.projectRoot,
    phase: input.phase,
    ...(input.projectDigest === undefined ? {} : { projectDigest: input.projectDigest }),
  });
  const cached: ExtractionPhaseCacheFile = {
    version: 2,
    phaseId: input.phase.id,
    phaseKind: input.phase.kind,
    fingerprint,
    preview,
    ...(reusablePreview(preview) ? { prepared: input.prepared } : {}),
  };
  const path = phaseCachePath(input.projectRoot, fingerprint);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, `${JSON.stringify(cached)}\n`);
  return cached;
}

async function previewPhase(input: {
  projectRoot: string;
  phase: CodeExtractionPhase;
  projectDigest?: string;
}): Promise<{ cached: ExtractionPhaseCacheFile; hit: boolean }> {
  const cached = await readCurrentPhaseCache(input);
  if (cached !== undefined) return { cached, hit: true };
  const runId = `preview_${Date.now()}_${stableHash(input.phase.id, 10)}`;
  const prepared = input.phase.kind === "phase.extract.ts"
    ? await prepareExtractTsPhase({
        projectRoot: input.projectRoot,
        phase: input.phase,
      })
    : await prepareExtractCustomPhase({
        projectRoot: input.projectRoot,
        phase: input.phase,
        runId,
      });
  return {
    cached: await writePhaseCache({
      projectRoot: input.projectRoot,
      phase: input.phase,
      prepared,
      ...(input.projectDigest === undefined ? {} : { projectDigest: input.projectDigest }),
    }),
    hit: false,
  };
}

export async function previewExtractionBatch(input: {
  projectRoot: string;
  phases: readonly PhaseDefinition[];
  phaseIds?: readonly string[];
}): Promise<ExtractionBatchPreview> {
  const startedAt = Date.now();
  const requested = new Set(input.phaseIds ?? []);
  const projectDigest = await projectInputDigest(input.projectRoot);
  const extractionPhases = input.phases.filter((phase): phase is CodeExtractionPhase =>
    isCodeExtractionPhase(phase) && (requested.size === 0 || requested.has(phase.id))
  );
  const cachedPhases = [] as ExtractionPhaseCacheFile[];
  let cacheHits = 0;
  for (const phase of extractionPhases) {
    const result = await previewPhase({ projectRoot: input.projectRoot, phase, projectDigest });
    cachedPhases.push(result.cached);
    if (result.hit) cacheHits += 1;
  }
  const phases = cachedPhases.map((cached) => cached.preview);
  const phaseFingerprints = Object.fromEntries(cachedPhases.map((cached) => [
    cached.phaseId,
    cached.fingerprint,
  ]));
  const indexUnits = phases.flatMap((phase) => phase.indexUnits);
  const projectedPages = indexUnits.reduce((sum, unit) => sum + unit.projectedPageCount, 0);
  const totals = {
    phases: phases.length,
    indexUnits: indexUnits.length,
    projectedPages,
    contentBytes: indexUnits.reduce((sum, unit) => sum + unit.contentBytes.total, 0),
    warnings: indexUnits.filter((unit) => unit.scale === "warning").length,
    blocked: indexUnits.filter((unit) => unit.scale === "blocked").length,
  };
  const advisories = projectedPages > 300 ? ["batch-page-count-warning"] : [];
  const capabilityClear = indexUnits.every((unit) => unit.capability !== "material-required");
  const ownershipClear = indexUnits.every((unit) => !unit.risks.includes("ownership-ambiguous"));
  const scaleClear = indexUnits.every((unit) => unit.scale !== "blocked");
  const preview: ExtractionBatchPreview = {
    schema: "context.extraction-batch-preview.v1",
    digest: stableHash({
      phaseFingerprints,
      phases,
      totals,
      advisories,
      capabilityClear,
      ownershipClear,
      scaleClear,
    }),
    createdAt: new Date().toISOString(),
    phases,
    totals,
    advisories,
    capabilityClear,
    ownershipClear,
    scaleClear,
    cache: {
      root: EXTRACTION_PREVIEW_ROOT,
      reusablePhases: cachedPhases.filter((cached) => cached.prepared !== undefined).length,
      hits: cacheHits,
      extractorInvocations: cachedPhases.length - cacheHits,
      previewDurationMs: Date.now() - startedAt,
    },
  };
  const batchPath = join(input.projectRoot, EXTRACTION_BATCH_PREVIEW_FILE);
  await mkdir(dirname(batchPath), { recursive: true });
  await atomicWriteFile(batchPath, `${JSON.stringify({
    version: 3,
    preview,
    phaseFingerprints,
  } satisfies ExtractionBatchCacheFile, null, 2)}\n`);
  await atomicWriteFile(
    join(input.projectRoot, EXTRACTION_PREVIEW_ROOT, `${preview.digest.replace(/^sha256:/u, "")}.json`),
    `${JSON.stringify({
      version: 3,
      preview,
      phaseFingerprints,
    } satisfies ExtractionBatchCacheFile, null, 2)}\n`,
  );
  return preview;
}

export async function readReusableExtractionPreparation(input: {
  projectRoot: string;
  phase: CodeExtractionPhase;
}): Promise<PreparedExtraction | undefined> {
  return (await readCurrentPhaseCache(input))?.prepared;
}

export async function readLatestExtractionBatchPreview(
  projectRoot: string,
): Promise<ExtractionBatchPreview | undefined> {
  const cached = await parseJson<ExtractionBatchCacheFile>(
    join(projectRoot, EXTRACTION_BATCH_PREVIEW_FILE),
  );
  return cached?.version === 3 ? cached.preview : undefined;
}

export async function readExtractionBatchPreviewByDigest(
  projectRoot: string,
  digest: string,
): Promise<ExtractionBatchPreview | undefined> {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(digest);
  if (match?.[1] === undefined) return undefined;
  const cached = await parseJson<ExtractionBatchCacheFile>(
    join(projectRoot, EXTRACTION_PREVIEW_ROOT, `${match[1]}.json`),
  );
  if (cached?.version !== 3 || cached.preview.digest !== digest) return undefined;
  return cached.preview;
}

export async function readExtractionPreviewState(input: {
  projectRoot: string;
  pendingPhaseIds: readonly string[];
  phases: readonly PhaseDefinition[];
}): Promise<ExtractionPreviewState> {
  if (input.pendingPhaseIds.length === 0) {
    return { current: true, capabilityClear: true, ownershipClear: true, scaleClear: true };
  }
  const cached = await parseJson<ExtractionBatchCacheFile>(
    join(input.projectRoot, EXTRACTION_BATCH_PREVIEW_FILE),
  );
  let current = cached?.version === 3;
  if (current && cached !== undefined) {
    const projectDigest = await projectInputDigest(input.projectRoot);
    for (const phaseId of input.pendingPhaseIds) {
      const phase = input.phases.find((candidate): candidate is CodeExtractionPhase =>
        candidate.id === phaseId && isCodeExtractionPhase(candidate)
      );
      if (phase === undefined) {
        current = false;
        break;
      }
      const phaseCache = await readCurrentPhaseCache({ projectRoot: input.projectRoot, phase, projectDigest });
      if (phaseCache === undefined || cached.phaseFingerprints[phaseId] !== phaseCache.fingerprint) {
        current = false;
        break;
      }
    }
  }
  if (!current || cached === undefined) {
    return { current: false, capabilityClear: true, ownershipClear: true, scaleClear: true };
  }
  return {
    current: true,
    capabilityClear: cached.preview.capabilityClear,
    ownershipClear: cached.preview.ownershipClear,
    scaleClear: cached.preview.scaleClear,
    digest: cached.preview.digest,
    report: cached.preview,
  };
}
