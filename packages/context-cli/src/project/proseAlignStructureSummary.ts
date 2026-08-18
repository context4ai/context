import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AlignDiagnostic,
  AlignPayload,
  EvidenceContext,
  StructureEdgePlan,
  StructureNodePlan,
  StructureSectionPlan,
  StructureUnresolvedIssue,
  StructureViewPlan,
} from "./proseAlignTypes.js";
export {
  emptyExistingApprovedStructureSummary,
  existingApprovedStructureDiagnostics,
  readExistingApprovedStructureSummary,
  type ExistingApprovedStructureSummary,
} from "./proseAlignExistingApprovedStructure.js";
import {
  emptyExistingApprovedStructureSummary,
  type ExistingApprovedStructureSummary,
} from "./proseAlignExistingApprovedStructure.js";
import { renderStructureSummaryHtml } from "./proseAlignStructureSummaryHtml.js";
import { htmlReportReference, type LocalHtmlReportReference } from "./localHtmlReport.js";

// A View is allowed to carry a normal document's worth of independently
// citable Sections. This is a structural safety ceiling, not a semantic page
// splitter: common multi-section documents must not be expanded into one View
// per Section merely because their evidence is well segmented.
const LARGE_VIEW_SECTION_THRESHOLD = 24;
const LARGE_VIEW_SOURCE_REF_THRESHOLD = 32;

export interface StructureSummarySection {
  id: string;
  section_ref: string;
  kind: string;
  summary?: string;
  ownership?: string;
  source_ref_count: number;
  source_refs: string[];
}

export interface StructureSummaryNode {
  node_ref: string;
  title: string;
  node_type: string;
  summary?: string;
  ownership?: string;
  tags: string[];
}

export interface StructureSummaryView {
  view_ref: string;
  node_ref: string;
  collection: string;
  title: string;
  node_type: string;
  containment: string;
  slug: string;
  path: string;
  summary?: string;
  ownership?: string;
  tags: string[];
  section_count: number;
  source_ref_count: number;
  sections: StructureSummarySection[];
  connected_edges: StructureSummaryEdge[];
  shared_source_refs: StructureSummarySharedSourceRef[];
  unresolved: StructureSummaryUnresolvedIssue[];
  split_requirement: StructureViewSplitRequirement;
}

export interface StructureSummaryViewGroup {
  collection: string;
  view_count: number;
  views: StructureSummaryView[];
}

export type StructureSummaryEdge = StructureEdgePlan & { source_ref_count: number };

export interface StructureSummarySharedSourceRef {
  source_ref: string;
  owners: string[];
}

export type StructureSummaryUnresolvedIssue = StructureUnresolvedIssue & { source_ref_count: number };

export interface StructureViewSplitRequirement {
  status: "not_required" | "split_required";
  reason: string;
  thresholds: {
    max_sections: number;
    max_source_refs: number;
  };
  parent_index_view_ref?: string;
  suggested_child_views: Array<{
    group_id: string;
    section_ids: string[];
    section_count: number;
    node_ref: string;
    view_ref: string;
    title: string;
    source_ref_count: number;
    source_refs: string[];
  }>;
  suggested_child_view_refs: string[];
  contains_edge_drafts: Array<{
    type: "contains";
    from: string;
    to: string;
    source_refs: string[];
  }>;
}

export interface StructureSummary {
  valid: boolean;
  source: { type: string; name: string };
  collections: string[];
  lifecycle_state: string;
  structure_digest: string;
  counts: {
    nodes: number;
    views: number;
    sections: number;
    edges: number;
    unresolved: number;
    source_refs: number;
    diagnostics: { errors: number; warnings: number; info: number };
  };
  distributions: {
    node_types: Record<string, number>;
    collections: Record<string, number>;
    section_kinds: Record<string, number>;
    edge_types: Record<string, number>;
    source_documents: Record<string, number>;
  };
  nodes: StructureSummaryNode[];
  views: StructureSummaryView[];
  views_by_collection: StructureSummaryViewGroup[];
  edges: StructureSummaryEdge[];
  shared_source_refs: StructureSummarySharedSourceRef[];
  existing_approved_structure: ExistingApprovedStructureSummary;
  unresolved: StructureSummaryUnresolvedIssue[];
  confirmation: {
    prompt: string;
    impact: string[];
  };
}

export interface StructureReport extends LocalHtmlReportReference {
  path: string;
}

