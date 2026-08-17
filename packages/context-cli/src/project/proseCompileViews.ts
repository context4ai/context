import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  type CompileProsePhaseDefinition,
} from "@c4a/context";
import { parseSpanSourceRef } from "@c4a/extract";
import {
  resolveProseSourceRef,
  type RuntimeEvidenceSpan,
} from "./documentEvidenceIndex.js";
import { COMPILE_GATE_SCHEMA_VERSION, STRUCTURE_FILE } from "./proseCompileConstants.js";
import { compileSemanticRules } from "./proseCompileSemanticRules.js";
import type { SemanticRuleSet } from "./semanticRules.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import {
  PROSE_SECTION_KIND_PRIORITY,
  PROSE_SECTION_KINDS,
  proseSectionKindMountMatrix,
} from "./proseSectionKinds.js";
import {
  isParentIndexView,
  parentIndexModel,
} from "./parentIndexView.js";
import type {
  AlignPayload,
  EvidenceContext,
  StructureSectionPlan,
  StructureViewPlan,
} from "./proseAlignTypes.js";

export interface CompileViewResult {
  kind: "prose.compile.view.result";
  schema_version: typeof COMPILE_GATE_SCHEMA_VERSION;
  view: "read-plan" | "node-context" | "blockers" | "schema";
  phase_id: string;
  source: { type: "file" | "lark"; name: string };
  structure: {
    file: typeof STRUCTURE_FILE;
    lifecycle_state: string;
    structure_digest: string;
    frozen_snapshot_hash?: string | null;
  };
  read_plan?: Record<string, unknown>;
  blockers?: Record<string, unknown>;
  node_context?: Record<string, unknown>;
  payload_schema?: Record<string, unknown>;
  semantic_rules: SemanticRuleSet;
  semantic_reference_files: SemanticRuleSet["required"];
  next_action: Record<string, unknown>;
}

export interface ExistingApprovedSection {
  id: string;
  kind: string;
  status: "active";
  summary?: string;
  content_mode?: "verbatim" | "empty";
  source_refs: string[];
  reader_visible_body: string;
  body_sha256: string;
  body_char_count: number;
}

export interface ExistingApprovedNodeSections {
  path: string;
  present: boolean;
  sources?: string[];
  sections: ExistingApprovedSection[];
}

function approvedContentMode(value: string | undefined): ExistingApprovedSection["content_mode"] | undefined {
  return value === "verbatim" || value === "empty"
    ? value
    : undefined;
}

export function nodeLocalSources(node: StructureViewPlan): string[] {
  const refs = node.sections.flatMap((section) => section.source_refs);
  const locators = refs.flatMap((ref) => {
    const parsed = parseSpanSourceRef(ref);
    return parsed?.locator === undefined ? [] : [parsed.locator];
  });
  return [...new Set(locators)];
}

function viewLocalSources(input: {
  structure: AlignPayload;
  node: StructureViewPlan;
}): string[] {
  const refs = input.node.sections.length > 0
    ? input.node.sections.flatMap((section) => section.source_refs)
    : parentIndexModel({ structure: input.structure, view: input.node })?.source_refs ?? [];
  const locators = refs.flatMap((ref) => {
    const parsed = parseSpanSourceRef(ref);
    return parsed?.locator === undefined ? [] : [parsed.locator];
  });
  return [...new Set(locators)];
}

