import { formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  type CaptureFileRunResult,
  isCaptureFileRunResult,
} from "./documentCapture.js";
import {
  type CaptureLarkRunResult,
  isCaptureLarkRunResult,
} from "./documentCaptureLark.js";
import {
  isProseAlignRunResult,
  type ProseAlignRunResult,
} from "./proseAlign.js";
import {
  isProseCompileRunResult,
} from "./proseCompile.js";
import type { CompileRunResult } from "./proseCompileTypes.js";
import type { ExtractTsRunResult } from "./extractCandidates.js";

export type ProjectRunFormat = "text" | "json";

interface RunOutputPlan {
  phase: {
    id: string;
    kind: string;
    reads: string[];
    writes: string[];
  };
}

export function errorView(error: unknown): { name: string; message: string; code?: string; stack?: string; detail?: Record<string, unknown> } {
  if (error instanceof ContextError) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
    };
  }
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return {
      name: error.name,
      message: error.message,
      ...(code !== undefined ? { code } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

export function resultSummary(result: unknown): Record<string, unknown> | undefined {
  if (result === undefined) return undefined;
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
}

function isExtractTsRunResult(value: unknown): value is ExtractTsRunResult {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "candidates" in value &&
    "candidateFile" in value;
}

function nextActionCommand(value: unknown): string | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  if ("command" in value && typeof value.command === "string") return value.command;
  return "message" in value && typeof value.message === "string" ? value.message : undefined;
}

function nextActionMessage(value: unknown): string | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return "message" in value && typeof value.message === "string" ? value.message : undefined;
}

function runSuccessBaseBody(input: { plan: RunOutputPlan; logPath: string }): string[] {
  return [
    `reads: ${input.plan.phase.reads.length > 0 ? input.plan.phase.reads.join(", ") : "none"}`,
    `writes: ${input.plan.phase.writes.length > 0 ? input.plan.phase.writes.join(", ") : "none"}`,
    `log: ${input.logPath}`,
  ];
}

function appendExtractTsRunBody(body: string[], result: ExtractTsRunResult): void {
  body.push(
    `sources: ${result.sources.length > 0 ? result.sources.join(", ") : "none"}`,
    `modules: ${result.modules}`,
    `symbols: ${result.extractedSymbols}`,
    `relationships: ${result.relationships.emitted}/${result.relationships.detected} emitted (${result.relationships.mode})`,
    `drafts: +${result.candidates.added}, ~${result.candidates.updated}, =${result.candidates.unchanged}, -${result.candidates.removed}, approved-skip:${result.candidates.skippedApproved}, rejected-skip:${result.candidates.skippedRejected}`,
    `source state: ${result.execution.sourceState}`,
    `policy: ${result.execution.policy}`,
    `codegraph changes: +${result.changes.added}, ~${result.changes.updated}, -${result.changes.removed}, unchanged-approved:${result.changes.unchangedApproved}`,
    `review: ${result.review.required ? `required (${result.review.pendingCandidates})` : "not required"}`,
    `next action: ${result.next_action.command}`,
    `candidate file: ${result.candidateFile}`,
  );
  if (result.autoPromotion !== undefined) {
    body.push(`auto promotion: applied:${result.autoPromotion.applied}, materialized:${result.autoPromotion.materialized}, removed:${result.autoPromotion.removed}, close:${result.autoPromotion.close}, verify:${result.autoPromotion.verify}`);
  }
  for (const moduleError of result.moduleErrors) {
    body.push(`module error ${moduleError.source}:${moduleError.module_path}: ${moduleError.error}`);
  }
  for (const hint of result.agent_hints) {
    body.push(`hint ${hint.code}: ${hint.message}${hint.command ? `; ${hint.command}` : ""}`);
  }
}

function appendCaptureFileRunBody(body: string[], result: CaptureFileRunResult): void {
  const nextAction = nextActionCommand(result.next_action);
  body.push(
    `source: file:${result.source.name}`,
    `include: ${result.source.include.join(", ")}`,
    `documents: ${result.documents.length}`,
    `snapshot: ${result.snapshot.manifest}`,
    `snapshot hash: ${result.snapshot.snapshot_hash}`,
    `changed: ${result.snapshot.changed ? "yes" : "no"}`,
  );
  if (nextAction !== undefined) body.push(`next action: ${nextAction}`);
  for (const document of result.documents.slice(0, 8)) {
    body.push(`document ${document.path}: ${document.title} (${document.line_count} line(s))`);
  }
}

