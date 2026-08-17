import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadSourcesRegistry,
  type AlignProsePhaseDefinition,
  type CaptureFilePhaseDefinition,
  type CaptureLarkPhaseDefinition,
  type CompileProsePhaseDefinition,
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
  | CaptureLarkPhaseDefinition
  | AlignProsePhaseDefinition
  | CompileProsePhaseDefinition;

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
  mode: "capture" | "align" | "compile";
  source: {
    type: DocumentSourceType;
    name: string;
    materializedAt: string;
  };
  collection?: string;
  snapshot?: {
    manifest: string;
    exists: boolean;
  };
  candidateTree: Array<{
    path: string;
    collection: string;
    source: string;
  }>;
  knowledgePathExamples: Array<{
    path: string;
    source_ref: string;
  }>;
  sourceRefExamples: string[];
  next_action: {
    kind: string;
    command: string;
  };
}

export function isDocumentPhasePreview(preview: unknown): preview is DocumentPhasePreview {
  return preview !== null &&
    typeof preview === "object" &&
    !Array.isArray(preview) &&
    "kind" in preview &&
    preview.kind === "document.phase.preview";
}

export function isDocumentPhase(phase: PhaseDefinition): phase is DocumentPhaseDefinition {
  return phase.kind === "phase.capture.file" ||
    phase.kind === "phase.capture.lark" ||
    phase.kind === "phase.align.prose" ||
    phase.kind === "phase.compile.prose";
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
  if (detail.category === ErrorCategory.SourceNotFound) return true;
  return detail.category === ErrorCategory.UserInputInvalid && typeof detail.sourceName === "string";
}

function documentSourceSelector(sourceName: string): string {
  const [namespace, module, ...rest] = sourceName.split("/");
  const batched = /^\d{8}$/u.test(namespace ?? "") && module !== undefined && rest.length === 0;
  return batched ? `${namespace} --module ${module}` : sourceName;
}

export function documentSourceAddCommand(sourceType: DocumentSourceType, sourceName: string): string {
  const selector = documentSourceSelector(sourceName);
  return sourceType === "lark"
    ? `context source add lark ${selector} --url <url>`
    : `context source add file ${selector} --local <relative-path>`;
}

function sourceAddNext(sourceName: string, expectedType?: DocumentSourceType): string {
  const selector = documentSourceSelector(sourceName);
  if (expectedType === "lark") return `context source add lark ${selector} --url <url>`;
  if (expectedType === "file") return `context source add file ${selector} --local <relative-path>`;
  return `context source add file ${selector} --local <relative-path> or context source add lark ${selector} --url <url>`;
}

function sourceExpression(sourceName: string, type: DocumentSourceType | "repo"): string {
  const [namespace, module, ...rest] = sourceName.split("/");
  if (/^\d{8}$/u.test(namespace ?? "") && module !== undefined && rest.length === 0) {
    return type === "repo"
      ? `source("${namespace}", "${module}")`
      : `source("${namespace}", "${module}", { type: "${type}" })`;
  }
  return `source("${sourceName}")`;
}

type DocumentSourceRegistryEntry = FileSourceRegistryEntry | LarkSourceRegistryEntry;

function findSourceEntry<TEntry extends { name: string; id?: string }>(
  entries: readonly TEntry[],
  sourceName: string,
): TEntry | undefined {
  return entries.find((candidate) => candidate.name === sourceName || candidate.id === sourceName);
}

function sourceTypeMismatchError(input: {
  sourceName: string;
  expectedType?: DocumentSourceType;
  actualType: DocumentSourceType | "repo";
}): ContextError {
  const expected = input.expectedType ?? "file or lark";
  const next = input.actualType === "repo"
    ? `use extractTs({ source: ${sourceExpression(input.sourceName, "repo")}, collection: "codegraph" }) for repo sources, or register a file/lark source with a different name`
    : input.actualType === "file"
      ? `use captureFile({ source: ${sourceExpression(input.sourceName, "file")} }) or register a lark source with a different name`
      : `use captureLark({ source: ${sourceExpression(input.sourceName, "lark")} }) or register a file source with a different name`;
  return new ContextError(ExitCode.UserError, `document source type mismatch: ${input.sourceName} is ${input.actualType}, expected ${expected}`, {
    category: ErrorCategory.UserInputInvalid,
    sourceName: input.sourceName,
    ...(input.expectedType !== undefined ? { expectedType: input.expectedType } : {}),
    actualType: input.actualType,
    next,
  });
}

