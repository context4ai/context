import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type {
  CodeIndexChainCandidate,
  CodeIndexChainCandidateDecision,
  CodeIndexIdentityGroup,
  CodeIndexInspectionInventory,
} from "@c4a/context";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";
import { customInputError } from "./customCandidateDraft.js";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".tmp",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
]);

const SOURCE_EXTENSION_FAMILIES = [
  new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]),
  new Set([".go"]),
  new Set([".py", ".pyi"]),
  new Set([".java", ".kt", ".kts", ".scala"]),
  new Set([".rs"]),
  new Set([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"]),
  new Set([".cs"]),
  new Set([".swift"]),
  new Set([".rb"]),
  new Set([".php"]),
  new Set([".dart"]),
  new Set([".vue"]),
  new Set([".svelte"]),
  new Set([".sh", ".bash", ".zsh"]),
  new Set([".sql"]),
  new Set([".proto", ".thrift", ".graphql", ".gql"]),
  new Set([".md", ".mdx"]),
] as const;

const SUPPORTED_SOURCE_EXTENSIONS = new Set(SOURCE_EXTENSION_FAMILIES.flatMap((family) => [...family]));

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/");
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3).replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`^${prefix}(?:/.*)?$`, "u");
  }
  let out = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      out += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      out += ".*";
      index += 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char?.replace(/[.+^${}()|[\]\\]/gu, "\\$&") ?? "";
  }
  return new RegExp(`${out}$`, "u");
}

function isExcluded(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern === path || globToRegExp(pattern).test(path));
}

async function sourceBaseline(input: {
  absolutePath: string;
  extensions: ReadonlySet<string>;
  exclusions: readonly string[];
}): Promise<Array<{ path: string; loc: number }>> {
  const files: Array<{ path: string; loc: number }> = [];
  const visit = async (absoluteDir: string, relativeDir = ""): Promise<void> => {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir.length === 0 ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name) || isExcluded(relativePath, input.exclusions)) continue;
        await visit(join(absoluteDir, entry.name), relativePath);
        continue;
      }
      if (!entry.isFile() || !input.extensions.has(extname(entry.name).toLowerCase())) continue;
      if (isExcluded(relativePath, input.exclusions)) continue;
      const content = await readFile(join(absoluteDir, entry.name), "utf8");
      files.push({
        path: relativePath,
        loc: content.split(/\r?\n/u).filter((line) => line.trim().length > 0).length,
      });
    }
  };
  await visit(input.absolutePath);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

interface StableBoundaryBaseline {
  kind: "route" | "operation" | "handler";
  identity: string;
  path: string;
}

function pageBoundary(path: string): StableBoundaryBaseline | undefined {
  const match = /^(?:src\/)?pages\/([^/]+)\/(?:entry|app)\.(?:[cm]?[jt]sx?|vue|svelte)$/u.exec(path);
  return match?.[1] === undefined ? undefined : { kind: "route", identity: match[1], path };
}

function goRegisterBoundaries(path: string, content: string): StableBoundaryBaseline[] {
  if (!/(?:^|\/)router(?:_[^/]*)?\.go$/u.test(path)) return [];
  return [...content.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*(?:Register|RegisterRoutes|RegisterRoute))\s*\(/gu)]
    .map((match) => match[1])
    .filter((identity): identity is string => identity !== undefined && identity !== "Register")
    .map((identity) => ({ kind: "handler" as const, identity, path }));
}

function goServiceOperationBoundaries(input: {
  path: string;
  content: string;
  sourceOfTruth?: string;
}): StableBoundaryBaseline[] {
  if (input.sourceOfTruth === undefined || input.path !== input.sourceOfTruth.replaceAll("\\", "/")) return [];
  if (!/(?:^|\/)handler\.go$/u.test(input.path)) return [];
  return [...input.content.matchAll(/\bfunc\s*\([^)]*\)\s*([A-Z][A-Za-z0-9_]*)\s*\(/gu)]
    .map((match) => match[1])
    .filter((identity): identity is string => identity !== undefined)
    .map((identity) => ({ kind: "operation" as const, identity, path: input.path }));
}