export function localizeRef(input: {
  ref: string;
  localSources: readonly string[];
}): string {
  if (!/^src-\d+#/u.test(input.ref)) return input.ref;
  const match = /^src-(\d+)(#span:.+)$/u.exec(input.ref);
  if (match === null) return input.ref;
  const index = Number(match[1]) - 1;
  const locator = input.localSources[index];
  return locator === undefined ? input.ref : `${locator}${match[2]}`;
}

function toLocalSourceRef(input: {
  ref: string;
  localSources: readonly string[];
}): string {
  const parsed = parseSpanSourceRef(input.ref);
  if (parsed?.locator === undefined) return input.ref;
  const localIndex = input.localSources.indexOf(parsed.locator);
  return localIndex < 0 ? input.ref : `src-${localIndex + 1}${input.ref.slice(parsed.locator.length)}`;
}

function compileConstraints(): Record<string, unknown> {
  return {
    content_fields_allowed: false,
    source_refs_required_for: ["add", "update"],
    source_span_shape: "one-source-one-continuous-range",
    max_actions_per_section_id: 1,
    structural_repair_route: "align",
  };
}

function compileSchema(): Record<string, unknown> {
  return {
    schema_version: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
    view_ref: "architecture:entity/getting-started",
    allowed_ops: ["add", "update", "skip"],
    constraints: compileConstraints(),
    legal_section_kinds: PROSE_SECTION_KINDS,
    section_kind_priority: PROSE_SECTION_KIND_PRIORITY,
    section_kind_mount_matrix: proseSectionKindMountMatrix(),
    actions: [{
      op: "add",
      section_id: "overview",
      kind: "description",
      summary: "Short summary for review and search.",
      source_refs: ["file:product-docs/guide.md#span:overview L3-8@<span-hash>"],
    }],
  };
}

export type SectionMirrorStatus = "mirrorable" | "split_required" | "source_ref_repair_required" | "no_source_refs";

export interface PlannedSectionMirrorHint {
  status: SectionMirrorStatus;
  reason: string;
  action: string;
  can_materialize_once: boolean;
  one_action_per_section_id: true;
  local_action_source_refs: string[];
  unresolved_source_refs?: string[];
  suggested_splits?: SuggestedSectionSplit[];
}

interface ResolvedSectionRef {
  sourceRef: string;
  span: RuntimeEvidenceSpan;
}

export interface SuggestedSectionSplit {
  section_id: string;
  kind: string;
  source_refs: string[];
  document_path: string;
  line_range: string;
  reason: string;
}

function sameSourceDocument(left: RuntimeEvidenceSpan, right: RuntimeEvidenceSpan): boolean {
  return left.source_type === right.source_type &&
    left.source_name === right.source_name &&
    left.document_path === right.document_path;
}

function refsAreContinuous(spans: readonly RuntimeEvidenceSpan[]): boolean {
  if (spans.length === 0) return false;
  const first = spans[0]!;
  if (spans.some((span) => !sameSourceDocument(first, span))) return false;
  const sorted = [...spans].sort((left, right) => left.line_start - right.line_start);
  let end = sorted[0]!.line_end;
  for (const span of sorted.slice(1)) {
    if (span.line_start > end + 1) return false;
    end = Math.max(end, span.line_end);
  }
  return true;
}

function splitSuggestionId(sectionId: string, index: number): string {
  return index === 0 ? sectionId : `${sectionId}-${index + 1}`;
}

function contiguousRefGroups(refs: readonly ResolvedSectionRef[]): ResolvedSectionRef[][] {
  const sorted = [...refs].sort((left, right) => {
    const leftKey = `${left.span.source_type}:${left.span.source_name}:${left.span.document_path}`;
    const rightKey = `${right.span.source_type}:${right.span.source_name}:${right.span.document_path}`;
    return leftKey.localeCompare(rightKey) || left.span.line_start - right.span.line_start;
  });
  const groups: ResolvedSectionRef[][] = [];
  for (const ref of sorted) {
    const last = groups.at(-1);
    const lastRef = last?.at(-1);
    if (
      last !== undefined &&
      lastRef !== undefined &&
      sameSourceDocument(lastRef.span, ref.span) &&
      ref.span.line_start <= lastRef.span.line_end + 1
    ) {
      last.push(ref);
      continue;
    }
    groups.push([ref]);
  }
  return groups;
}

function splitSuggestionsForSection(input: {
  section: StructureSectionPlan;
  reason: string;
  resolved: readonly ResolvedSectionRef[];
}): SuggestedSectionSplit[] {
  return contiguousRefGroups(input.resolved).map((group, index) => {
    const first = group[0]!.span;
    const lineStart = Math.min(...group.map((item) => item.span.line_start));
    const lineEnd = Math.max(...group.map((item) => item.span.line_end));
    return {
      section_id: splitSuggestionId(input.section.id, index),
      kind: input.section.kind,
      source_refs: group.map((item) => item.sourceRef),
      document_path: first.document_path,
      line_range: `L${lineStart}-${lineEnd}`,
      reason: input.reason,
    };
  });
}

export async function plannedSectionMirrorHint(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  section: StructureSectionPlan;
  localSources: readonly string[];
}): Promise<PlannedSectionMirrorHint> {
  const localActionSourceRefs = input.section.source_refs.map((ref) => toLocalSourceRef({
    ref,
    localSources: input.localSources,
  }));
  if (input.section.source_refs.length === 0) {
    return {
      status: "no_source_refs",
      reason: "source_refs_missing",
      action: "return_to_align_add_source_refs_or_skip_section",
      can_materialize_once: false,
      one_action_per_section_id: true,
      local_action_source_refs: localActionSourceRefs,
    };
  }

  const resolved: ResolvedSectionRef[] = [];
  const unresolved: string[] = [];
  for (const ref of input.section.source_refs) {
    const sourceRef = localizeRef({ ref, localSources: input.localSources });
    const item = await resolveProseSourceRef({
      projectRoot: input.projectRoot,
      index: input.evidence.index,
      sourceRef,
      snapshotMarkdownCache: input.evidence.snapshotMarkdownCache,
    });
    if (item === null || item.status !== "exact") {
      unresolved.push(sourceRef);
      continue;
    }
    resolved.push({ sourceRef, span: item.span });
  }

  if (unresolved.length > 0 || resolved.length !== input.section.source_refs.length) {
    return {
      status: "source_ref_repair_required",
      reason: "source_ref_unresolved",
      action: "return_to_align_repair_source_refs",
      can_materialize_once: false,
      one_action_per_section_id: true,
      local_action_source_refs: localActionSourceRefs,
      unresolved_source_refs: unresolved,
    };
  }

  const spans = resolved.map((item) => item.span);
  const first = spans[0]!;
  if (spans.some((span) => !sameSourceDocument(first, span))) {
    return {
      status: "split_required",
      reason: "multiple_source_documents",
      action: "return_to_align_split_section",
      can_materialize_once: false,
      one_action_per_section_id: true,
      local_action_source_refs: localActionSourceRefs,
      suggested_splits: splitSuggestionsForSection({
        section: input.section,
        reason: "multiple_source_documents",
        resolved,
      }),
    };
  }

  if (!refsAreContinuous(spans)) {
    return {
      status: "split_required",
      reason: "non_contiguous_source_refs",
      action: "return_to_align_split_section",
      can_materialize_once: false,
      one_action_per_section_id: true,
      local_action_source_refs: localActionSourceRefs,
      suggested_splits: splitSuggestionsForSection({
        section: input.section,
        reason: "non_contiguous_source_refs",
        resolved,
      }),
    };
  }

  return {
    status: "mirrorable",
    reason: "continuous_same_document",
    action: "emit_one_action_omitting_content",
    can_materialize_once: true,
    one_action_per_section_id: true,
    local_action_source_refs: localActionSourceRefs,
  };
}

async function readPlanNodes(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  structure: AlignPayload;
}): Promise<Array<Record<string, unknown>>> {
  return Promise.all(input.structure.views.map(async (node) => {
  const localSources = nodeLocalSources(node);
    const sectionHints = await Promise.all(node.sections.map((section) => plannedSectionMirrorHint({
      projectRoot: input.projectRoot,
      evidence: input.evidence,
      section,
      localSources,
    })));
    return {
      view_ref: node.view_ref,
      node_ref: node.node_ref,
      collection: node.collection,
      title: node.title,
      node_type: node.node_type,
      path: node.path,
      sections: node.sections.length,
      source_refs: new Set(node.sections.flatMap((section) => section.source_refs)).size,
      section_ids: node.sections.map((section) => section.id),
      planned_sections: node.sections.map((section, index) => ({
        id: section.id,
        kind: section.kind,
        source_refs: section.source_refs,
        source_ref_count: section.source_refs.length,
        mirror_status: sectionHints[index]?.status ?? "unknown",
        ...(sectionHints[index]?.suggested_splits !== undefined ? { suggested_splits: sectionHints[index]!.suggested_splits } : {}),
      })),
      source_mirror: {
        mirrorable_sections: node.sections.filter((_, index) => sectionHints[index]?.status === "mirrorable").map((section) => section.id),
        split_required_sections: node.sections.filter((_, index) => sectionHints[index]?.status === "split_required").map((section) => section.id),
        suggested_splits: sectionHints
          .flatMap((hint, index) => (hint?.suggested_splits ?? []).map((split) => ({
            original_section_id: node.sections[index]?.id,
            ...split,
          }))),
        source_ref_repair_required_sections: node.sections.filter((_, index) => sectionHints[index]?.status === "source_ref_repair_required").map((section) => section.id),
        no_source_ref_sections: node.sections.filter((_, index) => sectionHints[index]?.status === "no_source_refs").map((section) => section.id),
      },
      ...(isParentIndexView({ structure: input.structure, view: node })
        ? {
            generated: "parent_index",
            parent_index: {
              children: parentIndexModel({ structure: input.structure, view: node })?.children ?? [],
              source_refs: parentIndexModel({ structure: input.structure, view: node })?.source_refs ?? [],
            },
          }
        : {}),
    };
  }));
}