function resolveDocumentSourceEntry(input: {
  registry: SourcesRegistry;
  sourceName: string;
  expectedType?: DocumentSourceType;
}): {
  sourceType: DocumentSourceType;
  entry: DocumentSourceRegistryEntry;
} {
  const fileEntry = findSourceEntry(input.registry.files, input.sourceName);
  const larkEntry = findSourceEntry(input.registry.larks, input.sourceName);
  const repoEntry = findSourceEntry(input.registry.repos, input.sourceName);

  if (input.expectedType === "file") {
    if (fileEntry !== undefined) return { sourceType: "file", entry: fileEntry };
    if (larkEntry !== undefined) throw sourceTypeMismatchError({ sourceName: input.sourceName, expectedType: "file", actualType: "lark" });
  } else if (input.expectedType === "lark") {
    if (larkEntry !== undefined) return { sourceType: "lark", entry: larkEntry };
    if (fileEntry !== undefined) throw sourceTypeMismatchError({ sourceName: input.sourceName, expectedType: "lark", actualType: "file" });
  } else {
    if (fileEntry !== undefined) return { sourceType: "file", entry: fileEntry };
    if (larkEntry !== undefined) return { sourceType: "lark", entry: larkEntry };
  }

  if (repoEntry !== undefined) {
    throw sourceTypeMismatchError({
      sourceName: input.sourceName,
      ...(input.expectedType !== undefined ? { expectedType: input.expectedType } : {}),
      actualType: "repo",
    });
  }

  throw new ContextError(ExitCode.UserError, `document source is not declared: ${input.sourceName}`, {
    category: ErrorCategory.SourceNotFound,
    sourceName: input.sourceName,
    ...(input.expectedType !== undefined ? { sourceType: input.expectedType } : {}),
    next: sourceAddNext(input.sourceName, input.expectedType),
  });
}

function documentSourceType(source: DocumentSourceDefinition): DocumentSourceType {
  if (source.kind === "source.ref") {
    if ("type" in source && (source.type === "file" || source.type === "lark")) return source.type;
    throw new ContextError(ExitCode.UserError, `document source reference is not resolved: ${source.name}`, {
      category: ErrorCategory.SourceNotFound,
      sourceName: source.name,
      next: sourceAddNext(source.name),
    });
  }
  if (source.kind === "source.file") return "file";
  return "lark";
}

function typedDocumentSourceReference(
  sourceType: DocumentSourceType,
  entry: FileSourceRegistryEntry | LarkSourceRegistryEntry,
): SourceReference<DocumentSourceType> {
  return {
    kind: "source.ref",
    type: sourceType,
    name: entry.name,
    materializedAt: entry.materializedAt,
  };
}

function documentSnapshotManifestPath(entry: FileSourceRegistryEntry | LarkSourceRegistryEntry): string {
  return entry.snapshot?.manifest ?? `${entry.materializedAt}/manifest.json`;
}

function documentSnapshotResource(
  sourceType: DocumentSourceType,
  source: DocumentSourceDefinition,
  entry?: FileSourceRegistryEntry | LarkSourceRegistryEntry,
): PhaseResourceReference {
  return {
    kind: "source.snapshot",
    source,
    sourceType,
    path: entry !== undefined
      ? documentSnapshotManifestPath(entry)
      : `sources/${sourceType}/${source.name}/manifest.json`,
  };
}

async function resolveNeutralDocumentSource(input: {
  projectRoot: string;
  sourceName: string;
  expectedType?: DocumentSourceType;
}): Promise<{
  sourceType: DocumentSourceType;
  entry: DocumentSourceRegistryEntry;
}> {
  const registry = await loadRunSourcesRegistry(input.projectRoot);
  return resolveDocumentSourceEntry({
    registry,
    sourceName: input.sourceName,
    ...(input.expectedType !== undefined ? { expectedType: input.expectedType } : {}),
  });
}

function typedDocumentPhaseAlias(phase: DocumentPhaseDefinition, phaseId: string): DocumentPhaseDefinition | undefined {
  if ((phase.kind !== "phase.align.prose" && phase.kind !== "phase.compile.prose") ||
    phase.source.kind !== "source.ref" ||
    "type" in phase.source) {
    return undefined;
  }

  const parts = phaseId.split(":");
  const expectedVerb = phase.kind === "phase.align.prose" ? "align" : "compile";
  if (parts.length !== 4 || parts[0] !== expectedVerb || (parts[1] !== "file" && parts[1] !== "lark")) {
    return undefined;
  }
  const sourceName = parts[2];
  const collection = parts[3];
  if (sourceName === undefined || collection === undefined) return undefined;
  if (sourceName !== phase.source.name || collection !== phase.collection) {
    return undefined;
  }

  const sourceType = parts[1] as DocumentSourceType;
  const sourceRef: SourceReference<DocumentSourceType> = {
    kind: "source.ref",
    type: sourceType,
    name: sourceName,
    materializedAt: `sources/${sourceType}/${sourceName}`,
  };
  return {
    ...phase,
    id: phaseId,
    source: sourceRef,
    sourceType,
    reads: phase.kind === "phase.align.prose"
      ? [documentSnapshotResource(sourceType, sourceRef)]
      : [
          documentSnapshotResource(sourceType, sourceRef),
          {
            kind: "lifecycle.structure",
            path: ".tmp/context-runtime/lifecycle/structure.yaml",
            profileCollection: phase.collection,
            status: "confirmed",
          },
        ],
  };
}

