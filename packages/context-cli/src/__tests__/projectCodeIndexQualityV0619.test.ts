import { describe, expect, test } from "bun:test";
import type { CustomCodeCandidateDraft, ExtractCustomPhaseDefinition } from "@c4a/context";
import { auditDimensions, measureCodeIndexMarkdown } from "../project/codeIndexAuditMetrics.js";
import { pageSignals } from "../project/codeIndexAudit.js";
import { buildCodeIndexActionGuidance } from "../project/codeIndexAuditGuidance.js";
import { candidateFromCustom } from "../project/customCandidateDraft.js";
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
        catalog_lines: measured.catalogLines,
        evidence_enumeration_lines: measured.evidenceEnumerationLines,
        templated_observation_lines: measured.templatedObservationLines,
        normalized_template_repetition_lines: measured.normalizedTemplateRepetitionLines,
        reader_content_lines: measured.readerContentLines,
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
        catalog_lines: 0,
        evidence_enumeration_lines: 0,
        templated_observation_lines: 0,
        normalized_template_repetition_lines: 0,
        reader_content_lines: 1,
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
        catalog_lines: 0,
        evidence_enumeration_lines: 0,
        templated_observation_lines: 0,
        normalized_template_repetition_lines: 0,
        reader_content_lines: 52,
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
        catalog_lines: 0,
        evidence_enumeration_lines: 0,
        templated_observation_lines: 0,
        normalized_template_repetition_lines: 0,
        reader_content_lines: 4,
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

  test("does not let templated observations increase semantic fact density", () => {
    const measured = measureCodeIndexMarkdown([
      "Observed `Alpha` in `src/a.ts`.",
      "Observed `Beta` in `src/b.ts`.",
      "Observed `Gamma` in `src/c.ts`.",
      "The `sample.entry` route delegates validated input to `sample.service` and returns its stable result.",
    ].join("\n"));
    expect(measured.templatedObservationLines).toBe(3);
    expect(measured.normalizedTemplateRepetitionLines).toBe(3);
    expect(Object.values(measured.normalizedTemplateHistogram)).toEqual([3]);
    expect(measured.semanticFactLines).toBe(1);
    expect(measured.explanatoryLines).toBe(1);
  });

  test("detects one normalized observation template repeated across multiple pages", () => {
    const pages = ["Alpha", "Beta", "Gamma"].map((name) => {
      const measured = measureCodeIndexMarkdown(`Observed \`${name}\` in \`src/${name.toLowerCase()}.ts\`.`);
      return {
        view_ref: `codeindex:sample/${name.toLowerCase()}`,
        module: "sample",
        path: `codeindex/sample/${name.toLowerCase()}.md`,
        candidate_fingerprint: name,
        content_digest: name,
        effective_chars: 40,
        section_count: 1,
        evidence_count: 1,
        section_scoped_evidence_count: 1,
        relation_count: 0,
        relation_evidence_count: 0,
        source_count: 1,
        line_count: measured.lineCount,
        semantic_fact_lines: measured.semanticFactLines,
        table_fact_rows: measured.tableFactRows,
        explanatory_lines: measured.explanatoryLines,
        catalog_lines: measured.catalogLines,
        evidence_enumeration_lines: measured.evidenceEnumerationLines,
        templated_observation_lines: measured.templatedObservationLines,
        normalized_template_repetition_lines: measured.normalizedTemplateRepetitionLines,
        normalized_template_histogram: measured.normalizedTemplateHistogram,
        reader_content_lines: measured.readerContentLines,
        implementation_body_lines: measured.implementationBodyLines,
        template_residue_count: measured.templateResidueCount,
        placeholder_section_count: measured.placeholderSectionCount,
        referenced_file_count: 1,
        referenced_symbol_count: 1,
        referenced_files: [`src/${name.toLowerCase()}.ts`],
        referenced_symbols: [name],
      };
    });
    const inspected = unit();
    inspected.outputProfile = "module-map";
    const repetition = auditDimensions({ unit: inspected, pages })
      .find((item) => item.dimension === "normalized-template-repetition-ratio");
    expect(repetition?.status).toBe("above-ceiling");
    expect(repetition?.evidence.repeated_template_fingerprints).toHaveLength(1);
  });

  test("applies stricter enumeration limits to module maps than public references", () => {
    const page = {
      view_ref: "codeindex:sample/module",
      module: "sample",
      path: "codeindex/sample/module.md",
      candidate_fingerprint: "candidate",
      content_digest: "content",
      effective_chars: 500,
      section_count: 2,
      evidence_count: 8,
      section_scoped_evidence_count: 8,
      relation_count: 0,
      relation_evidence_count: 0,
      source_count: 1,
      line_count: 20,
      semantic_fact_lines: 8,
      table_fact_rows: 6,
      explanatory_lines: 4,
      catalog_lines: 6,
      evidence_enumeration_lines: 2,
      templated_observation_lines: 2,
      normalized_template_repetition_lines: 2,
      reader_content_lines: 14,
      implementation_body_lines: 0,
      template_residue_count: 0,
      placeholder_section_count: 0,
      referenced_file_count: 8,
      referenced_symbol_count: 8,
      referenced_files: ["src/index.ts"],
      referenced_symbols: ["publicApi"],
    };
    const moduleDimensions = auditDimensions({
      unit: { ...unit(), outputProfile: "module-map" },
      pages: [page],
    });
    const referenceDimensions = auditDimensions({ unit: unit(), pages: [page] });
    expect(moduleDimensions.find((item) => item.dimension === "enumeration-ratio")?.absolute_gate).toBe(true);
    expect(referenceDimensions.find((item) => item.dimension === "enumeration-ratio")?.absolute_gate).toBe(false);
  });

  test("covers target identities through a source-constrained reader group without prose enumeration", () => {
    const grouped = unit();
    grouped.inventory.symbolsDiscovered = 2;
    grouped.inventory.symbolsAnalyzed = 2;
    grouped.inventory.targetSymbols = 2;
    grouped.inventory.targetSymbolIdentities = ["createClient", "closeClient"];
    grouped.inventory.identityGroups = [{
      id: "client-lifecycle",
      members: ["createClient", "closeClient"],
      viewRef: "codeindex:sample/lifecycle",
      sourceFiles: ["src/file-0.ts"],
    }];
    const dimensions = auditDimensions({
      unit: grouped,
      pages: [{
        view_ref: "codeindex:sample/lifecycle",
        module: "sample",
        path: "codeindex/sample/lifecycle.md",
        candidate_fingerprint: "candidate",
        content_digest: "content",
        effective_chars: 120,
        section_count: 1,
        evidence_count: 1,
        section_scoped_evidence_count: 1,
        relation_count: 0,
        relation_evidence_count: 0,
        source_count: 1,
        line_count: 8,
        semantic_fact_lines: 3,
        table_fact_rows: 0,
        explanatory_lines: 4,
        catalog_lines: 0,
        evidence_enumeration_lines: 0,
        templated_observation_lines: 0,
        normalized_template_repetition_lines: 0,
        reader_content_lines: 7,
        implementation_body_lines: 0,
        template_residue_count: 0,
        placeholder_section_count: 0,
        referenced_file_count: 1,
        referenced_symbol_count: 0,
        referenced_files: ["src/file-0.ts"],
        referenced_symbols: [],
      }],
    });
    expect(dimensions.find((item) => item.dimension === "identity-group-evidence-coverage")?.status).toBe("target");
    expect(dimensions.find((item) => item.dimension === "target-symbol-coverage")?.status).toBe("above-target");
  });

  test("requires every chain candidate decision and an evidence-backed representative external chain", () => {
    const chained = unit();
    chained.inventory.chainCandidates = [{
      id: "handler-to-client",
      family: "handler-downstream",
      from: "handleRequest",
      to: "remoteClient.fetch",
      sourceFiles: ["src/file-0.ts"],
      confidence: "structural",
    }];
    const page = {
      view_ref: "codeindex:sample/request-flow",
      module: "sample",
      path: "codeindex/sample/request-flow.md",
      candidate_fingerprint: "candidate",
      content_digest: "content",
      effective_chars: 120,
      section_count: 1,
      evidence_count: 1,
      section_scoped_evidence_count: 1,
      relation_count: 1,
      relation_evidence_count: 1,
      source_count: 1,
      line_count: 8,
      semantic_fact_lines: 3,
      table_fact_rows: 0,
      explanatory_lines: 4,
      catalog_lines: 0,
      evidence_enumeration_lines: 0,
      templated_observation_lines: 0,
      normalized_template_repetition_lines: 0,
      reader_content_lines: 7,
      implementation_body_lines: 0,
      template_residue_count: 0,
      placeholder_section_count: 0,
      referenced_file_count: 1,
      referenced_symbol_count: 2,
      referenced_files: ["src/file-0.ts"],
      referenced_symbols: ["handleRequest", "remoteClient.fetch"],
    };
    const missing = auditDimensions({ unit: chained, pages: [page] });
    expect(missing.find((item) => item.dimension === "chain-candidate-decision-coverage")?.status).toBe("below-floor");
    expect(missing.find((item) => item.dimension === "external-boundary-family-closure")?.status).toBe("below-floor");

    chained.inventory.chainCandidateDecisions = [{
      candidateId: "handler-to-client",
      decision: "document",
      viewRef: page.view_ref,
    }];
    const closed = auditDimensions({ unit: chained, pages: [page] });
    expect(closed.find((item) => item.dimension === "chain-candidate-decision-coverage")?.status).toBe("target");
    expect(closed.find((item) => item.dimension === "external-boundary-family-closure")?.status).toBe("target");
  });

  test("does not allow an empty candidate list to bypass adjacent boundary families", () => {
    const inspected = unit();
    inspected.inventory.boundaryTargets = [
      { kind: "operation", identity: "readItem" },
      { kind: "handler", identity: "handleRead" },
      { kind: "downstream", identity: "store.load" },
    ];
    const missing = auditDimensions({ unit: inspected, pages: [] });
    expect(missing.find((item) => item.dimension === "chain-candidate-family-discovery")?.status).toBe("below-floor");

    inspected.inventory.chainCandidates = [
      {
        id: "operation-handler",
        family: "operation-handler",
        from: "readItem",
        to: "handleRead",
        sourceFiles: ["src/file-0.ts"],
        confidence: "structural",
      },
      {
        id: "handler-downstream",
        family: "handler-downstream",
        from: "handleRead",
        to: "store.load",
        sourceFiles: ["src/file-0.ts"],
        confidence: "structural",
      },
    ];
    const discovered = auditDimensions({ unit: inspected, pages: [] });
    expect(discovered.find((item) => item.dimension === "chain-candidate-family-discovery")?.status).toBe("target");
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
        catalog_lines: 0,
        evidence_enumeration_lines: 0,
        templated_observation_lines: 0,
        normalized_template_repetition_lines: 0,
        reader_content_lines: 15,
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
