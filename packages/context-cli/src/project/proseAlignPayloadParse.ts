import { createHash } from "node:crypto";
import { DOC_MAINLINE_COLLECTIONS, type DocumentMainlineCollection } from "@c4a/context";
import { isSafeEntityId } from "./entityId.js";
import { parseUserOrAgentHints } from "./proseAlignHints.js";
import {
  isKnownProseSectionKind,
  isProseSectionKindMountable,
  mountableProseSectionKinds,
} from "./proseSectionKinds.js";
import {
  diagnostic,
  isRecord,
  parseStringArray,
  parseOptionalString,
  reportUnknownFields,
  stringOrNullValue,
  stringValue,
} from "./proseAlignSchemaUtils.js";
import {
  STRUCTURE_EDGE_CONFIDENCES,
  STRUCTURE_EDGE_TYPES,
  STRUCTURE_SCHEMA_VERSION,
  type AlignDiagnostic,
  type AlignPayload,
  type StructureEdgePlan,
  type StructureLifecycle,
  type StructureNodePlan,
  type StructureSectionPlan,
  type StructureUnresolvedIssue,
  type StructureViewPlan,
} from "./proseAlignTypes.js";

const EDGE_TYPE_SET = new Set<string>(STRUCTURE_EDGE_TYPES);
const EDGE_CONFIDENCE_SET = new Set<string>(STRUCTURE_EDGE_CONFIDENCES);
const DOCUMENT_COLLECTION_SET = new Set<string>(DOC_MAINLINE_COLLECTIONS);
const NODE_TYPES = ["entity", "domain", "action"] as const;
const NODE_TYPE_SET = new Set<string>(NODE_TYPES);

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digest(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isDocumentMainlineCollection(value: string | undefined): value is DocumentMainlineCollection {
  return value !== undefined && DOCUMENT_COLLECTION_SET.has(value);
}

function isSafeSectionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id);
}

function viewRefFor(collection: string, nodeRef: string): string {
  return `${collection}:${nodeRef}`;
}

function sectionRefFor(viewRef: string, sectionId: string): string {
  return `${viewRef}#${sectionId}`;
}

function isSafePathPart(value: string): boolean {
  return isSafeEntityId(value) && !value.includes("\\");
}

function isSafeSlug(value: string): boolean {
  return isSafePathPart(value) && !value.includes("/");
}

function viewPathFor(collection: string, containment: string, slug: string): string {
  return containment === "root"
    ? `${collection}/${slug}.md`
    : `${collection}/${containment}/${slug}.md`;
}

function parseNodeRef(value: unknown, field: string, diagnostics: AlignDiagnostic[]): string | undefined {
  const nodeRef = typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  if (nodeRef === undefined) {
    diagnostics.push(diagnostic("error", "schema.node_ref_missing", "schema", "NodeRef is required.", field));
    return undefined;
  }
  if (!isSafeEntityId(nodeRef)) {
    diagnostics.push(diagnostic("error", "schema.node_ref_unsafe", "schema", "NodeRef must be a safe relative id such as entity/rspack.", field));
    return undefined;
  }
  return nodeRef;
}

function nodeTypeFromRef(nodeRef: string): string | undefined {
  return nodeRef.split("/", 1)[0];
}

function parseViewCollection(
  rawView: Record<string, unknown>,
  index: number,
  diagnostics: AlignDiagnostic[],
): DocumentMainlineCollection | undefined {
  const collection = stringValue(rawView, "collection");
  if (collection === undefined) {
    diagnostics.push(diagnostic("error", "schema.collection_missing", "schema", "View collection is required.", `views[${index}].collection`));
    return undefined;
  }
  if (!isDocumentMainlineCollection(collection)) {
    diagnostics.push(diagnostic("error", "schema.collection_invalid", "schema", `View collection must be one of ${DOC_MAINLINE_COLLECTIONS.join(", ")}. codegraph is produced by AST extraction and feats is not a prose align target.`, `views[${index}].collection`, {
      repair: { action: "choose_document_mainline_collection", allowed_collections: DOC_MAINLINE_COLLECTIONS },
    }));
    return undefined;
  }
  return collection;
}