async function stableBoundaryBaseline(input: {
  absolutePath: string;
  unit: ExtractionIndexUnitPreview;
  files: readonly { path: string }[];
}): Promise<StableBoundaryBaseline[]> {
  const boundaries: StableBoundaryBaseline[] = [];
  for (const file of input.files) {
    if (input.unit.facets.includes("page-routing")) {
      const page = pageBoundary(file.path);
      if (page !== undefined) boundaries.push(page);
    }
    if (!file.path.endsWith(".go")) continue;
    const content = await readFile(join(input.absolutePath, file.path), "utf8");
    if (input.unit.facets.includes("protocol-provider")) {
      boundaries.push(...goRegisterBoundaries(file.path, content));
    }
    if (input.unit.outputProfile === "service-boundary") {
      boundaries.push(...goServiceOperationBoundaries({
        path: file.path,
        content,
        ...(input.unit.sourceOfTruth === undefined ? {} : { sourceOfTruth: input.unit.sourceOfTruth }),
      }));
    }
  }
  return [...new Map(boundaries.map((boundary) => [`${boundary.kind}:${boundary.identity}`, boundary])).values()]
    .sort((left, right) => `${left.kind}:${left.identity}`.localeCompare(`${right.kind}:${right.identity}`));
}

function boundaryIdentityCovered(required: string, reported: readonly string[]): boolean {
  const normalized = required.toLowerCase();
  return reported.some((identity) => identity.toLowerCase() === normalized);
}

