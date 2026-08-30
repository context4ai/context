import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import type {
  ExtractionBatchPreview,
  ExtractionIndexUnitPreview,
  ExtractionPhasePreview,
} from "./extractCandidateTypes.js";
import {
  buildReportViewWindow,
  reportViewBaseCommand,
  type ReportViewItem,
  type ReportViewOptions,
} from "./reportViewBudget.js";

export type ExtractionPreviewViewName = "summary" | "items";

export interface ExtractionPreviewOutputOptions extends ReportViewOptions {
  view?: string;
  indexUnit?: string;
  itemKind?: string;
}

interface ExtractionPreviewItem extends ReportViewItem {
  phase_id: string;
  index_unit_id?: string;
}

function viewName(value: string | undefined): ExtractionPreviewViewName {
  if (value === undefined || value === "summary") return "summary";
  if (value === "items") return value;
  throw new ContextError(ExitCode.UserError, "extraction preview --view must be summary or items", {
    category: ErrorCategory.UserInputInvalid,
    view: value,
    valid_views: ["summary", "items"],
  });
}

function itemId(parts: Record<string, unknown>): string {
  return `preview-item:${stableHash(parts, 20)}`;
}

function pushItem(
  items: ExtractionPreviewItem[],
  input: Omit<ExtractionPreviewItem, "item_id">,
): void {
  items.push({
    item_id: itemId(input),
    ...input,
  } as ExtractionPreviewItem);
}

function pushTextItems(input: {
  items: ExtractionPreviewItem[];
  phaseId: string;
  indexUnitId?: string;
  itemKind: string;
  values: readonly string[];
}): void {
  for (const text of input.values) {
    pushItem(input.items, {
      item_kind: input.itemKind,
      phase_id: input.phaseId,
      ...(input.indexUnitId === undefined ? {} : { index_unit_id: input.indexUnitId }),
      text,
    });
  }
}

function pushUnitItems(
  items: ExtractionPreviewItem[],
  phaseId: string,
  unit: ExtractionIndexUnitPreview,
): void {
  const unitId = unit.id;
  const inventory = unit.inventory;
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "module-type-evidence", values: unit.moduleTypeEvidence });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "declared-document", values: unit.documents });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "declared-entry", values: unit.entries });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "declared-protocol", values: unit.protocols });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "declared-exclusion", values: unit.exclusions });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "eligible-file", values: inventory.eligibleFileTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "analyzed-file", values: inventory.analyzedFileTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "document", values: inventory.documentTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "root-document", values: inventory.rootDocumentTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "read-document", values: inventory.readDocumentTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "referenced-document", values: inventory.referencedDocumentTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "target-symbol", values: inventory.targetSymbolIdentities });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "exported-target", values: inventory.exportedTargetIdentities });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "inventory-entry", values: inventory.entryTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "inventory-protocol", values: inventory.protocolTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "excluded-file", values: inventory.excludedFileTargets });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "exclusion-reason", values: inventory.excludedReasons });
  pushTextItems({ items, phaseId, indexUnitId: unitId, itemKind: "parser-skipped-file", values: inventory.parserSkippedFileTargets });
  for (const target of inventory.boundaryTargets) {
    pushItem(items, {
      item_kind: "boundary-target",
      phase_id: phaseId,
      index_unit_id: unitId,
      boundary_kind: target.kind,
      identity: target.identity,
    });
  }
  for (const target of inventory.coveredBoundaryTargets) {
    pushItem(items, {
      item_kind: "covered-boundary-target",
      phase_id: phaseId,
      index_unit_id: unitId,
      boundary_kind: target.kind,
      identity: target.identity,
    });
  }
  for (const group of inventory.identityGroups) {
    pushItem(items, {
      item_kind: "identity-group",
      phase_id: phaseId,
      index_unit_id: unitId,
      group_id: group.id,
      view_ref: group.viewRef,
      member_count: group.members.length,
      source_file_count: group.sourceFiles.length,
    });
    for (const identity of group.members) {
      pushItem(items, {
        item_kind: "identity-group-member",
        phase_id: phaseId,
        index_unit_id: unitId,
        group_id: group.id,
        identity,
      });
    }
    for (const text of group.sourceFiles) {
      pushItem(items, {
        item_kind: "identity-group-source-file",
        phase_id: phaseId,
        index_unit_id: unitId,
        group_id: group.id,
        text,
      });
    }
  }
  for (const candidate of inventory.chainCandidates) {
    pushItem(items, {
      item_kind: "chain-candidate",
      phase_id: phaseId,
      index_unit_id: unitId,
      candidate_id: candidate.id,
      family: candidate.family,
      from: candidate.from,
      to: candidate.to,
      confidence: candidate.confidence,
      source_file_count: candidate.sourceFiles.length,
    });
    for (const text of candidate.sourceFiles) {
      pushItem(items, {
        item_kind: "chain-candidate-source-file",
        phase_id: phaseId,
        index_unit_id: unitId,
        candidate_id: candidate.id,
        text,
      });
    }
  }
  for (const decision of inventory.chainCandidateDecisions) {
    pushItem(items, {
      item_kind: "chain-candidate-decision",
      phase_id: phaseId,
      index_unit_id: unitId,
      candidate_id: decision.candidateId,
      decision: decision.decision,
      ...(decision.viewRef === undefined ? {} : { view_ref: decision.viewRef }),
      ...(decision.canonicalChainId === undefined ? {} : { canonical_chain_id: decision.canonicalChainId }),
      ...(decision.reason === undefined ? {} : { text: decision.reason }),
    });
  }
  for (const directory of unit.topDirectories) {
    pushItem(items, {
      item_kind: "top-directory",
      phase_id: phaseId,
      index_unit_id: unitId,
      path: directory.path,
      count: directory.count,
    });
  }
  for (const page of unit.contentBytes.topPages) {
    pushItem(items, {
      item_kind: "largest-page",
      phase_id: phaseId,
      index_unit_id: unitId,
      path: page.path,
      bytes: page.bytes,
    });
  }
  for (const gap of unit.structuralCoverage?.uncovered ?? []) {
    pushItem(items, {
      item_kind: "structural-coverage-gap",
      phase_id: phaseId,
      index_unit_id: unitId,
      gap_id: gap.id,
      capability: gap.capability,
      structural_kind: gap.kind,
      source: gap.source,
      expected_path_count: gap.expectedPaths.length,
    });
    pushTextItems({
      items,
      phaseId,
      indexUnitId: unitId,
      itemKind: "structural-coverage-expected-path",
      values: gap.expectedPaths,
    });
  }
}

