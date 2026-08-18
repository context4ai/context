import { parseDocumentSourceLocator, parseSpanSourceRef } from "@c4a/extract";
import { buildCommittedEvidenceIndex, resolveProseSourceRef } from "./documentEvidenceIndex.js";
import { diagnostic } from "./proseAlignSchemaUtils.js";
import {
  ACTION_KINDS,
  alignCommand,
  ENTITY_TAG_A,
  ENTITY_TAG_B,
  ENTITY_TAGS,
  type AlignDiagnostic,
  type AlignPayload,
  type EvidenceContext,
} from "./proseAlignTypes.js";

const ENTITY_TAG_A_SET = new Set<string>(ENTITY_TAG_A);
const ENTITY_TAG_B_SET = new Set<string>(ENTITY_TAG_B);
const ENTITY_TAGS_SET = new Set<string>(ENTITY_TAGS);
const ACTION_KIND_SET = new Set<string>(ACTION_KINDS);
const CONCRETE_ENTITY_TAGS = new Set<string>([...ENTITY_TAG_A, ...ENTITY_TAG_B]);
const STABLE_ENTITY_SHAPE_TAGS = new Set<string>(["app", "service", "lib", "cli", "module", "symbol"]);
const SCOPE_ENTITY_TAGS = new Set<string>(["application", "system"]);

interface NodeQualityMetrics {
  childCount: number;
  childActionCount: number;
  childNodeCount: number;
  concreteTags: string[];
  descriptionCount: number;
  fieldPrefix: string;
  hasContainsParent: boolean;
  hasGeneratedParentIndex: boolean;
  hasTermTag: boolean;
  sectionCount: number;
  tags: string[];
}

interface StructureQualityContext {
  childActions: Map<string, number>;
  childNodes: Map<string, number>;
  childrenByParent: Map<string, Set<string>>;
  containsParents: Map<string, number>;
  descriptionSectionsByNode: Map<string, number>;
  generatedParentIndexNodes: Set<string>;
  nodeByRef: Map<string, AlignPayload["nodes"][number]>;
  sectionsByNode: Map<string, number>;
  sourceDocumentsByNode: Map<string, Set<string>>;
}

export async function currentEvidenceSnapshotHash(input: {
  projectRoot: string;
  evidence: EvidenceContext;
}): Promise<string> {
  const current = await buildCommittedEvidenceIndex({
    projectRoot: input.projectRoot,
    sourceType: input.evidence.source.sourceType,
    sourceName: input.evidence.source.sourceName,
    materializedAt: input.evidence.source.materializedAt,
    ...(input.evidence.source.manifestPath !== undefined ? { manifestPath: input.evidence.source.manifestPath } : {}),
    writeRuntimeIndex: false,
  });
  return current.index.snapshot_hash;
}

export function addStructureQualityDiagnostics(payload: AlignPayload, diagnostics: AlignDiagnostic[]): void {
  const context = buildStructureQualityContext(payload);

  for (const node of payload.nodes) {
    addNodeQualityDiagnostics(
      node,
      {
        childCount: context.childNodes.get(node.node_ref) ?? 0,
        childActionCount: context.childActions.get(node.node_ref) ?? 0,
        childNodeCount: context.childNodes.get(node.node_ref) ?? 0,
        concreteTags: (node.tags ?? []).filter((tag) => CONCRETE_ENTITY_TAGS.has(tag)),
        descriptionCount: context.descriptionSectionsByNode.get(node.node_ref) ?? 0,
        fieldPrefix: `nodes.${node.node_ref}`,
        hasContainsParent: (context.containsParents.get(node.node_ref) ?? 0) > 0,
        hasGeneratedParentIndex: context.generatedParentIndexNodes.has(node.node_ref),
        hasTermTag: (node.tags ?? []).includes("term"),
        sectionCount: context.sectionsByNode.get(node.node_ref) ?? 0,
        tags: node.tags ?? [],
      },
      diagnostics,
    );
  }
  addThinChildFragmentDiagnostics({
    childrenByParent: context.childrenByParent,
    childNodes: context.childNodes,
    nodeByRef: context.nodeByRef,
    sectionsByNode: context.sectionsByNode,
    sourceDocumentsByNode: context.sourceDocumentsByNode,
    diagnostics,
  });
  addChildScopeTagInheritanceDiagnostics({
    childrenByParent: context.childrenByParent,
    nodeByRef: context.nodeByRef,
    diagnostics,
  });
}

