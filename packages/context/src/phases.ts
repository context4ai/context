import {
  assertDocumentMainlineCollection,
  assertKnowledgeCollection,
  type FileCaptureProcessorDefinition,
  type KnowledgeCollection,
  type MarkdownTransform,
  type PackageKind,
  type PackageSelectDefinition,
  type DocumentMainlineCollection,
} from "./contracts.js";
import { DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION } from "./documentEvidence.js";
import {
  assertUniqueIndexUnits,
  ExtractTsConfigurationError,
  normalizeExtractEntry,
  normalizeIndexUnit,
  type CodeIndexCoverageKind,
  type CodeIndexInspectionAdapter,
  type CodeIndexUnitPlan,
} from "./codeIndexPlan.js";
export {
  CODE_INDEX_CAPABILITIES,
  CODE_INDEX_COVERAGE_KINDS,
  CODE_INDEX_LIFECYCLES,
  CODE_INDEX_MODULE_FACETS,
  CODE_INDEX_MODULE_TYPES,
  CODE_INDEX_OUTPUT_PROFILES,
  ExtractTsConfigurationError,
  NO_ENTRY_DETECTED,
  requiredCodeIndexCoverage,
} from "./codeIndexPlan.js";
export type {
  CodeIndexCapability,
  CodeIndexCapabilityGap,
  CodeIndexCoverageKind,
  CodeIndexInspectionAdapter,
  CodeIndexInspectionContext,
  CodeIndexInspectionFinding,
  CodeIndexInspectionFindingKind,
  CodeIndexInspectionResult,
  CodeIndexLifecycle,
  CodeIndexModuleFacet,
  CodeIndexModuleType,
  CodeIndexOutputProfile,
  CodeIndexUnitPlan,
} from "./codeIndexPlan.js";
import type {
  RegistrySourceReference,
  DocumentSourceDefinition,
  DocumentSourceType,
  FileSourceDefinition,
  FileSourceReference,
  LarkSourceDefinition,
  LarkSourceReference,
  RepoProjectSourceDefinition,
  SourceCollectionReference,
  SourceDefinition,
  SourceType,
  TypedSourceReference,
} from "./sources.js";

export type PhaseResourceReference =
  | {
    kind: "source";
    source: SourceDefinition | SourceCollectionReference;
  }
  | {
    kind: "source.snapshot";
    source: DocumentSourceDefinition;
    sourceType: DocumentSourceType;
    path: string;
  }
  | {
    kind: "lifecycle.candidates";
    path: string;
    collection?: KnowledgeCollection;
    status?: "draft" | "rejected";
  }
  | {
    kind: "lifecycle.structure";
    path: ".tmp/context-runtime/lifecycle/structure.yaml";
    profileCollection?: DocumentMainlineCollection;
    status?: "draft" | "confirmed" | "frozen";
  }
  | {
    kind: "knowledge.collection";
    path: string;
    collection: KnowledgeCollection;
    status: "approved";
  }
  | {
    kind: "knowledge.approved";
    path: "knowledge";
    select?: PackageSelectDefinition;
  }
  | {
    kind: "knowledge.decisions";
    path: "knowledge/decisions.json";
  }
  | {
    kind: "package.template";
    path: string;
  }
  | {
    kind: "review.payload";
    path: string;
  }
  | {
    kind: "dist.package";
    path: string;
    packageName: string;
    packageKind: PackageKind;
  };

export type ContextPhaseContext = {
  ensureSources: (options?: { source?: SourceDefinition }) => Promise<void>;
  extract: {
    ts: (options: ExtractTsPhaseDefinition) => Promise<void>;
  };
  review: {
    html: (options: ReviewValidityPhaseDefinition) => Promise<void>;
  };
};

export type ContextPhase = (ctx: ContextPhaseContext) => unknown | Promise<unknown>;

export type ExtractTsPhaseDefinition = {
  kind: "phase.extract.ts";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  source: RepoProjectSourceDefinition;
  collection: "codegraph";
  include: readonly string[];
  mode: "exports" | "scan";
  entries?: readonly string[];
  exportedOnly: boolean;
  indexPlan: "declared" | "inferred";
  indexUnits: readonly CodeIndexUnitPlan[];
  transform?: MarkdownTransform | readonly MarkdownTransform[];
  out: {
    kind: "codegraph-entities";
    candidateFile: string;
    approvedPagesDir: string;
    initialStatus: "draft";
  };
};

