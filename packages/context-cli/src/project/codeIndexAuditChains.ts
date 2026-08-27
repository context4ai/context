import type { CodeIndexChainCandidateFamily } from "@c4a/context";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";
import type {
  CodeIndexAuditDimension,
  CodeIndexAuditDimensionStatus,
  CodeIndexAuditPageMetrics,
} from "./codeIndexAuditTypes.js";

interface Threshold {
  floor: number | null;
  target: number | null;
  ceiling: number | null;
}

function normalizeIdentity(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").trim().toLowerCase();
}

function coveredIdentities(targets: readonly string[], references: readonly string[]): string[] {
  const normalizedReferences = references.map(normalizeIdentity);
  return targets.filter((target) => {
    const normalizedTarget = normalizeIdentity(target);
    return normalizedReferences.some((reference) =>
      reference === normalizedTarget || reference.endsWith(`/${normalizedTarget}`) ||
      normalizedTarget.endsWith(`/${reference}`)
    );
  });
}

function coverageThreshold(floor: number, target: number): Threshold {
  return { floor, target, ceiling: 100 };
}

function dimensionStatus(observed: number, threshold: Threshold): CodeIndexAuditDimensionStatus {
  if (threshold.floor !== null && observed < threshold.floor) return "below-floor";
  if (threshold.ceiling !== null && observed > threshold.ceiling) return "above-ceiling";
  if (threshold.target !== null && observed < threshold.target) return "below-target";
  if (threshold.target !== null && observed > threshold.target) return "above-target";
  return "target";
}

function score(observed: number, threshold: Threshold, status: CodeIndexAuditDimensionStatus): number {
  if (threshold.target === null) return status === "target" ? 100 : 0;
  if (status === "target" || status === "above-target") return 100;
  if (status === "below-floor") {
    if (threshold.floor === null || threshold.floor === 0) return 0;
    return Math.max(0, Math.round(observed / threshold.floor * 59));
  }
  if (status === "below-target" && threshold.floor !== null) {
    return Math.round(60 + (observed - threshold.floor) /
      Math.max(0.0001, threshold.target - threshold.floor) * 40);
  }
  if (status === "above-ceiling" && threshold.ceiling !== null) {
    return Math.max(0, Math.round(59 * threshold.ceiling / Math.max(observed, threshold.ceiling)));
  }
  return 100;
}

function evaluated(input: {
  dimension: string;
  observed: number;
  threshold: Threshold;
  evidence: CodeIndexAuditDimension["evidence"];
  actions: string[];
}): CodeIndexAuditDimension {
  const status = dimensionStatus(input.observed, input.threshold);
  return {
    dimension: input.dimension,
    observed: Number(input.observed.toFixed(3)),
    unit: "percent",
    ...input.threshold,
    score: score(input.observed, input.threshold, status),
    status,
    absolute_gate: status === "below-floor" || status === "above-ceiling",
    evidence: input.evidence,
    recommended_actions: input.actions,
  };
}

function coverageDimension(input: {
  dimension: string;
  targets: readonly string[];
  references: readonly string[];
  actions: string[];
}): CodeIndexAuditDimension {
  const covered = coveredIdentities(input.targets, input.references);
  const uncovered = input.targets.filter((identity) => !covered.includes(identity));
  return evaluated({
    dimension: input.dimension,
    observed: input.targets.length === 0 ? 100 : covered.length / input.targets.length * 100,
    threshold: coverageThreshold(100, 100),
    evidence: {
      eligible: input.targets.length,
      covered: covered.length,
      uncovered: uncovered.length,
      uncovered_identities: uncovered,
    },
    actions: input.actions,
  });
}

function expectedFamilies(unit: ExtractionIndexUnitPreview): CodeIndexChainCandidateFamily[] {
  const kinds = new Set(unit.inventory.boundaryTargets.map((target) => target.kind));
  return [
    kinds.has("entry") && (kinds.has("operation") || kinds.has("route") || kinds.has("handler"))
      ? "entry-operation"
      : undefined,
    kinds.has("operation") && kinds.has("handler") ? "operation-handler" : undefined,
    kinds.has("handler") && kinds.has("downstream") ? "handler-downstream" : undefined,
    kinds.has("event") && (kinds.has("handler") || kinds.has("operation") || kinds.has("downstream"))
      ? "event-processing"
      : undefined,
    kinds.has("command") && (kinds.has("operation") || kinds.has("downstream"))
      ? "command-effect"
      : undefined,
    kinds.has("export") && (kinds.has("operation") || kinds.has("handler"))
      ? "export-implementation"
      : undefined,
    kinds.has("handoff") ? "cross-source-handoff" : undefined,
  ].filter((family): family is CodeIndexChainCandidateFamily => family !== undefined);
}

