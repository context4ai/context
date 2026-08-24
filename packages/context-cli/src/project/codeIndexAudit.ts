import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "@c4a/agent-graph";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";
import { readLatestExtractionBatchPreview } from "./extractionPreviewCache.js";
import type {
  CodeIndexAuditDecisionPayload,
  CodeIndexAuditHistoryEntry,
  CodeIndexAuditPageMetrics,
  CodeIndexAuditRecord,
  CodeIndexAuditReport,
  CodeIndexAuditSignal,
  CodeIndexAuditSignalAssessment,
  CodeIndexAuditStatus,
  CodeIndexAuditUnitReport,
} from "./codeIndexAuditTypes.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { walkApprovedMarkdown } from "./verifyProjectFiles.js";
import { withProjectWriteLock } from "./writeLock.js";

export const CODE_INDEX_AUDIT_PATH = "knowledge/code-index-audit.json";

const CODE_CANDIDATE_SNAPSHOT_ROOT = ".tmp/context-runtime/extract/candidates";
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
  CodeIndexAuditDecisionPayload,
  CodeIndexAuditHistoryEntry,
  CodeIndexAuditPageMetrics,
  CodeIndexAuditRecord,
  CodeIndexAuditReport,
  CodeIndexAuditSignal,
  CodeIndexAuditSignalAssessment,
  CodeIndexAuditSignalSeverity,
  CodeIndexAuditStatus,
  CodeIndexAuditUnitReport,
} from "./codeIndexAuditTypes.js";

