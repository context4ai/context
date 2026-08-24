import type { CodeIndexOutputProfile } from "@c4a/context";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";

const OVERSIZED_PAGE_ADVISORY_BYTES = 256 * 1024;
const THIN_AGGREGATE_AVERAGE_BYTES = 256;

const ENTRY_OPTIONAL_PROFILES = new Set<CodeIndexOutputProfile>([
  "protocol-index",
  "module-registry",
  "cross-module-flow",
  "provenance-only",
]);

const PROTOCOL_REQUIRED_PROFILES = new Set<CodeIndexOutputProfile>([
  "protocol-index",
  "adapter-contract",
]);

const AGGREGATE_PROFILES = new Set<CodeIndexOutputProfile>([
  "protocol-index",
  "service-boundary",
  "runtime-map",
  "module-map",
  "application-map",
  "adapter-contract",
  "command-map",
  "module-registry",
  "cross-module-flow",
]);

function addRisk(unit: ExtractionIndexUnitPreview, risk: string): void {
  if (!unit.risks.includes(risk)) unit.risks.push(risk);
}

export function applyIndexUnitAdvisoryRisks(
  unit: ExtractionIndexUnitPreview,
  options: { customAggregate: boolean },
): void {
  if (unit.capability === "material-required") addRisk(unit, "capability-material-required");
  if (unit.moduleTypes.includes("unknown") || unit.moduleTypeEvidence.length === 0) {
    addRisk(unit, "module-classification-required");
  }
  if (unit.contentBytes.max > OVERSIZED_PAGE_ADVISORY_BYTES) addRisk(unit, "oversized-page-risk");
  if (
    unit.entries.length === 0 &&
    unit.protocols.length === 0 &&
    !ENTRY_OPTIONAL_PROFILES.has(unit.outputProfile)
  ) addRisk(unit, "stable-entry-missing");
  if (PROTOCOL_REQUIRED_PROFILES.has(unit.outputProfile) && unit.protocols.length === 0) {
    addRisk(unit, "protocol-evidence-missing");
  }
  if (
    unit.lifecycle !== "authoritative" &&
    unit.outputProfile !== "provenance-only" &&
    unit.sourceOfTruth === undefined
  ) addRisk(unit, "derived-source-risk");

  const structuralKinds = ["interface", "const", "struct", "enum", "type", "var", "variable"]
    .reduce((sum, kind) => sum + (unit.candidateKinds[kind] ?? 0), 0);
  const deliberatePublicReference =
    unit.outputProfile === "public-api-reference" &&
    unit.facets.includes("public-api") &&
    unit.visibility.internal === 0;
  if (
    unit.projectedPageCount > 0 &&
    structuralKinds / unit.projectedPageCount >= 0.7 &&
    !deliberatePublicReference
  ) addRisk(unit, "symbol-catalog-risk");

  if (
    options.customAggregate &&
    unit.projectedPageCount > 0 &&
    AGGREGATE_PROFILES.has(unit.outputProfile) &&
    unit.contentBytes.total / unit.projectedPageCount < THIN_AGGREGATE_AVERAGE_BYTES
  ) addRisk(unit, "thin-aggregate-risk");
}
