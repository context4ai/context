import { describe, expect, test } from "bun:test";
import type { ExtractionIndexUnitPreview } from "../project/extractCandidateTypes.js";
import { applyIndexUnitAdvisoryRisks } from "../project/extractionIndexUnitRisks.js";

function unit(
  overrides: Partial<ExtractionIndexUnitPreview> = {},
): ExtractionIndexUnitPreview {
  return {
    id: "module-a",
    inputSources: ["repo:module-a"],
    outputOwner: "module-a",
    moduleType: "service",
    moduleTypes: ["service"],
    facets: [],
    moduleTypeEvidence: ["src/index.ts"],
    documents: ["README.md"],
    outputProfile: "service-boundary",
    capability: "complete",
    plan: "declared",
    responsibility: "Document the stable module boundary.",
    entries: ["src/index.ts"],
    protocols: [],
    exclusions: [],
    lifecycle: "authoritative",
    currentPageCount: 0,
    projectedPageCount: 1,
    candidateEstimate: 1,
    changes: { added: 1, updated: 0, removed: 0, unchanged: 0, exact: true },
    scale: "normal",
    visibility: { exported: 1, internal: 0 },
    candidateKinds: { module: 1 },
    topDirectories: [],
    contentBytes: { total: 1024, max: 1024, sampled: false, topPages: [] },
    inventory: {
      basis: "ast",
      eligibleFiles: 1,
      analyzedFiles: 1,
      eligibleFileTargets: ["src/index.ts"],
      analyzedFileTargets: ["src/index.ts"],
      eligibleLoc: 100,
      analyzedLoc: 100,
      documentsDiscovered: 1,
      documentsRead: 1,
      documentTargets: ["README.md"],
      rootDocumentTargets: ["README.md"],
      readDocumentTargets: ["README.md"],
      referencedDocumentTargets: [],
      symbolsDiscovered: 1,
      symbolsAnalyzed: 1,
      targetSymbols: 1,
      exportedSymbols: 1,
      targetSymbolIdentities: [],
      exportedTargetIdentities: [],
      entryTargets: ["src/index.ts"],
      protocolTargets: [],
      boundaryTargets: [{ kind: "entry", identity: "src/index.ts" }],
      coveredBoundaryTargets: [{ kind: "entry", identity: "src/index.ts" }],
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    },
    risks: [],
    ...overrides,
  };
}

describe("extraction index-unit advisory risks", () => {
  test("does not require executable entries for registries and cross-module flows", () => {
    for (const outputProfile of ["module-registry", "cross-module-flow"] as const) {
      const preview = unit({ outputProfile, entries: [], protocols: [] });
      applyIndexUnitAdvisoryRisks(preview, { customAggregate: true });
      expect(preview.risks).not.toContain("stable-entry-missing");
    }
  });

  test("does not require protocol evidence for a domain service boundary", () => {
    const preview = unit({ outputProfile: "service-boundary", protocols: [] });
    applyIndexUnitAdvisoryRisks(preview, { customAggregate: true });
    expect(preview.risks).not.toContain("protocol-evidence-missing");
  });

  test("accepts a generated public reference with an identified source of truth", () => {
    const preview = unit({
      moduleType: "sdk-library",
      moduleTypes: ["sdk-library", "derived-source"],
      facets: ["public-api", "generated-contract"],
      outputProfile: "public-api-reference",
      lifecycle: "generated",
      sourceOfTruth: "schema/public-api.yaml",
      candidateKinds: { interface: 8, type: 2 },
      projectedPageCount: 10,
      candidateEstimate: 10,
      visibility: { exported: 10, internal: 0 },
    });
    applyIndexUnitAdvisoryRisks(preview, { customAggregate: false });
    expect(preview.risks).not.toContain("derived-source-risk");
    expect(preview.risks).not.toContain("symbol-catalog-risk");
  });

  test("warns when a custom aggregate is too thin", () => {
    const preview = unit({
      outputProfile: "module-map",
      contentBytes: { total: 80, max: 80, sampled: false, topPages: [] },
    });
    applyIndexUnitAdvisoryRisks(preview, { customAggregate: true });
    expect(preview.risks).toContain("thin-aggregate-risk");
  });
});
