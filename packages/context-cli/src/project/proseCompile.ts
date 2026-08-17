import {
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  type CompileProsePhaseDefinition,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { isSafeEntityId } from "./entityId.js";
import {
  alignCommand,
  suggestedCompilePayloadPath,
  type AlignDiagnostic,
  type AlignPayload,
  type EvidenceContext,
  type StructureViewPlan,
} from "./proseAlignTypes.js";
import { COMPILE_GATE_SCHEMA_VERSION } from "./proseCompileConstants.js";
import { compileSemanticRules } from "./proseCompileSemanticRules.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import {
  resolveProseSourceRef,
  type ResolvedProseSourceRef,
} from "./documentEvidenceIndex.js";
import {
  existingApprovedNodeSections,
  localizeRef,
  nodeLocalSources,
  type ExistingApprovedSection,
} from "./proseCompileViews.js";
import {
  type PreparedSection,
  prepareActionSections,
} from "./proseCompileMaterialize.js";
import {
  parseCompilePayload,
} from "./proseCompileActionPayload.js";
import { compileDiagnostic } from "./proseCompileDiagnostics.js";
import { loadCompileInput } from "./proseCompileStructure.js";
import {
  type CompileRunOptions,
  type CompileRunResult,
  type CompileStageResult,
  type CompileValidateResult,
} from "./proseCompileTypes.js";
import { diagnosticsView } from "./diagnosticsView.js";
import {
  type ProseCandidateSection,
} from "./candidateLedger.js";
import { runCompileViewRequest } from "./proseCompileViewRequest.js";
import { compileRepairNextAction } from "./proseCompileRepairNext.js";
import {
  candidateRecord,
  compileBatchNextAction,
  writeCompileCandidates,
} from "./proseCompileCandidates.js";
import { runParentIndexCompileRequest } from "./proseCompileParentIndex.js";
import { runDeterministicCompileBatch } from "./proseCompileDeterministic.js";

export { isProseCompileRunResult } from "./proseCompileTypes.js";

function userError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function existingToCandidateSection(section: ExistingApprovedSection): ProseCandidateSection {
  const sourceRef = section.source_refs[0] ?? "";
  return {
    id: section.id,
    kind: section.kind,
    ...(section.summary !== undefined ? { summary: section.summary } : {}),
    body: section.reader_visible_body,
    source_ref: sourceRef,
    source_refs: section.source_refs,
    ...(section.content_mode !== undefined ? { content_mode: section.content_mode } : {}),
  };
}

type ResolvedCompileSectionRef = {
  sourceRef: string;
  resolved: ResolvedProseSourceRef;
};

function sameSourceDocument(left: ResolvedProseSourceRef["span"], right: ResolvedProseSourceRef["span"]): boolean {
  return left.source_type === right.source_type &&
    left.source_name === right.source_name &&
    left.document_path === right.document_path;
}

function sectionSpanRange(spans: readonly ResolvedProseSourceRef["span"][]): {
  first: ResolvedProseSourceRef["span"];
  start: number;
  end: number;
} | undefined {
  if (spans.length === 0) return undefined;
  const first = spans[0]!;
  if (spans.some((span) => !sameSourceDocument(first, span))) return undefined;
  const sorted = [...spans].sort((left, right) => left.line_start - right.line_start);
  let end = sorted[0]!.line_end;
  for (const span of sorted.slice(1)) {
    if (span.line_start > end + 1) return undefined;
    end = Math.max(end, span.line_end);
  }
  return { first, start: sorted[0]!.line_start, end };
}

function sectionRefRangesMatch(input: {
  existing: readonly ResolvedCompileSectionRef[];
  planned: readonly ResolvedCompileSectionRef[];
}): boolean {
  const existingRange = sectionSpanRange(input.existing.map((item) => item.resolved.span));
  const plannedRange = sectionSpanRange(input.planned.map((item) => item.resolved.span));
  return existingRange !== undefined &&
    plannedRange !== undefined &&
    sameSourceDocument(existingRange.first, plannedRange.first) &&
    existingRange.start === plannedRange.start &&
    existingRange.end === plannedRange.end;
}