function pushPhaseItems(items: ExtractionPreviewItem[], phase: ExtractionPhasePreview): void {
  for (const source of phase.sources) {
    pushItem(items, {
      item_kind: "source",
      phase_id: phase.phaseId,
      source: source.name,
      ref: source.ref,
      ...(source.head === undefined ? {} : { head: source.head }),
      scope_hash: source.scopeHash,
      materialized_at: source.materializedAt,
    });
  }
  for (const unit of phase.indexUnits) pushUnitItems(items, phase.phaseId, unit);
  for (const hint of phase.agent_hints) {
    pushItem(items, {
      item_kind: "agent-hint",
      phase_id: phase.phaseId,
      code: hint.code,
      severity: hint.severity,
      text: hint.message,
      ...(hint.command === undefined ? {} : { command: hint.command }),
    });
  }
  if (phase.phaseKind === "phase.extract.ts") {
    pushTextItems({ items, phaseId: phase.phaseId, itemKind: "knowledge-tree-line", values: phase.knowledgeTree });
    for (const example of phase.knowledgePathExamples) {
      pushItem(items, {
        item_kind: "knowledge-path-example",
        phase_id: phase.phaseId,
        candidate_id: example.id,
        title: example.title,
        candidate_kind: example.kind,
        source: example.source,
        module: example.module,
        path: example.path,
        source_ref: example.source_ref,
      });
    }
    for (const source of phase.sources) {
      for (const module of source.modules) {
        pushItem(items, {
          item_kind: "source-module",
          phase_id: phase.phaseId,
          source: source.name,
          module: module.name,
          path: module.path,
          ...(module.version === undefined ? {} : { version: module.version }),
          files: module.files,
          discovered_files: module.discoveredFiles,
          analyzed_files: module.analyzedFiles,
          skipped_files: module.skippedFiles,
          total_lines: module.totalLines,
          symbols: module.symbols,
          exported_symbols: module.exportedSymbols,
          internal_symbols: module.internalSymbols,
          relations: module.relations,
          candidate_estimate: module.candidateEstimate,
        });
        pushTextItems({
          items,
          phaseId: phase.phaseId,
          itemKind: "module-entry-file",
          values: module.entryFiles,
        });
        pushTextItems({
          items,
          phaseId: phase.phaseId,
          itemKind: "module-skipped-reason",
          values: module.skippedReasons,
        });
      }
      for (const error of source.moduleErrors) {
        pushItem(items, {
          item_kind: "module-error",
          phase_id: phase.phaseId,
          source: source.name,
          module_path: error.module_path,
          text: error.error,
        });
      }
    }
    return;
  }
  for (const finding of phase.inspection.findings) {
    pushItem(items, {
      item_kind: "inspection-finding",
      phase_id: phase.phaseId,
      index_unit_id: finding.indexUnitId,
      source: finding.source,
      finding_kind: finding.kind,
      text: finding.summary,
      ...(finding.path === undefined ? {} : { path: finding.path }),
    });
  }
  for (const gap of phase.inspection.capabilityGaps) {
    pushItem(items, {
      item_kind: "capability-gap",
      phase_id: phase.phaseId,
      index_unit_id: gap.indexUnitId,
      text: gap.reason,
      ...(gap.requestedMaterial === undefined ? {} : { requested_material: gap.requestedMaterial }),
    });
  }
  for (const probe of phase.inspection.structuralProbes) {
    pushItem(items, {
      item_kind: "structural-probe",
      phase_id: phase.phaseId,
      source: probe.source,
      probe_id: probe.id,
      capability: probe.capability,
      structural_kind: probe.kind,
      profiles: [...probe.profiles],
      path_count: probe.paths.length,
      text: probe.summary,
    });
    pushTextItems({ items, phaseId: phase.phaseId, itemKind: "structural-probe-path", values: probe.paths });
  }
}