function validateDerivedViewRef(input: {
  collection: string | undefined;
  index: number;
  nodeRef: string | undefined;
  viewRef: string | undefined;
  diagnostics: AlignDiagnostic[];
}): void {
  if (input.viewRef === undefined) {
    input.diagnostics.push(diagnostic("error", "schema.view_ref_missing", "schema", "ViewRef is required.", `views[${input.index}].view_ref`));
    return;
  }
  if (input.nodeRef === undefined || input.collection === undefined) return;
  const expected = viewRefFor(input.collection, input.nodeRef);
  if (input.viewRef === expected) return;
  input.diagnostics.push(diagnostic("error", "schema.view_ref_not_derived", "schema", "ViewRef must equal <collection>:<node_ref>.", `views[${input.index}].view_ref`, {
    repair: { action: "replace_view_ref", expected_view_ref: expected },
  }));
}

function validateViewNodeRef(input: {
  index: number;
  nodeByRef: ReadonlyMap<string, StructureNodePlan>;
  nodeRef: string | undefined;
  diagnostics: AlignDiagnostic[];
}): void {
  if (input.nodeRef === undefined || input.nodeByRef.has(input.nodeRef)) return;
  input.diagnostics.push(diagnostic("error", "schema.view_node_unknown", "schema", "View node_ref must point to an existing node.", `views[${input.index}].node_ref`, {
    repair: { action: "add_node_or_change_view_node_ref", node_ref: input.nodeRef },
  }));
}

function parseViewPathParts(input: {
  rawView: Record<string, unknown>;
  index: number;
  collection: string | undefined;
  diagnostics: AlignDiagnostic[];
}): { containment?: string; slug?: string } {
  const rawContainment = stringValue(input.rawView, "containment");
  const containment = rawContainment ?? "root";
  if (!isSafePathPart(containment)) {
    input.diagnostics.push(diagnostic("error", "schema.view_containment_unsafe", "schema", "View containment must be a safe relative path segment or nested path.", `views[${input.index}].containment`));
  }
  const slug = stringValue(input.rawView, "slug");
  if (slug === undefined) {
    input.diagnostics.push(diagnostic("error", "schema.view_slug_missing", "schema", "View slug is required and is used as the approved filename.", `views[${input.index}].slug`, {
      repair: {
        action: "add_view_slug",
        expected_shape: "<safe-filename-slug>",
        path_derivation: "<collection>/<slug>.md or <collection>/<containment>/<slug>.md",
      },
    }));
  } else if (!isSafeSlug(slug)) {
    input.diagnostics.push(diagnostic("error", "schema.view_slug_unsafe", "schema", "View slug must be a safe filename slug without path separators.", `views[${input.index}].slug`));
  }
  if (input.collection !== undefined &&
    isSafePathPart(containment) &&
    slug !== undefined &&
    isSafeSlug(slug) &&
    input.rawView.path !== undefined) {
    const expectedPath = viewPathFor(input.collection, containment, slug);
    if (typeof input.rawView.path !== "string" || input.rawView.path.trim() !== expectedPath) {
      input.diagnostics.push(diagnostic("error", "schema.view_path_not_derived", "schema", "View path must be omitted or equal to the CLI-derived path.", `views[${input.index}].path`, {
        repair: { action: "remove_or_replace_view_path", expected_path: expectedPath },
      }));
    }
  }
  return {
    containment,
    ...(slug !== undefined ? { slug } : {}),
  };
}

function validateViewNodeType(input: {
  index: number;
  rawNodeType: string | undefined;
  derivedNodeType: string | undefined;
  diagnostics: AlignDiagnostic[];
}): void {
  if (input.rawNodeType === undefined || input.derivedNodeType === undefined || input.rawNodeType === input.derivedNodeType) return;
  input.diagnostics.push(diagnostic("error", "schema.view_node_type_mismatch", "schema", "View node_type must match the referenced node.", `views[${input.index}].node_type`, {
    repair: { action: "replace_view_node_type", expected_node_type: input.derivedNodeType },
  }));
}