export interface StructureSummaryCompact {
  valid: boolean;
  source: { type: string; name: string };
  collections: string[];
  lifecycle_state: string;
  structure_digest: string;
  counts: StructureSummary["counts"];
  views_by_collection: Array<{
    collection: string;
    view_count: number;
    views: Array<{
      view_ref: string;
      node_ref: string;
      title: string;
      path: string;
      section_count: number;
      source_ref_count: number;
      edge_count: number;
      unresolved_count: number;
      split_required: boolean;
    }>;
  }>;
  unresolved: Array<Pick<StructureSummaryUnresolvedIssue, "issue" | "note" | "source_ref_count">>;
  diagnostics: {
    errors: AlignDiagnostic[];
    warnings: AlignDiagnostic[];
  };
  confirmation: StructureSummary["confirmation"];
}

export interface StructureReviewNotice {
  review_report: StructureReport;
  counts: StructureSummary["counts"];
  collections: string[];
  lifecycle_state: string;
  confirmation_ready: boolean;
  confirmation_blockers: AlignDiagnostic[];
}

function bump(map: Record<string, number>, key: string, count = 1): void {
  map[key] = (map[key] ?? 0) + count;
}

function refDocument(sourceRef: string): string {
  const hashIndex = sourceRef.indexOf("#span:");
  if (hashIndex < 0) return sourceRef;
  const head = sourceRef.slice(0, hashIndex);
  const slashIndex = head.indexOf("/");
  return slashIndex < 0 ? head : head.slice(slashIndex + 1);
}

function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)].sort();
}

function sectionSummary(section: StructureSectionPlan): StructureSummarySection {
  return {
    id: section.id,
    section_ref: section.section_ref,
    kind: section.kind,
    ...(section.summary !== undefined ? { summary: section.summary } : {}),
    ...(section.ownership !== undefined ? { ownership: section.ownership } : {}),
    source_ref_count: section.source_refs.length,
    source_refs: uniqueRefs(section.source_refs),
  };
}

export function splitRequirementForView(view: StructureViewPlan): StructureViewSplitRequirement {
  const sourceRefCount = uniqueRefs(view.sections.flatMap((section) => section.source_refs)).length;
  const overSectionThreshold = view.sections.length > LARGE_VIEW_SECTION_THRESHOLD;
  const overSourceRefThreshold = sourceRefCount > LARGE_VIEW_SOURCE_REF_THRESHOLD;
  if (!overSectionThreshold && !overSourceRefThreshold) {
    return {
      status: "not_required",
      reason: "within_threshold",
      thresholds: {
        max_sections: LARGE_VIEW_SECTION_THRESHOLD,
        max_source_refs: LARGE_VIEW_SOURCE_REF_THRESHOLD,
      },
      suggested_child_views: [],
      suggested_child_view_refs: [],
      contains_edge_drafts: [],
    };
  }
  const suggestedGroups = boundedChildViewGroups(view.sections);
  const groupNumberWidth = Math.max(2, String(suggestedGroups.length).length);
  const suggestedChildViews = suggestedGroups.map((sections, index) => {
    const groupId = `part-${String(index + 1).padStart(groupNumberWidth, "0")}`;
    const childNodeRef = `${view.node_ref}/${groupId}`;
    const sourceRefs = uniqueRefs(sections.flatMap((section) => section.source_refs));
    return {
      group_id: groupId,
      section_ids: sections.map((section) => section.id),
      section_count: sections.length,
      node_ref: childNodeRef,
      view_ref: `${view.collection}:${childNodeRef}`,
      title: `Part ${index + 1}`,
      source_ref_count: sourceRefs.length,
      source_refs: sourceRefs,
    };
  });
  return {
    status: "split_required",
    reason: overSectionThreshold && overSourceRefThreshold
      ? "too_many_sections_and_source_refs"
      : overSectionThreshold
        ? "too_many_sections"
        : "too_many_source_refs",
    thresholds: {
      max_sections: LARGE_VIEW_SECTION_THRESHOLD,
      max_source_refs: LARGE_VIEW_SOURCE_REF_THRESHOLD,
    },
    parent_index_view_ref: view.view_ref,
    suggested_child_views: suggestedChildViews,
    suggested_child_view_refs: suggestedChildViews.map((child) => child.view_ref),
    contains_edge_drafts: suggestedChildViews.map((child) => ({
      type: "contains",
      from: view.view_ref,
      to: child.view_ref,
      source_refs: child.source_refs,
    })),
  };
}