function appendCaptureLarkRunBody(body: string[], result: CaptureLarkRunResult): void {
  const nextAction = nextActionCommand(result.next_action);
  body.push(
    `source: lark:${result.source.name}`,
    `identity: ${result.source.identity}`,
    `documents: ${result.documents.length}`,
    `assets: ${result.assets.length}`,
    `snapshot: ${result.snapshot.manifest}`,
    `snapshot hash: ${result.snapshot.snapshot_hash}`,
    `changed: ${result.snapshot.changed ? "yes" : "no"}`,
  );
  if (nextAction !== undefined) body.push(`next action: ${nextAction}`);
  for (const document of result.documents.slice(0, 8)) {
    body.push(`document ${document.path}: ${document.title} (${document.line_count} line(s))`);
  }
}

type HtmlReportLike = {
  path?: unknown;
  absolute_path?: unknown;
  file_url?: unknown;
};

function appendHtmlReport(body: string[], label: string, report: HtmlReportLike | undefined): void {
  if (report === undefined) return;
  if (typeof report.path === "string") body.push(`${label}: ${report.path}`);
  if (typeof report.absolute_path === "string") body.push(`${label} absolute path: ${report.absolute_path}`);
  if (typeof report.file_url === "string") body.push(`${label} file_url: ${report.file_url}`);
}

function appendAlignReviewNotice(body: string[], result: ProseAlignRunResult): void {
  const notice = "review_notice" in result && result.review_notice !== null && typeof result.review_notice === "object"
    ? result.review_notice as { review_report?: HtmlReportLike }
    : undefined;
  appendHtmlReport(body, "structure report", notice?.review_report);
}

function appendAlignStructureSummary(body: string[], result: ProseAlignRunResult): void {
  const summary = "structure_summary" in result && result.structure_summary !== null && typeof result.structure_summary === "object"
    ? result.structure_summary as { counts?: Record<string, unknown>; lifecycle_state?: unknown; structure_digest?: unknown }
    : undefined;
  if (summary?.counts !== undefined) {
    const counts = summary.counts;
    body.push(
      `structure: nodes=${String(counts.nodes ?? "?")} sections=${String(counts.sections ?? "?")} edges=${String(counts.edges ?? "?")} unresolved=${String(counts.unresolved ?? "?")}`,
    );
    if (typeof summary.lifecycle_state === "string") body.push(`structure lifecycle: ${summary.lifecycle_state}`);
  }
  const hasNotice = "review_notice" in result && result.review_notice !== null && typeof result.review_notice === "object";
  const report = "structure_report" in result && result.structure_report !== null && typeof result.structure_report === "object"
    ? result.structure_report as HtmlReportLike
    : undefined;
  if (!hasNotice) appendHtmlReport(body, "structure report", report);
}

type CompactStructureSummary = {
  views_by_collection?: Array<{
    collection?: unknown;
    view_count?: unknown;
    views?: Array<{
      title?: unknown;
      view_ref?: unknown;
      path?: unknown;
      section_count?: unknown;
      source_ref_count?: unknown;
      edge_count?: unknown;
      unresolved_count?: unknown;
      split_required?: unknown;
    }>;
  }>;
  unresolved?: Array<{ issue?: unknown; note?: unknown; source_ref_count?: unknown }>;
  diagnostics?: { warnings?: Array<{ code?: unknown; message?: unknown; candidate_id?: unknown }> };
  confirmation?: { impact?: unknown[] };
};

function compactSummary(result: ProseAlignRunResult): CompactStructureSummary | undefined {
  return "structure_summary_compact" in result &&
    result.structure_summary_compact !== null &&
    typeof result.structure_summary_compact === "object" &&
    !Array.isArray(result.structure_summary_compact)
    ? result.structure_summary_compact as CompactStructureSummary
    : undefined;
}

