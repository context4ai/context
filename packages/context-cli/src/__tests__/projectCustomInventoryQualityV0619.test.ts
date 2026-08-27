import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCustomInspectionInventory,
  assertCustomInventoryCoversSourceBaseline,
} from "../project/customExtractInventory.js";
import type { ExtractionIndexUnitPreview } from "../project/extractCandidateTypes.js";

function unit(): ExtractionIndexUnitPreview {
  return {
    id: "sample",
    inputSources: ["20260825/sample"],
    outputOwner: "sample",
    moduleType: "sdk-library",
    moduleTypes: ["sdk-library"],
    facets: ["public-api"],
    moduleTypeEvidence: ["src/index.ts"],
    documents: ["README.md"],
    outputProfile: "public-api-reference",
    capability: "complete",
    plan: "declared",
    responsibility: "Document the public contract.",
    entries: ["src/index.ts"],
    protocols: [],
    exclusions: [],
    lifecycle: "authoritative",
    currentPageCount: 0,
    projectedPageCount: 1,
    candidateEstimate: 1,
    changes: { added: 1, updated: 0, removed: 0, unchanged: 0, exact: true },
    scale: "normal",
    visibility: { exported: 9, internal: 1 },
    candidateKinds: { function: 10 },
    topDirectories: [],
    contentBytes: { total: 1000, max: 1000, sampled: false, topPages: [] },
    inventory: {
      basis: "ast",
      eligibleFiles: 10,
      analyzedFiles: 10,
      eligibleFileTargets: Array.from({ length: 10 }, (_, index) => `src/file-${index}.ts`),
      analyzedFileTargets: Array.from({ length: 10 }, (_, index) => `src/file-${index}.ts`),
      eligibleLoc: 1_000,
      analyzedLoc: 950,
      documentsDiscovered: 1,
      documentsRead: 1,
      documentTargets: ["README.md"],
      rootDocumentTargets: ["README.md"],
      readDocumentTargets: ["README.md"],
      referencedDocumentTargets: [],
      symbolsDiscovered: 10,
      symbolsAnalyzed: 10,
      targetSymbols: 9,
      exportedSymbols: 9,
      targetSymbolIdentities: [],
      exportedTargetIdentities: [],
      entryTargets: ["src/index.ts"],
      protocolTargets: [],
      boundaryTargets: [{ kind: "entry", identity: "src/index.ts" }],
      coveredBoundaryTargets: [{ kind: "entry", identity: "src/index.ts" }],
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

describe("0.6.19 custom code-index inventory completeness", () => {
  test("requires complete symbol identity denominators from custom inspection", () => {
    const inspected = unit();
    const inventory = {
      indexUnitId: "sample",
      eligibleFiles: 1,
      analyzedFiles: 1,
      eligibleFileTargets: ["src/index.ts"],
      analyzedFileTargets: ["src/index.ts"],
      eligibleLoc: 10,
      analyzedLoc: 10,
      documentsDiscovered: 0,
      documentsRead: 0,
      symbolsDiscovered: 2,
      symbolsAnalyzed: 2,
      targetSymbols: 2,
      exportedSymbols: 1,
      targetSymbolIdentities: ["publicApi"],
      exportedTargetIdentities: ["publicApi"],
      entryTargets: ["src/index.ts"],
      protocolTargets: [],
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    } as const;
    expect(() => applyCustomInspectionInventory({
      unit: inspected,
      inventory,
      phaseId: "extract:sample",
    })).toThrow("symbol identity lists must be complete and match their counts");
  });

  test("rejects a hand-picked custom inventory that omits adjacent source and MDX files", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-custom-inventory-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "src", "index.ts"), "export const publicApi = 1;\n", "utf8");
      writeFileSync(join(root, "src", "client.tsx"), "export function Client() { return null; }\n", "utf8");
      writeFileSync(join(root, "README.md"), "# Package\n", "utf8");
      writeFileSync(join(root, "docs", "operations.mdx"), "# Operations\n\nRun the service.\n", "utf8");
      writeFileSync(join(root, "package.json"), "{}\n", "utf8");
      const inspected = unit();
      inspected.documents = ["README.md"];
      const inventory = {
        indexUnitId: "sample",
        eligibleFiles: 3,
        analyzedFiles: 3,
        eligibleFileTargets: ["src/index.ts", "README.md", "package.json"],
        analyzedFileTargets: ["src/index.ts", "README.md", "package.json"],
        eligibleLoc: 3,
        analyzedLoc: 3,
        documentsDiscovered: 1,
        documentsRead: 1,
        documentTargets: ["README.md"],
        rootDocumentTargets: ["README.md"],
        readDocumentTargets: ["README.md"],
        referencedDocumentTargets: ["README.md"],
        symbolsDiscovered: 1,
        symbolsAnalyzed: 1,
        targetSymbols: 1,
        exportedSymbols: 1,
        targetSymbolIdentities: ["publicApi"],
        exportedTargetIdentities: ["publicApi"],
        entryTargets: ["src/index.ts"],
        protocolTargets: [],
        excludedFiles: 0,
        excludedFileTargets: [],
        excludedReasons: [],
        parserSkippedFiles: 0,
        parserSkippedFileTargets: [],
      };
      await expect(assertCustomInventoryCoversSourceBaseline({
        unit: inspected,
        inventory,
        phaseId: "extract:sample",
        sources: [{ name: "20260825/sample", absolutePath: root }],
      })).rejects.toMatchObject({
        detail: {
          missing_eligible_files: ["docs/operations.mdx", "src/client.tsx"],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("accepts an independently complete custom inventory after declared exclusions", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-custom-inventory-"));
    try {
      mkdirSync(join(root, "src", "generated"), { recursive: true });
      writeFileSync(join(root, "src", "index.ts"), "export const publicApi = 1;\n", "utf8");
      writeFileSync(join(root, "src", "generated", "client.ts"), "export const generated = 1;\n", "utf8");
      const inspected = unit();
      inspected.exclusions = ["src/generated/**"];
      const inventory = {
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
        excludedFiles: 1,
        excludedFileTargets: ["src/generated/client.ts"],
        excludedReasons: ["generated source"],
        parserSkippedFiles: 0,
        parserSkippedFileTargets: [],
      };
      await expect(assertCustomInventoryCoversSourceBaseline({
        unit: inspected,
        inventory,
        phaseId: "extract:sample",
        sources: [{ name: "20260825/sample", absolutePath: root }],
      })).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects omitted sibling page entries even when file and LOC inventories are complete", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-custom-boundaries-"));
    try {
      mkdirSync(join(root, "src", "pages", "home"), { recursive: true });
      mkdirSync(join(root, "src", "pages", "settings"), { recursive: true });
      writeFileSync(join(root, "src", "pages", "home", "entry.tsx"), "export const Home = 1;\n", "utf8");
      writeFileSync(join(root, "src", "pages", "settings", "entry.tsx"), "export const Settings = 1;\n", "utf8");
      const inspected = unit();
      inspected.moduleType = "web-application";
      inspected.moduleTypes = ["web-application"];
      inspected.facets = ["page-routing"];
      inspected.outputProfile = "application-map";
      const inventory = {
        indexUnitId: "sample",
        eligibleFiles: 2,
        analyzedFiles: 2,
        eligibleFileTargets: ["src/pages/home/entry.tsx", "src/pages/settings/entry.tsx"],
        analyzedFileTargets: ["src/pages/home/entry.tsx", "src/pages/settings/entry.tsx"],
        eligibleLoc: 2,
        analyzedLoc: 2,
        documentsDiscovered: 0,
        documentsRead: 0,
        documentTargets: [],
        rootDocumentTargets: [],
        readDocumentTargets: [],
        referencedDocumentTargets: [],
        symbolsDiscovered: 1,
        symbolsAnalyzed: 1,
        targetSymbols: 1,
        exportedSymbols: 0,
        targetSymbolIdentities: ["home"],
        exportedTargetIdentities: [],
        entryTargets: ["src/pages/home/entry.tsx"],
        protocolTargets: [],
        boundaryTargets: [{ kind: "route" as const, identity: "home" }],
        coveredBoundaryTargets: [{ kind: "route" as const, identity: "home" }],
        excludedFiles: 0,
        excludedFileTargets: [],
        excludedReasons: [],
        parserSkippedFiles: 0,
        parserSkippedFileTargets: [],
      };
      await expect(assertCustomInventoryCoversSourceBaseline({
        unit: inspected,
        inventory,
        phaseId: "extract:sample",
        sources: [{ name: "20260825/sample", absolutePath: root }],
      })).rejects.toMatchObject({
        detail: {
          missing_target_symbols: [{ kind: "route", identity: "settings", path: "src/pages/settings/entry.tsx" }],
          missing_boundary_targets: [{ kind: "route", identity: "settings", path: "src/pages/settings/entry.tsx" }],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects omitted Go service operations from a declared handler source of truth", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-custom-operations-"));
    try {
      writeFileSync(join(root, "handler.go"), [
        "package service",
        "type Service struct{}",
        "func (s *Service) First() {}",
        "func (s *Service) Second() {}",
        "",
      ].join("\n"), "utf8");
      const inspected = unit();
      inspected.moduleType = "service";
      inspected.moduleTypes = ["service"];
      inspected.facets = ["protocol-provider"];
      inspected.outputProfile = "service-boundary";
      inspected.sourceOfTruth = "handler.go";
      const inventory = {
        indexUnitId: "sample",
        eligibleFiles: 1,
        analyzedFiles: 1,
        eligibleFileTargets: ["handler.go"],
        analyzedFileTargets: ["handler.go"],
        eligibleLoc: 4,
        analyzedLoc: 4,
        documentsDiscovered: 0,
        documentsRead: 0,
        documentTargets: [],
        rootDocumentTargets: [],
        readDocumentTargets: [],
        referencedDocumentTargets: [],
        symbolsDiscovered: 1,
        symbolsAnalyzed: 1,
        targetSymbols: 1,
        exportedSymbols: 0,
        targetSymbolIdentities: ["First"],
        exportedTargetIdentities: [],
        entryTargets: [],
        protocolTargets: [],
        boundaryTargets: [{ kind: "operation" as const, identity: "First" }],
        coveredBoundaryTargets: [{ kind: "operation" as const, identity: "First" }],
        excludedFiles: 0,
        excludedFileTargets: [],
        excludedReasons: [],
        parserSkippedFiles: 0,
        parserSkippedFileTargets: [],
      };
      await expect(assertCustomInventoryCoversSourceBaseline({
        unit: inspected,
        inventory,
        phaseId: "extract:sample",
        sources: [{ name: "20260825/sample", absolutePath: root }],
      })).rejects.toMatchObject({
        detail: {
          missing_target_symbols: [{ kind: "operation", identity: "Second", path: "handler.go" }],
          missing_boundary_targets: [{ kind: "operation", identity: "Second", path: "handler.go" }],
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