function boundedChildViewGroups(sections: readonly StructureSectionPlan[]): StructureSectionPlan[][] {
  const sourceRefCount = uniqueRefs(sections.flatMap((section) => section.source_refs)).length;
  const minimumGroupCount = Math.max(
    2,
    Math.ceil(sections.length / LARGE_VIEW_SECTION_THRESHOLD),
    Math.ceil(sourceRefCount / LARGE_VIEW_SOURCE_REF_THRESHOLD),
  );
  const groups: StructureSectionPlan[][] = [];
  let cursor = 0;
  while (cursor < sections.length) {
    const groupsStillRequired = Math.max(1, minimumGroupCount - groups.length);
    const remainingSections = sections.length - cursor;
    const targetSectionCount = Math.min(
      LARGE_VIEW_SECTION_THRESHOLD,
      Math.ceil(remainingSections / groupsStillRequired),
    );
    const group: StructureSectionPlan[] = [];
    while (cursor < sections.length && group.length < targetSectionCount) {
      const nextSection = sections[cursor];
      if (nextSection === undefined) break;
      const nextSourceRefCount = uniqueRefs([
        ...group.flatMap((section) => section.source_refs),
        ...nextSection.source_refs,
      ]).length;
      if (group.length > 0 && nextSourceRefCount > LARGE_VIEW_SOURCE_REF_THRESHOLD) break;
      group.push(nextSection);
      cursor += 1;
    }
    if (group.length === 0) {
      const nextSection = sections[cursor];
      if (nextSection === undefined) break;
      group.push(nextSection);
      cursor += 1;
    }
    groups.push(group);
  }
  return groups;
}

export function largeNarrativeSplitDiagnostics(payload: AlignPayload | undefined): AlignDiagnostic[] {
  if (payload === undefined) return [];
  const blocking = payload.lifecycle.state === "confirmed" || payload.lifecycle.state === "frozen";
  return payload.views.flatMap((view, index): AlignDiagnostic[] => {
    const requirement = splitRequirementForView(view);
    if (requirement.status !== "split_required") return [];
    return [{
      severity: blocking ? "error" : "warning",
      code: "view.split_required",
      family: "node_quality",
      message: blocking
        ? "Large narrative view must be split into a parent index view and child views before confirmation."
        : "Large narrative view should be split into a parent index view and child views before confirmation.",
      candidate_id: view.view_ref,
      field: `views[${index}]`,
      repair: {
        action: "split_large_view_before_confirmation",
        parent_index_view_ref: requirement.parent_index_view_ref,
        suggested_child_view_refs: requirement.suggested_child_view_refs,
        contains_edge_drafts: requirement.contains_edge_drafts,
        reason: requirement.reason,
      },
    }];
  });
}

function nodeSummary(node: StructureNodePlan): StructureSummaryNode {
  return {
    node_ref: node.node_ref,
    title: node.title,
    node_type: node.node_type,
    ...(node.summary !== undefined ? { summary: node.summary } : {}),
    ...(node.ownership !== undefined ? { ownership: node.ownership } : {}),
    tags: node.tags ?? [],
  };
}

function endpointAliasesForView(view: Pick<StructureViewPlan, "node_ref" | "view_ref" | "sections">): string[] {
  return [
    view.node_ref,
    view.view_ref,
    ...view.sections.map((section) => section.section_ref),
  ];
}

function sourceRefsForView(view: Pick<StructureViewPlan, "sections">): Set<string> {
  return new Set(view.sections.flatMap((section) => section.source_refs));
}

function edgeTouchesView(edge: StructureSummaryEdge, endpointAliases: ReadonlySet<string>): boolean {
  return endpointAliases.has(edge.from) || endpointAliases.has(edge.to);
}

function sharedRefTouchesView(
  sharedRef: StructureSummarySharedSourceRef,
  endpointAliases: ReadonlySet<string>,
): boolean {
  return sharedRef.owners.some((owner) => endpointAliases.has(owner));
}

function unresolvedTouchesView(
  issue: StructureSummaryUnresolvedIssue,
  endpointAliases: ReadonlySet<string>,
  sourceRefs: ReadonlySet<string>,
): boolean {
  if (issue.source_refs?.some((sourceRef) => sourceRefs.has(sourceRef))) return true;
  const searchable = `${issue.issue}\n${issue.note ?? ""}`;
  return [...endpointAliases].some((endpoint) => searchable.includes(endpoint));
}