export interface CustomCodeEvidence {
  source: string;
  file: string;
  symbol: string;
  kind: string;
  digest: string;
  line?: number;
}

export interface CustomCodeCandidateReview {
  title: string;
  summary: string;
  behaviorSummary?: string;
  edgeSummary?: string;
  signals: readonly string[];
  reason: string;
}

export interface CustomCodeCandidateEdge {
  type: "contains" | "depends_on";
  from: string;
  to: string;
  relationType: string;
  evidence: readonly CustomCodeEvidence[];
}

export interface CustomCodeCandidateSection {
  id: string;
  kind: CodeIndexCoverageKind;
  title: string;
  markdown: string;
  evidence: readonly CustomCodeEvidence[];
}

export interface CustomCodeCandidateDraft {
  nodeRef: string;
  kind: string;
  visibility: string;
  module: string;
  markdown?: string;
  /** Evidence-scoped aggregate sections used to prove output-profile coverage. */
  sections?: readonly CustomCodeCandidateSection[];
  evidence: readonly CustomCodeEvidence[];
  review: CustomCodeCandidateReview;
  edges?: readonly CustomCodeCandidateEdge[];
}

export interface CustomCodeExtractionResult {
  candidates:
    | readonly CustomCodeCandidateDraft[]
    | Iterable<CustomCodeCandidateDraft>
    | AsyncIterable<CustomCodeCandidateDraft>;
}

export interface CustomCodeExtractionContext {
  projectRoot: string;
  runId: string;
  /** CLI-resolved source roots. Use these paths instead of environment-specific checkout paths. */
  sources: readonly {
    name: string;
    materializedAt: string;
    absolutePath: string;
  }[];
}

export type CustomCodeExtractor = (
  context: CustomCodeExtractionContext,
) => CustomCodeExtractionResult | Promise<CustomCodeExtractionResult>;

export type ExtractCustomPhaseDefinition = {
  kind: "phase.extract.custom";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  sources: readonly RepoProjectSourceDefinition[];
  collection: "codegraph";
  indexPlan: "declared" | "inferred";
  indexUnits: readonly CodeIndexUnitPlan[];
  inspect?: CodeIndexInspectionAdapter;
  extract: CustomCodeExtractor;
};

export type CaptureFilePhaseDefinition = {
  kind: "phase.capture.file";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  source: FileSourceDefinition | FileSourceReference;
  processors?: readonly FileCaptureProcessorDefinition[];
};

export type CaptureLarkPhaseDefinition = {
  kind: "phase.capture.lark";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  source: LarkSourceDefinition | LarkSourceReference;
  resources: {
    videos: "reference-only" | "bundle";
    maxBytesPerResource: number;
    maxTotalBytes: number;
  };
};

export type AlignProsePhaseDefinition = {
  kind: "phase.align.prose";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  source: DocumentSourceDefinition;
  sourceType?: DocumentSourceType;
  collection: DocumentMainlineCollection;
};

export type CompileProsePhaseDefinition = {
  kind: "phase.compile.prose";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  source: DocumentSourceDefinition;
  sourceType?: DocumentSourceType;
  collection: DocumentMainlineCollection;
  schemaVersion: typeof DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION;
};

export type ReviewValidityScope =
  | {
    kind: "collection";
    collection: KnowledgeCollection;
  }
  | {
    kind: "all";
  };

export type ReviewValidityPhaseDefinition = {
  kind: "phase.review.validity";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  collection?: KnowledgeCollection;
  scope: ReviewValidityScope;
  status: "draft";
  payload: string;
  decisions: readonly ["approved", "rejected"];
};

export type CustomPhaseDefinition = {
  kind: "phase.custom";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  run: ContextPhase;
};

export type PhaseDefinition =
  | ExtractTsPhaseDefinition
  | ExtractCustomPhaseDefinition
  | CaptureFilePhaseDefinition
  | CaptureLarkPhaseDefinition
  | AlignProsePhaseDefinition
  | CompileProsePhaseDefinition
  | ReviewValidityPhaseDefinition
  | CustomPhaseDefinition;

