export const CODE_INDEX_MODULE_TYPES = [
  "api-service",
  "service",
  "background-runtime",
  "sdk-library",
  "web-application",
  "adapter",
  "cli-tool",
  "monorepo-container",
  "contract-source",
  "derived-source",
  "unknown",
] as const;

export type CodeIndexModuleType = typeof CODE_INDEX_MODULE_TYPES[number];

export const CODE_INDEX_MODULE_FACETS = [
  "page-routing",
  "public-api",
  "protocol-provider",
  "protocol-consumer",
  "event-producer",
  "event-consumer",
  "persistence",
  "plugin-extension",
  "configuration-runtime",
  "build-release",
  "cross-module-chain",
  "generated-contract",
] as const;

export type CodeIndexModuleFacet = typeof CODE_INDEX_MODULE_FACETS[number];

export const CODE_INDEX_OUTPUT_PROFILES = [
  "protocol-index",
  "service-boundary",
  "runtime-map",
  "public-api-reference",
  "module-map",
  "application-map",
  "adapter-contract",
  "command-map",
  "module-registry",
  "cross-module-flow",
  "provenance-only",
] as const;

export type CodeIndexOutputProfile = typeof CODE_INDEX_OUTPUT_PROFILES[number];

export const CODE_INDEX_COVERAGE_KINDS = [
  "responsibility",
  "entrypoint",
  "operation",
  "contract",
  "handoff",
  "state-boundary",
  "failure-recovery",
  "delivery",
  "source-authority",
] as const;

export type CodeIndexCoverageKind = typeof CODE_INDEX_COVERAGE_KINDS[number];

const PROFILE_COVERAGE: Readonly<Record<CodeIndexOutputProfile, readonly CodeIndexCoverageKind[]>> = {
  "module-map": ["responsibility", "entrypoint"],
  "application-map": ["entrypoint", "operation", "handoff"],
  "protocol-index": ["contract", "operation", "handoff"],
  "service-boundary": ["operation", "handoff"],
  "runtime-map": ["entrypoint", "operation", "failure-recovery"],
  "public-api-reference": ["contract"],
  "adapter-contract": ["contract", "handoff"],
  "command-map": ["entrypoint", "operation", "failure-recovery"],
  "module-registry": ["responsibility", "source-authority"],
  "cross-module-flow": ["operation", "handoff"],
  "provenance-only": ["source-authority"],
};

export function requiredCodeIndexCoverage(input: {
  outputProfile: CodeIndexOutputProfile;
  facets?: readonly CodeIndexModuleFacet[];
}): CodeIndexCoverageKind[] {
  const required = new Set(PROFILE_COVERAGE[input.outputProfile]);
  for (const facet of input.facets ?? []) {
    if (facet === "build-release") required.add("delivery");
    if (facet === "persistence" || facet === "configuration-runtime") required.add("state-boundary");
    if (facet === "generated-contract") required.add("source-authority");
  }
  return [...required];
}

export const CODE_INDEX_CAPABILITIES = [
  "complete",
  "project-adapter",
  "material-required",
] as const;

export type CodeIndexCapability = typeof CODE_INDEX_CAPABILITIES[number];

export const CODE_INDEX_LIFECYCLES = [
  "authoritative",
  "generated",
  "mirrored",
  "legacy",
  "vendored",
] as const;

export type CodeIndexLifecycle = typeof CODE_INDEX_LIFECYCLES[number];

/** Stable knowledge intent for one user-visible code index unit. */
export interface CodeIndexUnitPlan {
  id: string;
  inputSources: readonly string[];
  outputOwner: string;
  /** Primary classification retained for compact reports and existing plans. */
  moduleType: CodeIndexModuleType;
  /** All applicable module archetypes. A hybrid module may declare more than one. */
  moduleTypes?: readonly CodeIndexModuleType[];
  /** Composable behavior and contract facets used to select extraction guidance. */
  facets?: readonly CodeIndexModuleFacet[];
  /** Source-backed reasons for the selected module type. */
  moduleTypeEvidence?: readonly string[];
  /** Source-relative Markdown documents read while classifying this index unit. */
  documents?: readonly string[];
  outputProfile: CodeIndexOutputProfile;
  responsibility: string;
  entries: readonly string[];
  pageKinds: readonly string[];
  protocols: readonly string[];
  dependencies: readonly string[];
  exclusions: readonly string[];
  lifecycle?: CodeIndexLifecycle;
  sourceOfTruth?: string;
  capability: CodeIndexCapability;
}

