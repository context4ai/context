import type {
  PackageKind,
  PackageNavigationDefinition,
  PackageSelectDefinition,
} from "./contracts.js";
import { assertKnowledgeCollection, assertOkfRoot } from "./contracts.js";
import { DEFAULT_PACKAGE_NAVIGATION } from "./contracts.js";
import type { PhaseDefinition, PhaseResourceReference } from "./phases.js";
import type { ProjectSourceDefinition } from "./sources.js";

export type {
  CodegraphCollection,
  CodeIndexCollection,
  DocumentMainlineCollection,
  EntityStatus,
  KnowledgeCollection,
  MainlineCollection,
  MarkdownTransform,
  FileCaptureProcessorDefinition,
  OkfRoot,
  PackageKind,
  PackageNavigationDefinition,
  PackageSelectDefinition,
  TopLevelNamespace,
} from "./contracts.js";
export {
  assertDocumentMainlineCollection,
  assertKnowledgeCollection,
  assertMainlineCollection,
  assertOkfRoot,
  assertTopLevelNamespace,
  DOC_MAINLINE_COLLECTIONS,
  DEFAULT_PACKAGE_NAVIGATION,
  KNOWLEDGE_COLLECTIONS,
  MAINLINE_COLLECTIONS,
  OKF_ROOTS,
  TOP_LEVEL_NAMESPACES,
} from "./contracts.js";
export {
  assertDocumentEvidenceSectionMetadata,
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  DOCUMENT_EVIDENCE_SECTION_VALIDATION_STAGES,
  DOCUMENT_SECTION_CONTENT_MODES,
  DOCUMENT_STRUCTURE_SCHEMA_VERSION,
} from "./documentEvidence.js";
export type {
  DocumentEvidenceSectionMetadata,
  DocumentEvidenceSectionValidationOptions,
  DocumentEvidenceSectionValidationStage,
  DocumentSectionContentMode,
} from "./documentEvidence.js";
export {
  alignProse,
  captureFile,
  captureLark,
  compileProse,
  CODE_INDEX_CAPABILITIES,
  CODE_INDEX_COVERAGE_KINDS,
  CODE_INDEX_LIFECYCLES,
  CODE_INDEX_MODULE_FACETS,
  CODE_INDEX_MODULE_TYPES,
  CODE_INDEX_OUTPUT_PROFILES,
  customPhase,
  extractCustom,
  extractTs,
  ExtractTsConfigurationError,
  NO_ENTRY_DETECTED,
  requiredCodeIndexCoverage,
  mdxJsonDocs,
  reviewValidity,
} from "./phases.js";
export type {
  AlignProsePhaseDefinition,
  CaptureFilePhaseDefinition,
  CaptureLarkPhaseDefinition,
  CompileProsePhaseDefinition,
  ContextPhase,
  ContextPhaseContext,
  CustomPhaseDefinition,
  CustomCodeCandidateDraft,
  CustomCodeCandidateEdge,
  CustomCodeCandidateSection,
  CustomCodeCandidateReview,
  CustomCodeEvidence,
  CustomCodeExtractionContext,
  CustomCodeExtractionResult,
  CustomCodeExtractor,
  CodeIndexCapability,
  CodeIndexCapabilityGap,
  CodeIndexCoverageKind,
  CodeIndexInspectionAdapter,
  CodeIndexInspectionContext,
  CodeIndexInspectionFinding,
  CodeIndexInspectionFindingKind,
  CodeIndexInspectionInventory,
  CodeIndexInspectionResult,
  CodeIndexLifecycle,
  CodeIndexModuleFacet,
  CodeIndexModuleType,
  CodeIndexOutputProfile,
  CodeIndexUnitPlan,
  ExtractCustomPhaseDefinition,
  ExtractTsPhaseDefinition,
  PhaseDefinition,
  PhaseResourceReference,
  ReviewValidityPhaseDefinition,
  ReviewValidityScope,
} from "./phases.js";
export {
  allSources,
  DEFAULT_FILE_SOURCES_REGISTRY_PATH,
  DEFAULT_LARK_SOURCES_REGISTRY_PATH,
  DEFAULT_REPO_SOURCES_REGISTRY_PATH,
  loadSourcesRegistry,
  resolveSourceReference,
  source,
} from "./sources.js";
export type {
  DocumentSourceDefinition,
  DocumentSourceReference,
  DocumentSourceType,
  FileSourceDefinition,
  FileSourceReference,
  FileSourceRegistryEntry,
  LarkSourceDefinition,
  LarkSourceReference,
  LarkSourceRegistryEntry,
  LoadSourcesRegistryOptions,
  ProjectSourceDefinition,
  RepoProjectSourceDefinition,
  RepoSourceDefinition,
  RepoSourceReference,
  RepoSourceRegistryEntry,
  RepoSourcesRegistry,
  SourceCollectionReference,
  SourceDefinition,
  SourceReference,
  SourcesRegistry,
  SourceType,
} from "./sources.js";

