import {
  createDocumentSourceSpan,
  formatCanonicalProseSourceRef,
} from "@c4a/extract";
import { readCommittedSnapshotMarkdown } from "./documentEvidenceIndex.js";
import type {
  AlignDiagnostic,
  EvidenceContext,
  StructureViewPlan,
} from "./proseAlignTypes.js";
import type { CompileAction, CompileActionPayload } from "./proseCompileActionPayload.js";
import { compileDiagnostic } from "./proseCompileDiagnostics.js";
import {
  resolveExactActionRefs,
  validateActionRefsAgainstPlannedSection,
} from "./proseCompileSourceRefs.js";
import {
  isKnownProseSectionKind,
  isProseSectionKindMountable,
  mountableProseSectionKinds,
} from "./proseSectionKinds.js";
import { existingApprovedNodeSections } from "./proseCompileViews.js";
import type { ProseCandidateSection } from "./candidateLedger.js";

type ContentMode = "verbatim" | "empty";

export interface PreparedSection {
  section: ProseCandidateSection;
  source_refs: string[];
  content_mode: ContentMode;
}

function textForRange(markdown: string, start: number, end: number): string {
  return markdown.split(/\r?\n/u).slice(start - 1, end).join("\n");
}

function plannedSection(input: {
  node: StructureViewPlan;
  action: CompileAction;
  actionIndex: number;
  diagnostics: AlignDiagnostic[];
}): StructureViewPlan["sections"][number] | undefined {
  if (input.action.op === "skip") return undefined;
  if (input.action.section_id === undefined) return undefined;
  const section = input.node.sections.find((candidate) => candidate.id === input.action.section_id);
  if (section === undefined) {
    input.diagnostics.push(compileDiagnostic("error", "action.section_id_unknown", "schema", "section_id must reference a planned section on the confirmed structure node.", `actions[${input.actionIndex}].section_id`, {
      repair: {
        action: "choose_planned_section_id",
        available_section_ids: input.node.sections.map((candidate) => candidate.id),
      },
    }));
  }
  return section;
}

async function prepareVerbatimSection(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  action: CompileAction;
  actionIndex: number;
  diagnostics: AlignDiagnostic[];
}): Promise<PreparedSection | undefined> {
  const planned = plannedSection(input);
  if (planned === undefined) return undefined;
  const exactRefs = await resolveExactActionRefs(input);
  if (exactRefs === undefined) return undefined;
  const refsBelongToSection = await validateActionRefsAgainstPlannedSection({
    ...input,
    planned,
    actionRefs: exactRefs,
  });
  if (!refsBelongToSection) return undefined;
  const resolved = exactRefs.map((item) => item.resolved);
  const first = resolved[0]!;
  if (resolved.some((item) => item.span.source_type !== first.span.source_type ||
    item.span.source_name !== first.span.source_name ||
    item.span.document_path !== first.span.document_path)) {
    input.diagnostics.push(compileDiagnostic("error", "action.source_refs_not_same_document", "source_ref", "Verbatim action source_refs must come from one source document.", `actions[${input.actionIndex}].source_refs`));
    return undefined;
  }
  const sorted = [...resolved].sort((left, right) => left.span.line_start - right.span.line_start);
  let end = sorted[0]!.span.line_end;
  for (const item of sorted.slice(1)) {
    if (item.span.line_start > end + 1) {
      input.diagnostics.push(compileDiagnostic("error", "action.source_refs_not_contiguous", "source_ref", "Omitted-content verbatim action source_refs must form one continuous source span.", `actions[${input.actionIndex}].source_refs`));
      return undefined;
    }
    end = Math.max(end, item.span.line_end);
  }
  const lineStart = sorted[0]!.span.line_start;
  const lineEnd = end;
  const markdown = await readCommittedSnapshotMarkdown({
    projectRoot: input.projectRoot,
    index: input.evidence.index,
    path: first.span.document_path,
    cache: input.evidence.snapshotMarkdownCache,
  });
  const span = createDocumentSourceSpan(markdown, { lineStart, lineEnd });
  const canonical = formatCanonicalProseSourceRef({
    sourceType: first.span.source_type,
    sourceName: first.span.source_name,
    documentPath: first.span.document_path,
    span,
  });
  const componentRefs = [...new Set(exactRefs.map((item) => item.sourceRef))];
  return {
    section: {
      id: planned.id,
      kind: input.action.kind,
      ...(input.action.summary !== undefined ? { summary: input.action.summary } : {}),
      body: textForRange(markdown, lineStart, lineEnd),
      source_ref: canonical,
      source_refs: componentRefs,
      content_mode: "verbatim",
    },
    source_refs: [canonical, ...componentRefs],
    content_mode: "verbatim",
  };
}