function viewSummary(input: {
  view: StructureViewPlan;
  edges: readonly StructureSummaryEdge[];
  sharedSourceRefs: readonly StructureSummarySharedSourceRef[];
  unresolved: readonly StructureSummaryUnresolvedIssue[];
}): StructureSummaryView {
  const { view } = input;
  const sourceRefs = uniqueRefs(view.sections.flatMap((section) => section.source_refs));
  const endpointAliases = new Set(endpointAliasesForView(view));
  const sourceRefSet = sourceRefsForView(view);
  return {
    view_ref: view.view_ref,
    node_ref: view.node_ref,
    collection: view.collection,
    title: view.title,
    node_type: view.node_type,
    containment: view.containment,
    slug: view.slug,
    path: view.path,
    ...(view.summary !== undefined ? { summary: view.summary } : {}),
    ...(view.ownership !== undefined ? { ownership: view.ownership } : {}),
    tags: [],
    section_count: view.sections.length,
    source_ref_count: sourceRefs.length,
    sections: view.sections.map(sectionSummary),
    connected_edges: input.edges.filter((edge) => edgeTouchesView(edge, endpointAliases)),
    shared_source_refs: input.sharedSourceRefs.filter((sharedRef) => sharedRefTouchesView(sharedRef, endpointAliases)),
    unresolved: input.unresolved.filter((issue) => unresolvedTouchesView(issue, endpointAliases, sourceRefSet)),
    split_requirement: splitRequirementForView(view),
  };
}

function sharedSourceRefs(payload: AlignPayload): StructureSummary["shared_source_refs"] {
  const ownersByRef = new Map<string, string[]>();
  for (const view of payload.views) {
    for (const section of view.sections) {
      for (const sourceRef of section.source_refs) {
        const owners = ownersByRef.get(sourceRef) ?? [];
        owners.push(section.section_ref);
        ownersByRef.set(sourceRef, owners);
      }
    }
  }
  return [...ownersByRef.entries()]
    .map(([sourceRef, owners]) => ({
      source_ref: sourceRef,
      owners: [...new Set(owners)].sort(),
    }))
    .filter((entry) => entry.owners.length > 1)
    .sort((left, right) => left.source_ref.localeCompare(right.source_ref));
}

function diagnosticCounts(diagnostics: readonly AlignDiagnostic[]): StructureSummary["counts"]["diagnostics"] {
  return {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length,
  };
}

function viewsByCollection(views: readonly StructureSummaryView[]): StructureSummaryViewGroup[] {
  const grouped = new Map<string, StructureSummaryView[]>();
  for (const view of views) {
    const items = grouped.get(view.collection) ?? [];
    items.push(view);
    grouped.set(view.collection, items);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([collection, items]) => ({
      collection,
      view_count: items.length,
      views: [...items].sort((left, right) => left.view_ref.localeCompare(right.view_ref)),
    }));
}

export function buildStructureSummary(input: {
  evidence: EvidenceContext;
  payload: AlignPayload;
  diagnostics: readonly AlignDiagnostic[];
  existingApprovedStructure?: ExistingApprovedStructureSummary;
}): StructureSummary {
  const nodeTypes: Record<string, number> = {};
  const collections: Record<string, number> = {};
  const sectionKinds: Record<string, number> = {};
  const edgeTypes: Record<string, number> = {};
  const sourceDocuments: Record<string, number> = {};
  const allRefs: string[] = [];
  for (const node of input.payload.nodes) {
    bump(nodeTypes, node.node_type);
  }
  for (const view of input.payload.views) {
    bump(collections, view.collection);
    for (const section of view.sections) {
      bump(sectionKinds, section.kind);
      allRefs.push(...section.source_refs);
    }
  }
  for (const edge of input.payload.edges) {
    bump(edgeTypes, edge.type);
    allRefs.push(...edge.source_refs);
  }
  for (const item of input.payload.unresolved) {
    allRefs.push(...item.source_refs ?? []);
  }
  for (const ref of allRefs) bump(sourceDocuments, refDocument(ref));
  const diagnostics = diagnosticCounts(input.diagnostics);
  const edges = input.payload.edges.map((edge) => ({
    ...edge,
    source_refs: uniqueRefs(edge.source_refs),
    source_ref_count: edge.source_refs.length,
  }));
  const sharedSourceRefSummaries = sharedSourceRefs(input.payload);
  const unresolved = input.payload.unresolved.map((item) => ({
    ...item,
    ...(item.source_refs !== undefined ? { source_refs: uniqueRefs(item.source_refs) } : {}),
    source_ref_count: item.source_refs?.length ?? 0,
  }));
  const views = input.payload.views.map((view) => viewSummary({
    view,
    edges,
    sharedSourceRefs: sharedSourceRefSummaries,
    unresolved,
  }));
  return {
    valid: diagnostics.errors === 0,
    source: { type: input.evidence.source.sourceType, name: input.evidence.source.sourceName },
    collections: Object.keys(collections).sort(),
    lifecycle_state: input.payload.lifecycle.state,
    structure_digest: input.payload.structure_digest,
    counts: {
      nodes: input.payload.nodes.length,
      views: input.payload.views.length,
      sections: input.payload.views.reduce((sum, view) => sum + view.sections.length, 0),
      edges: input.payload.edges.length,
      unresolved: input.payload.unresolved.length,
      source_refs: uniqueRefs(allRefs).length,
      diagnostics,
    },
    distributions: {
      node_types: nodeTypes,
      collections,
      section_kinds: sectionKinds,
      edge_types: edgeTypes,
      source_documents: sourceDocuments,
    },
    nodes: input.payload.nodes.map(nodeSummary),
    views,
    views_by_collection: viewsByCollection(views),
    edges,
    shared_source_refs: sharedSourceRefSummaries,
    existing_approved_structure: input.existingApprovedStructure ?? emptyExistingApprovedStructureSummary(),
    unresolved,
    confirmation: {
      prompt: "Confirming this structure allows source-bound compile to create review candidates for these nodes and edges.",
      impact: [
        "ViewRefs and their derived paths become the compile targets.",
        "Section ids, kinds, and source_ref ownership determine the source-bound compile projection.",
        "Typed edges can be projected into approved knowledge after review/apply/close.",
        "Unresolved items remain out of approved edges until the structure is revised.",
      ],
    },
  };
}