function buildStructureQualityContext(payload: AlignPayload): StructureQualityContext {
  const context: StructureQualityContext = {
    childActions: new Map<string, number>(),
    childNodes: new Map<string, number>(),
    childrenByParent: new Map<string, Set<string>>(),
    containsParents: new Map<string, number>(),
    descriptionSectionsByNode: new Map<string, number>(),
    generatedParentIndexNodes: new Set<string>(),
    nodeByRef: new Map(payload.nodes.map((node) => [node.node_ref, node])),
    sectionsByNode: new Map<string, number>(),
    sourceDocumentsByNode: new Map<string, Set<string>>(),
  };
  const parentOwnerByEndpoint = new Map<string, string>();
  const childNodeByEndpoint = new Map<string, string>();
  const nodeTypeByRef = new Map(payload.nodes.map((node) => [node.node_ref, node.node_type]));
  for (const node of payload.nodes) {
    parentOwnerByEndpoint.set(node.node_ref, node.node_ref);
    childNodeByEndpoint.set(node.node_ref, node.node_ref);
  }
  for (const view of payload.views) {
    parentOwnerByEndpoint.set(view.view_ref, view.node_ref);
    childNodeByEndpoint.set(view.view_ref, view.node_ref);
    for (const section of view.sections) parentOwnerByEndpoint.set(section.section_ref, view.node_ref);
    addViewMetrics(view, context);
    if (view.generated === "parent_index") {
      context.generatedParentIndexNodes.add(view.node_ref);
    }
  }
  for (const edge of payload.edges) {
    addContainsEdgeMetrics(edge, {
      childNodeByEndpoint,
      context,
      nodeTypeByRef,
      parentOwnerByEndpoint,
    });
  }
  return context;
}

function addViewMetrics(view: AlignPayload["views"][number], context: StructureQualityContext): void {
  context.sectionsByNode.set(view.node_ref, (context.sectionsByNode.get(view.node_ref) ?? 0) + view.sections.length);
  context.descriptionSectionsByNode.set(
    view.node_ref,
    (context.descriptionSectionsByNode.get(view.node_ref) ?? 0) + view.sections.filter((section) => section.kind === "description").length,
  );
  const sourceDocuments = context.sourceDocumentsByNode.get(view.node_ref) ?? new Set<string>();
  for (const section of view.sections) {
    for (const sourceRef of section.source_refs) sourceDocuments.add(sourceDocumentKey(sourceRef));
  }
  context.sourceDocumentsByNode.set(view.node_ref, sourceDocuments);
}

function addContainsEdgeMetrics(edge: AlignPayload["edges"][number], input: {
  childNodeByEndpoint: ReadonlyMap<string, string>;
  context: StructureQualityContext;
  nodeTypeByRef: ReadonlyMap<string, string>;
  parentOwnerByEndpoint: ReadonlyMap<string, string>;
}): void {
  if (edge.type !== "contains") return;
  const parentNodeRef = input.parentOwnerByEndpoint.get(edge.from);
  if (parentNodeRef === undefined) return;
  const childNodeRef = input.childNodeByEndpoint.get(edge.to);
  if (childNodeRef === undefined) return;
  input.context.childNodes.set(parentNodeRef, (input.context.childNodes.get(parentNodeRef) ?? 0) + 1);
  input.context.containsParents.set(childNodeRef, (input.context.containsParents.get(childNodeRef) ?? 0) + 1);
  const children = input.context.childrenByParent.get(parentNodeRef) ?? new Set<string>();
  children.add(childNodeRef);
  input.context.childrenByParent.set(parentNodeRef, children);
  if (input.nodeTypeByRef.get(childNodeRef) === "action") {
    input.context.childActions.set(parentNodeRef, (input.context.childActions.get(parentNodeRef) ?? 0) + 1);
  }
}