function parseGeneratedViewKind(
  rawView: Record<string, unknown>,
  index: number,
  diagnostics: AlignDiagnostic[],
): "parent_index" | undefined {
  const generated = stringValue(rawView, "generated");
  if (generated === undefined) return undefined;
  if (generated === "parent_index") return generated;
  diagnostics.push(diagnostic("error", "schema.view_generated_invalid", "schema", "View generated must be parent_index when present.", `views[${index}].generated`, {
    repair: { action: "remove_generated_or_use_parent_index" },
  }));
  return undefined;
}

function validateNodeIdentity(input: {
  index: number;
  nodeRef: string | undefined;
  title: string | undefined;
  nodeType: string | undefined;
  diagnostics: AlignDiagnostic[];
}): void {
  const { index, nodeRef, title, nodeType, diagnostics } = input;
  if (title === undefined) diagnostics.push(diagnostic("error", "schema.node_title_missing", "schema", "Node title is required.", `nodes[${index}].title`));
  if (nodeType === undefined) diagnostics.push(diagnostic("error", "schema.node_type_missing", "schema", "Node node_type is required.", `nodes[${index}].node_type`));
  if (nodeType !== undefined && !NODE_TYPE_SET.has(nodeType)) {
    diagnostics.push(diagnostic("error", "schema.node_type_invalid", "schema", `Node node_type must be one of ${NODE_TYPES.join(", ")}.`, `nodes[${index}].node_type`, {
      repair: { action: "choose_supported_node_type", allowed_node_types: NODE_TYPES },
    }));
  }
  if (nodeRef !== undefined && nodeType !== undefined && !nodeRef.startsWith(`${nodeType}/`)) {
    diagnostics.push(diagnostic("error", "schema.node_ref_type_mismatch", "schema", "NodeRef must start with node_type followed by '/'.", `nodes[${index}].node_ref`, {
      repair: { action: "rename_node_ref_or_node_type", expected_prefix: `${nodeType}/` },
    }));
  }
}