export type CodeIndexInspectionFindingKind =
  | "module"
  | "entry"
  | "protocol"
  | "dependency"
  | "lifecycle"
  | "source-of-truth";

export interface CodeIndexInspectionFinding {
  indexUnitId: string;
  source: string;
  kind: CodeIndexInspectionFindingKind;
  summary: string;
  path?: string;
}

export interface CodeIndexCapabilityGap {
  indexUnitId: string;
  reason: string;
  requestedMaterial?: string;
}

/** Complete source inventory returned by a project adapter for mechanical quality scoring. */
export interface CodeIndexInspectionInventory {
  indexUnitId: string;
  eligibleFiles: number;
  analyzedFiles: number;
  /** Complete eligible source identities used as the file denominator. */
  eligibleFileTargets: readonly string[];
  /** Complete source identities successfully analyzed by the adapter. */
  analyzedFileTargets: readonly string[];
  eligibleLoc: number;
  analyzedLoc: number;
  documentsDiscovered: number;
  documentsRead: number;
  /** Discovered Markdown identities, relative to the registered source root. */
  documentTargets?: readonly string[];
  /** Root README or documentation entry identities that require complete reading. */
  rootDocumentTargets?: readonly string[];
  /** Discovered document identities read during module classification. */
  readDocumentTargets?: readonly string[];
  /** Documents already referenced by emitted knowledge candidates. */
  referencedDocumentTargets?: readonly string[];
  symbolsDiscovered: number;
  symbolsAnalyzed: number;
  targetSymbols: number;
  exportedSymbols: number;
  /** Stable target identities, normally exported or profile-selected symbol names. */
  targetSymbolIdentities: readonly string[];
  /** Public export identities that must remain discoverable. */
  exportedTargetIdentities: readonly string[];
  entryTargets: readonly string[];
  protocolTargets: readonly string[];
  boundaryTargets?: readonly {
    kind: "entry" | "export" | "route" | "operation" | "handler" | "downstream" | "command" | "event" | "plugin" | "handoff";
    identity: string;
  }[];
  coveredBoundaryTargets?: readonly {
    kind: "entry" | "export" | "route" | "operation" | "handler" | "downstream" | "command" | "event" | "plugin" | "handoff";
    identity: string;
  }[];
  excludedFiles: number;
  /** Complete identities deliberately excluded after discovery. */
  excludedFileTargets: readonly string[];
  excludedReasons: readonly string[];
  parserSkippedFiles: number;
  /** Complete eligible identities that the parser could not analyze. */
  parserSkippedFileTargets: readonly string[];
}

export interface CodeIndexInspectionResult {
  findings: readonly CodeIndexInspectionFinding[];
  capabilityGaps?: readonly CodeIndexCapabilityGap[];
  inventories?: readonly CodeIndexInspectionInventory[];
}

export interface CodeIndexInspectionContext {
  projectRoot: string;
  sources: readonly {
    name: string;
    materializedAt: string;
    absolutePath: string;
  }[];
}

export type CodeIndexInspectionAdapter = (
  context: CodeIndexInspectionContext,
) => CodeIndexInspectionResult | Promise<CodeIndexInspectionResult>;

export const NO_ENTRY_DETECTED = "NO_ENTRY_DETECTED" as const;

export class ExtractTsConfigurationError extends TypeError {
  readonly code = NO_ENTRY_DETECTED;

  constructor(message: string) {
    super(message);
    this.name = "ExtractTsConfigurationError";
  }
}