const getSourceType = (sourceDefinition: SourceDefinition | SourceCollectionReference): SourceType => {
  if (sourceDefinition.kind === "source.collection" || sourceDefinition.kind === "source.ref") {
    if (!("type" in sourceDefinition)) {
      throw new TypeError(`source reference is not bound to a source type: ${sourceDefinition.name}`);
    }
    return sourceDefinition.type;
  }
  if (sourceDefinition.kind === "source.repo") return "repo";
  if (sourceDefinition.kind === "source.file") return "file";
  return "lark";
};

const getSourceName = (sourceDefinition: SourceDefinition): string => sourceDefinition.name;

const typedReference = <TType extends SourceType>(
  reference: RegistrySourceReference | TypedSourceReference<TType>,
  expected: TType,
  field: string,
): TypedSourceReference<TType> => {
  if ("type" in reference && reference.type !== expected) {
    throw new TypeError(`${field} must reference a ${expected} source, got ${reference.type}`);
  }
  return {
    kind: "source.ref",
    type: expected,
    name: reference.name,
    materializedAt: `sources/${expected}/${reference.name}`,
  };
};

const bindSourceType = <TType extends SourceType>(
  sourceDefinition: SourceDefinition | SourceCollectionReference,
  expected: TType,
  field: string,
): SourceDefinition | SourceCollectionReference => {
  if (sourceDefinition.kind === "source.ref") {
    return typedReference(sourceDefinition as RegistrySourceReference | TypedSourceReference<TType>, expected, field);
  }

  const actual = getSourceType(sourceDefinition);
  if (actual !== expected) {
    throw new TypeError(`${field} must reference a ${expected} source, got ${actual}`);
  }
  return sourceDefinition;
};

const assertDocumentSourceType = (
  sourceDefinition: DocumentSourceDefinition,
  field: string,
): DocumentSourceType => {
  if (sourceDefinition.kind === "source.ref" && !("type" in sourceDefinition)) {
    throw new TypeError(`${field} must be bound to a file or lark source`);
  }
  const actual = getSourceType(sourceDefinition);
  if (actual !== "file" && actual !== "lark") {
    throw new TypeError(`${field} must reference a file or lark source, got ${actual}`);
  }
  return actual;
};

const sourceSnapshotResource = (
  sourceDefinition: DocumentSourceDefinition,
  sourceType: DocumentSourceType,
): PhaseResourceReference => ({
  kind: "source.snapshot",
  source: sourceDefinition,
  sourceType,
  path: `sources/${sourceType}/${getSourceName(sourceDefinition)}/manifest.json`,
});

const lifecycleStructureResource = (
  collection: DocumentMainlineCollection,
  status?: "draft" | "confirmed" | "frozen",
): PhaseResourceReference => ({
  kind: "lifecycle.structure",
  path: ".tmp/context-runtime/lifecycle/structure.yaml",
  profileCollection: collection,
  ...(status === undefined ? {} : { status }),
});

function normalizeFileCaptureProcessors(definition: {
  processor?: FileCaptureProcessorDefinition;
  processors?: readonly FileCaptureProcessorDefinition[];
}): readonly FileCaptureProcessorDefinition[] {
  return [
    ...(definition.processor !== undefined ? [definition.processor] : []),
    ...(definition.processors ?? []),
  ];
}

export function mdxJsonDocs(options: {
  include?: readonly string[];
  documentExtensions?: readonly string[];
  routeMetadataFile?: string;
} = {}): FileCaptureProcessorDefinition {
  const routeMetadataFile = options.routeMetadataFile ?? "_meta.json";
  return {
    kind: "file.capture.processor.mdx-json-docs",
    include: options.include ?? ["**/*.md", "**/*.mdx", `**/${routeMetadataFile}`],
    documentExtensions: options.documentExtensions ?? [".md", ".mdx"],
    routeMetadataFile,
  };
}