function parseNode(rawNode: Record<string, unknown>, index: number, diagnostics: AlignDiagnostic[]): StructureNodePlan | undefined {
  reportUnknownFields(rawNode, ["node_ref", "title", "node_type", "summary", "ownership", "tags"], `nodes[${index}]`, diagnostics);
  const nodeRef = parseNodeRef(rawNode.node_ref, `nodes[${index}].node_ref`, diagnostics);
  const title = stringValue(rawNode, "title");
  const nodeType = stringValue(rawNode, "node_type");
  validateNodeIdentity({ index, nodeRef, title, nodeType, diagnostics });
  const tags = parseStringArray(rawNode.tags, `nodes[${index}].tags`, diagnostics);
  if (nodeRef === undefined || title === undefined || nodeType === undefined) return undefined;
  const summary = stringValue(rawNode, "summary");
  const ownership = stringValue(rawNode, "ownership");
  return {
    node_ref: nodeRef,
    title,
    node_type: nodeType,
    ...(summary !== undefined ? { summary } : {}),
    ...(ownership !== undefined ? { ownership } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function parseNodes(value: unknown, diagnostics: AlignDiagnostic[]): StructureNodePlan[] {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("error", "schema.nodes_array", "schema", "Payload nodes must be an array.", "nodes"));
    return [];
  }
  if (value.length === 0) diagnostics.push(diagnostic("error", "schema.nodes_missing", "schema", "Payload must include at least one node.", "nodes"));
  const nodes: StructureNodePlan[] = [];
  for (const [index, rawNode] of value.entries()) {
    if (!isRecord(rawNode)) {
      diagnostics.push(diagnostic("error", "schema.node_object", "schema", `Node ${index + 1} must be an object.`, `nodes[${index}]`));
      continue;
    }
    const node = parseNode(rawNode, index, diagnostics);
    if (node !== undefined) nodes.push(node);
  }
  return nodes;
}

function validateSectionKind(input: {
  field: string;
  nodeType: string | undefined;
  kind: string | undefined;
  diagnostics: AlignDiagnostic[];
}): void {
  if (input.kind === undefined) return;
  if (!isKnownProseSectionKind(input.kind)) {
    input.diagnostics.push(diagnostic("error", "schema.section_kind_invalid", "schema", "Section kind must use the current prose section kind set.", input.field, {
      repair: { action: "choose_supported_section_kind" },
    }));
    return;
  }
  if (input.nodeType !== undefined && !isProseSectionKindMountable(input.nodeType, input.kind)) {
    input.diagnostics.push(diagnostic("error", "schema.section_kind_mount_invalid", "schema", `Section kind ${input.kind} cannot be mounted on node_type ${input.nodeType}.`, input.field, {
      repair: {
        action: "choose_kind_allowed_for_node_type_or_return_to_structure",
        valid_kinds: mountableProseSectionKinds(input.nodeType),
      },
    }));
  }
}

function parseSections(input: {
  value: unknown;
  viewIndex: number;
  viewRef: string | undefined;
  nodeType: string | undefined;
  diagnostics: AlignDiagnostic[];
}): StructureSectionPlan[] {
  if (!Array.isArray(input.value)) {
    diagnosticsForSections(input);
    return [];
  }
  const sections: StructureSectionPlan[] = [];
  const sectionIds = new Set<string>();
  for (const [sectionIndex, rawSection] of input.value.entries()) {
    const field = `views[${input.viewIndex}].sections[${sectionIndex}]`;
    if (!isRecord(rawSection)) {
      input.diagnostics.push(diagnostic("error", "schema.section_object", "schema", "Section must be an object.", field));
      continue;
    }
    reportUnknownFields(rawSection, ["id", "section_ref", "kind", "summary", "ownership", "source_refs"], field, input.diagnostics);
    const id = stringValue(rawSection, "id");
    const kind = stringValue(rawSection, "kind");
    const ownership = stringValue(rawSection, "ownership");
    const sourceRefs = parseStringArray(rawSection.source_refs, `${field}.source_refs`, input.diagnostics);
    if (id === undefined) input.diagnostics.push(diagnostic("error", "schema.section_id_missing", "schema", "Section id is required.", `${field}.id`));
    if (id !== undefined && !isSafeSectionId(id)) {
      input.diagnostics.push(diagnostic("error", "schema.section_id_unsafe", "schema", "Section id must start with an alphanumeric character and contain only alphanumeric characters, underscores, or hyphens.", `${field}.id`));
    }
    if (id !== undefined && sectionIds.has(id)) {
      input.diagnostics.push(diagnostic("error", "duplicate.section_id", "duplicate", "Section id must be unique within the view.", `${field}.id`));
    }
    if (id !== undefined) sectionIds.add(id);
    if (kind === undefined) input.diagnostics.push(diagnostic("error", "schema.section_kind_missing", "schema", "Section kind is required.", `${field}.kind`));
    validateSectionKind({ field: `${field}.kind`, nodeType: input.nodeType, kind, diagnostics: input.diagnostics });
    if (sourceRefs.length === 0) {
      input.diagnostics.push(diagnostic("error", "source_ref.section_missing", "source_ref", "Section must cite at least one source_ref.", `${field}.source_refs`));
    }
    if (id !== undefined && input.viewRef !== undefined && rawSection.section_ref !== undefined) {
      const expected = sectionRefFor(input.viewRef, id);
      if (typeof rawSection.section_ref !== "string" || rawSection.section_ref.trim() !== expected) {
        input.diagnostics.push(diagnostic("error", "schema.section_ref_not_derived", "schema", "SectionRef must be omitted or equal to <view_ref>#<section_id>.", `${field}.section_ref`, {
          repair: { action: "remove_or_replace_section_ref", expected_section_ref: expected },
        }));
      }
    }
    if (id !== undefined && kind !== undefined && input.viewRef !== undefined) {
      sections.push({
        id,
        section_ref: sectionRefFor(input.viewRef, id),
        kind,
        ...(typeof rawSection.summary === "string" && rawSection.summary.trim().length > 0 ? { summary: rawSection.summary.trim() } : {}),
        ...(ownership !== undefined ? { ownership } : {}),
        source_refs: sourceRefs,
      });
    }
  }
  return sections;
}

function diagnosticsForSections(input: {
  value: unknown;
  viewIndex: number;
  diagnostics: AlignDiagnostic[];
}): void {
  input.diagnostics.push(diagnostic("error", "schema.sections_array", "schema", "View sections must be an array.", `views[${input.viewIndex}].sections`));
}

function parseView(input: {
  rawView: Record<string, unknown>;
  index: number;
  nodeByRef: ReadonlyMap<string, StructureNodePlan>;
  diagnostics: AlignDiagnostic[];
}): StructureViewPlan | undefined {
  const { rawView, index, nodeByRef, diagnostics } = input;
  reportUnknownFields(rawView, ["view_ref", "node_ref", "collection", "generated", "title", "node_type", "containment", "slug", "path", "summary", "ownership", "sections"], `views[${index}]`, diagnostics);
  const nodeRef = parseNodeRef(rawView.node_ref, `views[${index}].node_ref`, diagnostics);
  const collection = parseViewCollection(rawView, index, diagnostics);
  const viewRef = stringValue(rawView, "view_ref");
  validateDerivedViewRef({ collection, index, nodeRef, viewRef, diagnostics });
  validateViewNodeRef({ index, nodeByRef, nodeRef, diagnostics });
  const { containment, slug } = parseViewPathParts({ rawView, index, collection, diagnostics });
  const node = nodeRef === undefined ? undefined : nodeByRef.get(nodeRef);
  const rawNodeType = stringValue(rawView, "node_type");
  const derivedNodeType = node?.node_type ?? (nodeRef === undefined ? undefined : nodeTypeFromRef(nodeRef));
  validateViewNodeType({ index, rawNodeType, derivedNodeType, diagnostics });
  const sections = parseSections({
    value: rawView.sections,
    viewIndex: index,
    viewRef,
    nodeType: rawNodeType ?? derivedNodeType,
    diagnostics,
  });
  const generated = parseGeneratedViewKind(rawView, index, diagnostics);
  const title = stringValue(rawView, "title") ?? node?.title;
  if (title === undefined) diagnostics.push(diagnostic("error", "schema.view_title_missing", "schema", "View title is required when node title is unavailable.", `views[${index}].title`));
  if (viewRef === undefined || nodeRef === undefined || collection === undefined || title === undefined || containment === undefined || !isSafePathPart(containment) || slug === undefined || !isSafeSlug(slug)) return undefined;
  const summary = stringValue(rawView, "summary");
  const ownership = stringValue(rawView, "ownership");
  return {
    view_ref: viewRef,
    node_ref: nodeRef,
    collection,
    ...(generated === "parent_index" ? { generated } : {}),
    title,
    node_type: derivedNodeType ?? rawNodeType ?? "entity",
    containment,
    slug,
    path: viewPathFor(collection, containment, slug),
    ...(summary !== undefined ? { summary } : {}),
    ...(ownership !== undefined ? { ownership } : {}),
    sections,
  };
}

function parseViews(value: unknown, nodes: readonly StructureNodePlan[], diagnostics: AlignDiagnostic[]): StructureViewPlan[] {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("error", "schema.views_array", "schema", "Payload views must be an array.", "views"));
    return [];
  }
  if (value.length === 0) diagnostics.push(diagnostic("error", "schema.views_missing", "schema", "Payload must include at least one view.", "views"));
  const nodeByRef = new Map(nodes.map((node) => [node.node_ref, node]));
  const views: StructureViewPlan[] = [];
  for (const [index, rawView] of value.entries()) {
    if (!isRecord(rawView)) {
      diagnostics.push(diagnostic("error", "schema.view_object", "schema", `View ${index + 1} must be an object.`, `views[${index}]`));
      continue;
    }
    const view = parseView({ rawView, index, nodeByRef, diagnostics });
    if (view !== undefined) views.push(view);
  }
  return views;
}