export function extractionPreviewItems(preview: ExtractionBatchPreview): ExtractionPreviewItem[] {
  const items: ExtractionPreviewItem[] = [];
  for (const phase of preview.phases) pushPhaseItems(items, phase);
  return items.sort((left, right) =>
    left.phase_id.localeCompare(right.phase_id) ||
    String(left.index_unit_id ?? "").localeCompare(String(right.index_unit_id ?? "")) ||
    left.item_kind.localeCompare(right.item_kind) ||
    left.item_id.localeCompare(right.item_id)
  );
}

function unitSummaryItems(preview: ExtractionBatchPreview): ReportViewItem[] {
  return preview.phases.flatMap((phase) => phase.indexUnits.map((unit) => ({
    item_id: `${phase.phaseId}/${unit.id}`,
    item_kind: "index-unit",
    phase_id: phase.phaseId,
    index_unit_id: unit.id,
    output_owner: unit.outputOwner,
    module_types: unit.moduleTypes,
    facets: unit.facets,
    output_profile: unit.outputProfile,
    plan: unit.plan,
    responsibility: unit.responsibility,
    current_pages: unit.currentPageCount,
    projected_pages: unit.projectedPageCount,
    candidate_estimate: unit.candidateEstimate,
    changes: unit.changes,
    scale: unit.scale,
    visibility: unit.visibility,
    content_bytes: unit.contentBytes.total,
    maximum_page_bytes: unit.contentBytes.max,
    inventory_counts: {
      eligible_files: unit.inventory.eligibleFiles,
      analyzed_files: unit.inventory.analyzedFiles,
      documents_discovered: unit.inventory.documentsDiscovered,
      documents_read: unit.inventory.documentsRead,
      target_symbols: unit.inventory.targetSymbols,
      exported_symbols: unit.inventory.exportedSymbols,
      identity_groups: unit.inventory.identityGroups.length,
      chain_candidates: unit.inventory.chainCandidates.length,
      excluded_files: unit.inventory.excludedFiles,
      parser_skipped_files: unit.inventory.parserSkippedFiles,
    },
    risks: unit.risks,
  })));
}

export function extractionPreviewItemsCommand(digest: string): string {
  return reportViewBaseCommand({
    command: "context run --preview-extraction-batch",
    args: [
      ["--preview-digest", digest],
      ["--view", "items"],
    ],
  });
}

