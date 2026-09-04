import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadSourcesRegistry,
  type CaptureFilePhaseDefinition,
  type CaptureLarkPhaseDefinition,
  type DocumentSourceDefinition,
  type DocumentSourceType,
  type FileSourceRegistryEntry,
  type LarkSourceRegistryEntry,
  type PhaseDefinition,
  type PhaseResourceReference,
  type SourceReference,
  type SourcesRegistry,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export type DocumentPhaseDefinition =
  | CaptureFilePhaseDefinition
  | CaptureLarkPhaseDefinition;

export interface DocumentPhaseDiagnostic {
  category: string;
  message: string;
  next?: string;
  sourceName?: string;
  sourceType?: string;
  expectedType?: string;
  actualType?: string;
}

export interface ProjectPhaseListEntry {
  phase: PhaseDefinition;
  diagnostics?: readonly DocumentPhaseDiagnostic[];
}

export interface DocumentPhasePreview {
  kind: "document.phase.preview";
  mode: "capture";
  source: {
    type: DocumentSourceType;
    name: string;
    materializedAt: string;
  };
  snapshot: {
    manifest: string;
    exists: boolean;
  };
  sourceRefExamples: string[];
  next_action: {
    kind: "confirm-source-read";
    command: string;
  };
}

type DocumentSourceRegistryEntry = FileSourceRegistryEntry | LarkSourceRegistryEntry;

export function isDocumentPhasePreview(preview: unknown): preview is DocumentPhasePreview {
  return preview !== null &&
    typeof preview === "object" &&
    !Array.isArray(preview) &&
    "kind" in preview &&
    preview.kind === "document.phase.preview";
}

export function isDocumentPhase(phase: PhaseDefinition): phase is DocumentPhaseDefinition {
  return phase.kind === "phase.capture.file" || phase.kind === "phase.capture.lark";
}

function registryReadError(error: unknown): ContextError {
  if (error instanceof ContextError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    next: "Fix sources registry YAML, then rerun context run --list",
  });
}

async function loadRunSourcesRegistry(projectRoot: string): Promise<SourcesRegistry> {
  try {
    return await loadSourcesRegistry({ rootDir: projectRoot });
  } catch (error) {
    throw registryReadError(error);
  }
}

function diagnosticFromContextError(error: ContextError): DocumentPhaseDiagnostic {
  const detail = error.detail ?? {};
  return {
    category: typeof detail.category === "string" ? detail.category : ErrorCategory.Unknown,
    message: error.message,
    ...(typeof detail.next === "string" ? { next: detail.next } : {}),
    ...(typeof detail.sourceName === "string" ? { sourceName: detail.sourceName } : {}),
    ...(typeof detail.sourceType === "string" ? { sourceType: detail.sourceType } : {}),
    ...(typeof detail.expectedType === "string" ? { expectedType: detail.expectedType } : {}),
    ...(typeof detail.actualType === "string" ? { actualType: detail.actualType } : {}),
  };
}

function canListPhaseWithDiagnostic(error: ContextError): boolean {
  const detail = error.detail ?? {};
  return detail.category === ErrorCategory.SourceNotFound ||
    (detail.category === ErrorCategory.UserInputInvalid && typeof detail.sourceName === "string");
}

function documentSourceSelector(sourceName: string): string {
  const [namespace, module, ...rest] = sourceName.split("/");
  return /^\d{8}$/u.test(namespace ?? "") && module !== undefined && rest.length === 0
    ? `${namespace} --module ${module}`
    : sourceName;
}

export function documentSourceAddCommand(sourceType: DocumentSourceType, sourceName: string): string {
  const selector = documentSourceSelector(sourceName);
  return sourceType === "lark"
    ? `context source add lark ${selector} --url <url>`
    : `context source add file ${selector} --local <relative-path>`;
}

function sourceAddNext(sourceName: string, expectedType: DocumentSourceType): string {
  return documentSourceAddCommand(expectedType, sourceName);
}

function findSourceEntry<TEntry extends { name: string; id?: string }>(
  entries: readonly TEntry[],
  sourceName: string,
): TEntry | undefined {
  return entries.find((candidate) => candidate.name === sourceName || candidate.id === sourceName);
}

function resolveDocumentSourceEntry(input: {
  registry: SourcesRegistry;
  sourceName: string;
  expectedType: DocumentSourceType;
}): { sourceType: DocumentSourceType; entry: DocumentSourceRegistryEntry } {
  const expectedEntries = input.expectedType === "file" ? input.registry.files : input.registry.larks;
  const expected = findSourceEntry(expectedEntries, input.sourceName);
  if (expected !== undefined) return { sourceType: input.expectedType, entry: expected };

  const otherType = input.expectedType === "file" ? "lark" : "file";
  const otherEntries = otherType === "file" ? input.registry.files : input.registry.larks;
  if (findSourceEntry(otherEntries, input.sourceName) !== undefined) {
    throw new ContextError(
      ExitCode.UserError,
      `document source type mismatch: ${input.sourceName} is ${otherType}, expected ${input.expectedType}`,
      {
        category: ErrorCategory.UserInputInvalid,
        sourceName: input.sourceName,
        expectedType: input.expectedType,
        actualType: otherType,
        next: sourceAddNext(input.sourceName, input.expectedType),
      },
    );
  }
  if (findSourceEntry(input.registry.repos, input.sourceName) !== undefined) {
    throw new ContextError(
      ExitCode.UserError,
      `document source type mismatch: ${input.sourceName} is repo, expected ${input.expectedType}`,
      {
        category: ErrorCategory.UserInputInvalid,
        sourceName: input.sourceName,
        expectedType: input.expectedType,
        actualType: "repo",
        next: "Select the repo through src/indexers.yaml for the current Indexer lifecycle, or register a distinct file/lark source for capture.",
      },
    );
  }
  throw new ContextError(ExitCode.UserError, `document source is not declared: ${input.sourceName}`, {
    category: ErrorCategory.SourceNotFound,
    sourceName: input.sourceName,
    sourceType: input.expectedType,
    next: sourceAddNext(input.sourceName, input.expectedType),
  });
}