async function resolveExactSectionRefs(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  refs: readonly string[];
  field: string;
  diagnostics: AlignDiagnostic[];
  diagnosticCode: string;
  message: string;
}): Promise<ResolvedCompileSectionRef[] | undefined> {
  const localSources = nodeLocalSources(input.node);
  const resolved: ResolvedCompileSectionRef[] = [];
  for (const [index, rawRef] of input.refs.entries()) {
    const sourceRef = localizeRef({ ref: rawRef, localSources });
    const item = await resolveProseSourceRef({
      projectRoot: input.projectRoot,
      index: input.evidence.index,
      sourceRef,
      snapshotMarkdownCache: input.evidence.snapshotMarkdownCache,
    });
    if (item === null || item.status !== "exact") {
      input.diagnostics.push(compileDiagnostic("error", input.diagnosticCode, "source_ref", input.message, `${input.field}[${index}]`, {
        source_ref: sourceRef,
        repair: {
          action: "rerun_align_or_compile_against_current_snapshot",
          status: item?.status ?? "unresolved",
        },
      }));
      continue;
    }
    resolved.push({ sourceRef: item.span.canonical_source_ref, resolved: item });
  }
  return resolved.length === input.refs.length && resolved.length > 0 ? resolved : undefined;
}

async function existingSectionReuseDiagnostics(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  preparedSections: readonly PreparedSection[];
}): Promise<AlignDiagnostic[]> {
  const diagnostics: AlignDiagnostic[] = [];
  const existing = await existingApprovedNodeSections({
    projectRoot: input.projectRoot,
    node: input.node,
  });
  if (existing.sections.length === 0) return diagnostics;

  const preparedSectionIds = new Set(input.preparedSections.map((section) => section.section.id));
  const plannedById = new Map(input.node.sections.map((section) => [section.id, section]));
  for (const [sectionIndex, section] of existing.sections.entries()) {
    if (preparedSectionIds.has(section.id)) continue;
    const planned = plannedById.get(section.id);
    if (planned === undefined) continue;
    const existingRefs = await resolveExactSectionRefs({
      projectRoot: input.projectRoot,
      evidence: input.evidence,
      node: input.node,
      refs: section.source_refs,
      field: `existing_sections[${sectionIndex}].source_refs`,
      diagnostics,
      diagnosticCode: "existing_section.source_ref_not_exact",
      message: "Approved section source_refs reused by this candidate must still resolve exactly against the current source snapshot.",
    });
    const plannedRefs = await resolveExactSectionRefs({
      projectRoot: input.projectRoot,
      evidence: input.evidence,
      node: input.node,
      refs: planned.source_refs,
      field: `views[${input.node.view_ref}].sections[${planned.id}].source_refs`,
      diagnostics,
      diagnosticCode: "planned_section.source_ref_unresolved",
      message: "Planned section source_refs must resolve exactly before existing approved content can be reused.",
    });
    if (existingRefs === undefined || plannedRefs === undefined) continue;
    if (!sectionRefRangesMatch({ existing: existingRefs, planned: plannedRefs })) {
      diagnostics.push(compileDiagnostic("error", "existing_section.source_ref_outside_current_section", "source_ref", "Approved section source_refs reused by this candidate must still belong to the current confirmed section source_refs.", `existing_sections[${sectionIndex}].source_refs`, {
        repair: {
          action: "rerun_compile_or_return_to_align_for_current_section",
          section_id: section.id,
          existing_source_refs: existingRefs.map((item) => item.sourceRef),
          planned_source_refs: plannedRefs.map((item) => item.sourceRef),
        },
      }));
    }
  }
  return diagnostics;
}

async function mergedCandidateSections(input: {
  projectRoot: string;
  node: StructureViewPlan;
  preparedSections: PreparedSection[];
}): Promise<ProseCandidateSection[]> {
  const existing = await existingApprovedNodeSections({
    projectRoot: input.projectRoot,
    node: input.node,
  });
  const preparedById = new Map(input.preparedSections.map((section) => [section.section.id, section.section]));
  const existingById = new Map(existing.sections.map((section) => [section.id, existingToCandidateSection(section)]));
  const ordered: ProseCandidateSection[] = [];
  const seen = new Set<string>();
  for (const planned of input.node.sections) {
    const next = preparedById.get(planned.id) ?? existingById.get(planned.id);
    if (next === undefined) continue;
    ordered.push(next);
    seen.add(planned.id);
  }
  for (const section of input.preparedSections) {
    if (seen.has(section.section.id)) continue;
    ordered.push(section.section);
    seen.add(section.section.id);
  }
  return ordered;
}