async function prepareContentSection(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  action: CompileAction;
  actionIndex: number;
  diagnostics: AlignDiagnostic[];
}): Promise<PreparedSection | undefined> {
  input.diagnostics.push(compileDiagnostic("error", "action.content_unsupported", "content", "Compile actions no longer accept reader-visible content. Omit content so the CLI mirrors a continuous source span, split the planned section, or return to align for a new structure.", `actions[${input.actionIndex}].content`, {
    repair: {
      action: "omit_content_or_split_section",
    },
  }));
  return undefined;
}

export async function prepareActionSections(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  node: StructureViewPlan;
  payload: CompileActionPayload;
}): Promise<{
  diagnostics: AlignDiagnostic[];
  sections: PreparedSection[];
}> {
  const diagnostics: AlignDiagnostic[] = [];
  const sections: PreparedSection[] = [];
  const existing = await existingApprovedNodeSections({
    projectRoot: input.projectRoot,
    node: input.node,
  });
  const existingSectionIds = new Set(existing.sections.map((section) => section.id));
  if (input.payload.view_ref !== input.node.view_ref) {
    diagnostics.push(compileDiagnostic("error", "schema.view_ref_mismatch", "schema", "Compile payload view_ref must match the selected structure view_ref.", "view_ref", {
      repair: { expected_view_ref: input.node.view_ref, actual_view_ref: input.payload.view_ref },
    }));
  }
  const usedSectionIds = new Set<string>();
  for (const [index, action] of input.payload.actions.entries()) {
    if (action.op === "skip") continue;
    if (!isKnownProseSectionKind(action.kind)) {
      diagnostics.push(compileDiagnostic("error", "action.kind_invalid", "schema", "Action kind must use the current prose section kind set.", `actions[${index}].kind`, {
        repair: { action: "choose_supported_section_kind" },
      }));
      continue;
    }
    if (!isProseSectionKindMountable(input.node.node_type, action.kind)) {
      diagnostics.push(compileDiagnostic("error", "action.kind_mount_invalid", "schema", `Action kind ${action.kind} cannot be mounted on node_type ${input.node.node_type}.`, `actions[${index}].kind`, {
        repair: {
          action: "choose_kind_allowed_for_node_type_or_return_to_align",
          valid_kinds: mountableProseSectionKinds(input.node.node_type),
        },
      }));
      continue;
    }
    if (action.section_id !== undefined) {
      if (action.op === "add" && existingSectionIds.has(action.section_id)) {
        diagnostics.push(compileDiagnostic("error", "action.add_existing_section", "schema", "add cannot target an existing approved section; use update for the same section_id.", `actions[${index}].section_id`));
        continue;
      }
      if (action.op === "update" && !existingSectionIds.has(action.section_id)) {
        diagnostics.push(compileDiagnostic("error", "action.update_missing_section", "schema", "update must target an existing approved section; use add for a new section_id.", `actions[${index}].section_id`));
        continue;
      }
      if (usedSectionIds.has(action.section_id)) {
        diagnostics.push(compileDiagnostic("error", "action.section_id_duplicate", "duplicate", "section_id can only be materialized once per compile payload.", `actions[${index}].section_id`));
        continue;
      }
      usedSectionIds.add(action.section_id);
    }
    const section = action.content === undefined
      ? await prepareVerbatimSection({ projectRoot: input.projectRoot, evidence: input.evidence, node: input.node, action, actionIndex: index, diagnostics })
      : await prepareContentSection({ projectRoot: input.projectRoot, evidence: input.evidence, node: input.node, action, actionIndex: index, diagnostics });
    if (section !== undefined) sections.push(section);
  }
  return { diagnostics, sections };
}