function appendCompactViews(body: string[], compact: CompactStructureSummary): void {
  for (const group of compact.views_by_collection ?? []) {
    const collection = typeof group.collection === "string" ? group.collection : "unknown";
    const viewCount = typeof group.view_count === "number" ? group.view_count : group.views?.length ?? 0;
    body.push(`collection ${collection}: ${viewCount} view(s)`);
    for (const view of (group.views ?? []).slice(0, 20)) {
      const title = typeof view.title === "string" ? view.title : String(view.view_ref ?? "untitled");
      const path = typeof view.path === "string" ? view.path : "?";
      const sections = typeof view.section_count === "number" ? view.section_count : "?";
      const refs = typeof view.source_ref_count === "number" ? view.source_ref_count : "?";
      const edges = typeof view.edge_count === "number" ? view.edge_count : "?";
      const unresolved = typeof view.unresolved_count === "number" ? view.unresolved_count : "?";
      const split = view.split_required === true ? " split-required" : "";
      body.push(`  - ${title}: ${path} (sections:${sections}, refs:${refs}, edges:${edges}, unresolved:${unresolved}${split})`);
    }
    const omitted = viewCount - Math.min(group.views?.length ?? 0, 20);
    if (omitted > 0) body.push(`  - ... ${omitted} more view(s); open the structure report for the full list`);
  }
}

function appendCompactUnresolved(body: string[], compact: CompactStructureSummary): void {
  const unresolved = compact.unresolved ?? [];
  if (unresolved.length === 0) return;
  body.push("unresolved:");
  for (const item of unresolved.slice(0, 8)) {
    const issue = typeof item.issue === "string" ? item.issue : "unknown";
    const refs = typeof item.source_ref_count === "number" ? item.source_ref_count : 0;
    const note = typeof item.note === "string" ? ` - ${item.note}` : "";
    body.push(`  - ${issue} (refs:${refs})${note}`);
  }
  if (unresolved.length > 8) body.push(`  - ... ${unresolved.length - 8} more unresolved item(s)`);
}

function appendCompactWarnings(body: string[], compact: CompactStructureSummary): void {
  const warnings = compact.diagnostics?.warnings ?? [];
  if (warnings.length === 0) return;
  body.push("warnings:");
  for (const warning of warnings.slice(0, 8)) {
    const code = typeof warning.code === "string" ? warning.code : "warning";
    const target = typeof warning.candidate_id === "string" ? ` ${warning.candidate_id}` : "";
    const message = typeof warning.message === "string" ? warning.message : "";
    body.push(`  - ${code}${target}: ${message}`);
  }
  if (warnings.length > 8) body.push(`  - ... ${warnings.length - 8} more warning(s)`);
}

function appendCompactConfirmationImpact(body: string[], compact: CompactStructureSummary): void {
  const impact = (compact.confirmation?.impact ?? []).filter((item): item is string => typeof item === "string");
  if (impact.length === 0) return;
  body.push("confirming this structure freezes:");
  for (const item of impact) body.push(`  - ${item}`);
}

function appendAlignCompactSummary(body: string[], result: ProseAlignRunResult): void {
  const compact = compactSummary(result);
  if (compact === undefined) return;
  appendCompactViews(body, compact);
  appendCompactUnresolved(body, compact);
  appendCompactWarnings(body, compact);
  appendCompactConfirmationImpact(body, compact);
}

function appendNextAction(body: string[], value: unknown): void {
  const nextCommand = nextActionCommand(value);
  if (nextCommand !== undefined) body.push(`next action: ${nextCommand}`);
  const nextMessage = nextActionMessage(value);
  if (nextMessage !== undefined) body.push(`next message: ${nextMessage}`);
  const reviewReport = value !== null && typeof value === "object" && !Array.isArray(value) &&
    "review_report" in value && value.review_report !== null && typeof value.review_report === "object"
    ? value.review_report as HtmlReportLike
    : undefined;
  appendHtmlReport(body, "next review report", reviewReport);
}