export type TemplateVarValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | readonly Record<string, unknown>[];

export type PackageTemplateDefinition = {
  path: string;
  vars?: Record<string, TemplateVarValue>;
};

export type PackageTemplateInput = string | {
  path: string;
  vars?: Record<string, TemplateVarValue>;
};

export type PackageDistributionDefinition = {
  /** @deprecated Accepted for older workspaces; package output roots are flat. */
  knowledgeNamespace: string;
};

export type PackageAssetOptimizationDefinition = {
  /** Image codec provider supplied by Context CLI. */
  processor: "sharp";
  /** Explicit output policy. Omit optimize to use Context's adaptive package budget. */
  mode?: "lossless-webp" | "webp";
  /** WebP quality for lossy mode. */
  quality?: number;
  /** Optional longest-edge limit. Images are never enlarged. */
  maxDimension?: number;
};

export type PackageAssetDefinition =
  | {
    /** Publish references to immutable Git-hosted resources instead of copying resource bytes. */
    delivery: "git-raw";
    /** Git remote used to derive the repository URL. */
    remote?: string;
    /** Optional HTTPS raw root. Context appends knowledge/assets/**; {commit} is supported. */
    urlPrefix?: string;
  }
  | {
    /** Copy resources into the package. This is the default delivery. */
    delivery: "bundle";
    /** Optional image optimization, resolved from the Context workspace. */
    optimize?: PackageAssetOptimizationDefinition;
  }
  | {
    /** Do not copy resources. Existing relative references remain unresolved. */
    delivery: "omit";
  };

export type BasePackageDefinition = {
  name: string;
  reads: readonly PhaseResourceReference[];
  writes: readonly PhaseResourceReference[];
  select?: PackageSelectDefinition;
  template: PackageTemplateDefinition;
  outDir: string;
};

export type KbPackageDefinition = BasePackageDefinition & {
  kind: "package.kb";
  navigation: PackageNavigationDefinition;
  distribution?: PackageDistributionDefinition;
  assets?: PackageAssetDefinition;
};

export type LlmsPackageDefinition = BasePackageDefinition & {
  kind: "package.llms";
};

export type PackageDefinition = KbPackageDefinition | LlmsPackageDefinition;

export type ContextProjectDefinition = {
  sources: readonly ProjectSourceDefinition[];
  phases: readonly PhaseDefinition[];
  packages: readonly PackageDefinition[];
};

export type ContextProjectModule<TProject extends ContextProjectDefinition = ContextProjectDefinition> = {
  kind: "context.project";
  project: TProject;
};

function assertUniquePhaseIds(phases: readonly PhaseDefinition[]): void {
  const firstById = new Map<string, { index: number; kind: PhaseDefinition["kind"] }>();
  for (const [index, phase] of phases.entries()) {
    const first = firstById.get(phase.id);
    if (first !== undefined) {
      throw new TypeError(
        `Duplicate Context phase id ${JSON.stringify(phase.id)}: phases[${first.index}] (${first.kind}) conflicts with phases[${index}] (${phase.kind}). Every phase id must be unique.`,
      );
    }
    firstById.set(phase.id, { index, kind: phase.kind });
  }
}

export const defineProject = <TProject extends ContextProjectDefinition>(
  project: TProject,
): ContextProjectModule<TProject> => {
  assertUniquePhaseIds(project.phases);
  return {
    kind: "context.project",
    project,
  };
};

const normalizeTemplate = (
  template: PackageTemplateInput,
  builtInVars: Record<string, TemplateVarValue>,
): PackageTemplateDefinition => {
  const assertTemplatePath = (templatePath: string): void => {
    if (!isSafeProjectRelativePath(templatePath)) {
      throw new TypeError(`Package template path must be a project-relative safe path: ${templatePath}`);
    }
  };

  if (typeof template === "string") {
    assertTemplatePath(template);
    return { path: template, vars: builtInVars };
  }

  assertTemplatePath(template.path);
  return {
    path: template.path,
    vars: {
      ...builtInVars,
      ...template.vars,
      packageName: String(builtInVars.packageName),
      packageKind: String(builtInVars.packageKind),
    },
  };
};

