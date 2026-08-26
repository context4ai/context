import { requiredCodeIndexCoverage } from "@c4a/context";
import type { BuiltCustomCandidate } from "./customCandidateDraft.js";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";
import type { probesForIndexUnit } from "./structuralCapabilityProbes.js";

export function applyCustomUnitCoverage(input: {
  unit: ExtractionIndexUnitPreview;
  candidates: readonly BuiltCustomCandidate[];
  requiredProbes: ReturnType<typeof probesForIndexUnit>;
}): void {
  const unitEvidence = input.candidates.flatMap((item) => item.symbols);
  const uncovered = input.requiredProbes.filter((probe) => !unitEvidence.some((evidence) =>
    evidence.source === probe.source && probe.paths.includes(evidence.file)
  ));
  input.unit.structuralCoverage = {
    required: input.requiredProbes.length,
    covered: input.requiredProbes.length - uncovered.length,
    uncovered: uncovered.map((probe) => ({
      id: probe.id,
      capability: probe.capability,
      kind: probe.kind,
      source: probe.source,
      expectedPaths: [...probe.paths],
    })),
  };
  if (uncovered.length > 0) {
    input.unit.capability = "material-required";
    input.unit.risks.push("structural-capability-uncovered");
  }

  const requiredCoverage = requiredCodeIndexCoverage({
    outputProfile: input.unit.outputProfile,
    facets: input.unit.facets,
  });
  const coveredCoverage = [...new Set(input.candidates.flatMap((item) => item.coverageKinds))].sort();
  const uncoveredCoverage = requiredCoverage.filter((kind) => !coveredCoverage.includes(kind));
  input.unit.semanticCoverage = {
    required: requiredCoverage,
    covered: coveredCoverage,
    uncovered: uncoveredCoverage,
  };
  if (uncoveredCoverage.length > 0) {
    input.unit.capability = "material-required";
    input.unit.risks.push("semantic-coverage-uncovered");
  }
  if (
    input.unit.outputProfile === "cross-module-flow" &&
    input.candidates.every((item) => (item.candidate.code_edges?.length ?? 0) === 0
  )) {
    input.unit.capability = "material-required";
    input.unit.risks.push("structured-relationship-missing");
  }
}