function documentSourceType(phase: DocumentPhaseDefinition): DocumentSourceType {
  return phase.kind === "phase.capture.file" ? "file" : "lark";
}

function typedDocumentSourceReference(
  sourceType: DocumentSourceType,
  entry: DocumentSourceRegistryEntry,
): SourceReference<DocumentSourceType> {
  return {
    kind: "source.ref",
    type: sourceType,
    name: entry.name,
    materializedAt: entry.materializedAt,
  };
}

function documentSnapshotManifestPath(entry: DocumentSourceRegistryEntry): string {
  return entry.snapshot?.manifest ?? `${entry.materializedAt}/manifest.json`;
}

function documentSnapshotResource(
  sourceType: DocumentSourceType,
  source: DocumentSourceDefinition,
  entry: DocumentSourceRegistryEntry,
): PhaseResourceReference {
  return {
    kind: "source.snapshot",
    source,
    sourceType,
    path: documentSnapshotManifestPath(entry),
  };
}

async function normalizeDocumentPhase(input: {
  projectRoot: string;
  phase: DocumentPhaseDefinition;
}): Promise<DocumentPhaseDefinition> {
  const sourceType = documentSourceType(input.phase);
  const registry = await loadRunSourcesRegistry(input.projectRoot);
  const { entry } = resolveDocumentSourceEntry({
    registry,
    sourceName: input.phase.source.name,
    expectedType: sourceType,
  });
  const sourceRef = typedDocumentSourceReference(sourceType, entry);
  if (input.phase.kind === "phase.capture.file") {
    const typed = sourceRef as SourceReference<"file">;
    return {
      ...input.phase,
      id: `capture:file:${entry.name}`,
      source: typed,
      reads: [{ kind: "source", source: typed }],
      writes: [documentSnapshotResource("file", typed, entry)],
    };
  }
  const typed = sourceRef as SourceReference<"lark">;
  return {
    ...input.phase,
    id: `capture:lark:${entry.name}`,
    source: typed,
    reads: [{ kind: "source", source: typed }],
    writes: [documentSnapshotResource("lark", typed, entry)],
  };
}

export async function normalizeRunPhasesForList(input: {
  projectRoot: string;
  phases: readonly PhaseDefinition[];
}): Promise<readonly ProjectPhaseListEntry[]> {
  return Promise.all(input.phases.map(async (phase) => {
    if (!isDocumentPhase(phase)) return { phase };
    try {
      return { phase: await normalizeDocumentPhase({ projectRoot: input.projectRoot, phase }) };
    } catch (error) {
      if (error instanceof ContextError && canListPhaseWithDiagnostic(error)) {
        return { phase, diagnostics: [diagnosticFromContextError(error)] };
      }
      throw error;
    }
  }));
}

export async function findPhaseForRun(input: {
  projectRoot: string;
  phases: readonly PhaseDefinition[];
  phaseId: string;
  dryRun?: boolean;
}): Promise<PhaseDefinition | undefined> {
  const direct = input.phases.find((candidate) => candidate.id === input.phaseId);
  if (direct === undefined || !isDocumentPhase(direct)) return direct;
  try {
    return await normalizeDocumentPhase({ projectRoot: input.projectRoot, phase: direct });
  } catch (error) {
    if (input.dryRun === true && error instanceof ContextError) return direct;
    throw error;
  }
}

export async function resolveDocumentPhaseSource(input: {
  projectRoot: string;
  phase: DocumentPhaseDefinition;
}): Promise<{
  sourceType: DocumentSourceType;
  sourceName: string;
  entry: DocumentSourceRegistryEntry;
}> {
  const sourceType = documentSourceType(input.phase);
  const registry = await loadRunSourcesRegistry(input.projectRoot);
  const { entry } = resolveDocumentSourceEntry({
    registry,
    sourceName: input.phase.source.name,
    expectedType: sourceType,
  });
  return { sourceType, sourceName: entry.name, entry };
}

export async function previewDocumentPhase(input: {
  projectRoot: string;
  phase: DocumentPhaseDefinition;
}): Promise<DocumentPhasePreview> {
  const { sourceType, entry } = await resolveDocumentPhaseSource(input);
  const manifest = documentSnapshotManifestPath(entry);
  const sourceRefBase = `${sourceType}:${entry.name}`;
  return {
    kind: "document.phase.preview",
    mode: "capture",
    source: {
      type: sourceType,
      name: entry.name,
      materializedAt: entry.materializedAt,
    },
    snapshot: {
      manifest,
      exists: existsSync(join(input.projectRoot, manifest)),
    },
    sourceRefExamples: [
      `${sourceRefBase}/<doc-locator>#span:<heading-hint> L<start>-<end>@<hash>`,
    ],
    next_action: {
      kind: "confirm-source-read",
      command: `context run ${input.phase.id}`,
    },
  };
}