function sourceDocumentKey(sourceRef: string): string {
  const parsed = parseSpanSourceRef(sourceRef);
  return parsed?.locator ?? sourceRef.split("#", 1)[0] ?? sourceRef;
}

function hasAnyTag(node: AlignPayload["nodes"][number], tags: ReadonlySet<string>): boolean {
  return (node.tags ?? []).some((tag) => tags.has(tag));
}

function singleValue(values: ReadonlySet<string> | undefined): string | undefined {
  if (values === undefined || values.size !== 1) return undefined;
  return [...values][0];
}

function addThinChildFragmentDiagnostics(input: {
  childrenByParent: ReadonlyMap<string, ReadonlySet<string>>;
  childNodes: ReadonlyMap<string, number>;
  nodeByRef: ReadonlyMap<string, AlignPayload["nodes"][number]>;
  sectionsByNode: ReadonlyMap<string, number>;
  sourceDocumentsByNode: ReadonlyMap<string, ReadonlySet<string>>;
  diagnostics: AlignDiagnostic[];
}): void {
  for (const [parentNodeRef, childNodeRefs] of input.childrenByParent.entries()) {
    const thinChildren = [...childNodeRefs].filter((childNodeRef) => {
      const child = input.nodeByRef.get(childNodeRef);
      if (child?.node_type !== "entity") return false;
      if (hasAnyTag(child, STABLE_ENTITY_SHAPE_TAGS)) return false;
      if ((input.sectionsByNode.get(childNodeRef) ?? 0) !== 1) return false;
      if ((input.childNodes.get(childNodeRef) ?? 0) !== 0) return false;
      return singleValue(input.sourceDocumentsByNode.get(childNodeRef)) !== undefined;
    });
    if (thinChildren.length < 3) continue;
    const thinChildDocuments = thinChildren
      .map((childNodeRef) => singleValue(input.sourceDocumentsByNode.get(childNodeRef)))
      .filter((value): value is string => value !== undefined);
    if (thinChildDocuments.length !== thinChildren.length) continue;
    const sourceDocuments = new Set(thinChildDocuments);
    if (sourceDocuments.size !== 1) continue;
    const sourceDocument = [...sourceDocuments][0];
    if (sourceDocument === undefined) continue;
    input.diagnostics.push(diagnostic(
      "warning",
      "node.children_should_be_sections",
      "node_quality",
      "This parent has many same-source thin child entities; keep them as child pages only when they have stable standalone retrieval identity.",
      `nodes.${parentNodeRef}.edges`,
      {
        candidate_id: parentNodeRef,
        repair: {
          action: "consolidate_thin_children_into_sections_or_confirm_standalone",
          child_node_refs: thinChildren,
          source_document: sourceDocument,
        },
      },
    ));
  }
}

function addChildScopeTagInheritanceDiagnostics(input: {
  childrenByParent: ReadonlyMap<string, ReadonlySet<string>>;
  nodeByRef: ReadonlyMap<string, AlignPayload["nodes"][number]>;
  diagnostics: AlignDiagnostic[];
}): void {
  for (const [parentNodeRef, childNodeRefs] of input.childrenByParent.entries()) {
    const parent = input.nodeByRef.get(parentNodeRef);
    if (parent?.node_type !== "entity") continue;
    const parentScopeTags = (parent.tags ?? []).filter((tag) => SCOPE_ENTITY_TAGS.has(tag));
    if (parentScopeTags.length === 0) continue;
    for (const childNodeRef of childNodeRefs) {
      const child = input.nodeByRef.get(childNodeRef);
      if (child?.node_type !== "entity") continue;
      const inheritedTags = (child.tags ?? []).filter((tag) => parentScopeTags.includes(tag));
      if (inheritedTags.length === 0) continue;
      input.diagnostics.push(diagnostic(
        "warning",
        "tags.child_inherits_system",
        "tags",
        "Child entity repeats the parent scope tag; retag it only by its own independent shape/scope, or keep it as a section.",
        `nodes.${childNodeRef}.tags`,
        {
          candidate_id: childNodeRef,
          repair: {
            action: "retag_child_aspect_or_confirm_independent_system",
            parent_node_ref: parentNodeRef,
            inherited_tags: inheritedTags,
          },
        },
      ));
    }
  }
}

