import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomCodeCandidateDraft, ExtractCustomPhaseDefinition } from "@c4a/context";
import { auditDimensions, measureCodeIndexMarkdown } from "../project/codeIndexAuditMetrics.js";
import { pageSignals } from "../project/codeIndexAudit.js";
import { buildCodeIndexActionGuidance } from "../project/codeIndexAuditGuidance.js";
import { candidateFromCustom } from "../project/customCandidateDraft.js";
import {
  applyCustomInspectionInventory,
  assertCustomInventoryCoversSourceBaseline,
} from "../project/customExtractInventory.js";
import type { ExtractionIndexUnitPreview } from "../project/extractCandidateTypes.js";
import { renderApprovedCodegraphMarkdown } from "../project/reviewApplyCodegraph.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";

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
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    },
    risks: [],
  };
}

describe("0.6.19 mechanical code-index quality", () => {
  test("distinguishes real placeholder markers from documented placeholder APIs", () => {
    const apiDocumentation = measureCodeIndexMarkdown([
      "# Placeholder API",
      "",
      "- `placeholder` configures the empty input hint.",
      "- `showPlaceholder` determines whether the hint is visible.",
      "The `input.placeholder` field remains part of the stable public contract.",
    ].join("\n"));
    expect(apiDocumentation.placeholderSectionCount).toBe(0);

    const unfinished = measureCodeIndexMarkdown([
      "# TODO",
      "",
      "- TBD: document the retry contract",
      "",
      "待补充",
    ].join("\n"));
    expect(unfinished.placeholderSectionCount).toBe(3);
  });

  test("scores independent dimensions without an aggregate score", () => {
    const markdown = [
      "# Public API",
      "",
      ...Array.from({ length: 90 }, (_, index) => `- \`export${index}\` maps to \`src/api${index}.ts\` and preserves its declared contract.`),
      "",
      "The `sample.api` entry groups stable exports by capability and keeps internal helpers outside the public contract.",
    ].join("\n");
    const measured = measureCodeIndexMarkdown(markdown);
    const dimensions = auditDimensions({
      unit: unit(),
      pages: [{
        view_ref: "codeindex:sample/public-api",
        module: "sample",
        path: "codeindex/sample/public-api.md",
        candidate_fingerprint: "candidate",
        content_digest: "content",
        effective_chars: 1000,
        section_count: 2,
        evidence_count: 90,
        section_scoped_evidence_count: 90,
        relation_count: 0,
        relation_evidence_count: 0,
        source_count: 1,
        line_count: measured.lineCount,
        semantic_fact_lines: measured.semanticFactLines,
        table_fact_rows: measured.tableFactRows,
        explanatory_lines: measured.explanatoryLines,
        implementation_body_lines: measured.implementationBodyLines,
        template_residue_count: measured.templateResidueCount,
        placeholder_section_count: measured.placeholderSectionCount,
        referenced_file_count: 90,
        referenced_symbol_count: 90,
        referenced_files: Array.from({ length: 90 }, (_, index) => `src/api${index}.ts`),
        referenced_symbols: Array.from({ length: 9 }, (_, index) => `export${index}`),
      }],
    });
    expect(dimensions.find((item) => item.dimension === "eligible-file-analysis")?.status).toBe("above-target");
    expect(dimensions.find((item) => item.dimension === "target-symbol-coverage")?.status).toBe("above-target");
    expect(dimensions.find((item) => item.dimension === "template-residue")?.absolute_gate).toBe(false);
    expect(dimensions.every((item) => !("total_score" in item))).toBe(true);
  });

  test("treats template residue, placeholder markers, and pages over 800 lines as separate absolute failures", () => {
    const page = {
        view_ref: "codeindex:sample/oversized",
        module: "sample",
        path: "codeindex/sample/oversized.md",
        candidate_fingerprint: "candidate",
        content_digest: "content",
        effective_chars: 10,
        section_count: 1,
        evidence_count: 1,
        section_scoped_evidence_count: 1,
        relation_count: 0,
        relation_evidence_count: 0,
        source_count: 1,
        line_count: 801,
        semantic_fact_lines: 1,
        table_fact_rows: 0,
        explanatory_lines: 0,
        implementation_body_lines: 0,
        template_residue_count: 1,
        placeholder_section_count: 1,
        referenced_file_count: 1,
        referenced_symbol_count: 1,
        referenced_files: ["src/index.ts"],
        referenced_symbols: ["publicApi"],
      };
    const dimensions = auditDimensions({
      unit: unit(),
      pages: [page],
    });
    expect(dimensions.find((item) => item.dimension === "max-page-lines")?.status).toBe("above-ceiling");
    expect(dimensions.find((item) => item.dimension === "template-residue")?.status).toBe("above-ceiling");
    expect(dimensions.find((item) => item.dimension === "template-residue")?.observed).toBe(1);
    expect(dimensions.find((item) => item.dimension === "placeholder-sections")?.status).toBe("above-ceiling");
    expect(dimensions.find((item) => item.dimension === "placeholder-sections")?.observed).toBe(1);
    const guidance = buildCodeIndexActionGuidance({ dimensions, pages: [page], signals: [] });
    expect(guidance.find((item) => item.action === "remove-template-residue")).toMatchObject({
      failed_dimensions: expect.arrayContaining(["placeholder-sections", "template-residue"]),
      affected_pages: ["codeindex:sample/oversized"],
    });
  });

  test("separates mandatory root documents from related Markdown coverage", () => {
    const documented = unit();
    documented.inventory.documentsDiscovered = 3;
    documented.inventory.documentsRead = 1;
    documented.inventory.documentTargets = ["README.md", "docs/architecture.md", "docs/operations.md"];
    documented.inventory.rootDocumentTargets = ["README.md"];
    documented.inventory.readDocumentTargets = ["docs/architecture.md"];
    const dimensions = auditDimensions({ unit: documented, pages: [] });
    const root = dimensions.find((item) => item.dimension === "root-document-read-coverage");
    const related = dimensions.find((item) => item.dimension === "related-document-read-coverage");
    expect(root?.status).toBe("below-floor");
    expect(root?.evidence.uncovered_identities).toEqual(["README.md"]);
    expect(related?.status).toBe("below-floor");
    expect(related?.evidence.uncovered_identities).toEqual(["docs/operations.md"]);
  });

  test("reports broad per-page file scope without making file count an absolute gate", () => {
    const dimensions = auditDimensions({
      unit: unit(),
      pages: [{
        view_ref: "codeindex:sample/broad-scope",
        module: "sample",
        path: "codeindex/sample/broad-scope.md",
        candidate_fingerprint: "candidate",
        content_digest: "content",
        effective_chars: 100,
        section_count: 1,
        evidence_count: 61,
        section_scoped_evidence_count: 61,
        relation_count: 0,
        relation_evidence_count: 0,
        source_count: 1,
        line_count: 100,
        semantic_fact_lines: 40,
        table_fact_rows: 0,
        explanatory_lines: 12,
        implementation_body_lines: 0,
        template_residue_count: 0,
        placeholder_section_count: 0,
        referenced_file_count: 61,
        referenced_symbol_count: 1,
        referenced_files: Array.from({ length: 61 }, (_, index) => `src/file-${index}.ts`),
        referenced_symbols: ["publicApi"],
      }],
    });
    const fileSpan = dimensions.find((item) => item.dimension === "max-referenced-files-per-page");
    expect(fileSpan?.status).toBe("above-ceiling");
    expect(fileSpan?.absolute_gate).toBe(false);
  });

  test("uses absolute facts instead of unstable LOC density for tiny modules", () => {
    const tiny = unit();
    tiny.inventory.eligibleFiles = 1;
    tiny.inventory.analyzedFiles = 1;
    tiny.inventory.eligibleLoc = 12;
    tiny.inventory.analyzedLoc = 12;
    tiny.inventory.targetSymbols = 1;
    tiny.inventory.targetSymbolIdentities = ["publicApi"];
    tiny.inventory.exportedSymbols = 1;
    tiny.inventory.exportedTargetIdentities = ["publicApi"];
    const dimensions = auditDimensions({
      unit: tiny,
      pages: [{
        view_ref: "codeindex:sample/public-api",
        module: "sample",
        path: "codeindex/sample/public-api.md",
        candidate_fingerprint: "candidate",
        content_digest: "content",
        effective_chars: 80,
        section_count: 1,
        evidence_count: 1,
        section_scoped_evidence_count: 1,
        relation_count: 0,
        relation_evidence_count: 0,
        source_count: 1,
        line_count: 8,
        semantic_fact_lines: 3,
        table_fact_rows: 0,
        explanatory_lines: 1,
        implementation_body_lines: 0,
        template_residue_count: 0,
        placeholder_section_count: 0,
        referenced_file_count: 1,
        referenced_symbol_count: 1,
        referenced_files: ["src/index.ts"],
        referenced_symbols: ["publicApi"],
      }],
    });
    expect(dimensions.find((item) => item.dimension === "semantic-fact-density")?.status).toBe("not-applicable");
    expect(dimensions.find((item) => item.dimension === "semantic-fact-lines")?.absolute_gate).toBe(false);
    expect(dimensions.find((item) => item.dimension === "public-export-identity-coverage")?.absolute_gate).toBe(false);
  });

  test("does not count unfenced signature and generated-type dumps as semantic facts", () => {
    const signatureDump = measureCodeIndexMarkdown([
      "The `client.fetch` entry owns the stable request contract.",
      "export interface Request {",
      "id: string;",
      "mode: Mode;",
      "}",
    ].join("\n"));
    expect(signatureDump.semanticFactLines).toBe(1);
    expect(signatureDump.signatureDumpLines).toBe(4);
    expect(signatureDump.implementationBodyLines).toBe(4);

    const generatedDump = measureCodeIndexMarkdown([
      "// Code generated by schema compiler. DO NOT EDIT.",
      "type Response struct {",
      "Status string",
      "Count int",
      "}",
    ].join("\n"));
    expect(generatedDump.semanticFactLines).toBe(0);
    expect(generatedDump.generatedTypeLines).toBe(5);
  });

  test("returns every uncovered target identity without report truncation", () => {
    const incomplete = unit();
    incomplete.inventory.targetSymbolIdentities = Array.from({ length: 140 }, (_, index) => `export${index}`);
    incomplete.inventory.targetSymbols = incomplete.inventory.targetSymbolIdentities.length;
    incomplete.inventory.symbolsDiscovered = incomplete.inventory.targetSymbols;
    incomplete.inventory.symbolsAnalyzed = incomplete.inventory.targetSymbols;
    const targetCoverage = auditDimensions({ unit: incomplete, pages: [] })
      .find((dimension) => dimension.dimension === "target-symbol-coverage");
    expect(targetCoverage?.evidence.uncovered_identities).toHaveLength(140);
    expect(targetCoverage?.evidence.uncovered_identities).toContain("export139");
  });

  test("requires and renders custom reader content only from evidence-scoped sections", () => {
    const phase = { id: "extract:sample", collection: "codeindex" } as ExtractCustomPhaseDefinition;
    const evidence = {
      source: "20260825/sample",
      file: "src/index.ts",
      symbol: "publicApi",
      kind: "function",
      digest: "abcdef012345",
    };
    const built = candidateFromCustom({
      phase,
      index: 0,
      sourceNames: new Set([evidence.source]),
      draft: {
        nodeRef: "sample/public-api",
        kind: "public-api",
        visibility: "exported",
        module: "sample",
        evidence: [evidence],
        sections: [{
          id: "contract",
          kind: "contract",
          title: "Contract",
          markdown: "`publicApi` is exported by `src/index.ts`.",
          evidence: [evidence],
        }],
        review: {
          title: "Sample public API",
          summary: "Public contract.",
          signals: ["source-backed"],
          reason: "Review the public API.",
        },
      },
    });
    expect(built.markdown).toContain("## Contract");
    expect(() => candidateFromCustom({
      phase,
      index: 1,
      sourceNames: new Set([evidence.source]),
      draft: {
        nodeRef: "sample/missing-sections",
        kind: "public-api",
        visibility: "exported",
        module: "sample",
        evidence: [evidence],
        review: {
          title: "Missing sections",
          summary: "Invalid custom candidate.",
          signals: ["source-backed"],
          reason: "Exercise runtime validation.",
        },
      } as unknown as CustomCodeCandidateDraft,
    })).toThrow("sections must contain at least one evidence-scoped section");
  });

  test("rejects template headings inside custom Section bodies", () => {
    const phase = { id: "extract:sample", collection: "codeindex" } as ExtractCustomPhaseDefinition;
    const evidence = {
      source: "20260825/sample",
      file: "src/index.ts",
      symbol: "publicApi",
      kind: "function",
      digest: "abcdef012345",
    };
    expect(() => candidateFromCustom({
      phase,
      index: 0,
      sourceNames: new Set([evidence.source]),
      draft: {
        nodeRef: "sample/template-residue",
        kind: "public-api",
        visibility: "exported",
        module: "sample",
        evidence: [evidence],
        sections: [{
          id: "contract",
          kind: "contract",
          title: "Contract",
          markdown: "## Contract\n\n`publicApi` is exported by `src/index.ts`.",
          evidence: [evidence],
        }],
        review: {
          title: "Sample public API",
          summary: "Public contract.",
          signals: ["source-backed"],
          reason: "Review the public API.",
        },
      },
    })).toThrow("markdown must contain Section body content only");
  });

  test("returns a safe token suggestion for canonical evidence delimiters", () => {
    const phase = { id: "extract:sample", collection: "codeindex" } as ExtractCustomPhaseDefinition;
    const evidence = {
      source: "20260825/sample",
      file: "src/index.ts",
      symbol: "client:request@v2",
      kind: "function",
      digest: "abcdef012345",
    };
    try {
      candidateFromCustom({
        phase,
        index: 0,
        sourceNames: new Set([evidence.source]),
        draft: {
          nodeRef: "sample/public-api",
          kind: "public-api",
          visibility: "exported",
          module: "sample",
          evidence: [evidence],
          sections: [{
            id: "contract",
            kind: "contract",
            title: "Contract",
            markdown: "The client request is public.",
            evidence: [evidence],
          }],
          review: {
            title: "Sample public API",
            summary: "Public contract.",
            signals: ["source-backed"],
            reason: "Review the public API.",
          },
        },
      });
      throw new Error("expected invalid evidence to fail");
    } catch (error) {
      expect(error).toMatchObject({
        detail: {
          field: "candidates[0].evidence[0].symbol",
          suggested_token: "client-request-v2",
        },
      });
    }
  });

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

  test("preserves every Section evidence ref through approved Markdown", () => {
    const phase = { id: "extract:sample", collection: "codeindex" } as ExtractCustomPhaseDefinition;
    const evidence = ["src/index.ts", "src/client.ts"].map((file, index) => ({
      source: "20260825/sample",
      file,
      symbol: index === 0 ? "publicApi" : "client",
      kind: "function",
      digest: `abcdef01234${index}`,
    }));
    const built = candidateFromCustom({
      phase,
      index: 0,
      sourceNames: new Set(["20260825/sample"]),
      draft: {
        nodeRef: "sample/contracts",
        kind: "contract",
        visibility: "exported",
        module: "sample",
        evidence,
        sections: [{
          id: "contract",
          kind: "contract",
          title: "Contract",
          markdown: "The public API delegates requests to the client.",
          evidence,
        }],
        review: {
          title: "Sample contracts",
          summary: "Public contract and handoff.",
          signals: ["source-backed"],
          reason: "Review the contract.",
        },
      },
    });
    const approved = renderApprovedCodegraphMarkdown({
      record: { ...built.candidate, updated: "2026-08-26T00:00:00.000Z" },
      snapshot: {
        candidate_id: built.candidate.candidate_id,
        collection: "codeindex",
        source: "20260825/sample",
        source_refs: built.candidate.source_refs,
        markdown: built.markdown,
      },
      timestamp: "2026-08-26T00:00:00.000Z",
    });
    expect(approvedContextSectionsInMarkdown(approved)[0]?.refs).toHaveLength(2);
    expect(approved).toContain("context:source_refs");
  });

  test("rejects repeated whole-page evidence reused for distinct relationships", () => {
    const refs = ["repo:20260825/sample#symbol:src/index.ts:publicApi:function@abcdef012345"];
    const signals = pageSignals({
      metrics: {
        view_ref: "codeindex:sample/flow",
        module: "sample",
        path: "codeindex/sample/flow.md",
        candidate_fingerprint: "candidate",
        content_digest: "content",
        effective_chars: 500,
        section_count: 1,
        evidence_count: 1,
        section_scoped_evidence_count: 1,
        relation_count: 2,
        relation_evidence_count: 1,
        source_count: 1,
        line_count: 20,
        semantic_fact_lines: 10,
        table_fact_rows: 0,
        explanatory_lines: 5,
        implementation_body_lines: 0,
        template_residue_count: 0,
        placeholder_section_count: 0,
        referenced_file_count: 1,
        referenced_symbol_count: 1,
        referenced_files: ["src/index.ts"],
        referenced_symbols: ["publicApi"],
      },
      sourceNames: ["20260825/sample"],
      sectionEvidenceCounts: [1],
      sectionEvidenceGroups: [refs],
      pageEvidenceRefs: refs,
      sectionEffectiveChars: [500],
      relationEvidenceCounts: [1, 1],
      relationEvidenceGroups: [refs, refs],
      boilerplateParagraphs: [],
    }, { ...unit(), outputProfile: "cross-module-flow" });
    expect(signals.find((signal) => signal.code === "relation-evidence-not-scoped")).toMatchObject({
      absolute_gate: true,
      recommended_actions: ["add-relationship-evidence"],
    });
  });
});
