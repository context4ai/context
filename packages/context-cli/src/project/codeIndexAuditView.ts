import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type {
  CodeIndexAuditPageMetrics,
  CodeIndexAuditStatus,
  CodeIndexAuditUnitReport,
} from "./codeIndexAuditTypes.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import {
  buildReportViewWindow,
  reportViewBaseCommand,
  type ReportViewItem,
  type ReportViewOptions,
} from "./reportViewBudget.js";

export type CodeIndexAuditViewName = "summary" | "items";

export interface CodeIndexAuditViewOptions extends ReportViewOptions {
  view?: string;
  reportDigest?: string;
  unit?: string;
  itemKind?: string;
}

interface CodeIndexAuditItem extends ReportViewItem {
  sequence: number;
  unit_id?: string;
}

function viewName(value: string | undefined): CodeIndexAuditViewName {
  if (value === undefined || value === "summary") return "summary";
  if (value === "items") return value;
  throw new ContextError(ExitCode.UserError, "code-index audit --view must be summary or items", {
    category: ErrorCategory.UserInputInvalid,
    view: value,
    valid_views: ["summary", "items"],
  });
}

function itemId(parts: Record<string, unknown>): string {
  return `audit-item:${stableHash(parts, 20)}`;
}

function pushItem(
  items: CodeIndexAuditItem[],
  input: Omit<CodeIndexAuditItem, "item_id" | "sequence">,
): void {
  items.push({
    item_id: itemId(input),
    sequence: items.length,
    ...input,
  } as CodeIndexAuditItem);
}

function pushTextItems(input: {
  items: CodeIndexAuditItem[];
  itemKind: string;
  values: readonly string[];
  unitId?: string;
  fields?: Record<string, unknown>;
}): void {
  for (const text of input.values) {
    pushItem(input.items, {
      item_kind: input.itemKind,
      ...(input.unitId === undefined ? {} : { unit_id: input.unitId }),
      ...(input.fields ?? {}),
      text,
    });
  }
}

function pushUnit(items: CodeIndexAuditItem[], unit: CodeIndexAuditUnitReport): void {
  pushItem(items, {
    item_kind: "unit",
    unit_id: unit.id,
    output_owner: unit.output_owner,
    output_profile: unit.output_profile,
    module_types: unit.module_types,
    page_count: unit.page_count,
    effective_chars: unit.effective_chars,
    evidence_count: unit.evidence_count,
    section_count: unit.section_count,
    relation_count: unit.relation_count,
    signal_count: unit.signal_count,
    elevated_signal_count: unit.elevated_signal_count,
    absolute_failure_count: unit.absolute_failure_count,
    below_target_count: unit.below_target_count,
    max_page_lines: unit.max_page_lines,
    problem_fingerprint: unit.problem_fingerprint,
  });
  pushTextItems({ items, itemKind: "unit-input-source", values: unit.input_sources, unitId: unit.id });
  pushTextItems({ items, itemKind: "unit-covered-source", values: unit.covered_sources, unitId: unit.id });
  pushTextItems({ items, itemKind: "unit-uncovered-source", values: unit.uncovered_sources, unitId: unit.id });
  pushTextItems({ items, itemKind: "unit-recommended-action", values: unit.recommended_actions, unitId: unit.id });
  for (const dimension of unit.dimensions) {
    const scalarEvidence = Object.fromEntries(Object.entries(dimension.evidence).filter(([, value]) => !Array.isArray(value)));
    pushItem(items, {
      item_kind: "dimension",
      unit_id: unit.id,
      dimension: dimension.dimension,
      observed: dimension.observed,
      measure_unit: dimension.unit,
      floor: dimension.floor,
      target: dimension.target,
      ceiling: dimension.ceiling,
      score: dimension.score,
      status: dimension.status,
      absolute_gate: dimension.absolute_gate,
      evidence: scalarEvidence,
      recommended_action_count: dimension.recommended_actions.length,
    });
    for (const [key, value] of Object.entries(dimension.evidence)) {
      if (!Array.isArray(value)) continue;
      pushTextItems({
        items,
        itemKind: "dimension-evidence",
        values: value,
        unitId: unit.id,
        fields: { dimension: dimension.dimension, evidence_key: key },
      });
    }
    pushTextItems({
      items,
      itemKind: "dimension-recommended-action",
      values: dimension.recommended_actions,
      unitId: unit.id,
      fields: { dimension: dimension.dimension },
    });
  }
  for (const guidance of unit.action_guidance) {
    const guidanceId = itemId({ unit_id: unit.id, action: guidance.action });
    pushItem(items, {
      item_kind: "action-guidance",
      unit_id: unit.id,
      guidance_id: guidanceId,
      action: guidance.action,
      failed_dimension_count: guidance.failed_dimensions.length,
      affected_page_count: guidance.affected_pages.length,
      template_count: guidance.template_paths.length,
      configuration_field_count: guidance.configuration_fields.length,
      expected_improvement_count: guidance.expected_improvement.length,
    });
    const groups: Array<[string, readonly string[]]> = [
      ["guidance-failed-dimension", guidance.failed_dimensions],
      ["guidance-affected-page", guidance.affected_pages],
      ["guidance-template", guidance.template_paths],
      ["guidance-configuration-field", guidance.configuration_fields],
      ["guidance-expected-improvement", guidance.expected_improvement],
    ];
    for (const [itemKind, values] of groups) {
      pushTextItems({ items, itemKind, values, unitId: unit.id, fields: { guidance_id: guidanceId, action: guidance.action } });
    }
  }
}