function parseEdges(value: unknown, diagnostics: AlignDiagnostic[]): StructureEdgePlan[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("error", "schema.edges_array", "schema", "Payload edges must be an array.", "edges"));
    return [];
  }
  const edges: StructureEdgePlan[] = [];
  for (const [index, rawEdge] of value.entries()) {
    if (!isRecord(rawEdge)) {
      diagnostics.push(diagnostic("error", "schema.edge_object", "schema", `Edge ${index + 1} must be an object.`, `edges[${index}]`));
      continue;
    }
    reportUnknownFields(rawEdge, ["type", "from", "to", "source_refs", "confidence", "note"], `edges[${index}]`, diagnostics);
    const type = stringValue(rawEdge, "type");
    const from = stringValue(rawEdge, "from");
    const to = stringValue(rawEdge, "to");
    const confidence = parseOptionalString(rawEdge.confidence, `edges[${index}].confidence`, diagnostics);
    const sourceRefs = parseStringArray(rawEdge.source_refs, `edges[${index}].source_refs`, diagnostics);
    if (type === undefined) diagnostics.push(diagnostic("error", "edge.type_missing", "edge", "Edge type is required.", `edges[${index}].type`));
    if (type !== undefined && !EDGE_TYPE_SET.has(type)) {
      diagnostics.push(diagnostic("error", "edge.type_invalid", "edge", `Edge type must be one of ${STRUCTURE_EDGE_TYPES.join(", ")}; related/affects/covers/owned_by are not accepted edge types.`, `edges[${index}].type`));
    }
    if (from === undefined) diagnostics.push(diagnostic("error", "edge.from_missing", "edge", "Edge from endpoint is required.", `edges[${index}].from`));
    if (to === undefined) diagnostics.push(diagnostic("error", "edge.to_missing", "edge", "Edge to endpoint is required.", `edges[${index}].to`));
    if (confidence !== undefined && !EDGE_CONFIDENCE_SET.has(confidence)) {
      diagnostics.push(diagnostic("error", "edge.confidence_invalid", "edge", `Edge confidence must be one of ${STRUCTURE_EDGE_CONFIDENCES.join(", ")} when source evidence is hedged.`, `edges[${index}].confidence`));
    }
    if (sourceRefs.length === 0) diagnostics.push(diagnostic("error", "source_ref.edge_missing", "source_ref", "Edge must cite at least one source_ref.", `edges[${index}].source_refs`));
    if (type !== undefined && EDGE_TYPE_SET.has(type) && from !== undefined && to !== undefined) {
      const note = stringValue(rawEdge, "note");
      edges.push({
        type: type as StructureEdgePlan["type"],
        from,
        to,
        source_refs: sourceRefs,
        ...(confidence !== undefined && EDGE_CONFIDENCE_SET.has(confidence) ? { confidence: confidence as NonNullable<StructureEdgePlan["confidence"]> } : {}),
        ...(note !== undefined ? { note } : {}),
      });
    }
  }
  return edges;
}