export async function writeStructureSummaryReport(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  payload: AlignPayload;
  diagnostics: readonly AlignDiagnostic[];
  existingApprovedStructure?: ExistingApprovedStructureSummary;
}): Promise<{ summary: StructureSummary; report: StructureReport }> {
  const summary = buildStructureSummary(input);
  const shortDigest = summary.structure_digest.replace(/^sha256:/u, "").slice(0, 16);
  const reportPath = join(".tmp", "context-runtime", "reports", `structure-summary-${shortDigest}.html`);
  const absolutePath = join(input.projectRoot, reportPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderStructureSummaryHtml({ summary, diagnostics: input.diagnostics }), "utf8");
  return {
    summary,
    report: htmlReportReference({
      projectRoot: input.projectRoot,
      path: reportPath,
      title: `Structure Summary - ${summary.source.type}:${summary.source.name}`,
    }),
  };
}

export function compactStructureSummary(input: {
  summary: StructureSummary;
  diagnostics: readonly AlignDiagnostic[];
  unresolvedLimit?: number;
  diagnosticLimit?: number;
}): StructureSummaryCompact {
  const unresolvedLimit = input.unresolvedLimit ?? 8;
  const diagnosticLimit = input.diagnosticLimit ?? 8;
  return {
    valid: input.summary.valid,
    source: input.summary.source,
    collections: input.summary.collections,
    lifecycle_state: input.summary.lifecycle_state,
    structure_digest: input.summary.structure_digest,
    counts: input.summary.counts,
    views_by_collection: input.summary.views_by_collection.map((group) => ({
      collection: group.collection,
      view_count: group.view_count,
      views: group.views.map((view) => ({
        view_ref: view.view_ref,
        node_ref: view.node_ref,
        title: view.title,
        path: view.path,
        section_count: view.section_count,
        source_ref_count: view.source_ref_count,
        edge_count: view.connected_edges.length,
        unresolved_count: view.unresolved.length,
        split_required: view.split_requirement.status === "split_required",
      })),
    })),
    unresolved: input.summary.unresolved.slice(0, unresolvedLimit).map((item) => ({
      issue: item.issue,
      ...(item.note !== undefined ? { note: item.note } : {}),
      source_ref_count: item.source_ref_count,
    })),
    diagnostics: {
      errors: input.diagnostics.filter((item) => item.severity === "error").slice(0, diagnosticLimit),
      warnings: input.diagnostics.filter((item) => item.severity === "warning").slice(0, diagnosticLimit),
    },
    confirmation: input.summary.confirmation,
  };
}

export function structureReviewNotice(input: {
  summary: StructureSummary;
  report: StructureReport;
  confirmationReady: boolean;
  confirmationBlockers: readonly AlignDiagnostic[];
}): StructureReviewNotice {
  return {
    review_report: input.report,
    counts: input.summary.counts,
    collections: input.summary.collections,
    lifecycle_state: input.summary.lifecycle_state,
    confirmation_ready: input.confirmationReady,
    confirmation_blockers: [...input.confirmationBlockers],
  };
}