function pushPage(items: CodeIndexAuditItem[], page: CodeIndexAuditPageMetrics): void {
  const {
    referenced_files: referencedFiles,
    referenced_symbols: referencedSymbols,
    normalized_template_histogram: normalizedTemplateHistogram,
    ...summary
  } = page;
  pushItem(items, {
    item_kind: "page",
    unit_id: page.module,
    ...summary,
    referenced_file_count: referencedFiles.length,
    referenced_symbol_count: referencedSymbols.length,
    normalized_template_count: Object.keys(normalizedTemplateHistogram ?? {}).length,
  });
  pushTextItems({
    items,
    itemKind: "page-referenced-file",
    values: referencedFiles,
    unitId: page.module,
    fields: { view_ref: page.view_ref },
  });
  pushTextItems({
    items,
    itemKind: "page-referenced-symbol",
    values: referencedSymbols,
    unitId: page.module,
    fields: { view_ref: page.view_ref },
  });
  for (const [template, count] of Object.entries(normalizedTemplateHistogram ?? {})) {
    pushItem(items, {
      item_kind: "page-template-repetition",
      unit_id: page.module,
      view_ref: page.view_ref,
      text: template,
      count,
    });
  }
}

export function codeIndexAuditItems(status: CodeIndexAuditStatus): CodeIndexAuditItem[] {
  const report = status.report;
  if (report === undefined) return [];
  const items: CodeIndexAuditItem[] = [];
  for (const signal of [...report.signals].sort((left, right) =>
    Number(right.severity === "elevated") - Number(left.severity === "elevated") ||
    left.id.localeCompare(right.id)
  )) {
    pushItem(items, {
      item_kind: "signal",
      unit_id: signal.unit_id,
      signal_id: signal.id,
      code: signal.code,
      severity: signal.severity,
      ...(signal.view_ref === undefined ? {} : { view_ref: signal.view_ref }),
      text: signal.message,
      metrics: signal.metrics,
      absolute_gate: signal.absolute_gate === true,
      recommended_action_count: signal.recommended_actions?.length ?? 0,
    });
    pushTextItems({
      items,
      itemKind: "signal-recommended-action",
      values: signal.recommended_actions ?? [],
      unitId: signal.unit_id,
      fields: { signal_id: signal.id },
    });
  }
  for (const unit of report.units) pushUnit(items, unit);
  for (const retry of status.guidance_units) {
    pushItem(items, {
      item_kind: "revision-guidance",
      unit_id: retry.unit_id,
      output_profile: retry.output_profile,
      problem_fingerprint: retry.problem_fingerprint,
      attempts: retry.attempts,
    });
    pushTextItems({ items, itemKind: "revision-failed-dimension", values: retry.failed_dimensions, unitId: retry.unit_id });
    pushTextItems({ items, itemKind: "revision-attempted-action", values: retry.attempted_actions, unitId: retry.unit_id });
    for (const delta of retry.dimension_deltas) {
      pushItem(items, {
        item_kind: "revision-dimension-delta",
        unit_id: retry.unit_id,
        dimension: delta.dimension,
        before: delta.before,
        after: delta.after,
        delta: delta.delta,
        status: delta.status,
      });
    }
  }
  for (const page of report.pages) pushPage(items, page);
  const decision = status.decision;
  if (decision !== undefined) {
    pushItem(items, {
      item_kind: "decision",
      decision: decision.decision,
      report_digest: decision.report_digest,
      text: decision.summary,
      matches_requested_scope: decision.scope_assessment.matches_requested_scope,
    });
    pushTextItems({ items, itemKind: "decision-scope-omission", values: decision.scope_assessment.omissions });
    for (const assessment of decision.signal_assessments) {
      pushItem(items, {
        item_kind: "decision-signal-assessment",
        signal_id: assessment.signal_id,
        disposition: assessment.disposition,
        text: assessment.reason,
      });
    }
    pushTextItems({ items, itemKind: "decision-requested-material", values: decision.requested_material ?? [] });
    pushTextItems({ items, itemKind: "decision-revision-unit", values: decision.revision_plan?.units ?? [] });
    pushTextItems({ items, itemKind: "decision-revision-action", values: decision.revision_plan?.actions ?? [] });
  }
  return items;
}

export function codeIndexAuditItemsCommand(digest: string): string {
  return reportViewBaseCommand({
    command: "context review code-index",
    args: [
      ["--report-digest", digest],
      ["--view", "items"],
    ],
  });
}