export function auditChainDimensions(input: {
  unit: ExtractionIndexUnitPreview;
  pages: readonly CodeIndexAuditPageMetrics[];
}): CodeIndexAuditDimension[] {
  const inventory = input.unit.inventory;
  const dimensions: CodeIndexAuditDimension[] = [];
  const pageByViewRef = new Map(input.pages.map((page) => [page.view_ref, page]));
  const families = expectedFamilies(input.unit);
  if (families.length > 0) {
    dimensions.push(coverageDimension({
      dimension: "chain-candidate-family-discovery",
      targets: families,
      references: inventory.chainCandidates.map((candidate) => candidate.family),
      actions: ["discover-chain-candidates"],
    }));
  }
  if (inventory.chainCandidates.length === 0) return dimensions;

  const decisions = new Map(inventory.chainCandidateDecisions.map((decision) => [decision.candidateId, decision]));
  const resolvedDocumentCandidates = new Set(inventory.chainCandidates.flatMap((candidate) => {
    const decision = decisions.get(candidate.id);
    if (decision?.decision !== "document" || decision.viewRef === undefined) return [];
    const page = pageByViewRef.get(decision.viewRef);
    if (page === undefined || page.relation_count === 0) return [];
    return candidate.sourceFiles.every((sourceFile) =>
      coveredIdentities([sourceFile], page.referenced_files).length === 1
    ) ? [candidate.id] : [];
  }));
  const resolvedMergeCandidates = new Set(inventory.chainCandidates.flatMap((candidate) => {
    const decision = decisions.get(candidate.id);
    return decision?.decision === "merge" && decision.canonicalChainId !== undefined &&
        resolvedDocumentCandidates.has(decision.canonicalChainId)
      ? [candidate.id]
      : [];
  }));
  const decidedCandidates = inventory.chainCandidates.filter((candidate) => {
    const decision = decisions.get(candidate.id);
    return decision?.decision === "exclude" || decision?.decision === "request-input" ||
      resolvedDocumentCandidates.has(candidate.id) || resolvedMergeCandidates.has(candidate.id);
  });
  const undecided = inventory.chainCandidates.filter((candidate) => !decidedCandidates.includes(candidate));
  dimensions.push(evaluated({
    dimension: "chain-candidate-decision-coverage",
    observed: decidedCandidates.length / inventory.chainCandidates.length * 100,
    threshold: coverageThreshold(100, 100),
    evidence: {
      candidates: inventory.chainCandidates.length,
      decided: decidedCandidates.length,
      undecided_candidate_ids: undecided.map((candidate) => candidate.id),
    },
    actions: ["decide-chain-candidates"],
  }));

  const externalFamilies = new Set<CodeIndexChainCandidateFamily>([
    "handler-downstream",
    "event-processing",
    "command-effect",
    "cross-source-handoff",
  ]);
  const requiredFamilies = [...new Set(inventory.chainCandidates
    .map((candidate) => candidate.family)
    .filter((family) => externalFamilies.has(family)))];
  if (requiredFamilies.length === 0) return dimensions;
  const closedFamilies = requiredFamilies.filter((family) => inventory.chainCandidates.some((candidate) => {
    if (candidate.family !== family) return false;
    const decision = decisions.get(candidate.id);
    return resolvedDocumentCandidates.has(candidate.id) || resolvedMergeCandidates.has(candidate.id) ||
      decision?.decision === "request-input";
  }));
  dimensions.push(evaluated({
    dimension: "external-boundary-family-closure",
    observed: closedFamilies.length / requiredFamilies.length * 100,
    threshold: coverageThreshold(100, 100),
    evidence: {
      required_families: requiredFamilies,
      closed_families: closedFamilies,
      uncovered_families: requiredFamilies.filter((family) => !closedFamilies.includes(family)),
    },
    actions: ["document-representative-chain"],
  }));
  return dimensions;
}
