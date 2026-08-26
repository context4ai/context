import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodeIndexInspectionInventory } from "@c4a/context";
import { assertCustomInventoryCoversSourceBaseline } from "../project/customExtractInventory.js";
import type { ExtractionIndexUnitPreview } from "../project/extractCandidateTypes.js";

function unit(): ExtractionIndexUnitPreview {
  return {
    id: "sample",
    inputSources: ["20260825/sample"],
    outputOwner: "sample",
    moduleType: "web-application",
    moduleTypes: ["web-application"],
    facets: [],
    moduleTypeEvidence: ["src/index.ts"],
    documents: [],
    outputProfile: "module-map",
    capability: "complete",
    plan: "declared",
    responsibility: "Describe the module boundary.",
    exclusions: [],
    entries: ["src/index.ts"],
    protocols: [],
    lifecycle: "authoritative",
    currentPageCount: 0,
    projectedPageCount: 1,
    candidateEstimate: 1,
    changes: { added: 1, updated: 0, removed: 0, unchanged: 0, exact: true },
    scale: "normal",
    visibility: { exported: 1, internal: 0 },
    candidateKinds: { function: 1 },
    topDirectories: [],
    contentBytes: { total: 1, max: 1, sampled: false, topPages: [] },
    inventory: {
      basis: "ast",
      eligibleFiles: 1,
      analyzedFiles: 1,
      eligibleFileTargets: ["src/index.ts"],
      analyzedFileTargets: ["src/index.ts"],
      eligibleLoc: 1,
      analyzedLoc: 1,
      documentsDiscovered: 0,
      documentsRead: 0,
      documentTargets: [],
      rootDocumentTargets: [],
      readDocumentTargets: [],
      referencedDocumentTargets: [],
      symbolsDiscovered: 1,
      symbolsAnalyzed: 1,
      targetSymbols: 1,
      exportedSymbols: 1,
      targetSymbolIdentities: ["publicApi"],
      exportedTargetIdentities: ["publicApi"],
      entryTargets: ["src/index.ts"],
      protocolTargets: [],
      boundaryTargets: [],
      coveredBoundaryTargets: [],
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    },
    risks: [],
  };
}

function inventory(): CodeIndexInspectionInventory {
  return {
    indexUnitId: "sample",
    eligibleFiles: 1,
    analyzedFiles: 1,
    eligibleFileTargets: ["src/index.ts"],
    analyzedFileTargets: ["src/index.ts"],
    eligibleLoc: 1,
    analyzedLoc: 1,
    documentsDiscovered: 0,
    documentsRead: 0,
    documentTargets: [],
    rootDocumentTargets: [],
    readDocumentTargets: [],
    referencedDocumentTargets: [],
    symbolsDiscovered: 1,
    symbolsAnalyzed: 1,
    targetSymbols: 1,
    exportedSymbols: 1,
    targetSymbolIdentities: ["publicApi"],
    exportedTargetIdentities: ["publicApi"],
    entryTargets: ["src/index.ts"],
    protocolTargets: [],
    boundaryTargets: [],
    coveredBoundaryTargets: [],
    excludedFiles: 0,
    excludedFileTargets: [],
    excludedReasons: [],
    parserSkippedFiles: 0,
    parserSkippedFileTargets: [],
  };
}

describe("0.6.19 independent custom inventory baseline", () => {
  test("finds an omitted source family and MDX even when the extractor declares only TypeScript", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-custom-baseline-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "src", "index.ts"), "export const publicApi = 1;\n", "utf8");
      writeFileSync(join(root, "worker.py"), "def run():\n    return 1\n", "utf8");
      writeFileSync(join(root, "docs", "guide.mdx"), "# Guide\n\nUse the public API.\n", "utf8");

      await expect(assertCustomInventoryCoversSourceBaseline({
        unit: unit(),
        inventory: inventory(),
        phaseId: "extract:sample",
        sources: [{ name: "20260825/sample", absolutePath: root }],
      })).rejects.toMatchObject({
        detail: {
          missing_eligible_files: ["docs/guide.mdx", "worker.py"],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