interface AuditedPage {
  metrics: CodeIndexAuditPageMetrics;
  sourceNames: string[];
  sectionEvidenceCounts: number[];
  sectionEffectiveChars: number[];
  relationEvidenceCounts: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function evidenceSource(ref: string): string | undefined {
  const match = /^repo:([^#]+)#/u.exec(ref);
  return match?.[1];
}

function markdownBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
}

function semanticContentDigest(markdown: string): string {
  return stableHash(markdownBody(markdown).replace(/\r\n/gu, "\n").trim());
}

function lineIsMostlyLocator(line: string): boolean {
  const value = line
    .replace(/^\s*(?:[-*+] |\d+[.)] )/u, "")
    .replaceAll("`", "")
    .trim();
  if (value.length === 0 || /\s/u.test(value)) return false;
  return value.includes("/") || /\.[a-z0-9]{1,8}(?:[#?:].*)?$/iu.test(value);
}

export function effectiveMarkdownChars(markdown: string): number {
  const body = markdownBody(markdown)
    .replace(/<!--\s*context:[\s\S]*?-->/giu, "")
    .replace(/```[^\n]*\n([\s\S]*?)```/gu, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "");
  const meaningful = body.split(/\r?\n/u)
    .filter((line) => !/^\s*#{1,6}\s+/u.test(line))
    .filter((line) => !lineIsMostlyLocator(line))
    .join("\n")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
  return [...meaningful].length;
}

function sectionSourceRefs(markdown: string): string[] {
  return [...markdown.matchAll(/source_ref="([^"]+)"/giu)]
    .flatMap((match) => match[1] === undefined ? [] : [match[1]]);
}

function splitMarkdownSections(markdown: string): string[] {
  const body = markdownBody(markdown);
  const matches = [...body.matchAll(/^##\s+.+$/gmu)];
  if (matches.length === 0) return body.trim().length === 0 ? [] : [body];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    return body.slice(start, end);
  });
}

function candidateSnapshotPath(projectRoot: string, candidateId: string): string {
  return join(projectRoot, CODE_CANDIDATE_SNAPSHOT_ROOT, `${candidateId}.json`);
}

async function candidateMarkdown(projectRoot: string, record: CandidateRecord): Promise<string> {
  const path = candidateSnapshotPath(projectRoot, record.candidate_id);
  if (!existsSync(path)) return record.body ?? "";
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isRecord(parsed) && typeof parsed.markdown === "string"
      ? parsed.markdown
      : record.body ?? "";
  } catch {
    return record.body ?? "";
  }
}

function candidatePage(input: {
  record: CandidateRecord;
  markdown: string;
}): AuditedPage {
  const sectionRefs = stableUnique((input.record.sections ?? []).flatMap((section) =>
    section.source_refs ?? [section.source_ref]
  ));
  const edgeRefs = stableUnique((input.record.code_edges ?? []).flatMap((edge) => edge.source_refs));
  const sources = stableUnique(input.record.source_refs.flatMap((ref) => {
    const source = evidenceSource(ref);
    return source === undefined ? [] : [source];
  }));
  const sections = input.record.sections ?? [];
  return {
    metrics: {
      view_ref: input.record.view_ref,
      module: input.record.module,
      path: input.record.path,
      candidate_fingerprint: input.record.fingerprint,
      content_digest: semanticContentDigest(input.markdown),
      effective_chars: effectiveMarkdownChars(input.markdown),
      section_count: sections.length || splitMarkdownSections(input.markdown).length,
      evidence_count: stableUnique(input.record.source_refs).length,
      section_scoped_evidence_count: sectionRefs.length,
      relation_count: input.record.code_edges?.length ?? 0,
      relation_evidence_count: edgeRefs.length,
      source_count: sources.length,
    },
    sourceNames: sources,
    sectionEvidenceCounts: sections.map((section) =>
      stableUnique(section.source_refs ?? [section.source_ref]).length
    ),
    sectionEffectiveChars: sections.map((section) => effectiveMarkdownChars(section.body ?? "")),
    relationEvidenceCounts: (input.record.code_edges ?? []).map((edge) => stableUnique(edge.source_refs).length),
  };
}

function frontmatterModule(frontmatter: Record<string, unknown>, viewRef: string): string {
  const symbol = stringList(frontmatter.code_symbols)[0]?.split("|")[0];
  if (symbol !== undefined && symbol.length > 0) return symbol;
  return viewRef.replace(/^codegraph:/u, "").split("/")[0] ?? "codegraph";
}

function approvedEdges(frontmatter: Record<string, unknown>): Array<{ source_refs: string[] }> {
  if (!Array.isArray(frontmatter.code_edges)) return [];
  return frontmatter.code_edges.flatMap((edge) =>
    isRecord(edge) ? [{ source_refs: stringList(edge.source_refs) }] : []
  );
}

async function approvedPages(projectRoot: string): Promise<AuditedPage[]> {
  const root = join(projectRoot, "knowledge", "codegraph");
  if (!existsSync(root)) return [];
  const pages: AuditedPage[] = [];
  for (const file of await walkApprovedMarkdown(root)) {
    const content = await readFile(file.absPath, "utf8");
    const frontmatter = parseFrontmatterLoose(content);
    const viewRef = typeof frontmatter.view_ref === "string" ? frontmatter.view_ref : undefined;
    if (viewRef === undefined || !viewRef.startsWith("codegraph:")) continue;
    const candidateFingerprint = typeof frontmatter.candidate_fingerprint === "string"
      ? frontmatter.candidate_fingerprint
      : stableHash({ viewRef, content });
    const symbols = stableUnique(stringList(frontmatter.code_symbols));
    const sourceRefs = stableUnique(sectionSourceRefs(content));
    const sections = splitMarkdownSections(content);
    const edges = approvedEdges(frontmatter);
    const sources = stableUnique([
      ...stringList(frontmatter.sources).flatMap((source) => source.startsWith("repo:") ? [source.slice(5)] : []),
      ...sourceRefs.flatMap((ref) => {
        const source = evidenceSource(ref);
        return source === undefined ? [] : [source];
      }),
    ]);
    pages.push({
      metrics: {
        view_ref: viewRef,
        module: frontmatterModule(frontmatter, viewRef),
        path: `codegraph/${file.relPath}`,
        candidate_fingerprint: candidateFingerprint,
        content_digest: semanticContentDigest(content),
        effective_chars: effectiveMarkdownChars(content),
        section_count: sections.length,
        evidence_count: Math.max(symbols.length, sourceRefs.length),
        section_scoped_evidence_count: sourceRefs.length,
        relation_count: edges.length,
        relation_evidence_count: stableUnique(edges.flatMap((edge) => edge.source_refs)).length,
        source_count: sources.length,
      },
      sourceNames: sources,
      sectionEvidenceCounts: sections.map((section) => stableUnique(sectionSourceRefs(section)).length),
      sectionEffectiveChars: sections.map(effectiveMarkdownChars),
      relationEvidenceCounts: edges.map((edge) => stableUnique(edge.source_refs).length),
    });
  }
  return pages;
}

async function proposedPages(projectRoot: string): Promise<{
  pages: AuditedPage[];
  source: CodeIndexAuditReport["source"];
}> {
  const approved = await approvedPages(projectRoot);
  const records = (await readCandidateRecords(projectRoot)).filter((record) =>
    record.status === "draft" && record.collection === "codegraph"
  );
  if (records.length === 0) {
    return { pages: approved, source: approved.length > 0 ? "approved" : "preview" };
  }
  const draftPages = await Promise.all(records.map(async (record) =>
    candidatePage({ record, markdown: await candidateMarkdown(projectRoot, record) })
  ));
  const merged = new Map(approved.map((page) => [page.metrics.view_ref, page]));
  for (const page of draftPages) merged.set(page.metrics.view_ref, page);
  return { pages: [...merged.values()], source: "draft-and-approved" };
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

function pageSignals(page: AuditedPage, unit: ExtractionIndexUnitPreview | undefined): CodeIndexAuditSignal[] {
  const outputProfile = unit?.outputProfile ?? "module-map";
  if (!AGGREGATE_OUTPUT_PROFILES.has(outputProfile)) return [];
  const metrics = page.metrics;
  const signals: CodeIndexAuditSignal[] = [];
  const unitId = unit?.id ?? metrics.module;
  const unscopedEvidence = Math.max(0, metrics.evidence_count - metrics.section_scoped_evidence_count);
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
  };
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
    risks: ["audit-plan-inferred"],
  };
}

export async function buildCodeIndexAuditReport(projectRoot: string): Promise<CodeIndexAuditReport | undefined> {
  const proposed = await proposedPages(projectRoot);
  const preview = await readLatestExtractionBatchPreview(projectRoot);
  const declaredUnits = preview?.phases.flatMap((phase) => phase.indexUnits) ?? [];
  const inferredUnits = proposed.pages
    .filter((page) => unitForPage(page, declaredUnits) === undefined)
    .map(inferredUnit);
  const units = [...new Map([...declaredUnits, ...inferredUnits].map((unit) => [unit.id, unit])).values()];
  if (units.length === 0 && proposed.pages.length === 0) return undefined;
  const pageSignalList = proposed.pages.flatMap((page) => pageSignals(page, unitForPage(page, units)));
  const signals = [...pageSignalList, ...units.flatMap((unit) => unitSignals(unit, proposed.pages))]
    .sort((left, right) =>
      (left.severity === right.severity ? 0 : left.severity === "elevated" ? -1 : 1) ||
      left.unit_id.localeCompare(right.unit_id) ||
      (left.view_ref ?? "").localeCompare(right.view_ref ?? "") ||
      left.code.localeCompare(right.code)
    );
  const unitReports = units.map((unit) => unitReport({ unit, pages: proposed.pages, signals }));
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
    schema: "context.code-index-audit-report.v1",
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

async function readAuditRecord(projectRoot: string): Promise<CodeIndexAuditRecord | undefined> {
  const path = join(projectRoot, CODE_INDEX_AUDIT_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schema !== "context.code-index-audit.v1") return undefined;
    return parsed as unknown as CodeIndexAuditRecord;
  } catch {
    return undefined;
  }
}

function currentRecord(
  record: CodeIndexAuditRecord | undefined,
  report: CodeIndexAuditReport,
): CodeIndexAuditRecord | undefined {
  // Draft and approved materializations can expose different mechanical
  // metadata while retaining the same candidate fingerprints. Bind the Agent
  // decision to the semantic page scope so approval alone does not force a
  // duplicate audit; any added, removed, or changed page changes scope_digest.
  if (record?.report.scope_digest === report.scope_digest) return record;
  if (
    record?.decision.decision !== "accept" ||
    record.report.source !== "draft-and-approved" ||
    report.source !== "approved"
  ) return undefined;
  const reviewedPages = new Map(record.report.pages.map((page) => [page.view_ref, page]));
  const isReviewedSubset = report.pages.every((page) => {
    const reviewed = reviewedPages.get(page.view_ref);
    return reviewed?.candidate_fingerprint === page.candidate_fingerprint;
  });
  return isReviewedSubset && report.pages.length <= record.report.pages.length
    ? record
    : undefined;
}

export async function collectCodeIndexAuditStatus(projectRoot: string): Promise<CodeIndexAuditStatus> {
  const report = await buildCodeIndexAuditReport(projectRoot);
  const record = await readAuditRecord(projectRoot);
  if (report === undefined) {
    return { applicable: false, current: true, resolved: true, revision_required: false, input_required: false, history: record?.history ?? [] };
  }
  const current = currentRecord(record, report);
  return {
    applicable: true,
    current: current !== undefined,
    resolved: current?.decision.decision === "accept",
    revision_required: current?.decision.decision === "revise",
    input_required: current?.decision.decision === "request-input",
    report,
    ...(current === undefined ? {} : { decision: current.decision }),
    history: record?.history ?? [],
  };
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `${field} must be a non-empty string`, {
      category: ErrorCategory.SchemaInvalid,
      field,
    });
  }
  return value.trim();
}

function nonEmptyStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new ContextError(ExitCode.UserError, `${field} must be a non-empty string array`, {
      category: ErrorCategory.SchemaInvalid,
      field,
    });
  }
  return stableUnique(value as string[]);
}

function parseDecisionPayload(value: unknown): CodeIndexAuditDecisionPayload {
  if (!isRecord(value) || value.schema !== "context.code-index-audit-decision.v1") {
    throw new ContextError(ExitCode.UserError, "code-index audit input must use context.code-index-audit-decision.v1", {
      category: ErrorCategory.SchemaInvalid,
      expected_schema: "context.code-index-audit-decision.v1",
    });
  }
  if (value.decision !== "accept" && value.decision !== "revise" && value.decision !== "request-input") {
    throw new ContextError(ExitCode.UserError, "code-index audit decision must be accept, revise, or request-input", {
      category: ErrorCategory.SchemaInvalid,
      valid_decisions: ["accept", "revise", "request-input"],
    });
  }
  if (!isRecord(value.scope_assessment) || typeof value.scope_assessment.matches_requested_scope !== "boolean") {
    throw new ContextError(ExitCode.UserError, "scope_assessment must record whether the registered sources match the requested scope", {
      category: ErrorCategory.SchemaInvalid,
      field: "scope_assessment",
    });
  }
  if (!Array.isArray(value.scope_assessment.omissions) || value.scope_assessment.omissions.some((item) => typeof item !== "string")) {
    throw new ContextError(ExitCode.UserError, "scope_assessment.omissions must be a string array", {
      category: ErrorCategory.SchemaInvalid,
      field: "scope_assessment.omissions",
    });
  }
  if (!Array.isArray(value.signal_assessments)) {
    throw new ContextError(ExitCode.UserError, "signal_assessments must be an array", {
      category: ErrorCategory.SchemaInvalid,
      field: "signal_assessments",
    });
  }
  const signalAssessments = value.signal_assessments.map((raw, index) => {
    if (!isRecord(raw) || (raw.disposition !== "fix" && raw.disposition !== "acceptable" && raw.disposition !== "not-applicable")) {
      throw new ContextError(ExitCode.UserError, `signal_assessments[${index}] is invalid`, {
        category: ErrorCategory.SchemaInvalid,
        field: `signal_assessments[${index}]`,
      });
    }
    return {
      signal_id: nonEmpty(raw.signal_id, `signal_assessments[${index}].signal_id`),
      disposition: raw.disposition,
      reason: nonEmpty(raw.reason, `signal_assessments[${index}].reason`),
    } satisfies CodeIndexAuditSignalAssessment;
  });
  const revisionPlan = value.revision_plan;
  const requestedMaterial = value.requested_material;
  return {
    schema: "context.code-index-audit-decision.v1",
    report_digest: nonEmpty(value.report_digest, "report_digest"),
    decision: value.decision,
    summary: nonEmpty(value.summary, "summary"),
    reviewed_units: nonEmptyStrings(value.reviewed_units, "reviewed_units"),
    scope_assessment: {
      matches_requested_scope: value.scope_assessment.matches_requested_scope,
      omissions: stableUnique(value.scope_assessment.omissions as string[]),
      summary: nonEmpty(value.scope_assessment.summary, "scope_assessment.summary"),
    },
    signal_assessments: signalAssessments,
    ...(revisionPlan === undefined
      ? {}
      : isRecord(revisionPlan)
        ? {
            revision_plan: {
              units: nonEmptyStrings(revisionPlan.units, "revision_plan.units"),
              actions: nonEmptyStrings(revisionPlan.actions, "revision_plan.actions"),
            },
          }
        : {}),
    ...(requestedMaterial === undefined
      ? {}
      : { requested_material: nonEmptyStrings(requestedMaterial, "requested_material") }),
  };
}