function payloadView(input: {
  structure: AlignPayload;
  viewRef: string | undefined;
  diagnostics: AlignDiagnostic[];
}): StructureViewPlan | undefined {
  if (input.viewRef === undefined || input.viewRef.length === 0) return undefined;
  const node = input.structure.views.find((candidate) => candidate.view_ref === input.viewRef);
  if (node !== undefined) return node;
  input.diagnostics.push(compileDiagnostic("error", "schema.view_ref_unknown", "schema", "Compile payload view_ref must reference an existing confirmed structure view_ref.", "view_ref", {
    repair: {
      action: "choose_existing_view_ref",
      available_view_refs: input.structure.views.map((candidate) => candidate.view_ref),
    },
  }));
  return undefined;
}

async function runCompileActionPayloadRequest(input: {
  evidence: EvidenceContext;
  options: CompileRunOptions;
  phase: CompileProsePhaseDefinition;
  projectRoot: string;
  structure: AlignPayload;
}): Promise<CompileRunResult> {
  const rawPayload = await readYamlOrJsonInput({
    path: input.options.input,
    label: "compile action payload",
    missingNext: "Generate a payload from the compile context view, then validate it before staging.",
    readFailureNext: "Pass the compile actions YAML/JSON file, or use --input - to read stdin.",
    parseFailureNext: "Fix payload syntax, then rerun --validate before --stage.",
  });
  const parsed = parseCompilePayload(rawPayload);
  const node = payloadView({ structure: input.structure, viewRef: parsed.payload?.view_ref, diagnostics: parsed.diagnostics });
  const prepared = parsed.payload === undefined || node === undefined
    ? { diagnostics: [] as AlignDiagnostic[], sections: [] as PreparedSection[] }
    : await prepareActionSections({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        node,
        payload: parsed.payload,
      });
  const reuseDiagnostics = parsed.payload === undefined || node === undefined
    ? []
    : await existingSectionReuseDiagnostics({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        node,
        preparedSections: prepared.sections,
      });
  const diagnostics = [...parsed.diagnostics, ...prepared.diagnostics, ...reuseDiagnostics];
  const result = compileValidateResult({
    diagnostics,
    phase: input.phase,
    ...(input.options.input !== undefined ? { inputPath: input.options.input } : {}),
    preparedSections: prepared.sections,
    structure: input.structure,
    viewRef: parsed.payload?.view_ref,
    actionCount: parsed.payload?.actions.length ?? 0,
  });
  if (input.options.stage !== true) return result;
  return await stageCompileActionPayload({
    diagnostics,
    evidence: input.evidence,
    node,
    phase: input.phase,
    preparedSections: prepared.sections,
    projectRoot: input.projectRoot,
    result,
    structure: input.structure,
  });
}

function compileValidateResult(input: {
  actionCount: number;
  diagnostics: AlignDiagnostic[];
  phase: CompileProsePhaseDefinition;
  inputPath?: string;
  preparedSections: readonly PreparedSection[];
  structure: AlignPayload;
  viewRef: string | undefined;
}): CompileValidateResult {
  const errors = input.diagnostics.filter((item) => item.severity === "error");
  const payloadPath = input.inputPath ?? suggestedCompilePayloadPath(input.phase.id);
  const node = input.structure.views.find((view) => view.view_ref === input.viewRef);
  const semanticRules = compileSemanticRules({
    view: "node-context",
    structure: input.structure,
    ...(node !== undefined ? { node } : {}),
  });
  return {
    kind: "prose.compile.validate.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    payload_schema: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
    state: errors.length === 0 ? "ready" : "invalid",
    valid: errors.length === 0,
    view_ref: input.viewRef ?? "unknown",
    actions: input.actionCount,
    views: node === undefined ? 0 : 1,
    sections: input.preparedSections.length,
    diagnostics: input.diagnostics,
    diagnostics_view: {
      total: input.diagnostics.length,
      page_size: 25,
      command: alignCommand(input.phase.id, ["--view", "diagnostics", "--input", payloadPath, "--format", "json"]),
    },
    semantic_rules: semanticRules,
    semantic_reference_files: semanticRules.required,
    next_action: errors.length === 0
      ? {
          kind: "stage_compile_actions",
          effect: "write",
          command: alignCommand(input.phase.id, [
            "--stage",
            "--input",
            payloadPath,
            "--format",
            "json",
          ]),
        }
      : {
          ...compileRepairNextAction({
            phase: input.phase,
            structure: input.structure,
            viewRef: input.viewRef,
            diagnostics: input.diagnostics,
          }),
        },
  };
}