function addNodeQualityDiagnostics(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  addNodeTagContractDiagnostics(node, metrics, diagnostics);
  addTermConflictDiagnostic(node, metrics, diagnostics);
  addDescriptionDominatesDiagnostic(node, metrics, diagnostics);
  addThinConcreteEntityDiagnostic(node, metrics, diagnostics);
  addExpandedTermDiagnostic(node, metrics, diagnostics);
  addThinActionDiagnostic(node, metrics, diagnostics);
  addDomainWithoutChildrenDiagnostic(node, metrics, diagnostics);
}

function addNodeTagContractDiagnostics(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  addDuplicateTagDiagnostics(node, metrics, diagnostics);
  if (node.node_type === "entity") {
    addEntityTagContractDiagnostics(node, metrics, diagnostics);
    return;
  }
  if (node.node_type === "action") {
    addActionTagContractDiagnostics(node, metrics, diagnostics);
    return;
  }
  if (node.node_type === "domain" && metrics.tags.length > 0) {
    diagnostics.push(diagnostic(
      "error",
      "tags.domain_forbidden",
      "tags",
      "Domain nodes must not carry tags; use contains edges and child views for structure.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "remove_domain_tags" },
      },
    ));
  }
}

function addDuplicateTagDiagnostics(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  const seen = new Set<string>();
  const duplicateTags = [...new Set(metrics.tags.filter((tag) => {
    if (seen.has(tag)) return true;
    seen.add(tag);
    return false;
  }))];
  if (duplicateTags.length === 0) return;
  diagnostics.push(diagnostic(
    "error",
    "tags.duplicate",
    "tags",
    "Node tags must not repeat the same controlled tag.",
    `${metrics.fieldPrefix}.tags`,
    {
      candidate_id: node.node_ref,
      repair: { action: "dedupe_node_tags", duplicate_tags: duplicateTags },
    },
  ));
}

function addEntityTagContractDiagnostics(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  const unknown = metrics.tags.filter((tag) => !ENTITY_TAGS_SET.has(tag));
  if (metrics.tags.length === 0) {
    diagnostics.push(diagnostic(
      "error",
      "tags.entity_required",
      "tags",
      "Entity nodes must include at least one controlled entity tag.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "add_entity_tag", allowed_tags: [...ENTITY_TAGS] },
      },
    ));
  }
  if (unknown.length > 0) {
    diagnostics.push(diagnostic(
      "error",
      "tags.entity_unknown",
      "tags",
      "Entity tags must come from the controlled entity tag set.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "replace_unknown_entity_tags", unknown_tags: unknown, allowed_tags: [...ENTITY_TAGS] },
      },
    ));
  }
  const groupA = metrics.tags.filter((tag) => ENTITY_TAG_A_SET.has(tag));
  if (groupA.length > 1) {
    diagnostics.push(diagnostic(
      "error",
      "tags.entity_a_multiple",
      "tags",
      "Entity nodes may use at most one runtime/product shape tag.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "choose_one_entity_a_tag", selected_tags: groupA, allowed_tags: [...ENTITY_TAG_A] },
      },
    ));
  }
  const groupB = metrics.tags.filter((tag) => ENTITY_TAG_B_SET.has(tag));
  if (groupB.length > 1) {
    diagnostics.push(diagnostic(
      "error",
      "tags.entity_b_multiple",
      "tags",
      "Entity nodes may use at most one scope tag.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "choose_one_entity_b_tag", selected_tags: groupB, allowed_tags: [...ENTITY_TAG_B] },
      },
    ));
  }
}

