import { dirname } from "node:path";
import type { ExtractTsPhaseDefinition } from "@c4a/context";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";
import { applyIndexUnitAdvisoryRisks } from "./extractionIndexUnitRisks.js";

const EXTRACTION_WARNING_PAGE_COUNT = 100;
export const EXTRACTION_BLOCK_PAGE_COUNT = 300;

function extractionScale(projectedPageCount: number): ExtractionIndexUnitPreview["scale"] {
  if (projectedPageCount > EXTRACTION_BLOCK_PAGE_COUNT) return "blocked";
  if (projectedPageCount > EXTRACTION_WARNING_PAGE_COUNT) return "warning";
  return "normal";
}

export function inferredIndexUnit(input: {
  phase: ExtractTsPhaseDefinition;
  sourceName: string;
}): ExtractionIndexUnitPreview {
  const outputOwner = input.sourceName.split("/").at(-1) ?? input.sourceName;
  return {
    id: input.sourceName,
    inputSources: [input.sourceName],
    outputOwner,
    moduleType: input.phase.mode === "exports" ? "sdk-library" : "unknown",
    moduleTypes: [input.phase.mode === "exports" ? "sdk-library" : "unknown"],
    facets: input.phase.mode === "exports" ? ["public-api"] : [],
    moduleTypeEvidence: [],
    documents: [],
    outputProfile: input.phase.mode === "exports" ? "public-api-reference" : "module-map",
    capability: "complete",
    plan: "inferred",
    responsibility: input.phase.mode === "exports"
      ? "Index the stable exported contracts of this module."
      : "Index the configured structural scope of this module.",
    entries: [...(input.phase.entries ?? [])],
    protocols: [],
    exclusions: [],
    lifecycle: "authoritative",
    currentPageCount: 0,
    projectedPageCount: 0,
    candidateEstimate: 0,
    changes: { added: 0, updated: 0, removed: 0, unchanged: 0, exact: false },
    scale: "normal",
    visibility: { exported: 0, internal: 0 },
    candidateKinds: {},
    topDirectories: [],
    contentBytes: { total: 0, max: 0, sampled: false, topPages: [] },
    inventory: {
      basis: "ast",
      eligibleFiles: 0,
      analyzedFiles: 0,
      eligibleFileTargets: [],
      analyzedFileTargets: [],
      eligibleLoc: 0,
      analyzedLoc: 0,
      documentsDiscovered: 0,
      documentsRead: 0,
      documentTargets: [],
      rootDocumentTargets: [],
      readDocumentTargets: [],
      referencedDocumentTargets: [],
      symbolsDiscovered: 0,
      symbolsAnalyzed: 0,
      targetSymbols: 0,
      exportedSymbols: 0,
      targetSymbolIdentities: [],
      exportedTargetIdentities: [],
      entryTargets: [...(input.phase.entries ?? [])],
      protocolTargets: [],
      boundaryTargets: (input.phase.entries ?? []).map((identity) => ({ kind: "entry" as const, identity })),
      coveredBoundaryTargets: (input.phase.entries ?? []).map((identity) => ({ kind: "entry" as const, identity })),
      identityGroups: [],
      chainCandidates: [],
      chainCandidateDecisions: [],
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    },
    risks: (input.phase.indexUnits ?? []).length === 0 ? ["index-plan-inferred"] : [],
  };
}

export function declaredIndexUnitPreview(
  unit: ExtractTsPhaseDefinition["indexUnits"][number],
  plan: ExtractTsPhaseDefinition["indexPlan"],
): ExtractionIndexUnitPreview {
  return {
    id: unit.id,
    inputSources: [...unit.inputSources],
    outputOwner: unit.outputOwner,
    moduleType: unit.moduleType,
    moduleTypes: [...(unit.moduleTypes ?? [unit.moduleType])],
    facets: [...(unit.facets ?? [])],
    moduleTypeEvidence: [...(unit.moduleTypeEvidence ?? [])],
    documents: [...(unit.documents ?? [])],
    outputProfile: unit.outputProfile,
    capability: unit.capability,
    plan,
    responsibility: unit.responsibility,
    entries: [...unit.entries],
    protocols: [...unit.protocols],
    exclusions: [...unit.exclusions],
    lifecycle: unit.lifecycle ?? "authoritative",
    ...(unit.sourceOfTruth === undefined ? {} : { sourceOfTruth: unit.sourceOfTruth }),
    currentPageCount: 0,
    projectedPageCount: 0,
    candidateEstimate: 0,
    changes: { added: 0, updated: 0, removed: 0, unchanged: 0, exact: false },
    scale: "normal",
    visibility: { exported: 0, internal: 0 },
    candidateKinds: {},
    topDirectories: [],
    contentBytes: { total: 0, max: 0, sampled: false, topPages: [] },
    inventory: {
      basis: "ast",
      eligibleFiles: 0,
      analyzedFiles: 0,
      eligibleFileTargets: [],
      analyzedFileTargets: [],
      eligibleLoc: 0,
      analyzedLoc: 0,
      documentsDiscovered: 0,
      documentsRead: 0,
      documentTargets: [],
      rootDocumentTargets: [],
      readDocumentTargets: [],
      referencedDocumentTargets: [],
      symbolsDiscovered: 0,
      symbolsAnalyzed: 0,
      targetSymbols: 0,
      exportedSymbols: 0,
      targetSymbolIdentities: [],
      exportedTargetIdentities: [],
      entryTargets: [...unit.entries],
      protocolTargets: [...unit.protocols],
      boundaryTargets: [
        ...unit.entries.map((identity) => ({ kind: "entry" as const, identity })),
        ...unit.protocols.map((identity) => ({ kind: "operation" as const, identity })),
      ],
      coveredBoundaryTargets: unit.entries.map((identity) => ({ kind: "entry" as const, identity })),
      identityGroups: [],
      chainCandidates: [],
      chainCandidateDecisions: [],
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    },
    risks: [],
  };
}