function parseUnresolved(value: unknown, diagnostics: AlignDiagnostic[]): StructureUnresolvedIssue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("error", "schema.unresolved_array", "schema", "Payload unresolved must be an array.", "unresolved"));
    return [];
  }
  const unresolved: StructureUnresolvedIssue[] = [];
  for (const [index, rawIssue] of value.entries()) {
    if (!isRecord(rawIssue)) {
      diagnostics.push(diagnostic("error", "schema.unresolved_object", "schema", `Unresolved issue ${index + 1} must be an object.`, `unresolved[${index}]`));
      continue;
    }
    reportUnknownFields(rawIssue, ["issue", "note", "source_refs"], `unresolved[${index}]`, diagnostics);
    const issue = stringValue(rawIssue, "issue");
    if (issue === undefined) {
      diagnostics.push(diagnostic("error", "schema.unresolved_issue_missing", "schema", "Unresolved issue must include issue.", `unresolved[${index}].issue`));
      continue;
    }
    const sourceRefs = parseStringArray(rawIssue.source_refs, `unresolved[${index}].source_refs`, diagnostics);
    const note = stringValue(rawIssue, "note");
    unresolved.push({
      issue,
      ...(note !== undefined ? { note } : {}),
      ...(sourceRefs.length > 0 ? { source_refs: sourceRefs } : {}),
    });
  }
  return unresolved;
}