function readPlanNodesByCollection(nodes: readonly Record<string, unknown>[]): Array<{
  collection: string;
  node_count: number;
  nodes: Record<string, unknown>[];
}> {
  const byCollection = new Map<string, Record<string, unknown>[]>();
  for (const node of nodes) {
    const collection = typeof node.collection === "string" && node.collection.length > 0
      ? node.collection
      : "unknown";
    const group = byCollection.get(collection) ?? [];
    group.push(node);
    byCollection.set(collection, group);
  }
  return [...byCollection.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([collection, group]) => ({
      collection,
      node_count: group.length,
      nodes: group,
    }));
}

function readPlanSuggestedStructureRepairs(nodes: readonly Record<string, unknown>[]): Record<string, unknown> {
  const splitRequiredSections = nodes.flatMap((node) => {
    const sourceMirror = node.source_mirror;
    if (sourceMirror === null || typeof sourceMirror !== "object" || Array.isArray(sourceMirror)) return [];
    const suggestedSplits = "suggested_splits" in sourceMirror && Array.isArray(sourceMirror.suggested_splits)
      ? sourceMirror.suggested_splits
      : [];
    if (suggestedSplits.length === 0) return [];
    return [{
      view_ref: node.view_ref,
      node_ref: node.node_ref,
      collection: node.collection,
      action: "return_to_align_split_section",
      suggested_splits: suggestedSplits,
    }];
  });
  return {
    split_required_sections: splitRequiredSections,
    repair_policy: splitRequiredSections.length === 0
      ? "no_split_repair_needed"
      : "Use these source_ref groups to revise structure sections before confirmation; do not manually probe ranges unless a suggested split is semantically wrong.",
  };
}

