import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtractCustomPhaseDefinition,
  ExtractTsPhaseDefinition,
  FileSourceRegistryEntry,
  LarkSourceRegistryEntry,
  KnowledgeCollection,
  PackageDefinition,
  PhaseDefinition,
} from "@c4a/context";
import YAML from "yaml";
import { ContextError } from "../lib/errors.js";
import { fileSourceIncludeMismatchDiagnostic } from "./documentCapture.js";
import { documentSnapshotFidelityState, readDocumentSnapshotCaptureReport } from "./documentSnapshotFidelity.js";
import {
  detectDocumentSiteFiles,
  documentSiteConfigHint,
  manifestUsesMdxJsonDocs,
  projectUsesMdxJsonDocsForSource,
} from "./documentSiteDetection.js";
import { readDocumentSourcesRegistry } from "./documentSources.js";
import { extractPhaseSourceFingerprint, readExtractSourceFingerprints } from "./extractCandidates.js";
import { larkSnapshotIdentityDiagnostic } from "./larkSourceIdentity.js";
import { collectPackageFreshness, type PackageFreshness } from "./packageBuilder.js";
import { STRUCTURE_FILE } from "./proseCompileConstants.js";
import { findDocumentSnapshotForSource } from "./documentBatchManifest.js";
import { diagnoseRepoSources, listRepoSources, type RepoSourceRecord, type RepoSourceStatus } from "./repoSources.js";
import { readProjectCloseStatus, type ProjectCloseStatus } from "./close.js";
import type {
  DocumentSourceStatus,
  SourceFreshnessState,
} from "./statusTypes.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { candidateSetHash } from "./reviewShared.js";
import { readRejectedDecisions } from "./reviewDecisions.js";
import { verifyProjectWorkspace, type ProjectVerifyIssue } from "./verify.js";
import { loadContextProjectModule } from "./workspace.js";

export async function countFiles(root: string, predicate: (relPath: string) => boolean): Promise<number> {
  if (!existsSync(root)) return 0;
  let count = 0;
  const visit = async (dir: string, prefix = ""): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await visit(abs, rel);
      else if (entry.isFile() && predicate(rel)) count++;
    }
  };
  await visit(root);
  return count;
}

