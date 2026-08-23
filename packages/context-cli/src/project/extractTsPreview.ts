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
  return {
    id: input.sourceName,
    inputSources: [input.sourceName],
    outputOwner: input.sourceName,
    moduleType: input.phase.mode === "exports" ? "sdk-library" : "unknown",
    moduleTypes: [input.phase.mode === "exports" ? "sdk-library" : "unknown"],
    facets: input.phase.mode === "exports" ? ["public-api"] : [],
    moduleTypeEvidence: [],
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
  if (unit.plan === "inferred" && !unit.risks.includes("index-plan-inferred")) {
    unit.risks.push("index-plan-inferred");
  }
  applyIndexUnitAdvisoryRisks(unit, { customAggregate: false });
  if (unit.scale === "warning") unit.risks.push("page-count-warning");
  if (unit.scale === "blocked") unit.risks.push("page-count-limit-exceeded");
  unit.risks = [...new Set(unit.risks)].sort();
  return unit;
}