function alignPhaseIdForCompile(phaseId: string): string | undefined {
  const parts = phaseId.split(":");
  if (parts[0] !== "compile" || parts.length < 4) return undefined;
  return ["align", ...parts.slice(1)].join(":");
}

function sectionMirrorBlockers(nodes: readonly Record<string, unknown>[]): Array<Record<string, unknown>> {
  return nodes.flatMap((node) => {
    const plannedSections = Array.isArray(node.planned_sections) ? node.planned_sections : [];
    return plannedSections.flatMap((section): Array<Record<string, unknown>> => {
      if (section === null || typeof section !== "object" || Array.isArray(section)) return [];
      const record = section as Record<string, unknown>;
      const status = record.mirror_status;
      if (status !== "split_required" && status !== "source_ref_repair_required" && status !== "no_source_refs") return [];
      return [{
        view_ref: node.view_ref,
        node_ref: node.node_ref,
        collection: node.collection,
        path: node.path,
        section_id: record.id,
        kind: record.kind,
        mirror_status: status,
        action: status === "split_required"
          ? "return_to_align_split_section"
          : status === "source_ref_repair_required"
            ? "return_to_align_repair_source_refs"
            : "return_to_align_add_source_refs_or_skip_section",
        ...(Array.isArray(record.suggested_splits) ? { suggested_splits: record.suggested_splits } : {}),
      }];
    });
  });
}