function parseLifecycle(value: unknown, diagnostics: AlignDiagnostic[]): StructureLifecycle {
  if (value === undefined) return { state: "draft" };
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("error", "schema.lifecycle_object", "schema", "Payload lifecycle must be an object.", "lifecycle"));
    return { state: "draft" };
  }
  reportUnknownFields(value, ["state", "phase_collection", "confirmed_by", "confirmed_at", "structure_digest", "frozen_at", "frozen_snapshot_hash"], "lifecycle", diagnostics);
  const state = stringValue(value, "state");
  if (state !== "draft" && state !== "confirmed" && state !== "frozen") {
    diagnostics.push(diagnostic("error", "lifecycle.state_invalid", "lifecycle", "Lifecycle state must be draft, confirmed, or frozen.", "lifecycle.state"));
  }
  const phaseCollection = stringValue(value, "phase_collection");
  const confirmedBy = stringValue(value, "confirmed_by");
  const confirmedAt = stringValue(value, "confirmed_at");
  const structureDigest = stringValue(value, "structure_digest");
  const frozenAt = stringOrNullValue(value, "frozen_at");
  const frozenSnapshotHash = stringOrNullValue(value, "frozen_snapshot_hash");
  const lifecycle: StructureLifecycle = {
    state: state === "confirmed" || state === "frozen" ? state : "draft",
    ...(phaseCollection !== undefined ? { phase_collection: phaseCollection } : {}),
    ...(confirmedBy !== undefined ? { confirmed_by: confirmedBy } : {}),
    ...(confirmedAt !== undefined ? { confirmed_at: confirmedAt } : {}),
    ...(structureDigest !== undefined ? { structure_digest: structureDigest } : {}),
    ...(frozenAt !== undefined ? { frozen_at: frozenAt ?? null } : {}),
    ...(frozenSnapshotHash !== undefined ? { frozen_snapshot_hash: frozenSnapshotHash ?? null } : {}),
  };
  if (lifecycle.state === "confirmed" || lifecycle.state === "frozen") {
    if (lifecycle.confirmed_by === undefined) {
      diagnostics.push(diagnostic("error", "lifecycle.confirmed_by_missing", "lifecycle", "Confirmed structure must include confirmed_by.", "lifecycle.confirmed_by"));
    }
    if (lifecycle.confirmed_at === undefined) {
      diagnostics.push(diagnostic("error", "lifecycle.confirmed_at_missing", "lifecycle", "Confirmed structure must include confirmed_at.", "lifecycle.confirmed_at"));
    }
    if (lifecycle.structure_digest === undefined) {
      diagnostics.push(diagnostic("error", "lifecycle.structure_digest_missing", "lifecycle", "Confirmed structure must include structure_digest from validation.", "lifecycle.structure_digest"));
    }
  }
  if (lifecycle.state === "frozen") {
    if (lifecycle.frozen_at === undefined || lifecycle.frozen_at === null) {
      diagnostics.push(diagnostic("error", "lifecycle.frozen_at_missing", "lifecycle", "Frozen structure must include frozen_at from compile freeze.", "lifecycle.frozen_at"));
    }
    if (lifecycle.frozen_snapshot_hash === undefined || lifecycle.frozen_snapshot_hash === null) {
      diagnostics.push(diagnostic("error", "lifecycle.frozen_snapshot_hash_missing", "lifecycle", "Frozen structure must include frozen_snapshot_hash from compile freeze.", "lifecycle.frozen_snapshot_hash"));
    }
  }
  return lifecycle;
}

function structureBody(input: {
  schema_version: typeof STRUCTURE_SCHEMA_VERSION;
  sources: string[];
  nodes: StructureNodePlan[];
  views: StructureViewPlan[];
  edges: StructureEdgePlan[];
  unresolved: StructureUnresolvedIssue[];
  evidence_snapshot_hash: string;
}): Record<string, unknown> {
  return {
    schema_version: input.schema_version,
    sources: input.sources,
    nodes: input.nodes,
    views: input.views,
    edges: input.edges,
    unresolved: input.unresolved,
    evidence_snapshot_hash: input.evidence_snapshot_hash,
  };
}

