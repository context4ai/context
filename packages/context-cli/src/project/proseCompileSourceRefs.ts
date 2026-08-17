import {
  resolveProseSourceRef,
  type ResolvedProseSourceRef,
} from "./documentEvidenceIndex.js";
import {
  type AlignDiagnostic,
  type EvidenceContext,
  type StructureViewPlan,
} from "./proseAlignTypes.js";
import { diagnostic } from "./proseAlignSchemaUtils.js";
import {
  localizeRef,
  nodeLocalSources,
} from "./proseCompileViews.js";

export interface ResolvedCompileActionRef {
  sourceRef: string;
  resolved: ResolvedProseSourceRef;
}

async function resolveActionRef(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  sourceRef: string;
}): Promise<ResolvedProseSourceRef | null> {
  return resolveProseSourceRef({
    projectRoot: input.projectRoot,
    index: input.evidence.index,
    sourceRef: input.sourceRef,
    snapshotMarkdownCache: input.evidence.snapshotMarkdownCache,
  });
}

export async function resolveExactActionRefs(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  action: { source_refs: string[] };
  actionIndex: number;
  diagnostics: AlignDiagnostic[];
}): Promise<ResolvedCompileActionRef[] | undefined> {
  const localSources = nodeLocalSources(input.node);
  const refs = input.action.source_refs.map((ref) => localizeRef({ ref, localSources }));
  const resolved: ResolvedCompileActionRef[] = [];
  for (const [refIndex, ref] of refs.entries()) {
    const item = await resolveActionRef({ projectRoot: input.projectRoot, evidence: input.evidence, sourceRef: ref });
    if (item === null || item.status !== "exact") {
      input.diagnostics.push(diagnostic("error", "action.source_ref_unresolved", "source_ref", "Action source_ref must resolve exactly against current snapshot.", `actions[${input.actionIndex}].source_refs[${refIndex}]`, {
        source_ref: ref,
      }));
      continue;
    }
    resolved.push({ sourceRef: item.span.canonical_source_ref, resolved: item });
  }
  return resolved.length === refs.length && resolved.length > 0 ? resolved : undefined;
}

async function resolveExactPlannedSectionRefs(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  planned: StructureViewPlan["sections"][number];
  actionIndex: number;
  diagnostics: AlignDiagnostic[];
}): Promise<ResolvedCompileActionRef[] | undefined> {
  const localSources = nodeLocalSources(input.node);
  const refs = input.planned.source_refs.map((ref) => localizeRef({ ref, localSources }));
  const resolved: ResolvedCompileActionRef[] = [];
  for (const [refIndex, ref] of refs.entries()) {
    const item = await resolveActionRef({ projectRoot: input.projectRoot, evidence: input.evidence, sourceRef: ref });
    if (item === null || item.status !== "exact") {
      input.diagnostics.push(diagnostic("error", "planned_section.source_ref_unresolved", "source_ref", "Planned section source_ref must resolve exactly before compile actions can use it.", `actions[${input.actionIndex}].section_id`, {
        source_ref: ref,
        repair: {
          action: "return_to_align_structure",
          planned_section_id: input.planned.id,
          planned_source_ref_index: refIndex,
        },
      }));
      continue;
    }
    resolved.push({ sourceRef: item.span.canonical_source_ref, resolved: item });
  }
  return resolved.length === refs.length && resolved.length > 0 ? resolved : undefined;
}

function sameSourceDocument(left: ResolvedProseSourceRef["span"], right: ResolvedProseSourceRef["span"]): boolean {
  return left.source_type === right.source_type &&
    left.source_name === right.source_name &&
    left.document_path === right.document_path;
}

function sameSourceSpan(left: ResolvedProseSourceRef["span"], right: ResolvedProseSourceRef["span"]): boolean {
  return sameSourceDocument(left, right) &&
    left.line_start === right.line_start &&
    left.line_end === right.line_end;
}