function readPlanBlockers(input: {
  phaseId: string;
  nodes: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  const sectionBlockers = sectionMirrorBlockers(input.nodes);
  const alignPhaseId = alignPhaseIdForCompile(input.phaseId);
  const firstViewRef = input.nodes.find((node) =>
    typeof node.view_ref === "string"
  )?.view_ref;
  return {
    section_blockers: sectionBlockers,
    suggested_structure_repairs: readPlanSuggestedStructureRepairs(input.nodes),
    counts: {
      section_blockers: sectionBlockers.length,
    },
    next_action: sectionBlockers.length === 0
      ? typeof firstViewRef === "string"
        ? {
          kind: "inspect_node_context",
          command: `context run ${input.phaseId} --view node-context --source ${firstViewRef} --format json`,
          available_view_refs: input.nodes.flatMap((node) =>
            typeof node.view_ref === "string" ? [node.view_ref] : []
          ),
          message: "No source mirror blockers were found; inspect the first remaining view or choose another exact available_view_ref.",
        }
        : {
            kind: "compile_batch_empty",
            message: "No structure view remains to inspect or compile.",
          }
      : {
          kind: alignPhaseId === undefined
            ? "align_configuration_required"
            : "return_to_align",
          ...(alignPhaseId === undefined
            ? {}
            : { command: `context run ${alignPhaseId} --view structure-summary --input .tmp/context-runtime/lifecycle/structure.yaml --format json` }),
          message: "Repair these planned sections in the structure before compile. Split sections using suggested_splits when present; otherwise repair source_refs or move unsupported content to unresolved.",
        },
  };
}

function sourceOverview(evidence: EvidenceContext): Record<string, unknown> {
  return {
    documents: evidence.documents.length,
    spans: evidence.chunks.length,
    token_estimate: evidence.documents.reduce((total, document) => total + document.token_estimate, 0),
    document_index: evidence.documents.map((document) => ({
      path: document.document.path,
      title: document.document.title ?? document.document.path,
      locator: document.locator,
      lines: document.document.line_count,
      headings: document.heading_tree.length,
      spans: evidence.chunks.filter((chunk) => chunk.document_path === document.document.path).length,
      token_estimate: document.token_estimate,
    })),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function frontmatterSources(content: string): string[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match === null) return [];
  const parsed = YAML.parse(match[1] ?? "") as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const sources = (parsed as Record<string, unknown>).sources;
  return Array.isArray(sources)
    ? sources.filter((source): source is string => typeof source === "string" && source.trim().length > 0)
    : [];
}

function canonicalizeApprovedSourceRef(ref: string, sources: readonly string[]): string {
  const match = /^src-(\d+)(#.+)$/u.exec(ref);
  if (match === null) return ref;
  const source = sources[Number(match[1]) - 1];
  return source === undefined ? ref : `${source}${match[2]}`;
}

export async function existingApprovedNodeSections(input: {
  projectRoot: string;
  node: StructureViewPlan;
}): Promise<ExistingApprovedNodeSections> {
  const relativePath = `knowledge/${input.node.path}`;
  const absolutePath = join(input.projectRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      present: false,
      sections: [],
    };
  }
  const content = await readFile(absolutePath, "utf8");
  const sources = frontmatterSources(content);
  const sections = approvedContextSectionsInMarkdown(content).map((section, index): ExistingApprovedSection => {
    const body = section.readerVisibleBody;
    const contentMode = approvedContentMode(section.contentMode);
    return {
      id: section.id ?? `section-${index + 1}`,
      kind: section.kind ?? "body",
      status: "active",
      ...(section.summary !== undefined ? { summary: section.summary } : {}),
      ...(contentMode !== undefined ? { content_mode: contentMode } : {}),
      source_refs: section.refs.map((ref) => canonicalizeApprovedSourceRef(ref, sources)),
      reader_visible_body: body,
      body_sha256: `sha256:${sha256(body)}`,
      body_char_count: body.length,
    };
  });
  return {
    path: relativePath,
    present: true,
    sources,
    sections,
  };
}

async function nodeContext(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  evidence: EvidenceContext;
  structure: AlignPayload;
  node: StructureViewPlan;
}): Promise<{ context: Record<string, unknown>; semanticRules: SemanticRuleSet }> {
  const localSources = viewLocalSources({ structure: input.structure, node: input.node });
  const parentIndex = parentIndexModel({ structure: input.structure, view: input.node });
  const existing = await existingApprovedNodeSections({
    projectRoot: input.projectRoot,
    node: input.node,
  });
  const semanticRules = compileSemanticRules({
    view: "node-context",
    structure: input.structure,
    node: input.node,
    existingSectionCount: existing.sections.length,
    parentIndex: parentIndex !== undefined,
  });
  return { context: {
    node: input.node,
    local_sources: localSources.map((locator, index) => ({
      alias: `src-${index + 1}`,
      locator,
    })),
    planned_sections: await Promise.all(input.node.sections.map(async (section) => ({
      ...section,
      local_source_refs: section.source_refs.map((ref) => toLocalSourceRef({ ref, localSources })),
      source_mirror: await plannedSectionMirrorHint({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        section,
        localSources,
      }),
    }))),
    ...(isParentIndexView({ structure: input.structure, view: input.node })
      ? {
          generated: "parent_index",
          parent_index: {
            children: parentIndex?.children ?? [],
            source_refs: parentIndex?.source_refs ?? [],
            materialization: "system_generated_from_child_views_and_contains_edges",
          },
        }
      : {}),
    existing,
    incremental: {
      status: "changed-only",
      locator_only_changes: [],
      unknown_inputs: [],
    },
    next_action: {
      kind: "validate_compile_batch",
      command: `context run ${input.phase.id} --validate --format json`,
    },
  }, semanticRules };
}

export async function viewResult(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  evidence: EvidenceContext;
  structure: AlignPayload;
  view: CompileViewResult["view"];
  node?: StructureViewPlan;
}): Promise<CompileViewResult> {
  const readPlanNodesResult = input.view === "read-plan" || input.view === "blockers"
    ? await readPlanNodes({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        structure: input.structure,
      })
    : undefined;
  const blockersResult = input.view === "blockers"
    ? readPlanBlockers({
        phaseId: input.phase.id,
        nodes: readPlanNodesResult ?? [],
      })
    : undefined;
  const nodeContextResult = input.node === undefined ? undefined : await nodeContext({
    projectRoot: input.projectRoot,
    phase: input.phase,
    evidence: input.evidence,
    structure: input.structure,
    node: input.node,
  });
  const semanticRules = nodeContextResult?.semanticRules ?? compileSemanticRules({
    view: input.view,
    structure: input.structure,
  });
  return {
    kind: "prose.compile.view.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    view: input.view,
    phase_id: input.phase.id,
    source: {
      type: input.evidence.source.sourceType,
      name: input.evidence.source.sourceName,
    },
    structure: {
      file: STRUCTURE_FILE,
      lifecycle_state: input.structure.lifecycle.state,
      structure_digest: input.structure.structure_digest,
      ...(input.structure.lifecycle.frozen_snapshot_hash !== undefined ? { frozen_snapshot_hash: input.structure.lifecycle.frozen_snapshot_hash } : {}),
    },
    semantic_rules: semanticRules,
    semantic_reference_files: semanticRules.required,
    ...(input.view === "read-plan"
      ? {
          read_plan: {
            nodes: readPlanNodesResult ?? [],
            nodes_by_collection: readPlanNodesByCollection(readPlanNodesResult ?? []),
            suggested_structure_repairs: readPlanSuggestedStructureRepairs(readPlanNodesResult ?? []),
            source_overview: sourceOverview(input.evidence),
            compile_constraints: compileConstraints(),
          },
        }
      : {}),
    ...(input.view === "blockers"
      ? {
          blockers: blockersResult ?? {},
        }
      : {}),
    ...(nodeContextResult !== undefined ? { node_context: nodeContextResult.context } : {}),
    ...(input.view === "schema" ? { payload_schema: compileSchema() } : {}),
    next_action: input.view === "blockers"
      ? (blockersResult?.next_action as Record<string, unknown>)
      : input.node === undefined
      ? {
          kind: "validate_compile_batch",
          command: `context run ${input.phase.id} --validate --format json`,
        }
      : {
          kind: "validate_compile_batch",
          command: `context run ${input.phase.id} --validate --format json`,
        },
  };
}
