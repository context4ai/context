import {
  type FileCaptureProcessorDefinition,
  type KnowledgeCollection,
  type PackageKind,
  type PackageSelectDefinition,
} from "./contracts.js";
import type {
  RegistrySourceReference,
  DocumentSourceDefinition,
  DocumentSourceType,
  FileSourceDefinition,
  FileSourceReference,
  LarkSourceDefinition,
  LarkSourceReference,
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
};

export type ContextPhase = (ctx: ContextPhaseContext) => unknown | Promise<unknown>;

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

export type CustomPhaseDefinition = {
  kind: "phase.custom";
  id: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  run: ContextPhase;
};

export type PhaseDefinition =
  | CaptureFilePhaseDefinition
  | CaptureLarkPhaseDefinition
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

const sourceSnapshotResource = (
  sourceDefinition: DocumentSourceDefinition,
  sourceType: DocumentSourceType,
): PhaseResourceReference => ({
  kind: "source.snapshot",
  source: sourceDefinition,
  sourceType,
  path: `sources/${sourceType}/${getSourceName(sourceDefinition)}/manifest.json`,
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