export function normalizeExtractEntry(value: string): string {
  const slashPath = value.trim().replace(/\\/gu, "/");
  const segments = slashPath.replace(/^\.\//u, "").split("/");
  if (
    slashPath.length === 0 ||
    slashPath.startsWith("/") ||
    /^[A-Za-z]:\//u.test(slashPath) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError(`extractTs entries must be source-relative file paths: ${value}`);
  }
  return segments.join("/");
}

function requiredIndexText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function requiredIndexEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function normalizeIndexUnit(unit: CodeIndexUnitPlan, field: string): CodeIndexUnitPlan {
  const inputSources = [...new Set(unit.inputSources.map((source, index) =>
    requiredIndexText(source, `${field}.inputSources[${index}]`)
  ))];
  if (inputSources.length === 0) {
    throw new TypeError(`${field}.inputSources must contain at least one registered source name`);
  }
  const moduleType = requiredIndexEnum(unit.moduleType, `${field}.moduleType`, CODE_INDEX_MODULE_TYPES);
  const moduleTypes = [...new Set([moduleType, ...(unit.moduleTypes ?? []).map((value, index) =>
    requiredIndexEnum(value, `${field}.moduleTypes[${index}]`, CODE_INDEX_MODULE_TYPES)
  )])];
  if (moduleTypes.includes("unknown") && moduleTypes.length > 1) {
    throw new TypeError(`${field}.moduleTypes cannot combine unknown with a known module type`);
  }
  const facets = [...new Set((unit.facets ?? []).map((value, index) =>
    requiredIndexEnum(value, `${field}.facets[${index}]`, CODE_INDEX_MODULE_FACETS)
  ))];
  return {
    id: requiredIndexText(unit.id, `${field}.id`),
    inputSources,
    outputOwner: requiredIndexText(unit.outputOwner, `${field}.outputOwner`),
    moduleType,
    moduleTypes,
    facets,
    ...(unit.moduleTypeEvidence === undefined
      ? {}
      : {
          moduleTypeEvidence: unit.moduleTypeEvidence.map((item, index) =>
            requiredIndexText(item, `${field}.moduleTypeEvidence[${index}]`)
          ),
        }),
    ...(unit.documents === undefined
      ? {}
      : {
          documents: [...new Set(unit.documents.map((item, index) =>
            normalizeExtractEntry(requiredIndexText(item, `${field}.documents[${index}]`))
          ))],
        }),
    outputProfile: requiredIndexEnum(
      unit.outputProfile,
      `${field}.outputProfile`,
      CODE_INDEX_OUTPUT_PROFILES,
    ),
    responsibility: requiredIndexText(unit.responsibility, `${field}.responsibility`),
    entries: unit.entries.map((entry, index) => requiredIndexText(entry, `${field}.entries[${index}]`)),
    pageKinds: unit.pageKinds.map((kind, index) => requiredIndexText(kind, `${field}.pageKinds[${index}]`)),
    protocols: unit.protocols.map((protocol, index) => requiredIndexText(protocol, `${field}.protocols[${index}]`)),
    dependencies: unit.dependencies.map((dependency, index) => requiredIndexText(dependency, `${field}.dependencies[${index}]`)),
    exclusions: unit.exclusions.map((exclusion, index) => requiredIndexText(exclusion, `${field}.exclusions[${index}]`)),
    ...(unit.lifecycle === undefined
      ? {}
      : {
          lifecycle: requiredIndexEnum(
            unit.lifecycle,
            `${field}.lifecycle`,
            CODE_INDEX_LIFECYCLES,
          ),
        }),
    ...(unit.sourceOfTruth === undefined
      ? {}
      : { sourceOfTruth: requiredIndexText(unit.sourceOfTruth, `${field}.sourceOfTruth`) }),
    capability: requiredIndexEnum(
      unit.capability,
      `${field}.capability`,
      CODE_INDEX_CAPABILITIES,
    ),
  };
}

export function assertUniqueIndexUnits(units: readonly CodeIndexUnitPlan[], field: string): void {
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const unit of units) {
    if (ids.has(unit.id)) throw new TypeError(`${field} contains duplicate id: ${unit.id}`);
    if (owners.has(unit.outputOwner)) {
      throw new TypeError(`${field} contains duplicate outputOwner: ${unit.outputOwner}`);
    }
    ids.add(unit.id);
    owners.add(unit.outputOwner);
  }
}
