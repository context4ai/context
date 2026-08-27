import { describe, expect, test } from "bun:test";
import type {
  CodeIndexInspectionInventory,
  CodeIndexModuleType,
  CodeIndexOutputProfile,
} from "@c4a/context";
import { auditDimensions } from "../project/codeIndexAuditMetrics.js";
import { applyCustomInspectionInventory } from "../project/customExtractInventory.js";
import type { ExtractionIndexUnitPreview } from "../project/extractCandidateTypes.js";

type Boundary = NonNullable<CodeIndexInspectionInventory["boundaryTargets"]>[number];

function preview(
  id: string,
  moduleType: CodeIndexModuleType,
  profile: CodeIndexOutputProfile,
): ExtractionIndexUnitPreview {
  return {
    id,
    inputSources: [`fixture/${id}`],
    outputOwner: id,
    moduleType,
    moduleTypes: [moduleType],
    facets: [],
    moduleTypeEvidence: ["src/module.ts"],
    documents: [],
    outputProfile: profile,
    capability: "complete",
    plan: "declared",
    responsibility: "Explain the stable module boundary.",
    entries: [],
    protocols: [],
    exclusions: [],
    lifecycle: "authoritative",
    currentPageCount: 0,
    projectedPageCount: 1,
    candidateEstimate: 1,
    changes: { added: 1, updated: 0, removed: 0, unchanged: 0, exact: true },
    scale: "normal",
    visibility: { exported: 0, internal: 0 },
    candidateKinds: {},
    topDirectories: [],
    contentBytes: { total: 1, max: 1, sampled: false, topPages: [] },
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
      entryTargets: [],
      protocolTargets: [],
      boundaryTargets: [],
      coveredBoundaryTargets: [],
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

function inventory(input: {
  id: string;
  boundaries: Boundary[];
  chains: Array<{
    id: string;
    family: NonNullable<CodeIndexInspectionInventory["chainCandidates"]>[number]["family"];
    from: string;
    to: string;
  }>;
}): CodeIndexInspectionInventory {
  return {
    indexUnitId: input.id,
    eligibleFiles: 1,
    analyzedFiles: 1,
    eligibleFileTargets: ["src/module.ts"],
    analyzedFileTargets: ["src/module.ts"],
    eligibleLoc: 1,
    analyzedLoc: 1,
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
    entryTargets: [],
    protocolTargets: [],
    boundaryTargets: input.boundaries,
    coveredBoundaryTargets: input.boundaries,
    identityGroups: [],
    chainCandidates: input.chains.map((chain) => ({
      ...chain,
      sourceFiles: ["src/module.ts"],
      confidence: "structural",
    })),
    chainCandidateDecisions: input.chains.map((chain) => ({
      candidateId: chain.id,
      decision: "request-input",
      reason: "The runtime binding requires authoritative material.",
    })),
    excludedFiles: 0,
    excludedFileTargets: [],
    excludedReasons: [],
    parserSkippedFiles: 0,
    parserSkippedFileTargets: [],
  };
}

describe("0.6.18 mixed-module code-index quality E2E", () => {
  test("closes candidate discovery and decision coverage for common anonymous module shapes", () => {
    const scenarios = [
      {
        id: "web",
        moduleType: "web-application" as const,
        profile: "application-map" as const,
        boundaries: [{ kind: "entry", identity: "bootstrap" }, { kind: "route", identity: "route.home" }] satisfies Boundary[],
        chains: [{ id: "web-entry", family: "entry-operation" as const, from: "bootstrap", to: "route.home" }],
      },
      {
        id: "api",
        moduleType: "api-service" as const,
        profile: "service-boundary" as const,
        boundaries: [{ kind: "operation", identity: "read" }, { kind: "handler", identity: "handleRead" }, { kind: "downstream", identity: "store.load" }] satisfies Boundary[],
        chains: [
          { id: "api-handler", family: "operation-handler" as const, from: "read", to: "handleRead" },
          { id: "api-store", family: "handler-downstream" as const, from: "handleRead", to: "store.load" },
        ],
      },
      {
        id: "library",
        moduleType: "sdk-library" as const,
        profile: "public-api-reference" as const,
        boundaries: [{ kind: "export", identity: "publicApi" }, { kind: "operation", identity: "execute" }] satisfies Boundary[],
        chains: [{ id: "library-export", family: "export-implementation" as const, from: "publicApi", to: "execute" }],
      },
      {
        id: "runtime",
        moduleType: "background-runtime" as const,
        profile: "runtime-map" as const,
        boundaries: [{ kind: "event", identity: "job.started" }, { kind: "handler", identity: "processJob" }] satisfies Boundary[],
        chains: [{ id: "runtime-event", family: "event-processing" as const, from: "job.started", to: "processJob" }],
      },
      {
        id: "adapter",
        moduleType: "adapter" as const,
        profile: "cross-module-flow" as const,
        boundaries: [{ kind: "handoff", identity: "inbound.contract" }, { kind: "operation", identity: "translate" }] satisfies Boundary[],
        chains: [{ id: "adapter-handoff", family: "cross-source-handoff" as const, from: "inbound.contract", to: "translate" }],
      },
    ];

    for (const scenario of scenarios) {
      const unit = preview(scenario.id, scenario.moduleType, scenario.profile);
      applyCustomInspectionInventory({
        unit,
        inventory: inventory(scenario),
        phaseId: `extract:${scenario.id}`,
      });
      const dimensions = auditDimensions({ unit, pages: [] });
      expect(dimensions.find((dimension) => dimension.dimension === "chain-candidate-family-discovery")?.status)
        .toBe("target");
      expect(dimensions.find((dimension) => dimension.dimension === "chain-candidate-decision-coverage")?.status)
        .toBe("target");
    }
  });
});