function addActionTagContractDiagnostics(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  const unknown = metrics.tags.filter((tag) => !ACTION_KIND_SET.has(tag));
  if (unknown.length > 0) {
    diagnostics.push(diagnostic(
      "error",
      "tags.action_unknown",
      "tags",
      "Action tags must come from the controlled ActionKind set.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "replace_unknown_action_tags", unknown_tags: unknown, allowed_tags: [...ACTION_KINDS] },
      },
    ));
  }
  const actionKinds = metrics.tags.filter((tag) => ACTION_KIND_SET.has(tag));
  if (actionKinds.length === 0) {
    diagnostics.push(diagnostic(
      "error",
      "tags.action_kind_required",
      "tags",
      "Action nodes must include exactly one ActionKind tag.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "add_one_action_kind", allowed_tags: [...ACTION_KINDS] },
      },
    ));
  } else if (actionKinds.length > 1) {
    diagnostics.push(diagnostic(
      "error",
      "tags.action_kind_multiple",
      "tags",
      "Action nodes must include exactly one ActionKind tag.",
      `${metrics.fieldPrefix}.tags`,
      {
        candidate_id: node.node_ref,
        repair: { action: "choose_one_action_kind", selected_tags: actionKinds, allowed_tags: [...ACTION_KINDS] },
      },
    ));
  }
}

function addTermConflictDiagnostic(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  if (node.node_type !== "entity" || !metrics.hasTermTag || metrics.concreteTags.length === 0) return;
  diagnostics.push(diagnostic(
    "error",
    "tags.term_conflict",
    "tags",
    "Entity tag term is mutually exclusive with concrete runtime/product tags.",
    `${metrics.fieldPrefix}.tags`,
    {
      candidate_id: node.node_ref,
      repair: { action: "split_term_entity_or_remove_conflicting_tags", conflicting_tags: metrics.concreteTags },
    },
  ));
}

function addDescriptionDominatesDiagnostic(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  if (node.node_type === "action" || metrics.sectionCount <= 1 || metrics.descriptionCount / metrics.sectionCount < 0.5) return;
  diagnostics.push(diagnostic(
    "warning",
    "node.description_dominates",
    "node_quality",
    "Description sections are at least half of this node; re-check kind precision before confirming structure.",
    `${metrics.fieldPrefix}.sections`,
    {
      candidate_id: node.node_ref,
      repair: { action: "review_section_kinds_with_compile_actions_reference" },
    },
  ));
}

function addThinConcreteEntityDiagnostic(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  if (node.node_type !== "entity" || metrics.hasTermTag || metrics.sectionCount !== 1 || metrics.childCount !== 0) return;
  diagnostics.push(diagnostic(
    "warning",
    "node.thin_concrete_entity",
    "node_quality",
    "Concrete entity has only one section and no child nodes; keep it only when it has stable standalone retrieval value.",
    `${metrics.fieldPrefix}.sections`,
    {
      candidate_id: node.node_ref,
      repair: {
        action: "merge_into_owner_or_confirm_standalone_identity",
        contains_parent: metrics.hasContainsParent,
      },
    },
  ));
}

function addExpandedTermDiagnostic(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  if (node.node_type !== "entity" || !metrics.hasTermTag || (metrics.sectionCount <= 3 && metrics.childCount === 0)) return;
  diagnostics.push(diagnostic(
    "warning",
    "node.term_expanded_beyond_definition",
    "node_quality",
    "Term entity has grown beyond a compact definition; move rules, designs, or procedures into the owning node.",
    `${metrics.fieldPrefix}.sections`,
    {
      candidate_id: node.node_ref,
      repair: { action: "split_term_from_rules_or_move_content_to_owner" },
    },
  ));
}

function addThinActionDiagnostic(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  if (
    node.node_type !== "action" ||
    metrics.sectionCount >= 2 ||
    metrics.childActionCount !== 0 ||
    (metrics.hasGeneratedParentIndex && metrics.childCount > 0)
  ) return;
  diagnostics.push(diagnostic(
    "warning",
    "node.action_too_thin",
    "node_quality",
    "Action node has fewer than two planned sections and no child action; confirm that the action has standalone retrieval value or keep it as a section under its owner.",
    `${metrics.fieldPrefix}.sections`,
    {
      candidate_id: node.node_ref,
      repair: {
        action: "confirm_standalone_action_or_add_source_backed_process_structure",
        options: ["keep_with_reviewed_rationale", "move_to_owning_view_section", "add_source_backed_section", "add_child_action"],
      },
    },
  ));
}

