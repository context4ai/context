import { stableHash } from "./extractCandidateArtifacts.js";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";
import { readLatestExtractionBatchPreview } from "./extractionPreviewCache.js";
import { buildCodeIndexActionGuidance } from "./codeIndexAuditGuidance.js";
import {
  proposedCodeIndexAuditPages,
  type AuditedPage,
} from "./codeIndexAuditPages.js";
import { auditDimensions, measureCodeIndexMarkdown } from "./codeIndexAuditMetrics.js";
import type {
  CodeIndexAuditReport,
  CodeIndexAuditSignal,
  CodeIndexAuditUnitReport,
} from "./codeIndexAuditTypes.js";
export { effectiveMarkdownChars } from "./codeIndexAuditPages.js";

export const CODE_INDEX_AUDIT_STATE_PATH = ".tmp/context-runtime/code-index-audit/state.json";

const PAGE_SIGNAL_SAMPLE_LIMIT = 50;
const AGGREGATE_OUTPUT_PROFILES = new Set([
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

export type {
  CodeIndexAuditDecision,
  CodeIndexAuditApplyResult,
  CodeIndexAuditDecisionPayload,
  CodeIndexAuditPageMetrics,
  CodeIndexAuditRecord,
  CodeIndexAuditReport,
  CodeIndexAuditRetryEntry,
  CodeIndexAuditSignal,
  CodeIndexAuditSignalAssessment,
  CodeIndexAuditSignalSeverity,
  CodeIndexAuditStatus,
  CodeIndexAuditUnitReport,
} from "./codeIndexAuditTypes.js";
export {
  applyCodeIndexAuditDecision,
  collectCodeIndexAuditStatus,
} from "./codeIndexAuditState.js";

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function unitForPage(
  page: AuditedPage,
  units: readonly ExtractionIndexUnitPreview[],
): ExtractionIndexUnitPreview | undefined {
  return units.find((unit) => unit.id === page.metrics.module || unit.outputOwner === page.metrics.module);
}

function signalId(code: string, unitId: string, viewRef?: string): string {
  return `${code}:${stableHash({ unitId, viewRef }, 12)}`;
}

export function pageSignals(page: AuditedPage, unit: ExtractionIndexUnitPreview | undefined): CodeIndexAuditSignal[] {
  const outputProfile = unit?.outputProfile ?? "module-map";
  if (!AGGREGATE_OUTPUT_PROFILES.has(outputProfile)) return [];
  const metrics = page.metrics;
  const signals: CodeIndexAuditSignal[] = [];
  const unitId = unit?.id ?? metrics.module;
  const unscopedEvidence = Math.max(0, metrics.evidence_count - metrics.section_scoped_evidence_count);
  const pageEvidenceKey = page.pageEvidenceRefs.join("\n");
  const everySectionUsesWholePage = page.sectionEvidenceGroups.length > 1 &&
    page.pageEvidenceRefs.length > 1 &&
    page.sectionEvidenceGroups.every((refs) => refs.join("\n") === pageEvidenceKey);
  if (everySectionUsesWholePage) {
    signals.push({
      id: signalId("section-evidence-not-scoped", unitId, metrics.view_ref),
      code: "section-evidence-not-scoped",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "Every reader-facing section repeats the complete page evidence set instead of citing its own supporting subset.",
      metrics: {
        sections: page.sectionEvidenceGroups.length,
        evidence: page.pageEvidenceRefs.length,
      },
      absolute_gate: true,
      recommended_actions: ["scope-section-evidence"],
    });
  }
  if (metrics.evidence_count >= 100 && metrics.effective_chars < 500) {
    signals.push({
      id: signalId("evidence-heavy-thin-body", unitId, metrics.view_ref),
      code: "evidence-heavy-thin-body",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "The aggregate page carries at least 100 evidence items but less than 500 effective prose characters.",
      metrics: { evidence: metrics.evidence_count, effective_chars: metrics.effective_chars },
    });
  } else if (metrics.evidence_count >= 100 && metrics.effective_chars / metrics.evidence_count < 10) {
    signals.push({
      id: signalId("low-prose-per-evidence", unitId, metrics.view_ref),
      code: "low-prose-per-evidence",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "The aggregate page has very little explanatory prose relative to a large evidence set.",
      metrics: {
        evidence: metrics.evidence_count,
        effective_chars: metrics.effective_chars,
        chars_per_evidence: Number((metrics.effective_chars / metrics.evidence_count).toFixed(2)),
      },
    });
  } else if (metrics.evidence_count >= 50 && metrics.effective_chars / metrics.evidence_count < 8) {
    signals.push({
      id: signalId("low-prose-per-evidence", unitId, metrics.view_ref),
      code: "low-prose-per-evidence",
      severity: "advisory",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "The aggregate page has little explanatory prose relative to its evidence set.",
      metrics: {
        evidence: metrics.evidence_count,
        effective_chars: metrics.effective_chars,
        chars_per_evidence: Number((metrics.effective_chars / metrics.evidence_count).toFixed(2)),
      },
    });
  }
  if (metrics.evidence_count >= 50 && unscopedEvidence / metrics.evidence_count >= 0.8) {
    signals.push({
      id: signalId("page-level-evidence-overbroad", unitId, metrics.view_ref),
      code: "page-level-evidence-overbroad",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "At least 80% of the page evidence is not scoped to a specific section.",
      metrics: {
        evidence: metrics.evidence_count,
        section_scoped_evidence: metrics.section_scoped_evidence_count,
        unscoped_evidence: unscopedEvidence,
      },
      absolute_gate: true,
      recommended_actions: ["scope-section-evidence"],
    });
  }
  const unsupportedSections = page.sectionEvidenceCounts.filter((count) => count === 0).length;
  if (unsupportedSections > 0) {
    signals.push({
      id: signalId("section-without-evidence", unitId, metrics.view_ref),
      code: "section-without-evidence",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "One or more reader-facing sections have no section-scoped source evidence.",
      metrics: { unsupported_sections: unsupportedSections, sections: page.sectionEvidenceCounts.length },
      absolute_gate: true,
      recommended_actions: ["scope-section-evidence", "remove-template-residue"],
    });
  }
  page.sectionEvidenceCounts.forEach((count, index) => {
    const chars = page.sectionEffectiveChars[index] ?? 0;
    if (count < 25 || chars >= 240) return;
    signals.push({
      id: signalId(`thin-evidence-heavy-section-${index}`, unitId, metrics.view_ref),
      code: "thin-evidence-heavy-section",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "A section cites at least 25 evidence items but contains less than 240 effective prose characters.",
      metrics: { section_index: index, evidence: count, effective_chars: chars },
    });
  });
  page.relationEvidenceCounts.forEach((count, index) => {
    if (count < 50) return;
    signals.push({
      id: signalId(`relation-evidence-overbroad-${index}`, unitId, metrics.view_ref),
      code: "relation-evidence-overbroad",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "A structured relationship cites at least 50 evidence items and should be narrowed to the concrete handoff.",
      metrics: { relation_index: index, evidence: count },
    });
  });
  const relationEvidenceKeys = page.relationEvidenceGroups.map((refs) => refs.join("\n"));
  const repeatedRelationEvidence = relationEvidenceKeys.filter((key, index) =>
    key.length > 0 && relationEvidenceKeys.indexOf(key) !== index
  ).length;
  if (repeatedRelationEvidence > 0) {
    signals.push({
      id: signalId("relation-evidence-not-scoped", unitId, metrics.view_ref),
      code: "relation-evidence-not-scoped",
      severity: "elevated",
      unit_id: unitId,
      view_ref: metrics.view_ref,
      message: "Multiple structured relationships repeat the same complete evidence set instead of citing the concrete handoff for each destination.",
      metrics: {
        relations: page.relationEvidenceGroups.length,
        repeated_relations: repeatedRelationEvidence,
      },
      absolute_gate: true,
      recommended_actions: ["add-relationship-evidence"],
    });
  }
  return signals;
}

function unitReport(input: {
  unit: ExtractionIndexUnitPreview;
  pages: readonly AuditedPage[];
  signals: readonly CodeIndexAuditSignal[];
}): CodeIndexAuditUnitReport {
  const pages = input.pages.filter((page) => unitForPage(page, [input.unit]) !== undefined);
  const coveredSources = stableUnique(pages.flatMap((page) => page.sourceNames));
  const uncoveredSources = input.unit.inputSources.filter((source) => !coveredSources.includes(source));
  const signals = input.signals.filter((signal) => signal.unit_id === input.unit.id);
  const pageMetrics = pages.map((page) => page.metrics);
  const dimensions = auditDimensions({ unit: input.unit, pages: pageMetrics });
  return {
    id: input.unit.id,
    output_owner: input.unit.outputOwner,
    output_profile: input.unit.outputProfile,
    module_types: [...input.unit.moduleTypes],
    input_sources: [...input.unit.inputSources],
    page_count: pages.length,
    effective_chars: pages.reduce((sum, page) => sum + page.metrics.effective_chars, 0),
    evidence_count: pages.reduce((sum, page) => sum + page.metrics.evidence_count, 0),
    section_count: pages.reduce((sum, page) => sum + page.metrics.section_count, 0),
    relation_count: pages.reduce((sum, page) => sum + page.metrics.relation_count, 0),
    covered_sources: coveredSources,
    uncovered_sources: uncoveredSources,
    signal_count: signals.length,
    elevated_signal_count: signals.filter((signal) => signal.severity === "elevated").length,
    dimensions,
    problem_fingerprint: "",
    absolute_failure_count: 0,
    below_target_count: 0,
    max_page_lines: Math.max(0, ...pages.map((page) => page.metrics.line_count)),
    recommended_actions: [],
    action_guidance: buildCodeIndexActionGuidance({ dimensions, pages: pageMetrics, signals }),
  };
}

function dimensionSignals(unit: CodeIndexAuditUnitReport): CodeIndexAuditSignal[] {
  return unit.dimensions
    .filter((dimension) =>
      dimension.absolute_gate ||
      dimension.status === "below-target" ||
      (dimension.status === "above-target" && (
        dimension.dimension === "max-page-lines" ||
        dimension.dimension === "implementation-body-ratio" ||
        dimension.dimension === "enumeration-ratio" ||
        dimension.dimension === "normalized-template-repetition-ratio"
      ))
    )
    .map((dimension) => ({
      id: signalId(`dimension-${dimension.dimension}`, unit.id),
      code: `dimension-${dimension.dimension}`,
      severity: dimension.absolute_gate ? "elevated" : "advisory",
      unit_id: unit.id,
      message: dimension.absolute_gate
        ? `The ${dimension.dimension} dimension is outside its absolute quality bounds.`
        : dimension.status === "above-target"
          ? `The ${dimension.dimension} dimension is above its recommended maximum target.`
          : `The ${dimension.dimension} dimension has not reached its recommended target.`,
      metrics: {
        observed: dimension.observed ?? "unscorable",
        floor: dimension.floor ?? "none",
        target: dimension.target ?? "none",
        ceiling: dimension.ceiling ?? "none",
        status: dimension.status,
      },
      absolute_gate: dimension.absolute_gate,
      recommended_actions: dimension.recommended_actions,
    }));
}

function unitSignals(unit: ExtractionIndexUnitPreview, pages: readonly AuditedPage[]): CodeIndexAuditSignal[] {
  const matching = pages.filter((page) => unitForPage(page, [unit]) !== undefined);
  const signals: CodeIndexAuditSignal[] = [];
  if (matching.length === 0) {
    signals.push({
      id: signalId("index-unit-without-pages", unit.id),
      code: "index-unit-without-pages",
      severity: "elevated",
      unit_id: unit.id,
      message: "The declared index unit produced no current knowledge page.",
      metrics: { pages: 0, input_sources: unit.inputSources.length },
      absolute_gate: true,
      recommended_actions: ["expand-input-scope", "add-module-explanation"],
    });
  }
  const coveredSources = stableUnique(matching.flatMap((page) => page.sourceNames));
  const uncovered = unit.inputSources.filter((source) => !coveredSources.includes(source));
  if (uncovered.length > 0) {
    signals.push({
      id: signalId("index-unit-source-uncovered", unit.id),
      code: "index-unit-source-uncovered",
      severity: "elevated",
      unit_id: unit.id,
      message: "One or more declared input sources do not contribute evidence to the index unit.",
      metrics: { uncovered_sources: uncovered.join(","), covered_sources: coveredSources.length },
      absolute_gate: true,
      recommended_actions: ["expand-input-scope", "correct-exclusions"],
    });
  }
  if (
    unit.outputProfile === "cross-module-flow" &&
    unit.inputSources.length >= 3 &&
    matching.reduce((sum, page) => sum + page.metrics.relation_count, 0) < unit.inputSources.length - 1
  ) {
    signals.push({
      id: signalId("cross-module-relations-sparse", unit.id),
      code: "cross-module-relations-sparse",
      severity: "elevated",
      unit_id: unit.id,
      message: "The cross-module flow has fewer structured handoffs than the minimum needed to connect its declared sources.",
      metrics: {
        input_sources: unit.inputSources.length,
        relations: matching.reduce((sum, page) => sum + page.metrics.relation_count, 0),
      },
      absolute_gate: true,
      recommended_actions: ["connect-adjacent-handoffs"],
    });
  }
  return signals;
}

function inferredUnit(page: AuditedPage): ExtractionIndexUnitPreview {
  return {
    id: page.metrics.module,
    inputSources: page.sourceNames,
    outputOwner: page.metrics.module,
    moduleType: "unknown",
    moduleTypes: ["unknown"],
    facets: [],
    moduleTypeEvidence: [],
    documents: [],
    outputProfile: "module-map",
    capability: "project-adapter",
    plan: "inferred",
    responsibility: "Audit the current approved code index.",
    entries: [],
    protocols: [],
    exclusions: [],
    lifecycle: "authoritative",
    currentPageCount: 1,
    projectedPageCount: 1,
    candidateEstimate: 1,
    changes: { added: 0, updated: 0, removed: 0, unchanged: 1, exact: true },
    scale: "normal",
    visibility: { exported: 0, internal: 0 },
    candidateKinds: {},
    topDirectories: [],
    contentBytes: { total: 0, max: 0, sampled: false, topPages: [] },
    inventory: {
      basis: "evidence-only",
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
    risks: ["audit-plan-inferred"],
  };
}

export async function buildCodeIndexAuditReport(projectRoot: string): Promise<CodeIndexAuditReport | undefined> {
  const proposed = await proposedCodeIndexAuditPages(projectRoot);
  const preview = await readLatestExtractionBatchPreview(projectRoot);
  const declaredUnits = preview?.phases.flatMap((phase) => phase.indexUnits) ?? [];
  const inferredUnits = proposed.pages
    .filter((page) => unitForPage(page, declaredUnits) === undefined)
    .map(inferredUnit);
  const units = [...new Map([...declaredUnits, ...inferredUnits].map((unit) => [unit.id, unit])).values()];
  if (units.length === 0 && proposed.pages.length === 0) return undefined;
  const paragraphPages = new Map<string, string[]>();
  for (const page of proposed.pages) for (const paragraph of page.boilerplateParagraphs) {
    paragraphPages.set(paragraph, [...(paragraphPages.get(paragraph) ?? []), page.metrics.view_ref]);
  }
  const repeatedParagraphs = [...paragraphPages.entries()].filter(([, pages]) => new Set(pages).size >= 3);
  for (const [paragraph, viewRefs] of repeatedParagraphs) {
    const repeatedFacts = measureCodeIndexMarkdown(paragraph).semanticFactLines;
    if (repeatedFacts === 0) continue;
    for (const viewRef of new Set(viewRefs)) {
      const page = proposed.pages.find((candidate) => candidate.metrics.view_ref === viewRef);
      if (page === undefined) continue;
      page.metrics.semantic_fact_lines = Math.max(0, page.metrics.semantic_fact_lines - repeatedFacts);
      page.metrics.repeated_boilerplate_fact_lines = (page.metrics.repeated_boilerplate_fact_lines ?? 0) + repeatedFacts;
    }
  }
  const boilerplateSignals = repeatedParagraphs.flatMap(([paragraph, pages]) => [...new Set(pages)].map((viewRef) => {
    const page = proposed.pages.find((candidate) => candidate.metrics.view_ref === viewRef)!;
    const unit = unitForPage(page, units);
    return {
      id: signalId("cross-page-boilerplate", unit?.id ?? page.metrics.module, viewRef),
      code: "cross-page-boilerplate",
      severity: "elevated" as const,
      unit_id: unit?.id ?? page.metrics.module,
      view_ref: viewRef,
      message: "The same generic paragraph appears in at least three code-index pages without a module-specific locator.",
      metrics: { repeated_pages: new Set(pages).size, paragraph_digest: stableHash(paragraph, 12) },
      absolute_gate: true,
      recommended_actions: ["remove-template-residue"],
    };
  }));
  const pageSignalList = [
    ...proposed.pages.flatMap((page) => pageSignals(page, unitForPage(page, units))),
    ...boilerplateSignals,
  ];
  const baseSignals = [...pageSignalList, ...units.flatMap((unit) => unitSignals(unit, proposed.pages))];
  const initialUnitReports = units.map((unit) => unitReport({ unit, pages: proposed.pages, signals: baseSignals }));
  const sourceRevisions = new Map(units.map((unit) => [unit.id, stableUnique(
    (preview?.phases ?? []).flatMap((phase) => {
      if (!phase.indexUnits.some((candidate) => candidate.id === unit.id)) return [];
      return phase.sources
        .filter((source) => unit.inputSources.includes(source.name))
        .map((source) => `${source.name}@${source.head ?? source.ref}#${source.scopeHash}`);
    }),
  )]));
  const signals = [...baseSignals, ...initialUnitReports.flatMap(dimensionSignals)]
    .sort((left, right) =>
      (left.severity === right.severity ? 0 : left.severity === "elevated" ? -1 : 1) ||
      left.unit_id.localeCompare(right.unit_id) ||
      (left.view_ref ?? "").localeCompare(right.view_ref ?? "") ||
      left.code.localeCompare(right.code)
    );
  const unitReports = initialUnitReports.map((unit) => {
    const unitSignals = signals.filter((signal) => signal.unit_id === unit.id);
    const absoluteFailures = unit.dimensions.filter((dimension) => dimension.absolute_gate);
    const absoluteSignalFailures = unitSignals.filter((signal) => signal.absolute_gate === true);
    const belowTargets = unit.dimensions.filter((dimension) =>
      dimension.status === "below-target" || dimension.status === "above-ceiling" || (
        dimension.status === "above-target" && (
          dimension.dimension === "max-page-lines" ||
          dimension.dimension === "implementation-body-ratio"
        )
      )
    );
    const recommendedActions = stableUnique([
      ...unit.dimensions.flatMap((dimension) =>
        dimension.absolute_gate || dimension.status === "below-target" || dimension.status === "above-ceiling" || (
          dimension.status === "above-target" && (
            dimension.dimension === "max-page-lines" ||
            dimension.dimension === "implementation-body-ratio"
          )
        )
          ? dimension.recommended_actions
          : []
      ),
      ...unitSignals.flatMap((signal) => signal.recommended_actions ?? []),
    ]);
    const problemFingerprint = stableHash({
      unit: unit.id,
      profile: unit.output_profile,
      sources: unit.input_sources,
      source_revisions: sourceRevisions.get(unit.id) ?? [],
      absolute_dimensions: absoluteFailures.map((dimension) => dimension.dimension).sort(),
      absolute_signals: absoluteSignalFailures.map((signal) => signal.code).sort(),
    });
    return {
      ...unit,
      signal_count: unitSignals.length,
      elevated_signal_count: unitSignals.filter((signal) => signal.severity === "elevated").length,
      problem_fingerprint: problemFingerprint,
      absolute_failure_count: absoluteFailures.length + absoluteSignalFailures.length,
      below_target_count: belowTargets.length,
      recommended_actions: recommendedActions,
    };
  });
  const scopeDigest = stableHash(proposed.pages.map((page) => ({
    view_ref: page.metrics.view_ref,
    fingerprint: page.metrics.candidate_fingerprint,
    content_digest: page.metrics.content_digest,
  })).sort((left, right) => left.view_ref.localeCompare(right.view_ref)));
  const summary = {
    units: unitReports.length,
    pages: proposed.pages.length,
    effective_chars: proposed.pages.reduce((sum, page) => sum + page.metrics.effective_chars, 0),
    evidence: proposed.pages.reduce((sum, page) => sum + page.metrics.evidence_count, 0),
    sections: proposed.pages.reduce((sum, page) => sum + page.metrics.section_count, 0),
    relations: proposed.pages.reduce((sum, page) => sum + page.metrics.relation_count, 0),
    signals: signals.length,
    elevated_signals: signals.filter((signal) => signal.severity === "elevated").length,
  };
  const pages = proposed.pages
    .map((page) => page.metrics)
    .sort((left, right) => left.view_ref.localeCompare(right.view_ref));
  const signaledViewRefs = new Set(signals.flatMap((signal) =>
    signal.view_ref === undefined ? [] : [signal.view_ref]
  ));
  const digest = stableHash({ scopeDigest, summary, units: unitReports, pages, signals });
  return {
    schema: "context.code-index-audit-report.v2",
    digest,
    scope_digest: scopeDigest,
    source: proposed.source,
    summary,
    units: unitReports,
    pages,
    page_samples: proposed.pages
      .sort((left, right) =>
        Number(signaledViewRefs.has(right.metrics.view_ref)) - Number(signaledViewRefs.has(left.metrics.view_ref)) ||
        right.metrics.evidence_count - left.metrics.evidence_count ||
        left.metrics.view_ref.localeCompare(right.metrics.view_ref)
      )
      .slice(0, PAGE_SIGNAL_SAMPLE_LIMIT)
      .map((page) => page.metrics),
    signals,
    review_requirements: {
      compare_registered_sources_with_user_scope: true,
      inspect_signal_samples: true,
      choose: ["accept", "revise", "request-input"],
    },
  };
}