function appendProseAlignRunBody(body: string[], result: ProseAlignRunResult): void {
  const state = "state" in result && typeof result.state === "string"
    ? result.state
    : "ok";
  body.push(
    `align gate: ${result.kind}`,
    `state: ${state}`,
  );
  const view = "view" in result && typeof result.view === "string" ? result.view : undefined;
  if (view !== undefined) body.push(`view: ${view}`);
  if (!("state" in result) && "valid" in result && typeof result.valid === "boolean") {
    body.push(`valid: ${result.valid ? "yes" : "no"}`);
  }
  appendAlignReviewNotice(body, result);
  appendAlignStructureSummary(body, result);
  appendAlignCompactSummary(body, result);
  if ("candidates" in result) body.push(`candidates: ${JSON.stringify(result.candidates)}`);
  appendNextAction(body, result.next_action);
}

function appendProseCompileRunBody(body: string[], result: CompileRunResult): void {
  body.push(`compile gate: ${result.kind}`);
  if ("state" in result && typeof result.state === "string") body.push(`state: ${result.state}`);
  if ("view" in result) body.push(`view: ${result.view}`);
  if (!("state" in result) && "valid" in result) body.push(`valid: ${result.valid ? "yes" : "no"}`);
  if ("sections" in result) body.push(`sections: ${result.sections}`);
  appendNextAction(body, result.next_action);
}

function appendRunResultBody(body: string[], result: unknown): void {
  if (isExtractTsRunResult(result)) appendExtractTsRunBody(body, result);
  if (isCaptureFileRunResult(result)) appendCaptureFileRunBody(body, result);
  if (isCaptureLarkRunResult(result)) appendCaptureLarkRunBody(body, result);
  if (isProseAlignRunResult(result)) appendProseAlignRunBody(body, result);
  if (isProseCompileRunResult(result)) appendProseCompileRunBody(body, result);
  if (result !== null && typeof result === "object" && !Array.isArray(result) &&
    "kind" in result && (result.kind === "semantic.rules.view.result" || result.kind === "diagnostics.view.result") &&
    "next_action" in result && result.next_action !== null && typeof result.next_action === "object" && !Array.isArray(result.next_action)) {
    appendNextAction(body, result.next_action as Record<string, unknown>);
  }
}

export function writeRunSuccess(input: {
  plan: RunOutputPlan;
  result: unknown;
  logPath: string;
  format: ProjectRunFormat;
  verbose?: boolean;
}): void {
  if (input.format === "json") {
    const result = compactJsonResult(input.result, input.verbose === true);
    process.stdout.write(`${JSON.stringify(input.verbose === true ? {
      result,
      ...input.plan,
      log: input.logPath,
    } : {
      result,
      phase: {
        id: input.plan.phase.id,
        kind: input.plan.phase.kind,
      },
      log: input.logPath,
    }, null, 2)}\n`);
    return;
  }

  const body = runSuccessBaseBody(input);
  appendRunResultBody(body, input.result);
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "ran",
    subject: input.plan.phase.id,
    headline: input.plan.phase.kind,
    body,
  }));
}

function compactDiagnostics(record: Record<string, unknown>): void {
  if (!Array.isArray(record.diagnostics) || record.diagnostics.length <= 25) return;
  const diagnostics = record.diagnostics.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item)
  ).sort((left, right) => {
    const rank = (severity: unknown): number => severity === "error" ? 0 : severity === "warning" ? 1 : 2;
    return rank(left.severity) - rank(right.severity);
  });
  record.diagnostics = diagnostics.slice(0, 25);
  record.diagnostics_summary = {
    total: diagnostics.length,
    returned: Math.min(25, diagnostics.length),
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length,
    truncated: diagnostics.length > 25,
    continuation: record.diagnostics_view,
  };
}

function compactCompileReadPlan(record: Record<string, unknown>): void {
  if (record.kind !== "prose.compile.view.result" || record.view !== "read-plan") return;
  if (record.read_plan === null || typeof record.read_plan !== "object" || Array.isArray(record.read_plan)) return;
  const readPlan = record.read_plan as Record<string, unknown>;
  const nodes = Array.isArray(readPlan.nodes) ? readPlan.nodes : [];
  record.read_plan = {
    nodes: nodes.flatMap((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
      const node = value as Record<string, unknown>;
      return [{
        view_ref: node.view_ref,
        node_ref: node.node_ref,
        collection: node.collection,
        title: node.title,
        sections: node.sections,
        section_ids: node.section_ids,
      }];
    }),
    nodes_total: nodes.length,
    source_overview: readPlan.source_overview,
  };
}