function addDomainWithoutChildrenDiagnostic(
  node: AlignPayload["nodes"][number],
  metrics: NodeQualityMetrics,
  diagnostics: AlignDiagnostic[],
): void {
  if (node.node_type !== "domain" || metrics.childNodeCount !== 0) return;
  diagnostics.push(diagnostic(
    "error",
    "node.domain_without_children",
    "node_quality",
    "Domain node has no source-backed contains children; keep it only when the user confirms a no-write grouping placeholder.",
    `${metrics.fieldPrefix}.edges`,
    {
      candidate_id: node.node_ref,
      repair: { action: "add_supported_contains_edge_or_reclassify_node" },
    },
  ));
}

export async function validateAlignSourceRef(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  sourceRef: string;
  diagnostics: AlignDiagnostic[];
  owner: string;
  field: string;
}): Promise<void> {
  const parsed = parseSpanSourceRef(input.sourceRef);
  if (parsed?.locator === undefined) {
    input.diagnostics.push(diagnostic("error", "source_ref.invalid", "source_ref", "source_ref must be canonical file:/lark:...#span:...", input.field, {
      candidate_id: input.owner,
      source_ref: input.sourceRef,
      repair: { action: "copy_source_ref_from_source_index_or_span_detail_view" },
    }));
    return;
  }
  const locator = parseDocumentSourceLocator(parsed.locator);
  if (locator === null || locator.sourceType !== input.evidence.source.sourceType || locator.sourceName !== input.evidence.source.sourceName) {
    input.diagnostics.push(diagnostic("error", "source_ref.source_mismatch", "source_ref", "source_ref must belong to this align phase source.", input.field, {
      candidate_id: input.owner,
      source_ref: input.sourceRef,
      repair: { action: "rerun_align_for_matching_source_or_replace_source_ref" },
    }));
    return;
  }
  const resolved = await resolveProseSourceRef({
    projectRoot: input.projectRoot,
    index: input.evidence.index,
    sourceRef: input.sourceRef,
    snapshotMarkdownCache: input.evidence.snapshotMarkdownCache,
  });
  if (resolved === null) {
    input.diagnostics.push(diagnostic("error", "source_ref.unresolved", "source_ref", "source_ref cannot be resolved against current snapshot evidence.", input.field, {
      candidate_id: input.owner,
      source_ref: input.sourceRef,
      repair: { action: "copy_current_source_ref_from_source_index_or_span_detail_view" },
    }));
    return;
  }
  if (resolved.status !== "exact") {
    input.diagnostics.push(diagnostic("error", `source_ref.${resolved.status}`, "source_ref", `source_ref resolves with ${resolved.status}; copy the current source_ref before staging structure.`, input.field, {
      candidate_id: input.owner,
      source_ref: input.sourceRef,
      repair: { action: "replace_with_current_canonical_source_ref", current_source_ref: resolved.span.canonical_source_ref },
    }));
  }
}

export function repairHints(diagnostics: readonly AlignDiagnostic[], phaseId: string): Array<Record<string, unknown>> {
  const families = [...new Set(diagnostics.filter((item) => item.severity === "error").map((item) => item.family))];
  const errorHints = families.map((family) => ({
    family,
    action: family === "source_ref" || family === "edge"
      ? "inspect_source_index_and_repair_structure"
      : family === "stale"
        ? "regenerate_structure_from_current_evidence"
        : family === "node_quality" || family === "tags"
          ? "review_node_and_section_gates_then_repair_structure"
        : "repair_structure_schema",
    command: family === "source_ref" || family === "edge" || family === "stale"
      ? alignCommand(phaseId, ["--view", family === "stale" ? "read-plan" : "source-index", "--format", "json"])
      : alignCommand(phaseId, ["--view", "schema", "--format", "json"]),
  }));
  return errorHints;
}