export const captureFile = (definition: {
  source: FileSourceDefinition | FileSourceReference;
  processor?: FileCaptureProcessorDefinition;
  processors?: readonly FileCaptureProcessorDefinition[];
}): CaptureFilePhaseDefinition => {
  const sourceDefinition = bindSourceType(definition.source, "file", "captureFile source") as FileSourceDefinition | TypedSourceReference<"file">;
  const sourceId = getSourceName(sourceDefinition);
  const processors = normalizeFileCaptureProcessors(definition);
  return {
    kind: "phase.capture.file",
    id: `capture:file:${sourceId}`,
    reads: [{
      kind: "source",
      source: sourceDefinition,
    }],
    writes: [sourceSnapshotResource(sourceDefinition, "file")],
    source: sourceDefinition,
    ...(processors.length > 0 ? { processors } : {}),
  };
};

export const captureLark = (definition: {
  source: LarkSourceDefinition | LarkSourceReference;
  resources?: {
    videos?: "reference-only" | "bundle";
    maxBytesPerResource?: number;
    maxTotalBytes?: number;
  };
}): CaptureLarkPhaseDefinition => {
  const sourceDefinition = bindSourceType(definition.source, "lark", "captureLark source") as LarkSourceDefinition | TypedSourceReference<"lark">;
  const sourceId = getSourceName(sourceDefinition);
  const maxBytesPerResource = definition.resources?.maxBytesPerResource ?? 20 * 1024 * 1024;
  const maxTotalBytes = definition.resources?.maxTotalBytes ?? 200 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytesPerResource) || maxBytesPerResource < 1) {
    throw new TypeError("captureLark resources.maxBytesPerResource must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxBytesPerResource) {
    throw new TypeError("captureLark resources.maxTotalBytes must be a safe integer greater than or equal to maxBytesPerResource");
  }
  return {
    kind: "phase.capture.lark",
    id: `capture:lark:${sourceId}`,
    reads: [{
      kind: "source",
      source: sourceDefinition,
    }],
    writes: [sourceSnapshotResource(sourceDefinition, "lark")],
    source: sourceDefinition,
    resources: {
      videos: definition.resources?.videos ?? "reference-only",
      maxBytesPerResource,
      maxTotalBytes,
    },
  };
};

export const alignProse = (definition: {
  source: DocumentSourceDefinition;
  collection: DocumentMainlineCollection;
}): AlignProsePhaseDefinition => {
  assertDocumentMainlineCollection(definition.collection, "alignProse collection");
  const sourceId = getSourceName(definition.source);
  if (definition.source.kind === "source.ref" && !("type" in definition.source)) {
    return {
      kind: "phase.align.prose",
      id: `align:source:${sourceId}:${definition.collection}`,
      reads: [{
        kind: "source",
        source: definition.source,
      }],
      writes: [lifecycleStructureResource(definition.collection, "draft")],
      source: definition.source,
      collection: definition.collection,
    };
  }

  const sourceType = assertDocumentSourceType(definition.source, "alignProse source");
  return {
    kind: "phase.align.prose",
    id: `align:${sourceType}:${sourceId}:${definition.collection}`,
    reads: [sourceSnapshotResource(definition.source, sourceType)],
    writes: [lifecycleStructureResource(definition.collection, "draft")],
    source: definition.source,
    sourceType,
    collection: definition.collection,
  };
};

export const compileProse = (definition: {
  source: DocumentSourceDefinition;
  collection: DocumentMainlineCollection;
}): CompileProsePhaseDefinition => {
  assertDocumentMainlineCollection(definition.collection, "compileProse collection");
  const sourceId = getSourceName(definition.source);
  if (definition.source.kind === "source.ref" && !("type" in definition.source)) {
    return {
      kind: "phase.compile.prose",
      id: `compile:source:${sourceId}:${definition.collection}`,
      reads: [{
        kind: "source",
        source: definition.source,
      }, lifecycleStructureResource(definition.collection, "confirmed")],
      writes: [
        lifecycleStructureResource(definition.collection, "frozen"),
        {
          kind: "lifecycle.candidates",
          path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
          status: "draft",
        },
      ],
      source: definition.source,
      collection: definition.collection,
      schemaVersion: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
    };
  }

  const sourceType = assertDocumentSourceType(definition.source, "compileProse source");
  return {
    kind: "phase.compile.prose",
    id: `compile:${sourceType}:${sourceId}:${definition.collection}`,
    reads: [
      sourceSnapshotResource(definition.source, sourceType),
      lifecycleStructureResource(definition.collection, "confirmed"),
    ],
    writes: [
      lifecycleStructureResource(definition.collection, "frozen"),
      {
        kind: "lifecycle.candidates",
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        status: "draft",
      },
    ],
    source: definition.source,
    sourceType,
    collection: definition.collection,
    schemaVersion: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  };
};