async function normalizeDocumentPhase(input: {
  projectRoot: string;
  phase: DocumentPhaseDefinition;
}): Promise<DocumentPhaseDefinition> {
  if (input.phase.source.kind !== "source.ref") {
    return input.phase;
  }

  const expectedType: DocumentSourceType | undefined = input.phase.kind === "phase.capture.file"
    ? "file"
    : input.phase.kind === "phase.capture.lark"
      ? "lark"
      : "type" in input.phase.source
        ? input.phase.source.type
        : undefined;
  const { sourceType, entry } = await resolveNeutralDocumentSource({
    projectRoot: input.projectRoot,
    sourceName: input.phase.source.name,
    ...(expectedType !== undefined ? { expectedType } : {}),
  });
  const sourceRef = typedDocumentSourceReference(sourceType, entry);

  if (input.phase.kind === "phase.capture.file") {
    return {
      ...input.phase,
      id: `capture:file:${entry.name}`,
      source: sourceRef as SourceReference<"file">,
      reads: [{ kind: "source", source: sourceRef as SourceReference<"file"> }],
      writes: [documentSnapshotResource("file", sourceRef, entry)],
    };
  }
  if (input.phase.kind === "phase.capture.lark") {
    return {
      ...input.phase,
      id: `capture:lark:${entry.name}`,
      source: sourceRef as SourceReference<"lark">,
      reads: [{ kind: "source", source: sourceRef as SourceReference<"lark"> }],
      writes: [documentSnapshotResource("lark", sourceRef, entry)],
    };
  }
  return {
    ...input.phase,
    id: `${input.phase.kind === "phase.align.prose" ? "align" : "compile"}:${sourceType}:${entry.name}:${input.phase.collection}`,
    source: sourceRef,
    sourceType,
    reads: input.phase.kind === "phase.align.prose"
      ? [documentSnapshotResource(sourceType, sourceRef, entry)]
      : [
          documentSnapshotResource(sourceType, sourceRef, entry),
          {
            kind: "lifecycle.structure",
            path: ".tmp/context-runtime/lifecycle/structure.yaml",
            profileCollection: input.phase.collection,
            status: "confirmed",
          },
        ],
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
        return {
          phase,
          diagnostics: [diagnosticFromContextError(error)],
        };
      }
      throw error;
    }
  }));
}

function sourceTypeMismatchForAlias(input: {
  alias: DocumentPhaseDefinition;
  actual: DocumentPhaseDefinition;
}): ContextError | undefined {
  if ((input.alias.kind !== "phase.align.prose" && input.alias.kind !== "phase.compile.prose") ||
    input.alias.kind !== input.actual.kind) return undefined;
  if (input.alias.sourceType === undefined || input.actual.sourceType === undefined) return undefined;
  if (input.alias.sourceType === input.actual.sourceType) return undefined;
  const verb = input.alias.kind === "phase.align.prose" ? "align" : "compile";
  return new ContextError(
    ExitCode.UserError,
    `document source type mismatch: ${input.alias.source.name} is ${input.actual.sourceType}, expected ${input.alias.sourceType}`,
    {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.alias.source.name,
      expectedType: input.alias.sourceType,
      actualType: input.actual.sourceType,
      next: `context run ${verb}:${input.actual.sourceType}:${input.alias.source.name}:${input.alias.collection} --dry-run`,
    },
  );
}

