import { describe, expect, test } from "bun:test";
import { buildCodeIndexAuditView } from "../project/codeIndexAuditView.js";
import type { CodeIndexAuditStatus } from "../project/codeIndexAuditTypes.js";
import type { ExtractionBatchPreview } from "../project/extractCandidateTypes.js";
import { buildExtractionPreviewOutput } from "../project/extractionPreviewView.js";

const PREVIEW_DIGEST = `sha256:${"a".repeat(64)}`;
const AUDIT_DIGEST = `sha256:${"b".repeat(64)}`;

function largePreview(targets: readonly string[]): ExtractionBatchPreview {
  return {
    schema: "context.extraction-batch-preview.v1",
    digest: PREVIEW_DIGEST,
    createdAt: "2026-08-30T00:00:00.000Z",
    phases: [{
      kind: "context.extraction-phase-preview.v1",
      phaseKind: "phase.extract.custom",
      phaseId: "extract:fixture:codeindex",
      collection: "codeindex",
      indexUnits: [{
        id: "fixture",
        inputSources: ["repo:fixture"],
        outputOwner: "fixture",
        moduleType: "sdk-library",
        moduleTypes: ["sdk-library"],
        facets: ["public-api"],
        moduleTypeEvidence: ["README.md"],
        documents: ["README.md"],
        outputProfile: "public-api-reference",
        capability: "project-adapter",
        plan: "declared",
        responsibility: "Fixture public contracts.",
        entries: ["src/index.ts"],
        protocols: [],
        exclusions: [],
        lifecycle: "authoritative",
        currentPageCount: 0,
        projectedPageCount: targets.length,
        candidateEstimate: targets.length,
        changes: { added: targets.length, updated: 0, removed: 0, unchanged: 0, exact: true },
        scale: "warning",
        visibility: { exported: targets.length, internal: 0 },
        candidateKinds: { "public-contract": targets.length },
        topDirectories: [{ path: "src", count: targets.length }],
        contentBytes: { total: targets.length * 100, max: 100, sampled: false, topPages: [] },
        inventory: {
          basis: "ast",
          eligibleFiles: targets.length,
          analyzedFiles: targets.length,
          eligibleFileTargets: [...targets],
          analyzedFileTargets: [...targets],
          eligibleLoc: targets.length,
          analyzedLoc: targets.length,
          documentsDiscovered: 1,
          documentsRead: 1,
          documentTargets: ["README.md"],
          rootDocumentTargets: ["README.md"],
          readDocumentTargets: ["README.md"],
          referencedDocumentTargets: ["README.md"],
          symbolsDiscovered: targets.length,
          symbolsAnalyzed: targets.length,
          targetSymbols: targets.length,
          exportedSymbols: targets.length,
          targetSymbolIdentities: [...targets],
          exportedTargetIdentities: [...targets],
          entryTargets: ["src/index.ts"],
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
      }],
      sources: [{
        name: "fixture",
        ref: "fixture-ref",
        scopeHash: "scope-hash",
        materializedAt: "2026-08-30T00:00:00.000Z",
      }],
      inspection: { findings: [], capabilityGaps: [], inventories: [], structuralProbes: [] },
      totals: {
        sources: 1,
        candidates: targets.length,
        evidence: targets.length,
        relations: 0,
        contentBytes: targets.length * 100,
      },
      agent_hints: [],
    }],
    totals: {
      phases: 1,
      indexUnits: 1,
      projectedPages: targets.length,
      contentBytes: targets.length * 100,
      warnings: 1,
      blocked: 0,
    },
    advisories: ["batch-page-count-warning"],
    capabilityClear: true,
    ownershipClear: true,
    scaleClear: true,
    cache: { root: ".tmp/context-runtime/extract/previews", reusablePhases: 1, hits: 1, extractorInvocations: 0, previewDurationMs: 1 },
  };
}

function largeAudit(affectedPages: readonly string[]): CodeIndexAuditStatus {
  const page = {
    view_ref: "codeindex:fixture/page-0000",
    module: "fixture",
    path: "codeindex/fixture/page-0000.md",
    candidate_fingerprint: "candidate-fixture",
    content_digest: "content-fixture",
    effective_chars: 100,
    section_count: 1,
    evidence_count: 1,
    section_scoped_evidence_count: 1,
    relation_count: 0,
    relation_evidence_count: 0,
    source_count: 1,
    line_count: 10,
    semantic_fact_lines: 2,
    table_fact_rows: 0,
    explanatory_lines: 8,
    catalog_lines: 0,
    evidence_enumeration_lines: 0,
    templated_observation_lines: 0,
    normalized_template_repetition_lines: 0,
    reader_content_lines: 10,
    implementation_body_lines: 0,
    template_residue_count: 0,
    placeholder_section_count: 0,
    referenced_file_count: 1,
    referenced_symbol_count: 1,
    referenced_files: ["src/index.ts"],
    referenced_symbols: ["fixture|entry"],
  };
  return {
    applicable: true,
    current: true,
    resolved: false,
    revision_required: false,
    input_required: false,
    guidance_required: false,
    guidance_units: [],
    report: {
      schema: "context.code-index-audit-report.v2",
      digest: AUDIT_DIGEST,
      scope_digest: `sha256:${"c".repeat(64)}`,
      source: "draft-and-approved",
      summary: {
        units: 1,
        pages: affectedPages.length,
        effective_chars: affectedPages.length * 100,
        evidence: affectedPages.length,
        sections: affectedPages.length,
        relations: 0,
        signals: 1,
        elevated_signals: 1,
      },
      units: [{
        id: "fixture",
        output_owner: "fixture",
        output_profile: "public-api-reference",
        module_types: ["sdk-library"],
        input_sources: ["repo:fixture"],
        page_count: affectedPages.length,
        effective_chars: affectedPages.length * 100,
        evidence_count: affectedPages.length,
        section_count: affectedPages.length,
        relation_count: 0,
        covered_sources: ["repo:fixture"],
        uncovered_sources: [],
        signal_count: 1,
        elevated_signal_count: 1,
        dimensions: [{
          dimension: "semantic-fact-lines",
          observed: 2,
          unit: "lines",
          floor: 8,
          target: 12,
          ceiling: null,
          score: 0.25,
          status: "below-floor",
          absolute_gate: true,
          evidence: { affected_pages: [...affectedPages] },
          recommended_actions: ["add-source-backed-explanation"],
        }],
        problem_fingerprint: "problem-fixture",
        absolute_failure_count: 1,
        below_target_count: 1,
        max_page_lines: 10,
        recommended_actions: ["add-source-backed-explanation"],
        action_guidance: [{
          action: "add-source-backed-explanation",
          failed_dimensions: ["semantic-fact-lines"],
          affected_pages: [...affectedPages],
          template_paths: ["resources/semantic/code-index/templates/contracts-and-chains.md"],
          configuration_fields: ["indexUnits[].sections"],
          expected_improvement: ["Increase source-backed semantic fact density."],
        }],
      }],
      pages: affectedPages.map((viewRef, index) => ({
        ...page,
        view_ref: viewRef,
        path: `${viewRef.replace("codeindex:", "codeindex/")}.md`,
        candidate_fingerprint: `candidate-${index}`,
        content_digest: `content-${index}`,
      })),
      page_samples: [page],
      signals: [{
        id: "signal-fixture",
        code: "semantic-fact-lines-below-floor",
        severity: "elevated",
        unit_id: "fixture",
        view_ref: affectedPages[0]!,
        message: "The fixture is below the semantic fact floor.",
        metrics: { observed: 2, floor: 8 },
        absolute_gate: true,
        recommended_actions: ["add-source-backed-explanation"],
      }],
      review_requirements: {
        compare_registered_sources_with_user_scope: true,
        inspect_signal_samples: true,
        choose: ["accept", "revise", "request-input"],
      },
    },
  };
}

describe("0.7.0 budget-safe large report views", () => {
  test("keeps extraction preview stdout bounded and pages every exact target identity", () => {
    const targets = Array.from({ length: 600 }, (_, index) => `src/component-${String(index).padStart(4, "0")}.ts`);
    const preview = largePreview(targets);
    const summary = buildExtractionPreviewOutput(preview);
    expect(Buffer.byteLength(JSON.stringify(summary, null, 2))).toBeLessThanOrEqual(24_000);
    expect(JSON.stringify(summary)).not.toContain(targets.at(-1)!);

    const returned = new Set<string>();
    let pageToken = "0";
    for (;;) {
      const page = buildExtractionPreviewOutput(preview, {
        view: "items",
        itemKind: "target-symbol",
        pageSize: "40",
        pageToken,
      }) as {
        page: { next_token?: string };
        items: { items: Array<{ item_id: string; text: string }> };
        next_action: { kind: string };
      };
      expect(Buffer.byteLength(JSON.stringify(page, null, 2))).toBeLessThanOrEqual(24_000);
      for (const item of page.items.items) {
        expect(returned.has(item.item_id)).toBe(false);
        returned.add(item.item_id);
      }
      if (page.next_action.kind === "preview_items_complete") break;
      expect(page.next_action.kind).toBe("read_next_preview_items_page");
      pageToken = page.page.next_token!;
    }
    expect(returned.size).toBe(targets.length);
  });

  test("keeps audit output bounded and exposes every long guidance association", () => {
    const affectedPages = Array.from({ length: 500 }, (_, index) => `codeindex:fixture/page-${String(index).padStart(4, "0")}`);
    const status = largeAudit(affectedPages);
    const summary = buildCodeIndexAuditView(status);
    expect(Buffer.byteLength(JSON.stringify(summary, null, 2))).toBeLessThanOrEqual(24_000);
    expect(JSON.stringify(summary)).not.toContain(affectedPages.at(-1)!);

    const returned = new Set<string>();
    let pageToken = "0";
    for (;;) {
      const page = buildCodeIndexAuditView(status, {
        view: "items",
        reportDigest: AUDIT_DIGEST,
        itemKind: "guidance-affected-page",
        pageSize: "20",
        pageToken,
      }) as {
        page: { next_token?: string };
        items: { items: Array<{ item_id: string; text: string }> };
        next_action: { kind: string };
      };
      expect(Buffer.byteLength(JSON.stringify(page, null, 2))).toBeLessThanOrEqual(24_000);
      for (const item of page.items.items) {
        expect(returned.has(item.item_id)).toBe(false);
        returned.add(item.item_id);
      }
      if (page.next_action.kind === "audit_items_complete") break;
      expect(page.next_action.kind).toBe("read_next_audit_items_page");
      pageToken = page.page.next_token!;
    }
    expect(returned.size).toBe(affectedPages.length);
  });

  test("rejects a stale digest before returning a later audit page", () => {
    const status = largeAudit(["codeindex:fixture/page-0000"]);
    expect(() => buildCodeIndexAuditView(status, {
      view: "items",
      reportDigest: `sha256:${"d".repeat(64)}`,
      pageToken: "0",
    })).toThrow("report changed while reading");
  });
});