export const extractTs = (definition: {
  source: RepoProjectSourceDefinition;
  collection: "codegraph";
  include?: readonly string[];
  mode?: "exports" | "scan";
  entries?: readonly string[];
  exportedOnly?: boolean;
  indexUnits?: readonly CodeIndexUnitPlan[];
  transform?: MarkdownTransform | readonly MarkdownTransform[];
}): ExtractTsPhaseDefinition => {
  const sourceDefinition = bindSourceType(definition.source, "repo", "extractTs source") as RepoProjectSourceDefinition;
  if (definition.collection !== "codegraph") {
    throw new TypeError(`extractTs collection must be codegraph: ${definition.collection}`);
  }
  const sourceId = sourceDefinition.kind === "source.collection"
    ? sourceDefinition.type
    : sourceDefinition.name;
  const mode = definition.mode ?? "exports";
  if (mode === "scan" && definition.entries !== undefined) {
    throw new TypeError("extractTs entries cannot be combined with mode: scan; scan mode uses every file matched by include");
  }
  if (definition.entries !== undefined && definition.entries.length === 0) {
    throw new ExtractTsConfigurationError("extractTs entries must contain at least one source-relative file path");
  }
  const entries = definition.entries === undefined
    ? undefined
    : [...new Set(definition.entries.map(normalizeExtractEntry))];
  const defaultSourceName = sourceDefinition.kind === "source.collection"
    ? sourceDefinition.type
    : sourceDefinition.name;
  const exportedOnly = definition.exportedOnly ?? mode === "exports";
  const indexUnits = (definition.indexUnits ?? (sourceDefinition.kind === "source.collection"
    ? []
    : [{
        id: defaultSourceName,
        inputSources: [defaultSourceName],
        outputOwner: defaultSourceName,
        moduleType: mode === "exports" ? "sdk-library" : "unknown",
        moduleTypes: [mode === "exports" ? "sdk-library" : "unknown"],
        facets: mode === "exports" ? ["public-api"] : [],
        moduleTypeEvidence: mode === "exports"
          ? ["Package export entries selected by extractTs exports mode."]
          : [],
        outputProfile: mode === "exports" ? "public-api-reference" : "module-map",
        responsibility: mode === "exports"
          ? "Index the stable exported contracts of this module."
          : "Index the configured structural scope of this module.",
        entries: entries ?? [],
        pageKinds: mode === "exports" ? ["public-contract"] : ["module-map"],
        protocols: [],
        dependencies: [],
        exclusions: [],
        capability: "complete",
      } satisfies CodeIndexUnitPlan])).map((unit, index) =>
        normalizeIndexUnit(unit, `extractTs indexUnits[${index}]`)
      );
  assertUniqueIndexUnits(indexUnits, "extractTs indexUnits");
  const phase: ExtractTsPhaseDefinition = {
    kind: "phase.extract.ts",
    id: `extract:${sourceId}:${definition.collection}`,
    reads: [{
      kind: "source",
      source: sourceDefinition,
    }],
    writes: [{
      kind: "lifecycle.candidates",
      path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
      collection: definition.collection,
      status: "draft",
    }],
    source: sourceDefinition,
    collection: definition.collection,
    include: definition.include ?? ["src/**/*.{ts,tsx}"],
    mode,
    ...(entries !== undefined ? { entries } : {}),
    exportedOnly,
    indexPlan: definition.indexUnits !== undefined ||
        (sourceDefinition.kind !== "source.collection" && mode === "exports" && exportedOnly)
      ? "declared"
      : "inferred",
    indexUnits,
    out: {
      kind: "codegraph-entities",
      candidateFile: ".tmp/context-runtime/lifecycle/candidates.jsonl",
      approvedPagesDir: `knowledge/${definition.collection}`,
      initialStatus: "draft",
    },
  };

  if (definition.transform) {
    phase.transform = definition.transform;
  }

  return phase;
};