export function parseAlignPayload(value: unknown): {
  payload?: AlignPayload;
  diagnostics: AlignDiagnostic[];
} {
  const diagnostics: AlignDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      diagnostics: [diagnostic("error", "schema.payload_object", "schema", "Payload must be a YAML/JSON object.", "schema")],
    };
  }
  reportUnknownFields(value, ["schema_version", "sources", "nodes", "views", "edges", "unresolved", "user_or_agent_hints", "lifecycle", "evidence_snapshot_hash"], "payload", diagnostics);
  if (value.schema_version !== STRUCTURE_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("error", "schema.version", "schema", `Payload schema_version must be ${STRUCTURE_SCHEMA_VERSION}.`, "schema_version"));
  }
  const sources = parseStringArray(value.sources, "sources", diagnostics);
  if (sources.length === 0) diagnostics.push(diagnostic("error", "schema.sources_missing", "schema", "Payload must include sources.", "sources"));
  const evidenceSnapshotHash = typeof value.evidence_snapshot_hash === "string" && value.evidence_snapshot_hash.trim().length > 0
    ? value.evidence_snapshot_hash.trim()
    : undefined;
  if (evidenceSnapshotHash === undefined) {
    diagnostics.push(diagnostic("error", "schema.evidence_snapshot_hash_missing", "schema", "Payload must include evidence_snapshot_hash copied from read-plan.snapshot.snapshot_hash.", "evidence_snapshot_hash"));
  }
  const nodes = parseNodes(value.nodes, diagnostics);
  const views = parseViews(value.views, nodes, diagnostics);
  const edges = parseEdges(value.edges, diagnostics);
  const unresolved = parseUnresolved(value.unresolved, diagnostics);
  const userOrAgentHints = parseUserOrAgentHints(value.user_or_agent_hints, diagnostics);
  const lifecycle = parseLifecycle(value.lifecycle, diagnostics);
  const body = structureBody({
    schema_version: STRUCTURE_SCHEMA_VERSION,
    sources,
    nodes,
    views,
    edges,
    unresolved,
    evidence_snapshot_hash: evidenceSnapshotHash ?? "",
  });
  const structureDigest = digest(body);
  if ((lifecycle.state === "confirmed" || lifecycle.state === "frozen") &&
    lifecycle.structure_digest !== undefined &&
    lifecycle.structure_digest !== structureDigest) {
    diagnostics.push(diagnostic("error", "lifecycle.structure_digest_mismatch", "lifecycle", "Lifecycle structure_digest does not match canonical structure body.", "lifecycle.structure_digest", {
      repair: { action: "replace_structure_digest", expected_structure_digest: structureDigest },
    }));
  }
  return {
    payload: {
      schema_version: STRUCTURE_SCHEMA_VERSION,
      sources,
      nodes,
      views,
      edges,
      unresolved,
      ...(userOrAgentHints !== undefined ? { user_or_agent_hints: userOrAgentHints } : {}),
      lifecycle,
      evidence_snapshot_hash: evidenceSnapshotHash ?? "",
      payload_digest: sha256(canonicalJson(value)),
      structure_digest: structureDigest,
    },
    diagnostics,
  };
}

export function normalizeAlignPayloadForWrite(payload: AlignPayload): Record<string, unknown> {
  return {
    schema_version: payload.schema_version,
    sources: payload.sources,
    evidence_snapshot_hash: payload.evidence_snapshot_hash,
    nodes: payload.nodes,
    views: payload.views,
    edges: payload.edges,
    unresolved: payload.unresolved,
    ...(payload.user_or_agent_hints !== undefined ? { user_or_agent_hints: payload.user_or_agent_hints } : {}),
    lifecycle: {
      ...payload.lifecycle,
      structure_digest: payload.structure_digest,
    },
  };
}