function errorMessage(error: unknown): string {
  if (error instanceof ContextError) {
    const next = error.detail?.next;
    return typeof next === "string" && next.length > 0
      ? `${error.message}; next: ${next}`
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function readDraftCandidateStatus(projectRoot: string): Promise<{
  count: number;
  rejectedCount: number;
  collections: KnowledgeCollection[];
  candidateSetDigest?: string;
  diagnostics: string[];
}> {
  try {
    await readRejectedDecisions(projectRoot);
    const rows = await readCandidateRecords(projectRoot);
    const drafts = rows.filter((row) => row.status === "draft");
    const rejected = rows.filter((row) => row.status === "rejected");
    return {
      count: drafts.length,
      rejectedCount: rejected.length,
      collections: [...new Set(drafts.map((row) => row.collection))].sort(),
      ...(drafts.length > 0 ? { candidateSetDigest: candidateSetHash(drafts) } : {}),
      diagnostics: [],
    };
  } catch (error) {
    if (error instanceof ContextError) {
      return {
        count: 0,
        rejectedCount: 0,
        collections: [],
        diagnostics: [error.message],
      };
    }
    throw error;
  }
}

export interface StructureDraftStatus {
  state: "missing" | "draft" | "confirmed" | "frozen" | "invalid";
  lifecycleState?: string;
  phaseCollection?: string;
  sourceKeys?: string[];
  collections?: string[];
  structureDigest?: string;
  evidenceSnapshotHash?: string;
  nodeCount?: number;
  viewCount?: number;
  sectionCount?: number;
  sourceRefCount?: number;
  edgeCount?: number;
  unresolvedCount?: number;
  diagnostics: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stagedStructureCounts(parsed: Record<string, unknown>): {
  nodeCount: number;
  viewCount: number;
  sectionCount: number;
  sourceRefCount: number;
  edgeCount: number;
  unresolvedCount: number;
} {
  const views = Array.isArray(parsed.views) ? parsed.views : [];
  const sections = views.flatMap((view) =>
    isRecord(view) && Array.isArray(view.sections) ? view.sections : []
  );
  const sourceRefs = new Set(sections.flatMap((section) => {
    if (!isRecord(section)) return [];
    return [
      ...(typeof section.source_ref === "string" ? [section.source_ref] : []),
      ...(Array.isArray(section.source_refs)
        ? section.source_refs.filter((item): item is string => typeof item === "string")
        : []),
    ];
  }));
  return {
    nodeCount: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
    viewCount: views.length,
    sectionCount: sections.length,
    sourceRefCount: sourceRefs.size,
    edgeCount: Array.isArray(parsed.edges) ? parsed.edges.length : 0,
    unresolvedCount: Array.isArray(parsed.unresolved) ? parsed.unresolved.length : 0,
  };
}

export function readStructureDraftStatus(projectRoot: string): StructureDraftStatus {
  const structurePath = join(projectRoot, STRUCTURE_FILE);
  if (!existsSync(structurePath)) return { state: "missing", sourceKeys: [], collections: [], diagnostics: [] };
  try {
    const parsed = YAML.parse(readFileSync(structurePath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return {
        state: "invalid",
        sourceKeys: [],
        collections: [],
        diagnostics: [`${STRUCTURE_FILE} must be a YAML object`],
      };
    }
    const lifecycle = isRecord(parsed.lifecycle) ? parsed.lifecycle : {};
    const lifecycleState = lifecycle.state;
    if (lifecycleState === "draft" || lifecycleState === "confirmed" || lifecycleState === "frozen") {
      const structureDigest = typeof parsed.structure_digest === "string"
        ? parsed.structure_digest
        : typeof lifecycle.structure_digest === "string"
          ? lifecycle.structure_digest
          : undefined;
      const evidenceSnapshotHash = typeof parsed.evidence_snapshot_hash === "string"
        ? parsed.evidence_snapshot_hash
        : undefined;
      return {
        state: lifecycleState,
        lifecycleState,
        ...(typeof lifecycle.phase_collection === "string"
          ? { phaseCollection: lifecycle.phase_collection }
          : {}),
        sourceKeys: Array.isArray(parsed.sources)
          ? parsed.sources.filter((item): item is string => typeof item === "string")
          : [],
        collections: Array.isArray(parsed.views)
          ? [...new Set(parsed.views.flatMap((view) =>
              isRecord(view) && typeof view.collection === "string" ? [view.collection] : []
            ))].sort()
          : [],
        ...(structureDigest === undefined ? {} : { structureDigest }),
        ...(evidenceSnapshotHash === undefined ? {} : { evidenceSnapshotHash }),
        ...stagedStructureCounts(parsed),
        diagnostics: [],
      };
    }
    return {
      state: "invalid",
      sourceKeys: [],
      collections: [],
      diagnostics: [`${STRUCTURE_FILE} lifecycle.state must be draft, confirmed, or frozen`],
    };
  } catch (error) {
    return {
      state: "invalid",
      sourceKeys: [],
      collections: [],
      diagnostics: [`${STRUCTURE_FILE} is invalid YAML: ${errorMessage(error)}`],
    };
  }
}

export async function loadStatusPhases(projectRoot: string): Promise<{
  phases: PhaseDefinition[];
  packages: PackageDefinition[];
  diagnostics: string[];
  projectEntryValid: boolean;
}> {
  try {
    const project = await loadContextProjectModule(projectRoot);
    return {
      phases: [...project.project.phases],
      packages: [...project.project.packages],
      diagnostics: [],
      projectEntryValid: true,
    };
  } catch (error) {
    return {
      phases: [],
      packages: [],
      diagnostics: [`project entry src/index.ts failed to load: ${errorMessage(error)}`],
      projectEntryValid: false,
    };
  }
}

export async function readSourceStatus(projectRoot: string): Promise<{
  sources: RepoSourceRecord[];
  sourceStatuses: RepoSourceStatus[];
  documentSources: DocumentSourceStatus[];
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  let sources: RepoSourceRecord[] = [];
  let sourceStatuses: RepoSourceStatus[] = [];
  let documentSources: DocumentSourceStatus[] = [];
  try {
    sources = await listRepoSources(projectRoot);
    sourceStatuses = sources.length > 0 ? await diagnoseRepoSources({ projectRoot }) : [];
  } catch (error) {
    diagnostics.push(errorMessage(error));
  }
  try {
    const registry = await readDocumentSourcesRegistry(projectRoot);
    documentSources = await Promise.all([
      ...registry.files.map((source) => documentSourceStatus(projectRoot, "file", source)),
      ...registry.larks.map((source) => documentSourceStatus(projectRoot, "lark", source)),
    ]);
    diagnostics.push(...documentSources.flatMap((source) => source.workspaceDiagnostics));
  } catch (error) {
    diagnostics.push(errorMessage(error));
  }
  return {
    sources,
    sourceStatuses,
    documentSources,
    diagnostics,
  };
}

export async function readVerifyStatus(projectRoot: string): Promise<{ issues: ProjectVerifyIssue[]; diagnostics: string[] }> {
  try {
    return {
      issues: (await verifyProjectWorkspace(projectRoot)).issues,
      diagnostics: [],
    };
  } catch (error) {
    return {
      issues: [],
      diagnostics: [errorMessage(error)],
    };
  }
}

export async function readPackageFreshnessStatus(projectRoot: string, packages: readonly PackageDefinition[]): Promise<{
  packages: PackageFreshness[];
  diagnostics: string[];
}> {
  try {
    return {
      packages: await collectPackageFreshness(projectRoot, packages),
      diagnostics: [],
    };
  } catch (error) {
    return {
      packages: [],
      diagnostics: [errorMessage(error)],
    };
  }
}

export async function readCloseStatus(projectRoot: string): Promise<ProjectCloseStatus> {
  try {
    return await readProjectCloseStatus(projectRoot);
  } catch (error) {
    return {
      state: "stale",
      diagnostics: [errorMessage(error)],
    };
  }
}

type CodeExtractionPhaseDefinition = ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition;

function isCodeExtractionPhase(phase: PhaseDefinition): phase is CodeExtractionPhaseDefinition {
  return phase.kind === "phase.extract.ts" || phase.kind === "phase.extract.custom";
}

function defaultMaterializedAt(source: RepoSourceRecord): string {
  return source.materializedAt ?? `sources/repo/${source.name}`;
}

function defaultDocumentMaterializedAt(type: "file" | "lark", name: string): string {
  return `sources/${type}/${name}`;
}

function defaultDocumentManifest(materializedAt: string): string {
  return `${materializedAt}/manifest.json`;
}

async function documentSourceStatus(
  projectRoot: string,
  type: "file",
  source: FileSourceRegistryEntry,
): Promise<DocumentSourceStatus>;
async function documentSourceStatus(
  projectRoot: string,
  type: "lark",
  source: LarkSourceRegistryEntry,
): Promise<DocumentSourceStatus>;
async function documentSourceStatus(
  projectRoot: string,
  type: "file" | "lark",
  source: FileSourceRegistryEntry | LarkSourceRegistryEntry,
): Promise<DocumentSourceStatus> {
  const materializedAt = source.materializedAt ?? defaultDocumentMaterializedAt(type, source.name);
  const manifest = source.snapshot?.manifest ?? defaultDocumentManifest(materializedAt);
  const readiness = documentSnapshotReadiness({
    projectRoot,
    type,
    sourceName: source.name,
    materializedAt,
    manifest,
    ...(type === "file" ? { fileSource: source as FileSourceRegistryEntry } : {}),
    ...(type === "lark" ? { larkSource: source as LarkSourceRegistryEntry } : {}),
  });
  const documentSiteHint = type === "file"
    ? await documentSourceSiteHint({
        projectRoot,
        source: source as FileSourceRegistryEntry,
        snapshotConfigured: readiness.snapshotConfigured,
      })
    : null;
  const agentHints = readiness.ready
    ? []
    : [readiness.resourceMaterialization?.status === "error"
        ? "document-resource-materialization-recapture-required"
        : readiness.captureFidelity?.evidence_status === "error"
        ? "document-capture-fidelity-recapture-required"
        : "document-source-not-captured"];
  if (documentSiteHint !== null) agentHints.push(documentSiteHint);
  return {
    type,
    ...(source.id !== source.name ? { id: source.id } : {}),
    name: source.name,
    ...(type === "file" && "local" in source && source.local !== undefined ? { local: source.local } : {}),
    ...(type === "lark" && "url" in source && source.url !== undefined ? { url: source.url } : {}),
    materializedAt,
    manifest,
    snapshotReady: readiness.ready,
    ...(readiness.snapshotHash === undefined ? {} : { snapshotHash: readiness.snapshotHash }),
    ...(readiness.normalizerVersion === undefined ? {} : { normalizerVersion: readiness.normalizerVersion }),
    ...(readiness.captureFidelity === undefined ? {} : { captureFidelity: readiness.captureFidelity }),
    ...(readiness.resourceMaterialization === undefined ? {} : { resourceMaterialization: readiness.resourceMaterialization }),
    diagnostics: readiness.diagnostics,
    agent_hints: agentHints,
    workspaceDiagnostics: readiness.workspaceDiagnostics,
  };
}

async function documentSourceSiteHint(input: {
  projectRoot: string;
  source: FileSourceRegistryEntry;
  snapshotConfigured?: boolean | undefined;
}): Promise<string | null> {
  const detection = await detectDocumentSiteFiles({
    projectRoot: input.projectRoot,
    local: input.source.local,
  });
  let processorConfigured = false;
  try {
    const loaded = await loadContextProjectModule(input.projectRoot);
    processorConfigured = projectUsesMdxJsonDocsForSource({
      phases: loaded.project.phases,
      source: input.source,
    });
  } catch {
    processorConfigured = false;
  }
  return documentSiteConfigHint({
    sourceName: input.source.name,
    detection,
    processorConfigured,
    snapshotConfigured: input.snapshotConfigured,
  });
}

function documentSnapshotReadiness(input: {
  projectRoot: string;
  type: "file" | "lark";
  sourceName: string;
  materializedAt: string;
  manifest: string;
  fileSource?: FileSourceRegistryEntry;
  larkSource?: LarkSourceRegistryEntry;
}): {
  ready: boolean;
  diagnostics: string[];
  workspaceDiagnostics: string[];
  snapshotConfigured?: boolean;
  snapshotHash?: string;
  normalizerVersion?: string;
  captureFidelity?: NonNullable<DocumentSourceStatus["captureFidelity"]>;
  resourceMaterialization?: NonNullable<DocumentSourceStatus["resourceMaterialization"]>;
} {
  const manifestPath = join(input.projectRoot, input.manifest);
  if (!existsSync(manifestPath)) {
    return {
      ready: false,
      diagnostics: [`snapshot is missing: ${input.manifest}`],
      workspaceDiagnostics: [],
    };
  }
  try {
    const manifest = findDocumentSnapshotForSource(
      JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
      input.sourceName,
    );
    if (manifest === null) {
      return {
        ready: false,
        diagnostics: [`snapshot batch has no captured entry for ${input.sourceName}`],
        workspaceDiagnostics: [],
      };
    }
    const snapshotConfigured = input.fileSource !== undefined ? manifestUsesMdxJsonDocs(manifest) : undefined;
    if (manifest.source_type !== input.type || manifest.source_name !== input.sourceName) {
      return {
        ready: false,
        diagnostics: [`snapshot manifest source does not match registry source: ${input.manifest}`],
        workspaceDiagnostics: [`snapshot manifest source does not match registry source: ${input.manifest}`],
        ...(snapshotConfigured !== undefined ? { snapshotConfigured } : {}),
      };
    }
    if (input.fileSource !== undefined) {
      const includeMismatch = fileSourceIncludeMismatchDiagnostic({
        manifest,
        source: input.fileSource,
        projectRoot: input.projectRoot,
        materializedAt: input.materializedAt,
      });
      if (includeMismatch !== null) {
        return {
          ready: false,
          diagnostics: [includeMismatch],
          workspaceDiagnostics: [],
          ...(snapshotConfigured !== undefined ? { snapshotConfigured } : {}),
        };
      }
    }
    if (input.larkSource !== undefined) {
      const identityMismatch = larkSnapshotIdentityDiagnostic(input.larkSource, manifest);
      if (identityMismatch !== null) {
        return {
          ready: false,
          diagnostics: [identityMismatch],
          workspaceDiagnostics: [],
        };
      }
    }
    const captureReport = readDocumentSnapshotCaptureReport({
      projectRoot: input.projectRoot,
      materializedAt: input.materializedAt,
      manifest,
    });
    const fidelity = documentSnapshotFidelityState(manifest, captureReport);
    if (fidelity.blocking.length > 0) {
      return {
        ready: false,
        diagnostics: fidelity.blocking,
        workspaceDiagnostics: [],
        ...(fidelity.report !== undefined ? { captureFidelity: fidelity.report } : {}),
        ...(fidelity.resourceMaterialization !== undefined ? { resourceMaterialization: fidelity.resourceMaterialization } : {}),
      };
    }
    const missingFiles = [
      ...manifest.files.map((file) => file.path),
      ...(manifest.assets ?? []).filter((asset) => asset.content_hash !== undefined).map((asset) => asset.path),
    ]
      .filter((path) => !existsSync(join(input.projectRoot, input.materializedAt, path)));
    if (missingFiles.length > 0) {
      return {
        ready: false,
        diagnostics: [`snapshot file is missing: ${input.materializedAt}/${missingFiles[0]}`],
        workspaceDiagnostics: [],
        ...(snapshotConfigured !== undefined ? { snapshotConfigured } : {}),
      };
    }
    return {
      ready: true,
      diagnostics: fidelity.warnings,
      workspaceDiagnostics: [],
      snapshotHash: manifest.snapshot_hash,
      normalizerVersion: manifest.normalizer_version,
      ...(fidelity.report !== undefined ? { captureFidelity: fidelity.report } : {}),
      ...(fidelity.resourceMaterialization !== undefined ? { resourceMaterialization: fidelity.resourceMaterialization } : {}),
      ...(snapshotConfigured !== undefined ? { snapshotConfigured } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ready: false,
      diagnostics: [`snapshot manifest is invalid: ${input.manifest}: ${message}`],
      workspaceDiagnostics: [`snapshot manifest is invalid: ${input.manifest}: ${message}`],
    };
  }
}

function selectedSourcesForExtractPhase(input: {
  phase: CodeExtractionPhaseDefinition;
  sources: readonly RepoSourceRecord[];
  sourceStatuses: readonly RepoSourceStatus[];
}): Array<{
  record: RepoSourceRecord;
  status: Pick<RepoSourceStatus, "head" | "scopeHash" | "materializedAt">;
}> {
  const statusByName = new Map(input.sourceStatuses.map((source) => [source.name, source]));
  const toSelection = (source: RepoSourceRecord) => {
    const sourceStatus = statusByName.get(source.name);
    return {
      record: source,
      status: {
        ...(sourceStatus?.head !== undefined ? { head: sourceStatus.head } : {}),
        ...(sourceStatus?.scopeHash !== undefined ? { scopeHash: sourceStatus.scopeHash } : {}),
        materializedAt: sourceStatus?.materializedAt ?? defaultMaterializedAt(source),
      },
    };
  };

  const definitions = input.phase.kind === "phase.extract.ts"
    ? [input.phase.source]
    : input.phase.sources;
  const selected = definitions.flatMap((definition) => {
    if (definition.kind === "source.repo") return [toSelection(definition)];
    if (definition.kind === "source.collection") return input.sources.map(toSelection);
    return input.sources
      .filter((source) => source.name === definition.name || source.id === definition.name)
      .map(toSelection);
  });
  return [...new Map(selected.map((source) => [source.record.name, source])).values()]
    .sort((left, right) => left.record.name.localeCompare(right.record.name));
}

export async function collectSourceFreshness(input: {
  projectRoot: string;
  phases: readonly PhaseDefinition[];
  sources: readonly RepoSourceRecord[];
  sourceStatuses: readonly RepoSourceStatus[];
}): Promise<{
  state: SourceFreshnessState;
  stalePhases: string[];
  pendingPhases: string[];
  diagnostics: string[];
  errorDiagnostics: string[];
}> {
  const extractPhases = input.phases.filter(isCodeExtractionPhase);
  if (extractPhases.length === 0) {
    return { state: "ready", stalePhases: [], pendingPhases: [], diagnostics: [], errorDiagnostics: [] };
  }
  if (input.sources.length === 0) {
    return { state: "ready", stalePhases: [], pendingPhases: [], diagnostics: [], errorDiagnostics: [] };
  }

  const cached = await readExtractSourceFingerprints(input.projectRoot);
  const stalePhases: string[] = [];
  const diagnostics: string[] = [];
  const errorDiagnostics: string[] = [];
  const unknownPhases: string[] = [];
  for (const phase of extractPhases) {
    const selectedSources = selectedSourcesForExtractPhase({
      phase,
      sources: input.sources,
      sourceStatuses: input.sourceStatuses,
    });
    if (selectedSources.length === 0) {
      errorDiagnostics.push(`extract phase ${phase.id} has no matching repo source`);
      continue;
    }
    const current = extractPhaseSourceFingerprint({
      phase,
      sources: selectedSources,
    });
    const previous = cached.phases[phase.id];
    if (previous === undefined) {
      unknownPhases.push(phase.id);
      continue;
    }
    if (previous.fingerprint !== current.fingerprint) {
      stalePhases.push(phase.id);
    }
  }

  return {
    state: stalePhases.length > 0 ? "stale" : unknownPhases.length > 0 ? "unknown" : "ready",
    stalePhases,
    pendingPhases: extractPhases
      .map((phase) => phase.id)
      .filter((phaseId) => stalePhases.includes(phaseId) || unknownPhases.includes(phaseId)),
    diagnostics: [
      ...diagnostics,
      ...unknownPhases.map((phaseId) =>
        `extract baseline is missing for ${phaseId}; rerun extraction if the source changed since the last committed knowledge update`
      ),
    ],
    errorDiagnostics,
  };
}