function validateDecision(input: {
  report: CodeIndexAuditReport;
  payload: CodeIndexAuditDecisionPayload;
}): void {
  if (input.payload.report_digest !== input.report.digest) {
    throw new ContextError(ExitCode.WorkspaceStateError, "code-index audit report changed before the decision was applied", {
      category: ErrorCategory.WorkspaceStateInvalid,
      expected_report_digest: input.report.digest,
      actual_report_digest: input.payload.report_digest,
      next: "Read the current code-index audit report and submit a decision for its digest.",
    });
  }
  const unitIds = new Set(input.report.units.map((unit) => unit.id));
  const missingUnits = [...unitIds].filter((unit) => !input.payload.reviewed_units.includes(unit));
  const unknownUnits = input.payload.reviewed_units.filter((unit) => !unitIds.has(unit));
  if (missingUnits.length > 0 || unknownUnits.length > 0) {
    throw new ContextError(ExitCode.UserError, "reviewed_units must cover the complete current code-index audit batch", {
      category: ErrorCategory.SchemaInvalid,
      missing_units: missingUnits,
      unknown_units: unknownUnits,
    });
  }
  const signalIds = new Set(input.report.signals.map((signal) => signal.id));
  const assessmentBySignal = new Map(input.payload.signal_assessments.map((item) => [item.signal_id, item]));
  const missingSignals = input.report.signals
    .filter((signal) => signal.severity === "elevated")
    .map((signal) => signal.id)
    .filter((id) => !assessmentBySignal.has(id));
  const unknownSignals = input.payload.signal_assessments
    .map((item) => item.signal_id)
    .filter((id) => !signalIds.has(id));
  if (missingSignals.length > 0 || unknownSignals.length > 0) {
    throw new ContextError(ExitCode.UserError, "signal_assessments must address every elevated signal and no unknown signal", {
      category: ErrorCategory.SchemaInvalid,
      missing_signal_ids: missingSignals,
      unknown_signal_ids: unknownSignals,
    });
  }
  if (input.payload.decision === "accept") {
    const unresolved = input.payload.signal_assessments.filter((assessment) => assessment.disposition === "fix");
    if (!input.payload.scope_assessment.matches_requested_scope || input.payload.scope_assessment.omissions.length > 0 || unresolved.length > 0) {
      throw new ContextError(ExitCode.UserError, "accept requires matching requested scope and no signal marked for repair", {
        category: ErrorCategory.SchemaInvalid,
        omissions: input.payload.scope_assessment.omissions,
        unresolved_signal_ids: unresolved.map((item) => item.signal_id),
      });
    }
  }
  if (input.payload.decision === "revise") {
    if (input.payload.revision_plan === undefined) {
      throw new ContextError(ExitCode.UserError, "revise requires revision_plan.units and revision_plan.actions", {
        category: ErrorCategory.SchemaInvalid,
        field: "revision_plan",
      });
    }
  }
  if (input.payload.decision === "request-input" && input.payload.requested_material === undefined) {
    throw new ContextError(ExitCode.UserError, "request-input requires requested_material", {
      category: ErrorCategory.SchemaInvalid,
      field: "requested_material",
    });
  }
}