function isContinuousMergeOfPlannedRefs(
  actionSpan: ResolvedProseSourceRef["span"],
  plannedSpans: readonly ResolvedProseSourceRef["span"][],
): boolean {
  if (plannedSpans.length === 0) return false;
  if (plannedSpans.some((span) => !sameSourceDocument(actionSpan, span))) return false;
  const sorted = [...plannedSpans].sort((left, right) => left.line_start - right.line_start);
  let end = sorted[0]!.line_end;
  for (const span of sorted.slice(1)) {
    if (span.line_start > end + 1) return false;
    end = Math.max(end, span.line_end);
  }
  return actionSpan.line_start === sorted[0]!.line_start && actionSpan.line_end === end;
}

function continuousRange(spans: readonly ResolvedProseSourceRef["span"][]): {
  start: number;
  end: number;
} | undefined {
  if (spans.length === 0) return undefined;
  const sorted = [...spans].sort((left, right) => left.line_start - right.line_start);
  let end = sorted[0]!.line_end;
  for (const span of sorted.slice(1)) {
    if (span.line_start > end + 1) return undefined;
    end = Math.max(end, span.line_end);
  }
  return { start: sorted[0]!.line_start, end };
}

export async function validateActionRefsAgainstPlannedSection(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  planned: StructureViewPlan["sections"][number];
  actionRefs: ResolvedCompileActionRef[];
  actionIndex: number;
  diagnostics: AlignDiagnostic[];
}): Promise<boolean> {
  const plannedRefs = await resolveExactPlannedSectionRefs(input);
  if (plannedRefs === undefined) return false;
  const plannedSpans = plannedRefs.map((item) => item.resolved.span);
  const firstPlanned = plannedSpans[0]!;
  if (plannedSpans.some((span) => !sameSourceDocument(firstPlanned, span))) {
    input.diagnostics.push(diagnostic("error", "planned_section.source_refs_not_same_document", "source_ref", "Planned section source_refs span multiple source documents. Return to align and split the section before compile.", `actions[${input.actionIndex}].section_id`, {
      repair: {
        action: "return_to_align_split_section",
        planned_section_id: input.planned.id,
        planned_source_refs: plannedRefs.map((item) => item.sourceRef),
      },
    }));
    return false;
  }
  const plannedRange = continuousRange(plannedSpans);
  if (plannedRange === undefined) {
    input.diagnostics.push(diagnostic("error", "planned_section.source_refs_not_contiguous", "source_ref", "Planned section source_refs are not one continuous source span. Return to align and split the section before compile.", `actions[${input.actionIndex}].section_id`, {
      repair: {
        action: "return_to_align_split_section",
        planned_section_id: input.planned.id,
        planned_source_refs: plannedRefs.map((item) => item.sourceRef),
      },
    }));
    return false;
  }
  let valid = true;
  for (const [refIndex, ref] of input.actionRefs.entries()) {
    const span = ref.resolved.span;
    if (plannedSpans.some((planned) => sameSourceSpan(span, planned))) continue;
    if (isContinuousMergeOfPlannedRefs(span, plannedSpans)) continue;
    valid = false;
    input.diagnostics.push(diagnostic("error", "action.source_ref_outside_section", "source_ref", "Action source_refs must come from the planned section source_refs or their continuous canonical merge.", `actions[${input.actionIndex}].source_refs[${refIndex}]`, {
      source_ref: ref.sourceRef,
      repair: {
        action: "use_planned_section_source_refs_or_realign",
        planned_section_id: input.planned.id,
        planned_source_refs: plannedRefs.map((item) => item.sourceRef),
      },
    }));
  }
  const actionSpans = input.actionRefs.map((item) => item.resolved.span);
  const actionRange = actionSpans.length > 0 && actionSpans.every((span) => sameSourceDocument(firstPlanned, span))
    ? continuousRange(actionSpans)
    : undefined;
  if (
    actionRange === undefined ||
    actionRange.start !== plannedRange.start ||
    actionRange.end !== plannedRange.end
  ) {
    valid = false;
    input.diagnostics.push(diagnostic("error", "action.source_refs_incomplete_section", "source_ref", "Action source_refs must cover every planned source_ref for this section. Return to align and split the section if only part of the evidence should be materialized.", `actions[${input.actionIndex}].source_refs`, {
      repair: {
        action: "use_all_planned_section_source_refs_or_realign",
        planned_section_id: input.planned.id,
        planned_source_refs: plannedRefs.map((item) => item.sourceRef),
      },
    }));
  }
  return valid;
}