function compactStageResult(record: Record<string, unknown>): void {
  if (record.kind !== "prose.align.structure-write.result") return;
  delete record.structure_summary;
  delete record.review_notice;
  delete record.structure_summary_compact;
}

function diagnosticSummary(diagnostics: unknown): {
  total: number;
  errors: number;
  warnings: number;
  info: number;
} {
  const items = Array.isArray(diagnostics)
    ? diagnostics.filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  return {
    total: items.length,
    errors: items.filter((item) => item.severity === "error").length,
    warnings: items.filter((item) => item.severity === "warning").length,
    info: items.filter((item) => item.severity === "info").length,
  };
}

function sortedDiagnostics(diagnostics: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(diagnostics)) return [];
  const rank = (severity: unknown): number => severity === "error" ? 0 : severity === "warning" ? 1 : 2;
  return diagnostics
    .filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item)
    )
    .sort((left, right) => rank(left.severity) - rank(right.severity));
}

function compactValidationResult(record: Record<string, unknown>): void {
  if (
    record.kind !== "prose.align.validate.result" &&
    record.kind !== "prose.compile.validate.result" &&
    record.view !== "structure-summary"
  ) {
    return;
  }
  const summary = diagnosticSummary(record.diagnostics);
  const diagnostics = sortedDiagnostics(record.diagnostics);
  const returned = Math.min(summary.total, 8);
  record.diagnostics_summary = {
    ...summary,
    returned,
    truncated: summary.total > returned,
    continuation: record.diagnostics_view,
  };
  if (summary.total === 0) {
    delete record.diagnostics;
  } else {
    record.diagnostics = diagnostics.slice(0, 8);
  }
  delete record.payload_schema;
  delete record.repair_hints;
  delete record.allowed_actions;
  delete record.confirmation_blockers;
  delete record.warning_lifecycle;
  delete record.semantic_issue_families;
  delete record.semantic_reference_files;
  delete record.review_notice;
  delete record.structure_summary;
}

function compactJsonResult(result: unknown, verbose: boolean): unknown {
  if (verbose || result === null || typeof result !== "object" || Array.isArray(result)) return result;
  const record = { ...(result as Record<string, unknown>) };
  if (record.view === "read-plan") {
    delete record.payload_schema;
    if (Array.isArray(record.views)) delete record.views;
    delete record.agent_hints;
    delete record.document_mainline_collections;
  }
  const proseEnvelope = typeof record.kind === "string" &&
    (record.kind.startsWith("prose.align.") ||
      record.kind.startsWith("prose.compile."));
  if (
    proseEnvelope &&
    record.view !== "schema" &&
    record.view !== "semantic-rules" &&
    record.view !== "read-plan"
  ) {
    delete record.payload_schema;
    if (Array.isArray(record.views)) delete record.views;
    delete record.agent_hints;
    delete record.document_mainline_collections;
    delete record.semantic_reference_files;
  }
  compactCompileReadPlan(record);
  compactStageResult(record);
  compactValidationResult(record);
  compactDiagnostics(record);
  const {
    next_action: nextAction,
    state,
    view,
    kind,
    semantic_reference_files: semanticReferenceFiles,
    source,
    document_mainline_collections: documentMainlineCollections,
    ...rest
  } = record;
  const includeContracts = view === "schema";
  const proseViewResult = typeof kind === "string" &&
    (kind.startsWith("prose.align.") || kind.startsWith("prose.compile."));
  const includeSource = !proseViewResult || includeContracts || view === "read-plan";
  return {
    ...(nextAction !== undefined ? { next_action: nextAction } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(view !== undefined ? { view } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...rest,
    ...(includeSource && source !== undefined ? { source } : {}),
    ...(includeContracts && documentMainlineCollections !== undefined
      ? { document_mainline_collections: documentMainlineCollections }
      : {}),
    ...(includeContracts && semanticReferenceFiles !== undefined
      ? { semantic_reference_files: semanticReferenceFiles }
      : {}),
  };
}