export function incrementPreviewDirectory(unit: ExtractionIndexUnitPreview, file: string): void {
  const path = dirname(file.replaceAll("\\", "/"));
  const normalized = path === "." ? "." : path;
  const existing = unit.topDirectories.find((item) => item.path === normalized);
  if (existing === undefined) unit.topDirectories.push({ path: normalized, count: 1 });
  else existing.count += 1;
}

export function recordPreviewPage(
  unit: ExtractionIndexUnitPreview,
  path: string,
  bytes: number,
): void {
  unit.contentBytes.topPages.push({ path, bytes });
  unit.contentBytes.topPages.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  unit.contentBytes.topPages.splice(5);
}

export function finalizeIndexUnit(unit: ExtractionIndexUnitPreview): ExtractionIndexUnitPreview {
  unit.scale = extractionScale(unit.projectedPageCount);
  unit.candidateEstimate = unit.projectedPageCount;
  unit.topDirectories.sort((left, right) => right.count - left.count || left.path.localeCompare(right.path));
  unit.topDirectories.splice(5);
  unit.inventory.targetSymbolIdentities = [...new Set(unit.inventory.targetSymbolIdentities)].sort();
  unit.inventory.exportedTargetIdentities = [...new Set(unit.inventory.exportedTargetIdentities)].sort();
  unit.inventory.eligibleFileTargets = [...new Set(unit.inventory.eligibleFileTargets)].sort();
  unit.inventory.analyzedFileTargets = [...new Set(unit.inventory.analyzedFileTargets)].sort();
  unit.inventory.excludedFileTargets = [...new Set(unit.inventory.excludedFileTargets)].sort();
  unit.inventory.parserSkippedFileTargets = [...new Set(unit.inventory.parserSkippedFileTargets)].sort();
  unit.inventory.eligibleFiles = unit.inventory.eligibleFileTargets.length;
  unit.inventory.analyzedFiles = unit.inventory.analyzedFileTargets.length;
  unit.inventory.excludedFiles = unit.inventory.excludedFileTargets.length;
  unit.inventory.parserSkippedFiles = unit.inventory.parserSkippedFileTargets.length;
  unit.inventory.documentTargets = [...new Set(unit.inventory.documentTargets)].sort();
  unit.inventory.rootDocumentTargets = [...new Set(unit.inventory.rootDocumentTargets)].sort();
  unit.inventory.readDocumentTargets = [...new Set(unit.inventory.readDocumentTargets)].sort();
  unit.inventory.referencedDocumentTargets = [...new Set(unit.inventory.referencedDocumentTargets)].sort();
  unit.inventory.documentsDiscovered = unit.inventory.documentTargets.length;
  unit.inventory.documentsRead = unit.inventory.readDocumentTargets.length;
  unit.inventory.entryTargets = [...new Set(unit.inventory.entryTargets)].sort();
  unit.inventory.protocolTargets = [...new Set(unit.inventory.protocolTargets)].sort();
  unit.inventory.boundaryTargets = [...new Map(unit.inventory.boundaryTargets.map((target) => [
    `${target.kind}:${target.identity}`,
    target,
  ])).values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.identity.localeCompare(right.identity));
  unit.inventory.coveredBoundaryTargets = [...new Map(unit.inventory.coveredBoundaryTargets.map((target) => [
    `${target.kind}:${target.identity}`,
    target,
  ])).values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.identity.localeCompare(right.identity));
  if (unit.plan === "inferred" && !unit.risks.includes("index-plan-inferred")) {
    unit.risks.push("index-plan-inferred");
  }
  applyIndexUnitAdvisoryRisks(unit, { customAggregate: false });
  if (unit.scale === "warning") unit.risks.push("page-count-warning");
  if (unit.scale === "blocked") unit.risks.push("page-count-limit-exceeded");
  unit.risks = [...new Set(unit.risks)].sort();
  return unit;
}