export async function findPhaseForRun(input: {
  projectRoot: string;
  phases: readonly PhaseDefinition[];
  phaseId: string;
  dryRun?: boolean;
}): Promise<PhaseDefinition | undefined> {
  const direct = input.phases.find((candidate) => candidate.id === input.phaseId);
  if (direct !== undefined) {
    if (!isDocumentPhase(direct)) return direct;
    try {
      return await normalizeDocumentPhase({ projectRoot: input.projectRoot, phase: direct });
    } catch (error) {
      if (input.dryRun === true && error instanceof ContextError) return direct;
      throw error;
    }
  }

  for (const phase of input.phases) {
    if (!isDocumentPhase(phase)) continue;
    try {
      const normalized = await normalizeDocumentPhase({ projectRoot: input.projectRoot, phase });
      if (normalized.id === input.phaseId) return normalized;
    } catch (error) {
      if (input.dryRun === true && error instanceof ContextError) return phase;
      throw error;
    }
  }

  for (const phase of input.phases) {
    if (!isDocumentPhase(phase)) continue;
    const alias = typedDocumentPhaseAlias(phase, input.phaseId);
    if (alias === undefined) continue;
    try {
      const normalized = await normalizeDocumentPhase({ projectRoot: input.projectRoot, phase });
      if (normalized.id === input.phaseId) return normalized;
      if (input.dryRun === true) return alias;
      const mismatch = sourceTypeMismatchForAlias({ alias, actual: normalized });
      if (mismatch !== undefined) throw mismatch;
    } catch (error) {
      if (input.dryRun === true && error instanceof ContextError) return alias;
      throw error;
    }
  }

  return undefined;
}

function documentPhaseMode(phase: DocumentPhaseDefinition): DocumentPhasePreview["mode"] {
  if (phase.kind === "phase.capture.file" || phase.kind === "phase.capture.lark") return "capture";
  return phase.kind === "phase.align.prose" ? "align" : "compile";
}

function documentPhaseNextActionCommand(phase: DocumentPhaseDefinition, mode: DocumentPhasePreview["mode"]): string {
  if (mode === "capture") return `context run ${phase.id}`;
  return `context run ${phase.id} --view read-plan --format json`;
}

export async function resolveDocumentPhaseSource(input: {
  projectRoot: string;
  phase: DocumentPhaseDefinition;
}): Promise<{
  sourceType: DocumentSourceType;
  sourceName: string;
  entry: FileSourceRegistryEntry | LarkSourceRegistryEntry;
}> {
  if (input.phase.source.kind === "source.ref" && !("type" in input.phase.source)) {
    const { sourceType, entry } = await resolveNeutralDocumentSource({
      projectRoot: input.projectRoot,
      sourceName: input.phase.source.name,
    });
    return { sourceType, sourceName: entry.name, entry };
  }

  const sourceType = documentSourceType(input.phase.source);
  const sourceName = input.phase.source.name;
  const registry = await loadRunSourcesRegistry(input.projectRoot);
  const { entry } = resolveDocumentSourceEntry({
    registry,
    sourceName,
    expectedType: sourceType,
  });

  return { sourceType, sourceName, entry };
}

export async function previewDocumentPhase(input: {
  projectRoot: string;
  phase: DocumentPhaseDefinition;
}): Promise<DocumentPhasePreview> {
  const { sourceType, entry } = await resolveDocumentPhaseSource(input);
  const mode = documentPhaseMode(input.phase);
  const collection = "collection" in input.phase ? input.phase.collection : undefined;
  const manifest = documentSnapshotManifestPath(entry);
  const snapshotExists = existsSync(join(input.projectRoot, manifest));

  const sourceRefBase = `${sourceType}:${entry.name}`;
  const indexSourceRefBase = `${sourceRefBase}/index.md`;
  const exampleSourceRefBase = `${sourceRefBase}/example.md`;
  const knowledgeBase = collection === undefined ? undefined : `knowledge/${collection}/${entry.name}`;
  return {
    kind: "document.phase.preview",
    mode,
    source: {
      type: sourceType,
      name: entry.name,
      materializedAt: entry.materializedAt,
    },
    ...(collection !== undefined ? { collection } : {}),
    snapshot: {
      manifest,
      exists: snapshotExists,
    },
    candidateTree: collection === undefined
      ? []
      : [{
          path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
          collection,
          source: entry.name,
        }],
    knowledgePathExamples: collection === undefined
      ? []
      : [
          {
            path: `${knowledgeBase}/index-page.md`,
            source_ref: `${indexSourceRefBase}#span:<heading-hint> L<start>-<end>@<span-hash>`,
          },
          {
            path: `${knowledgeBase}/example.md`,
            source_ref: `${exampleSourceRefBase}#span:<heading-hint> L<start>-<end>@<span-hash>`,
          },
        ],
    sourceRefExamples: [
      `${sourceRefBase}/<doc-locator>#span:<heading-hint> L<start>-<end>@<hash>`,
      `${indexSourceRefBase}#span:<heading-hint> L<start>-<end>@<span-hash>`,
    ],
    next_action: {
      kind: mode === "capture"
        ? "confirm-source-read"
        : mode === "align"
          ? "investigate-and-draft-structure"
          : "inspect-compile-inputs",
      command: documentPhaseNextActionCommand(input.phase, mode),
    },
  };
}