export async function applyCodeIndexAuditDecision(input: {
  projectRoot: string;
  payload: unknown;
}): Promise<CodeIndexAuditRecord> {
  return withProjectWriteLock(input.projectRoot, "review-code-index", async () => {
    const report = await buildCodeIndexAuditReport(input.projectRoot);
    if (report === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, "no code-index audit scope is available", {
        category: ErrorCategory.WorkspaceStateInvalid,
        next: "Complete the Route-selected code extraction before auditing the index.",
      });
    }
    const payload = parseDecisionPayload(input.payload);
    validateDecision({ report, payload });
    const previous = await readAuditRecord(input.projectRoot);
    const entry: CodeIndexAuditHistoryEntry = {
      report_digest: report.digest,
      scope_digest: report.scope_digest,
      decision: payload.decision,
      summary: payload.summary,
      reviewed_units: payload.reviewed_units,
      elevated_signal_count: report.summary.elevated_signals,
    };
    const history = [
      ...(previous?.history ?? []),
      ...(previous?.decision === undefined
        ? []
        : [{
            report_digest: previous.report.digest,
            scope_digest: previous.report.scope_digest,
            decision: previous.decision.decision,
            summary: previous.decision.summary,
            reviewed_units: previous.decision.reviewed_units,
            elevated_signal_count: previous.report.summary.elevated_signals,
          } satisfies CodeIndexAuditHistoryEntry]),
    ].filter((item, index, all) => index === all.findIndex((candidate) =>
      candidate.report_digest === item.report_digest && candidate.decision === item.decision
    ));
    if (!history.some((item) => item.report_digest === entry.report_digest && item.decision === entry.decision)) {
      history.push(entry);
    }
    const record: CodeIndexAuditRecord = {
      schema: "context.code-index-audit.v1",
      report,
      decision: payload,
      history,
    };
    await writeJsonAtomic(join(input.projectRoot, CODE_INDEX_AUDIT_PATH), record);
    return record;
  });
}