const normalizeSelect = (select: PackageSelectDefinition | undefined): PackageSelectDefinition | undefined => {
  if (!select) return undefined;

  const normalized: PackageSelectDefinition = {};
  if (select.collections && select.collections.length > 0) {
    assertSelectCollections(select.collections);
    normalized.collections = select.collections;
  }
  if (select.okfRoots && select.okfRoots.length > 0) {
    assertSelectOkfRoots(select.okfRoots);
    normalized.okfRoots = select.okfRoots;
  }
  if (select.include && select.include.length > 0) {
    assertSelectPatterns("include", select.include);
    normalized.include = select.include;
  }
  if (select.exclude && select.exclude.length > 0) {
    assertSelectPatterns("exclude", select.exclude);
    normalized.exclude = select.exclude;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizePackageNavigation = (
  navigation: Partial<PackageNavigationDefinition> | undefined,
): PackageNavigationDefinition => {
  const maxInlineEntries = navigation?.maxInlineEntries ?? DEFAULT_PACKAGE_NAVIGATION.maxInlineEntries;
  if (!Number.isSafeInteger(maxInlineEntries) || maxInlineEntries < 1) {
    throw new TypeError(`Package navigation.maxInlineEntries must be a positive safe integer: ${maxInlineEntries}`);
  }
  return {
    foldDirectoryIndexes: navigation?.foldDirectoryIndexes ??
      DEFAULT_PACKAGE_NAVIGATION.foldDirectoryIndexes,
    maxInlineEntries,
  };
};

const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const PACKAGE_KNOWLEDGE_NAMESPACE_SEGMENT_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const PACKAGE_KNOWLEDGE_NAMESPACE_SEGMENT_MAX_LENGTH = 48;
const PACKAGE_KNOWLEDGE_NAMESPACE_MAX_LENGTH = 128;

const isSafeProjectRelativePath = (value: string): boolean => {
  if (value.length === 0) return false;
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(value)) return false;
  return value.split(/[\\/]+/u).every((part) => part.length > 0 && part !== "." && part !== "..");
};

const assertSelectPatterns = (field: "include" | "exclude", patterns: readonly string[]): void => {
  for (const pattern of patterns) {
    if (!isSafeProjectRelativePath(pattern)) {
      throw new TypeError(`Package select.${field} must be a knowledge-relative safe pattern: ${pattern}`);
    }
  }
};

const assertSelectCollections = (collections: readonly string[]): void => {
  for (const collection of collections) {
    assertKnowledgeCollection(collection, "Package select.collections");
  }
};

const normalizePackageDistribution = (
  distribution: PackageDistributionDefinition | undefined,
): PackageDistributionDefinition | undefined => {
  if (distribution === undefined) return undefined;
  if (typeof distribution.knowledgeNamespace !== "string") {
    throw new TypeError("Package distribution.knowledgeNamespace must be a string.");
  }
  const knowledgeNamespace = distribution.knowledgeNamespace.trim();
  const segments = knowledgeNamespace.split("/");
  if (
    knowledgeNamespace.length > PACKAGE_KNOWLEDGE_NAMESPACE_MAX_LENGTH ||
    segments.length === 0 ||
    segments.some((segment) =>
      segment.length > PACKAGE_KNOWLEDGE_NAMESPACE_SEGMENT_MAX_LENGTH ||
      !PACKAGE_KNOWLEDGE_NAMESPACE_SEGMENT_PATTERN.test(segment)
    )
  ) {
    throw new TypeError(
      `Package distribution.knowledgeNamespace must contain safe lowercase path segments using letters, numbers, hyphens, or dots, separated by "/", and be at most ${PACKAGE_KNOWLEDGE_NAMESPACE_MAX_LENGTH} characters: ${distribution.knowledgeNamespace}`,
    );
  }
  return { knowledgeNamespace };
};

const normalizePackageAssetOptimization = (
  assets: PackageAssetOptimizationDefinition,
): PackageAssetOptimizationDefinition => {
  if (assets.processor !== "sharp") {
    throw new TypeError(`Package assets.optimize.processor must be "sharp": ${String(assets.processor)}`);
  }
  const mode = assets.mode ?? "lossless-webp";
  if (mode !== "lossless-webp" && mode !== "webp") {
    throw new TypeError(`Package assets.optimize.mode must be "lossless-webp" or "webp": ${String(mode)}`);
  }
  if (assets.quality !== undefined &&
    (!Number.isSafeInteger(assets.quality) || assets.quality < 1 || assets.quality > 100)) {
    throw new TypeError(`Package assets.optimize.quality must be a safe integer from 1 to 100: ${assets.quality}`);
  }
  if (mode === "lossless-webp" && assets.quality !== undefined) {
    throw new TypeError("Package assets.optimize.quality is only valid when assets.optimize.mode is \"webp\".");
  }
  if (assets.maxDimension !== undefined &&
    (!Number.isSafeInteger(assets.maxDimension) || assets.maxDimension < 1)) {
    throw new TypeError(`Package assets.optimize.maxDimension must be a positive safe integer: ${assets.maxDimension}`);
  }
  return {
    processor: "sharp",
    mode,
    ...(assets.quality === undefined ? {} : { quality: assets.quality }),
    ...(assets.maxDimension === undefined ? {} : { maxDimension: assets.maxDimension }),
  };
};

const normalizePackageAssets = (
  assets: PackageAssetDefinition | undefined,
): PackageAssetDefinition => {
  if (assets === undefined) return { delivery: "bundle" };
  if (assets.delivery === "bundle") {
    return {
      delivery: "bundle",
      ...(assets.optimize === undefined
        ? {}
        : { optimize: normalizePackageAssetOptimization(assets.optimize) }),
    };
  }
  if (assets.delivery === "omit") return { delivery: "omit" };
  if (assets.delivery !== "git-raw") {
    throw new TypeError(`Package assets.delivery must be "git-raw", "bundle", or "omit": ${String((assets as { delivery?: unknown }).delivery)}`);
  }
  const remote = assets.remote?.trim();
  if (remote !== undefined && !/^[A-Za-z0-9._-]+$/u.test(remote)) {
    throw new TypeError(`Package assets.remote must be a safe Git remote name: ${assets.remote}`);
  }
  const urlPrefix = assets.urlPrefix?.trim().replace(/\/+$/u, "");
  if (urlPrefix !== undefined && !urlPrefix.startsWith("https://")) {
    throw new TypeError("Package assets.urlPrefix must be an HTTPS URL; it may contain {commit}.");
  }
  return {
    delivery: "git-raw",
    ...(remote === undefined ? {} : { remote }),
    ...(urlPrefix === undefined ? {} : { urlPrefix }),
  };
};

const assertSelectOkfRoots = (roots: readonly string[]): void => {
  for (const root of roots) {
    assertOkfRoot(root, "Package select.okfRoots");
  }
};

const createPackageDefinitionBase = (
  kind: PackageKind,
  definition: {
    name: string;
    template: PackageTemplateInput;
    select?: PackageSelectDefinition;
  },
): BasePackageDefinition => {
  if (!PACKAGE_NAME_PATTERN.test(definition.name)) {
    throw new TypeError(`Package name must be a lowercase path-safe slug: ${definition.name}`);
  }

  const select = normalizeSelect(definition.select);
  const acronymSegments = new Set(["ai", "api", "cli", "db", "id", "kb", "llm", "llms", "sdk", "ui"]);
  const defaultDisplayName = definition.name
    .replace(/[._-]+/gu, " ")
    .trim()
    .replace(/\b[a-z0-9]+\b/gu, (segment) =>
      acronymSegments.has(segment) ? segment.toUpperCase() : `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`
    );
  const builtInVars: Record<string, TemplateVarValue> = {
    displayName: defaultDisplayName.length > 0 ? defaultDisplayName : definition.name,
    packageName: definition.name,
    packageKind: kind,
  };
  const template = normalizeTemplate(definition.template, builtInVars);
  const packageDefinition: BasePackageDefinition = {
    name: definition.name,
    reads: [{
      kind: "knowledge.approved",
      path: "knowledge",
      ...(select ? { select } : {}),
    }, {
      kind: "package.template",
      path: template.path,
    }],
    writes: [{
      kind: "dist.package",
      path: `dist/${definition.name}`,
      packageName: definition.name,
      packageKind: kind,
    }],
    template,
    outDir: `dist/${definition.name}`,
  };

  if (select) {
    packageDefinition.select = select;
  }

  return packageDefinition;
};

export const kbPackage = (definition: {
  name: string;
  template: PackageTemplateInput;
  select?: PackageSelectDefinition;
  navigation?: Partial<PackageNavigationDefinition>;
  distribution?: PackageDistributionDefinition;
  assets?: PackageAssetDefinition;
}): KbPackageDefinition => {
  const base = createPackageDefinitionBase("kb", definition);
  const distribution = normalizePackageDistribution(definition.distribution);
  const assets = normalizePackageAssets(definition.assets);
  return {
    kind: "package.kb",
    ...base,
    navigation: normalizePackageNavigation(definition.navigation),
    ...(distribution === undefined ? {} : { distribution }),
    assets,
  };
};

export const llmsPackage = (definition: {
  name: string;
  template: PackageTemplateInput;
  select?: PackageSelectDefinition;
}): LlmsPackageDefinition => ({
  kind: "package.llms",
  ...createPackageDefinitionBase("llms", definition),
});