export function buildExtractionPreviewOutput(
  preview: ExtractionBatchPreview,
  options: ExtractionPreviewOutputOptions = {},
): Record<string, unknown> {
  const view = viewName(options.view);
  const summary = {
    phases: preview.totals.phases,
    index_units: preview.totals.indexUnits,
    projected_pages: preview.totals.projectedPages,
    content_bytes: preview.totals.contentBytes,
    warning_units: preview.totals.warnings,
    blocked_units: preview.totals.blocked,
    advisories: preview.advisories,
    capability_clear: preview.capabilityClear,
    ownership_clear: preview.ownershipClear,
    scale_clear: preview.scaleClear,
    reusable_phase_caches: preview.cache.reusablePhases,
  };
  if (view === "summary") {
    const baseCommand = reportViewBaseCommand({
      command: "context run --preview-extraction-batch",
      args: [
        ["--preview-digest", preview.digest],
        ["--view", "summary"],
      ],
    });
    const result = buildReportViewWindow({
      items: unitSummaryItems(preview),
      options,
      baseCommand,
      selectionPolicy: {
        id: "phase-and-index-unit-order",
        order: [
          { field: "phase_id", direction: "asc" },
          { field: "index_unit_id", direction: "asc" },
        ],
      },
      completeKind: "preview_summary_complete",
      nextPageKind: "read_next_preview_summary_page",
      budgetTruncatedKind: "expand_preview_summary_budget",
    });
    const itemsCommand = `${extractionPreviewItemsCommand(preview.digest)} --page-size 25 --token-budget 2000 --byte-budget 24000 --format json`;
    return {
      schema: "context.extraction-batch-preview-view.v1",
      view,
      preview_digest: preview.digest,
      summary,
      ...result,
      views: [{
        id: "preview-items",
        purpose: "Read the complete digest-bound preview report as stable, budgeted items.",
        command: itemsCommand,
      }],
      ...(result.next_action.kind === "preview_summary_complete"
        ? {
            next_action: {
              kind: "read_preview_items",
              command: itemsCommand,
              reason_code: "extraction-preview-items-required",
            },
          }
        : {}),
    };
  }

  const allItems = extractionPreviewItems(preview);
  const selectedItems = allItems.filter((item) =>
    (options.indexUnit === undefined || item.index_unit_id === options.indexUnit) &&
    (options.itemKind === undefined || item.item_kind === options.itemKind)
  );
  if (options.indexUnit !== undefined && !allItems.some((item) => item.index_unit_id === options.indexUnit)) {
    throw new ContextError(ExitCode.UserError, "--index-unit does not match this extraction preview", {
      category: ErrorCategory.UserInputInvalid,
      index_unit: options.indexUnit,
      available_index_units: [...new Set(allItems.flatMap((item) => item.index_unit_id === undefined ? [] : [item.index_unit_id]))],
    });
  }
  const baseCommand = reportViewBaseCommand({
    command: "context run --preview-extraction-batch",
    args: [
      ["--preview-digest", preview.digest],
      ["--view", "items"],
      ...(options.indexUnit === undefined ? [] : [["--index-unit", options.indexUnit] as [string, string]]),
      ...(options.itemKind === undefined ? [] : [["--item-kind", options.itemKind] as [string, string]]),
    ],
  });
  return {
    schema: "context.extraction-batch-preview-view.v1",
    view,
    preview_digest: preview.digest,
    summary,
    filters: {
      ...(options.indexUnit === undefined ? {} : { index_unit: options.indexUnit }),
      ...(options.itemKind === undefined ? {} : { item_kind: options.itemKind }),
    },
    available_item_kinds: [...new Set(allItems.map((item) => item.item_kind))].sort(),
    ...buildReportViewWindow({
      items: selectedItems,
      options,
      baseCommand,
      selectionPolicy: {
        id: "phase-unit-kind-and-stable-id",
        order: [
          { field: "phase_id", direction: "asc" },
          { field: "index_unit_id", direction: "asc" },
          { field: "item_kind", direction: "asc" },
          { field: "item_id", direction: "asc" },
        ],
      },
      completeKind: "preview_items_complete",
      nextPageKind: "read_next_preview_items_page",
      budgetTruncatedKind: "expand_preview_items_budget",
    }),
  };
}