export const extractCustom = (definition: {
  id: string;
  sources: readonly RepoProjectSourceDefinition[];
  collection: "codegraph";
  indexUnits?: readonly CodeIndexUnitPlan[];
  inspect?: CodeIndexInspectionAdapter;
  extract: CustomCodeExtractor;
}): ExtractCustomPhaseDefinition => {
  const id = definition.id.trim();
  if (id.length === 0) throw new TypeError("extractCustom id must be a non-empty phase id");
  if (definition.sources.length === 0) throw new TypeError("extractCustom sources must contain at least one repo source");
  if (definition.collection !== "codegraph") {
    throw new TypeError(`extractCustom collection must be codegraph: ${definition.collection}`);
  }
  const sources = definition.sources.map((sourceDefinition) =>
    bindSourceType(sourceDefinition, "repo", "extractCustom source") as RepoProjectSourceDefinition
  );
  const indexUnits = (definition.indexUnits ?? []).map((unit, index) =>
    normalizeIndexUnit(unit, `extractCustom indexUnits[${index}]`)
  );
  assertUniqueIndexUnits(indexUnits, "extractCustom indexUnits");
  return {
    kind: "phase.extract.custom",
    id,
    reads: sources.map((sourceDefinition) => ({ kind: "source", source: sourceDefinition })),
    writes: [{
      kind: "lifecycle.candidates",
      path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
      collection: definition.collection,
      status: "draft",
    }],
    sources,
    collection: definition.collection,
    indexPlan: definition.indexUnits === undefined ? "inferred" : "declared",
    indexUnits,
    ...(definition.inspect === undefined ? {} : { inspect: definition.inspect }),
    extract: definition.extract,
  };
};

export const reviewValidity = (definition: {
  collection: KnowledgeCollection;
  payload?: string;
} | {
  scope: "all";
  payload?: string;
}): ReviewValidityPhaseDefinition => {
  const payload = definition.payload ?? "review-payload.json";
  if ("scope" in definition) {
    if (definition.scope !== "all") {
      throw new TypeError(`reviewValidity scope must be all: ${String(definition.scope)}`);
    }
    return {
      kind: "phase.review.validity",
      id: "review:all:validity",
      reads: [{
        kind: "lifecycle.candidates",
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        status: "draft",
      }],
      writes: [
        {
          kind: "review.payload",
          path: payload,
        },
        {
          kind: "knowledge.approved",
          path: "knowledge",
        },
        {
          kind: "knowledge.decisions",
          path: "knowledge/decisions.json",
        },
        {
          kind: "lifecycle.candidates",
          path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
          status: "rejected",
        },
      ],
      scope: { kind: "all" },
      status: "draft",
      payload,
      decisions: ["approved", "rejected"],
    };
  }
  assertKnowledgeCollection(definition.collection, "reviewValidity collection");
  return {
    kind: "phase.review.validity",
    id: `review:${definition.collection}:validity`,
    reads: [{
      kind: "lifecycle.candidates",
      path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
      collection: definition.collection,
      status: "draft",
    }],
    writes: [
      {
        kind: "review.payload",
        path: payload,
      },
      {
        kind: "knowledge.collection",
        path: `knowledge/${definition.collection}`,
        collection: definition.collection,
        status: "approved",
      },
      {
        kind: "knowledge.decisions",
        path: "knowledge/decisions.json",
      },
      {
        kind: "lifecycle.candidates",
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        collection: definition.collection,
        status: "rejected",
      },
    ],
    collection: definition.collection,
    scope: { kind: "collection", collection: definition.collection },
    status: "draft",
    payload,
    decisions: ["approved", "rejected"],
  };
};

export const customPhase = (
  id: string,
  run: ContextPhase,
  io: {
    reads?: readonly PhaseResourceReference[];
    writes?: readonly PhaseResourceReference[];
  } = {},
): CustomPhaseDefinition => ({
  kind: "phase.custom",
  id,
  reads: io.reads ?? [],
  writes: io.writes ?? [],
  run,
});