export function buildCodeIndexAuditView(
  status: CodeIndexAuditStatus,
  options: CodeIndexAuditViewOptions = {},
): Record<string, unknown> {
  const view = viewName(options.view);
  const report = status.report;
  if (report === undefined) {
    return {
      schema: "context.code-index-audit-view.v1",
      view,
      applicable: status.applicable,
      current: status.current,
      resolved: status.resolved,
      summary: { units: 0, pages: 0, signals: 0, elevated_signals: 0 },
      next_action: { kind: "code_index_audit_unavailable", command: "context status --format json" },
    };
  }
  if (options.reportDigest !== undefined && options.reportDigest !== report.digest) {
    throw new ContextError(ExitCode.WorkspaceStateError, "the code-index audit report changed while reading a budgeted view", {
      category: ErrorCategory.WorkflowRevisionStale,
      expected_report_digest: options.reportDigest,
      current_report_digest: report.digest,
      next_action: {
        kind: "restart_code_index_audit_read",
        command: "context review code-index --view summary --format json",
      },
      next: "context review code-index --view summary --format json",
    });
  }
  const summary = {
    ...report.summary,
    source: report.source,
    applicable: status.applicable,
    current: status.current,
    resolved: status.resolved,
    revision_required: status.revision_required,
    input_required: status.input_required,
    guidance_required: status.guidance_required,
    current_decision: status.decision?.decision ?? null,
  };
  if (view === "summary") {
    const baseCommand = reportViewBaseCommand({
      command: "context review code-index",
      args: [
        ["--report-digest", report.digest],
        ["--view", "summary"],
      ],
    });
    const unitItems: ReportViewItem[] = report.units.map((unit) => ({
      item_id: unit.id,
      item_kind: "unit",
      unit_id: unit.id,
      output_profile: unit.output_profile,
      module_types: unit.module_types,
      pages: unit.page_count,
      facts: unit.dimensions.find((dimension) => dimension.dimension === "semantic-fact-lines")?.observed ?? null,
      max_page_lines: unit.max_page_lines,
      absolute_failures: unit.absolute_failure_count,
      below_target: unit.below_target_count,
      signal_count: unit.signal_count,
      elevated_signal_count: unit.elevated_signal_count,
      recommended_actions: unit.recommended_actions,
    }));
    const result = buildReportViewWindow({
      items: unitItems,
      options,
      baseCommand,
      selectionPolicy: { id: "unit-id-order", order: [{ field: "unit_id", direction: "asc" }] },
      completeKind: "audit_summary_complete",
      nextPageKind: "read_next_audit_summary_page",
      budgetTruncatedKind: "expand_audit_summary_budget",
    });
    const itemsCommand = `${codeIndexAuditItemsCommand(report.digest)} --page-size 25 --token-budget 2000 --byte-budget 24000 --format json`;
    return {
      schema: "context.code-index-audit-view.v1",
      view,
      report_digest: report.digest,
      scope_digest: report.scope_digest,
      summary,
      review_requirements: report.review_requirements,
      ...result,
      views: [{
        id: "audit-items",
        purpose: "Read every digest-bound audit item in the CLI-selected review order before deciding.",
        command: itemsCommand,
      }],
      ...(result.next_action.kind === "audit_summary_complete"
        ? {
            next_action: {
              kind: "read_audit_items",
              command: itemsCommand,
              reason_code: "code-index-audit-items-required",
            },
          }
        : {}),
    };
  }

  const allItems = codeIndexAuditItems(status);
  if (options.unit !== undefined && !report.units.some((unit) => unit.id === options.unit)) {
    throw new ContextError(ExitCode.UserError, "--unit does not match this code-index audit", {
      category: ErrorCategory.UserInputInvalid,
      unit: options.unit,
      available_units: report.units.map((unit) => unit.id),
    });
  }
  const selectedItems = allItems.filter((item) =>
    (options.unit === undefined || item.unit_id === options.unit) &&
    (options.itemKind === undefined || item.item_kind === options.itemKind)
  );
  const baseCommand = reportViewBaseCommand({
    command: "context review code-index",
    args: [
      ["--report-digest", report.digest],
      ["--view", "items"],
      ...(options.unit === undefined ? [] : [["--unit", options.unit] as [string, string]]),
      ...(options.itemKind === undefined ? [] : [["--item-kind", options.itemKind] as [string, string]]),
    ],
  });
  return {
    schema: "context.code-index-audit-view.v1",
    view,
    report_digest: report.digest,
    scope_digest: report.scope_digest,
    summary,
    filters: {
      ...(options.unit === undefined ? {} : { unit: options.unit }),
      ...(options.itemKind === undefined ? {} : { item_kind: options.itemKind }),
    },
    available_item_kinds: [...new Set(allItems.map((item) => item.item_kind))].sort(),
    ...buildReportViewWindow({
      items: selectedItems,
      options,
      baseCommand,
      selectionPolicy: {
        id: "semantic-priority-then-stable-sequence",
        order: [{ field: "sequence", direction: "asc" }],
        note: "Elevated signals precede units, dimensions, guidance, page evidence, and prior decisions.",
      },
      completeKind: "audit_items_complete",
      nextPageKind: "read_next_audit_items_page",
      budgetTruncatedKind: "expand_audit_items_budget",
    }),
  };
}