export async function assertCustomInventoryCoversSourceBaseline(input: {
  unit: ExtractionIndexUnitPreview;
  inventory: CodeIndexInspectionInventory;
  phaseId: string;
  sources: readonly { name: string; absolutePath: string }[];
}): Promise<void> {
  if (input.unit.outputProfile === "cross-module-flow") return;
  const scopedSources = input.sources.filter((source) => input.unit.inputSources.includes(source.name));
  if (scopedSources.length !== 1) return;
  const baseline = await sourceBaseline({
    absolutePath: scopedSources[0]!.absolutePath,
    extensions: SUPPORTED_SOURCE_EXTENSIONS,
    exclusions: input.unit.exclusions,
  });
  if (baseline.length === 0) {
    throw customInputError(input.phaseId, "inspection source has no independently scannable source or Markdown files", {
      index_unit: input.inventory.indexUnitId,
      eligible_file_targets: input.inventory.eligibleFileTargets,
      next: "Confirm the module scope or declare supported source and Markdown/MDX files. Configuration files may remain evidence but cannot be the only AST inventory denominator.",
    });
  }
  const reported = new Set(input.inventory.eligibleFileTargets.map((target) =>
    target.replaceAll("\\", "/").replace(/^\.\//u, "")
  ));
  const missing = baseline.map((file) => file.path).filter((path) => !reported.has(path));
  const baselineLoc = baseline.reduce((total, file) => total + file.loc, 0);
  const stableBoundaries = await stableBoundaryBaseline({
    absolutePath: scopedSources[0]!.absolutePath,
    unit: input.unit,
    files: baseline,
  });
  const reportedTargets = input.inventory.targetSymbolIdentities.map((identity) => identity.replaceAll("\\", "/"));
  const reportedBoundaries = (input.inventory.boundaryTargets ?? []).map((target) => target.identity.replaceAll("\\", "/"));
  const missingStableTargets = stableBoundaries.filter((boundary) =>
    !boundaryIdentityCovered(boundary.identity, reportedTargets)
  );
  const missingStableBoundaries = stableBoundaries.filter((boundary) =>
    !boundaryIdentityCovered(boundary.identity, reportedBoundaries)
  );
  if (missing.length > 0 || input.inventory.eligibleLoc < baselineLoc) {
    throw customInputError(input.phaseId, "inspection inventory under-reports the independently scanned source baseline", {
      index_unit: input.inventory.indexUnitId,
      missing_eligible_files: missing,
      reported_eligible_files: input.inventory.eligibleFiles,
      baseline_eligible_files: baseline.length,
      reported_eligible_loc: input.inventory.eligibleLoc,
      baseline_eligible_loc: baselineLoc,
      exclusions: input.unit.exclusions,
      next: "Enumerate every eligible file in the represented language families after declared exclusions. Do not use a hand-picked evidence subset as the file or LOC denominator.",
    });
  }
  if (missingStableTargets.length > 0 || missingStableBoundaries.length > 0) {
    throw customInputError(input.phaseId, "inspection inventory under-reports independently discovered stable boundaries", {
      index_unit: input.inventory.indexUnitId,
      missing_target_symbols: missingStableTargets,
      missing_boundary_targets: missingStableBoundaries,
      next: "Add every independently discovered page entry, route registration, and service operation to the target-symbol and boundary denominators. Knowledge may aggregate them, but it must not silently omit adjacent stable boundaries.",
    });
  }
}

function completeIdentities(value: unknown, field: string, phaseId: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw customInputError(phaseId, `${field} must be a complete array of non-empty identities`, { field });
  }
  const normalized = value.map((item) => (item as string).replaceAll("\\", "/").replace(/^\.\//u, ""));
  if (new Set(normalized).size !== normalized.length) {
    throw customInputError(phaseId, `${field} must not contain duplicate identities`, { field });
  }
  return normalized.sort();
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateIdentityGroups(input: {
  groups: readonly CodeIndexIdentityGroup[];
  eligibleFiles: readonly string[];
  targetSymbols: readonly string[];
  phaseId: string;
}): CodeIndexIdentityGroup[] {
  const ids = new Set<string>();
  const groupedMembers = new Set<string>();
  return input.groups.map((group) => {
    const members = completeIdentities(group.members, "identityGroups[].members", input.phaseId);
    const sourceFiles = completeIdentities(group.sourceFiles, "identityGroups[].sourceFiles", input.phaseId);
    if (!nonEmpty(group.id) || !nonEmpty(group.viewRef) || members.length === 0 || sourceFiles.length === 0) {
      throw customInputError(input.phaseId, "identity groups require id, viewRef, members, and sourceFiles", {
        identity_group: group.id,
      });
    }
    if (ids.has(group.id) || members.some((member) => groupedMembers.has(member))) {
      throw customInputError(input.phaseId, "identity group ids and members must be unique within an index unit", {
        identity_group: group.id,
      });
    }
    if (
      members.some((member) => !input.targetSymbols.includes(member)) ||
      sourceFiles.some((sourceFile) => !input.eligibleFiles.includes(sourceFile))
    ) {
      throw customInputError(input.phaseId, "identity group members and sourceFiles must belong to the inspected inventory", {
        identity_group: group.id,
      });
    }
    ids.add(group.id);
    members.forEach((member) => groupedMembers.add(member));
    return { id: group.id, viewRef: group.viewRef, members, sourceFiles };
  });
}

function validateChainCandidates(input: {
  candidates: readonly CodeIndexChainCandidate[];
  decisions: readonly CodeIndexChainCandidateDecision[];
  eligibleFiles: readonly string[];
  boundaryTargets: readonly NonNullable<CodeIndexInspectionInventory["boundaryTargets"]>[number][];
  phaseId: string;
}): { candidates: CodeIndexChainCandidate[]; decisions: CodeIndexChainCandidateDecision[] } {
  const validFamilies = new Set<CodeIndexChainCandidate["family"]>([
    "entry-operation", "operation-handler", "handler-downstream", "event-processing",
    "command-effect", "export-implementation", "cross-source-handoff",
  ]);
  const validConfidence = new Set<CodeIndexChainCandidate["confidence"]>(["structural", "declared", "ambiguous"]);
  const validDecisions = new Set<CodeIndexChainCandidateDecision["decision"]>([
    "document", "merge", "exclude", "request-input",
  ]);
  const boundaryKinds = new Map(input.boundaryTargets.map((target) => [target.identity, target.kind]));
  const familyMatchesEndpoints = (candidate: CodeIndexChainCandidate): boolean => {
    const from = boundaryKinds.get(candidate.from);
    const to = boundaryKinds.get(candidate.to);
    if (from === undefined || to === undefined) return false;
    if (candidate.family === "entry-operation") return from === "entry" && ["operation", "route", "handler"].includes(to);
    if (candidate.family === "operation-handler") return from === "operation" && to === "handler";
    if (candidate.family === "handler-downstream") return from === "handler" && to === "downstream";
    if (candidate.family === "event-processing") return from === "event" && ["handler", "operation", "downstream"].includes(to);
    if (candidate.family === "command-effect") return from === "command" && ["operation", "downstream"].includes(to);
    if (candidate.family === "export-implementation") return from === "export" && ["operation", "handler"].includes(to);
    return from === "handoff" || to === "handoff";
  };
  const candidateIds = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    const sourceFiles = completeIdentities(candidate.sourceFiles, "chainCandidates[].sourceFiles", input.phaseId);
    if (
      !nonEmpty(candidate.id) || !nonEmpty(candidate.from) || !nonEmpty(candidate.to) ||
      sourceFiles.length === 0 || sourceFiles.some((sourceFile) => !input.eligibleFiles.includes(sourceFile))
    ) {
      throw customInputError(input.phaseId, "chain candidates require stable endpoints and inspected sourceFiles", {
        chain_candidate: candidate.id,
      });
    }
    if (!validFamilies.has(candidate.family) || !validConfidence.has(candidate.confidence) || !familyMatchesEndpoints(candidate)) {
      throw customInputError(input.phaseId, "chain candidate family and endpoints must match the inspected boundary inventory", {
        chain_candidate: candidate.id,
        family: candidate.family,
        from: candidate.from,
        to: candidate.to,
      });
    }
    if (candidateIds.has(candidate.id)) {
      throw customInputError(input.phaseId, "chain candidate ids must be unique within an index unit", {
        chain_candidate: candidate.id,
      });
    }
    candidateIds.add(candidate.id);
    return { ...candidate, sourceFiles };
  });
  const decided = new Set<string>();
  const decisions = input.decisions.map((decision) => {
    if (!validDecisions.has(decision.decision)) {
      throw customInputError(input.phaseId, "chain candidate decision is invalid", {
        chain_candidate: decision.candidateId,
        decision: decision.decision,
      });
    }
    if (!candidateIds.has(decision.candidateId) || decided.has(decision.candidateId)) {
      throw customInputError(input.phaseId, "chain candidate decisions must reference one unique discovered candidate", {
        chain_candidate: decision.candidateId,
      });
    }
    if (decision.decision === "document" && !nonEmpty(decision.viewRef)) {
      throw customInputError(input.phaseId, "document chain decisions require a reader-facing viewRef", {
        chain_candidate: decision.candidateId,
      });
    }
    if (
      decision.decision === "merge" &&
      (!nonEmpty(decision.canonicalChainId) || !candidateIds.has(decision.canonicalChainId))
    ) {
      throw customInputError(input.phaseId, "merge chain decisions require canonicalChainId", {
        chain_candidate: decision.candidateId,
      });
    }
    if ((decision.decision === "exclude" || decision.decision === "request-input") && !nonEmpty(decision.reason)) {
      throw customInputError(input.phaseId, `${decision.decision} chain decisions require a reason`, {
        chain_candidate: decision.candidateId,
      });
    }
    decided.add(decision.candidateId);
    return { ...decision };
  });
  return { candidates, decisions };
}

export function applyCustomInspectionInventory(input: {
  unit: ExtractionIndexUnitPreview;
  inventory: CodeIndexInspectionInventory;
  phaseId: string;
}): void {
  const { inventory, phaseId, unit } = input;
  const eligibleFileTargets = completeIdentities(inventory.eligibleFileTargets, "eligibleFileTargets", phaseId);
  const analyzedFileTargets = completeIdentities(inventory.analyzedFileTargets, "analyzedFileTargets", phaseId);
  const excludedFileTargets = completeIdentities(inventory.excludedFileTargets, "excludedFileTargets", phaseId);
  const parserSkippedFileTargets = completeIdentities(
    inventory.parserSkippedFileTargets,
    "parserSkippedFileTargets",
    phaseId,
  );
  const targetSymbolIdentities = completeIdentities(
    inventory.targetSymbolIdentities,
    "targetSymbolIdentities",
    phaseId,
  );
  const exportedTargetIdentities = completeIdentities(
    inventory.exportedTargetIdentities,
    "exportedTargetIdentities",
    phaseId,
  );
  const counts = [
    inventory.eligibleFiles,
    inventory.analyzedFiles,
    inventory.eligibleLoc,
    inventory.analyzedLoc,
    inventory.documentsDiscovered,
    inventory.documentsRead,
    inventory.symbolsDiscovered,
    inventory.symbolsAnalyzed,
    inventory.targetSymbols,
    inventory.exportedSymbols,
    inventory.excludedFiles,
    inventory.parserSkippedFiles,
  ];
  if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
    throw customInputError(phaseId, "inspection inventory counts must be non-negative integers", {
      index_unit: inventory.indexUnitId,
    });
  }
  if (
    inventory.analyzedFiles > inventory.eligibleFiles ||
    inventory.analyzedLoc > inventory.eligibleLoc ||
    inventory.documentsRead > inventory.documentsDiscovered ||
    inventory.symbolsAnalyzed > inventory.symbolsDiscovered ||
    inventory.targetSymbols > inventory.symbolsDiscovered ||
    inventory.exportedSymbols > inventory.symbolsDiscovered
  ) {
    throw customInputError(phaseId, "inspection inventory numerators cannot exceed their denominators", {
      index_unit: inventory.indexUnitId,
    });
  }
  if (
    eligibleFileTargets.length !== inventory.eligibleFiles ||
    analyzedFileTargets.length !== inventory.analyzedFiles ||
    excludedFileTargets.length !== inventory.excludedFiles ||
    parserSkippedFileTargets.length !== inventory.parserSkippedFiles ||
    targetSymbolIdentities.length !== inventory.targetSymbols ||
    exportedTargetIdentities.length !== inventory.exportedSymbols ||
    analyzedFileTargets.some((identity) => !eligibleFileTargets.includes(identity)) ||
    parserSkippedFileTargets.some((identity) => !eligibleFileTargets.includes(identity)) ||
    exportedTargetIdentities.some((identity) => !targetSymbolIdentities.includes(identity))
  ) {
    throw customInputError(phaseId, "inspection file and symbol identity lists must be complete and match their counts", {
      index_unit: inventory.indexUnitId,
    });
  }
  const documentTargets = [...new Set(inventory.documentTargets ?? [])];
  const rootDocumentTargets = [...new Set(inventory.rootDocumentTargets ?? [])];
  const readDocumentTargets = [...new Set(inventory.readDocumentTargets ?? [])];
  const referencedDocumentTargets = [...new Set(inventory.referencedDocumentTargets ?? [])];
  if (
    (inventory.documentTargets !== undefined && documentTargets.length !== inventory.documentsDiscovered) ||
    (inventory.readDocumentTargets !== undefined && readDocumentTargets.length !== inventory.documentsRead) ||
    rootDocumentTargets.some((identity) => !documentTargets.includes(identity)) ||
    readDocumentTargets.some((identity) => !documentTargets.includes(identity)) ||
    referencedDocumentTargets.some((identity) => !documentTargets.includes(identity))
  ) {
    throw customInputError(phaseId, "inspection document identities must match their counts and discovered targets", {
      index_unit: inventory.indexUnitId,
    });
  }
  const identityGroups = validateIdentityGroups({
    groups: inventory.identityGroups ?? [],
    eligibleFiles: eligibleFileTargets,
    targetSymbols: targetSymbolIdentities,
    phaseId,
  });
  const boundaryTargets = [...(inventory.boundaryTargets ?? [
    ...inventory.entryTargets.map((identity) => ({ kind: "entry" as const, identity })),
    ...inventory.protocolTargets.map((identity) => ({ kind: "operation" as const, identity })),
  ])];
  const chain = validateChainCandidates({
    candidates: inventory.chainCandidates ?? [],
    decisions: inventory.chainCandidateDecisions ?? [],
    eligibleFiles: eligibleFileTargets,
    boundaryTargets,
    phaseId,
  });
  unit.inventory = {
    basis: "ast",
    eligibleFiles: inventory.eligibleFiles,
    analyzedFiles: inventory.analyzedFiles,
    eligibleFileTargets,
    analyzedFileTargets,
    eligibleLoc: inventory.eligibleLoc,
    analyzedLoc: inventory.analyzedLoc,
    documentsDiscovered: inventory.documentsDiscovered,
    documentsRead: inventory.documentsRead,
    documentTargets,
    rootDocumentTargets,
    readDocumentTargets,
    referencedDocumentTargets,
    symbolsDiscovered: inventory.symbolsDiscovered,
    symbolsAnalyzed: inventory.symbolsAnalyzed,
    targetSymbols: inventory.targetSymbols,
    exportedSymbols: inventory.exportedSymbols,
    targetSymbolIdentities,
    exportedTargetIdentities,
    entryTargets: [...inventory.entryTargets],
    protocolTargets: [...inventory.protocolTargets],
    boundaryTargets,
    coveredBoundaryTargets: [...(inventory.coveredBoundaryTargets ?? [])],
    identityGroups,
    chainCandidates: chain.candidates,
    chainCandidateDecisions: chain.decisions,
    excludedFiles: inventory.excludedFiles,
    excludedFileTargets,
    excludedReasons: [...inventory.excludedReasons],
    parserSkippedFiles: inventory.parserSkippedFiles,
    parserSkippedFileTargets,
  };
}