async function stageCompileActionPayload(input: {
  diagnostics: AlignDiagnostic[];
  evidence: EvidenceContext;
  node: StructureViewPlan | undefined;
  phase: CompileProsePhaseDefinition;
  preparedSections: PreparedSection[];
  projectRoot: string;
  result: CompileValidateResult;
  structure: AlignPayload;
}): Promise<CompileStageResult> {
  if (!input.result.valid) {
    throw userError("context.compile-actions.v1 payload is not valid", {
      diagnostics: input.diagnostics,
      next: input.result.next_action,
    });
  }
  if (input.node === undefined) {
    throw userError("compile payload node is not available", {
      diagnostics: input.diagnostics,
      next: input.result.next_action,
    });
  }
  if (!isSafeEntityId(input.node.node_ref)) {
    throw userError("compile node_ref is not a safe knowledge id", {
      node_ref: input.node.node_ref,
    });
  }
  if (input.preparedSections.length === 0) return emptyCompileStageResult(input.phase, input.node);
  const sections = await mergedCandidateSections({
    projectRoot: input.projectRoot,
    node: input.node,
    preparedSections: input.preparedSections,
  });
  const record = candidateRecord({
    evidence: input.evidence,
    structure: input.structure,
    node: input.node,
    sections,
  });
  const candidates = await writeCompileCandidates({
    projectRoot: input.projectRoot,
    records: [record],
  });
  const nextAction = await compileBatchNextAction(input);
  return {
    kind: "prose.compile.stage.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    views: 1,
    sections: sections.length,
    candidateFile: ".tmp/context-runtime/lifecycle/candidates.jsonl",
    candidates,
    next_action: nextAction,
  };
}

function emptyCompileStageResult(
  phase: CompileProsePhaseDefinition,
  node: StructureViewPlan,
): CompileStageResult {
  return {
    kind: "prose.compile.stage.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    views: 1,
    sections: 0,
    candidateFile: ".tmp/context-runtime/lifecycle/candidates.jsonl",
    candidates: {
      added: 0,
      updated: 0,
      unchanged: 0,
      skippedRejected: 0,
      replacedIdentityConflicts: 0,
    },
    next_action: {
      kind: "no_review_candidates",
      command: `context run ${phase.id} --view node-context --source ${node.view_ref} --format json`,
    },
  };
}

export async function runCompileProsePhase(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  options: CompileRunOptions;
}): Promise<CompileRunResult> {
  const view = input.options.schema === true ? "schema" : input.options.view ?? (input.options.validate || input.options.stage ? undefined : "read-plan");
  const readOnly = input.options.validate !== true && input.options.stage !== true;
  const { evidence, structure } = await loadCompileInput({
    ...input,
    ...(readOnly ? { readOnly: true } : {}),
    ...((view === "blockers" || view === "schema") && readOnly
      ? { allowInvalidStructureForReadOnly: true }
      : view !== undefined && readOnly
      ? { allowInvalidApprovedStructureForReadOnly: true }
      : {}),
  });
  if (readOnly) {
    if (view === "diagnostics") {
      const validation = await runDeterministicCompileBatch({
        evidence,
        options: { ...input.options, stage: false },
        phase: input.phase,
        projectRoot: input.projectRoot,
        structure,
      });
      const diagnostics = "diagnostics" in validation && Array.isArray(validation.diagnostics)
        ? validation.diagnostics
        : [];
      return diagnosticsView({
        diagnostics,
        baseCommand: `context run ${input.phase.id} --view diagnostics`,
        ...(input.options.pageToken !== undefined ? { pageToken: input.options.pageToken } : {}),
        ...(input.options.pageSize !== undefined ? { pageSize: input.options.pageSize } : {}),
      });
    }
    return await runCompileViewRequest({
      evidence,
      projectRoot: input.projectRoot,
      phase: input.phase,
      source: input.options.source,
      rule: input.options.rule,
      readCursor: input.options.readCursor,
      pageSize: input.options.pageSize,
      structure,
      view,
    });
  }

  if (input.options.input === undefined) {
    return runDeterministicCompileBatch({
      evidence,
      options: input.options,
      phase: input.phase,
      projectRoot: input.projectRoot,
      structure,
    });
  }
  const parentIndexResult = await runParentIndexCompileRequest({
    evidence,
    options: input.options,
    phase: input.phase,
    projectRoot: input.projectRoot,
    structure,
  });
  if (parentIndexResult !== undefined) return parentIndexResult;
  return await runCompileActionPayloadRequest({
    evidence,
    options: input.options,
    phase: input.phase,
    projectRoot: input.projectRoot,
    structure,
  });
}
