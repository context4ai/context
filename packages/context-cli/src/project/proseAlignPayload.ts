import {
  parseDocumentSourceLocator,
  parseSpanSourceRef,
} from "@c4a/extract";
import { diagnostic } from "./proseAlignSchemaUtils.js";
import { resolveProseSourceRef } from "./documentEvidenceIndex.js";
import { parseAlignPayload } from "./proseAlignPayloadParse.js";
import {
  addStructureQualityDiagnostics,
  validateAlignSourceRef,
} from "./proseAlignPayloadValidation.js";
import {
  type AlignDiagnostic,
  type AlignPayload,
  type EvidenceContext,
  type ValidateResult,
} from "./proseAlignTypes.js";
import {
  compactStructureSummary,
  existingApprovedStructureDiagnostics,
  largeNarrativeSplitDiagnostics,
  readExistingApprovedStructureSummary,
  structureReviewNotice,
  writeStructureSummaryReport,
} from "./proseAlignStructureSummary.js";
import { readExistingApprovedEndpointRefs } from "./proseAlignExistingApprovedStructure.js";
import { parentIndexModel } from "./parentIndexView.js";
import { buildValidateResult, withStructureReviewArtifacts } from "./proseAlignValidateResult.js";
import { addSectionMirrorDiagnostics } from "./proseAlignPayloadMirror.js";
import { addMechanicalBoundaryDiagnostics } from "./proseAlignBoundaryDiagnostics.js";

export { readAlignInputPayload } from "./proseAlignPayloadInput.js";
export { stageAlignPayload } from "./proseAlignPayloadStage.js";

type AlignValidationInput = {
  projectRoot: string;
  phaseId: string;
  phaseCollection: string;
  evidence: EvidenceContext;
  rawPayload: unknown;
  approvedStructureRestore?: boolean;
  includeStructureSummary?: boolean;
  commandInputPath?: string;
};

// Internal-only root used by orphan reachability. It is never a valid persisted edge endpoint.
function collectionRootEndpoint(collection: string): string {
  return `collection:${collection}`;
}

function validatePhaseShape(
  input: AlignValidationInput,
  payload: AlignPayload | undefined,
  diagnostics: AlignDiagnostic[],
): void {
  if (payload !== undefined && !payload.sources.includes(`${input.evidence.source.sourceType}:${input.evidence.source.sourceName}`)) {
    diagnostics.push(diagnostic("error", "schema.source_missing", "schema", "Payload sources must include this align phase source.", "sources", {
      repair: { action: "add_phase_source", source: `${input.evidence.source.sourceType}:${input.evidence.source.sourceName}` },
    }));
  }
  if (payload !== undefined &&
    payload.evidence_snapshot_hash.length > 0 &&
    payload.evidence_snapshot_hash !== input.evidence.index.snapshot_hash) {
    diagnostics.push(diagnostic("error", "payload.digest_stale", "stale", "Payload was generated from a different evidence snapshot; rerun read-plan and regenerate the structure.", "evidence_snapshot_hash", {
      repair: {
        action: "regenerate_structure_from_current_evidence",
        expected_snapshot_hash: input.evidence.index.snapshot_hash,
        actual_snapshot_hash: payload.evidence_snapshot_hash,
      },
    }));
  }
}

function sourceRefBelongsToEvidence(input: {
  evidence: EvidenceContext;
  sourceRef: string;
}): boolean {
  const parsed = parseSpanSourceRef(input.sourceRef);
  if (parsed?.locator === undefined) return false;
  const locator = parseDocumentSourceLocator(parsed.locator);
  return locator !== null &&
    locator.sourceType === input.evidence.source.sourceType &&
    locator.sourceName === input.evidence.source.sourceName;
}

function shouldValidateSourceRef(input: AlignValidationInput, sourceRef: string): boolean {
  return input.approvedStructureRestore !== true ||
    sourceRefBelongsToEvidence({ evidence: input.evidence, sourceRef });
}

async function validateNodeSourceRefs(
  input: AlignValidationInput,
  payload: AlignPayload | undefined,
  diagnostics: AlignDiagnostic[],
): Promise<Set<string>> {
  const nodeRefs = new Set<string>();
  for (const node of payload?.nodes ?? []) {
    if (nodeRefs.has(node.node_ref)) {
      diagnostics.push(diagnostic("error", "duplicate.node_ref", "duplicate", "Structure repeats a NodeRef.", "nodes", {
        candidate_id: node.node_ref,
      }));
    }
    nodeRefs.add(node.node_ref);
  }
  return nodeRefs;
}

async function validateViewSourceRefs(
  input: AlignValidationInput,
  payload: AlignPayload | undefined,
  nodeRefs: ReadonlySet<string>,
  diagnostics: AlignDiagnostic[],
): Promise<Set<string>> {
  const endpointRefs = new Set<string>(nodeRefs);
  const viewRefs = new Set<string>();
  const viewPaths = new Map<string, string>();
  for (const [viewIndex, view] of (payload?.views ?? []).entries()) {
    if (viewRefs.has(view.view_ref)) {
      diagnostics.push(diagnostic("error", "duplicate.view_ref", "duplicate", "Structure repeats a ViewRef.", `views[${viewIndex}].view_ref`, {
        candidate_id: view.view_ref,
      }));
    }
    viewRefs.add(view.view_ref);
    const existingPathViewRef = viewPaths.get(view.path);
    if (existingPathViewRef !== undefined && existingPathViewRef !== view.view_ref) {
      diagnostics.push(diagnostic("error", "duplicate.view_path", "duplicate", "Structure repeats a derived approved view path; change containment or slug before confirming.", `views[${viewIndex}].path`, {
        candidate_id: view.view_ref,
        repair: { action: "change_view_slug_or_containment", existing_view_ref: existingPathViewRef, path: view.path },
      }));
    } else {
      viewPaths.set(view.path, view.view_ref);
    }
    endpointRefs.add(view.view_ref);
    for (const [sectionIndex, section] of view.sections.entries()) {
      endpointRefs.add(section.section_ref);
      for (const [refIndex, ref] of section.source_refs.entries()) {
        if (!shouldValidateSourceRef(input, ref)) continue;
        await validateAlignSourceRef({
          projectRoot: input.projectRoot,
          evidence: input.evidence,
          sourceRef: ref,
          diagnostics,
          owner: section.section_ref,
          field: `views[${viewIndex}].sections[${sectionIndex}].source_refs[${refIndex}]`,
        });
      }
    }
  }
  return endpointRefs;
}

function validatePreferredNodeHints(
  payload: AlignPayload | undefined,
  nodeRefs: ReadonlySet<string>,
  diagnostics: AlignDiagnostic[],
): void {
  for (const preferredNode of payload?.user_or_agent_hints?.preferred_nodes ?? []) {
    if (nodeRefs.has(preferredNode.node_ref)) continue;
    diagnostics.push(diagnostic("warning", "hint.preferred_node_not_staged", "support", "Preferred node hint is not represented by a staged NodeRef; add evidence-backed node or keep it out of structure.", "user_or_agent_hints.preferred_nodes", {
      candidate_id: preferredNode.node_ref,
    }));
  }
}

function isGeneratedParentIndexContainsEdge(
  payload: AlignPayload | undefined,
  edge: AlignPayload["edges"][number],
): boolean {
  if (payload === undefined || edge.type !== "contains") return false;
  const parent = payload.views.find((view) => view.view_ref === edge.from);
  if (parent?.generated !== "parent_index" || parent.sections.length !== 0) return false;
  const child = payload.views.find((view) => view.view_ref === edge.to);
  return child !== undefined && child.collection === parent.collection && child.sections.length > 0;
}

async function validateEdgeSourceRefs(
  input: AlignValidationInput,
  payload: AlignPayload | undefined,
  endpointRefs: ReadonlySet<string>,
  diagnostics: AlignDiagnostic[],
): Promise<void> {
  for (const [edgeIndex, edge] of (payload?.edges ?? []).entries()) {
    if (!endpointRefs.has(edge.from)) {
      diagnostics.push(diagnostic("error", "edge.from_unknown", "edge", "Edge from must point to an existing NodeRef, ViewRef, SectionRef, or approved endpoint.", `edges[${edgeIndex}].from`, {
        repair: { action: "choose_existing_from_endpoint_or_move_to_unresolved", from: edge.from },
      }));
    }
    if (!endpointRefs.has(edge.to)) {
      diagnostics.push(diagnostic("error", "edge.to_unknown", "edge", "Edge to must point to an existing NodeRef, ViewRef, SectionRef, or approved endpoint.", `edges[${edgeIndex}].to`, {
        repair: { action: "choose_existing_to_endpoint_or_move_to_unresolved", to: edge.to },
      }));
    }
    for (const [refIndex, ref] of edge.source_refs.entries()) {
      if (!shouldValidateSourceRef(input, ref)) continue;
      await validateAlignSourceRef({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        sourceRef: ref,
        diagnostics,
        owner: `${edge.from}->${edge.to}`,
        field: `edges[${edgeIndex}].source_refs[${refIndex}]`,
      });
      if (isGeneratedParentIndexContainsEdge(payload, edge)) continue;
      await validateEdgeSourceSpanShape({
        input,
        edgeIndex,
        edgeType: edge.type,
        sourceRef: ref,
        diagnostics,
      });
    }
  }
}

function endpointAliasesForView(view: NonNullable<AlignPayload["views"][number]>): string[] {
  return [
    view.node_ref,
    view.view_ref,
    ...view.sections.map((section) => section.section_ref),
  ];
}

function reachabilityAliasesForView(view: NonNullable<AlignPayload["views"][number]>): string[] {
  return [
    view.view_ref,
    ...view.sections.map((section) => section.section_ref),
  ];
}

function localEndpointRefsForPayload(
  payload: AlignPayload | undefined,
  nodeRefs: ReadonlySet<string>,
  viewEndpointRefs: ReadonlySet<string>,
): Set<string> {
  const endpointRefs = new Set<string>([
    ...nodeRefs,
    ...viewEndpointRefs,
  ]);
  return endpointRefs;
}

function connectGraphEndpoints(
  graph: Map<string, Set<string>>,
  left: string,
  right: string,
): void {
  const leftNeighbors = graph.get(left) ?? new Set<string>();
  leftNeighbors.add(right);
  graph.set(left, leftNeighbors);
  const rightNeighbors = graph.get(right) ?? new Set<string>();
  rightNeighbors.add(left);
  graph.set(right, rightNeighbors);
}

function reachableViewsFromSpine(input: {
  payload: AlignPayload;
  approvedEndpointRefs?: ReadonlySet<string>;
  approvedStructureRestore?: boolean;
}): Set<string> {
  const { payload } = input;
  const endpointGraph = new Map<string, Set<string>>();
  const viewAliases = new Map<string, string[]>();
  const ensureEndpoint = (endpoint: string): Set<string> => {
    const neighbors = endpointGraph.get(endpoint) ?? new Set<string>();
    endpointGraph.set(endpoint, neighbors);
    return neighbors;
  };
  for (const node of payload.nodes) {
    ensureEndpoint(node.node_ref);
  }
  for (const view of payload.views) {
    const aliases = endpointAliasesForView(view);
    viewAliases.set(view.view_ref, aliases);
    aliases.forEach((endpoint) => ensureEndpoint(endpoint));
    ensureEndpoint(collectionRootEndpoint(view.collection));
  }
  for (const approvedEndpoint of input.approvedEndpointRefs ?? []) {
    ensureEndpoint(approvedEndpoint);
  }

  for (const edge of payload.edges) {
    ensureEndpoint(edge.from).add(edge.to);
    ensureEndpoint(edge.to).add(edge.from);
  }
  const edgeTouchedEndpoints = new Set(payload.edges.flatMap((edge) => [edge.from, edge.to]));
  for (const view of payload.views) {
    if (!edgeTouchedEndpoints.has(view.node_ref) && input.approvedStructureRestore !== true) continue;
    connectGraphEndpoints(endpointGraph, view.node_ref, view.view_ref);
  }
  connectCollectionRootsToLocalSpine({
    endpointGraph,
    payload,
    viewAliases,
    approvedEndpointRefs: input.approvedEndpointRefs ?? new Set(),
    approvedStructureRestore: input.approvedStructureRestore === true,
  });

  const queue = [
    ...new Set(payload.views.map((view) => collectionRootEndpoint(view.collection))),
    ...(input.approvedEndpointRefs ?? []),
    ...(input.approvedStructureRestore === true ? payload.nodes.map((node) => node.node_ref) : []),
  ];
  const reachable = new Set<string>(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) continue;
    for (const next of endpointGraph.get(current) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  return new Set(payload.views
    .filter((view) => reachabilityAliasesForView(view).some((endpoint) => reachable.has(endpoint)))
    .map((view) => view.view_ref));
}

function connectCollectionRootsToLocalSpine(input: {
  endpointGraph: Map<string, Set<string>>;
  payload: AlignPayload;
  viewAliases: ReadonlyMap<string, string[]>;
  approvedEndpointRefs: ReadonlySet<string>;
  approvedStructureRestore: boolean;
}): void {
  const edgeTouchedEndpoints = new Set(input.payload.edges.flatMap((edge) => [edge.from, edge.to]));
  const containsParents = new Set(input.payload.edges
    .filter((edge) => edge.type === "contains")
    .map((edge) => edge.from));
  const connectRootToAliases = (collection: string, aliases: readonly string[]): void => {
    const root = collectionRootEndpoint(collection);
    for (const alias of aliases) connectGraphEndpoints(input.endpointGraph, root, alias);
  };
  for (const view of input.payload.views) {
    const aliases = input.viewAliases.get(view.view_ref) ?? [];
    if (aliases.some((alias) => containsParents.has(alias))) {
      connectRootToAliases(view.collection, aliases);
      continue;
    }
    const edgeTouched = aliases.some((alias) => edgeTouchedEndpoints.has(alias));
    if (!edgeTouched && !input.approvedStructureRestore) {
      connectRootToAliases(view.collection, reachabilityAliasesForView(view));
    }
  }
  const collections = [...new Set(input.payload.views.map((view) => view.collection))];
  for (const node of input.payload.nodes) {
    if (!containsParents.has(node.node_ref)) continue;
    for (const collection of collections) connectGraphEndpoints(input.endpointGraph, collectionRootEndpoint(collection), node.node_ref);
  }
}

function addOrphanViewDiagnostics(
  payload: AlignPayload | undefined,
  diagnostics: AlignDiagnostic[],
  options: {
    approvedEndpointRefs?: ReadonlySet<string>;
    approvedStructureRestore?: boolean;
  } = {},
): void {
  if (payload === undefined) return;
  const reachable = reachableViewsFromSpine({ payload, ...options });
  const blocking = payload.lifecycle.state === "confirmed" || payload.lifecycle.state === "frozen";
  for (const [viewIndex, view] of payload.views.entries()) {
    if (reachable.has(view.view_ref)) continue;
    diagnostics.push(diagnostic(
      blocking ? "error" : "warning",
      "view.orphan_risk",
      "edge",
      blocking
        ? "View is not connected to the structure spine by a source-backed edge; add contains or another typed edge, or keep it unresolved before confirmation."
        : "View is not connected to the structure spine yet; confirm only after adding a source-backed contains or typed edge.",
      `views[${viewIndex}]`,
      {
        candidate_id: view.view_ref,
        repair: {
          action: "connect_view_or_move_to_unresolved",
          collection: view.collection,
          endpoints: endpointAliasesForView(view),
        },
      },
    ));
  }
}

function validateParentIndexViews(
  payload: AlignPayload | undefined,
  diagnostics: AlignDiagnostic[],
): void {
  if (payload === undefined) return;
  const viewByRef = new Map(payload.views.map((view) => [view.view_ref, view]));
  for (const [viewIndex, view] of payload.views.entries()) {
    if (view.sections.length > 0) {
      if (view.generated === "parent_index") {
        diagnostics.push(diagnostic(
          "error",
          "view.parent_index_has_sections",
          "schema",
          "Parent-index views must not carry source-bound sections; keep source-mirrored content in child views.",
          `views[${viewIndex}].sections`,
          { candidate_id: view.view_ref, repair: { action: "move_sections_to_child_views" } },
        ));
      }
      continue;
    }

    const model = parentIndexModel({ structure: payload, view });
    if (model === undefined || model.children.length === 0) {
      diagnostics.push(diagnostic(
        "error",
        "schema.view_sections_missing",
        "schema",
        "View must include at least one section plan unless it is a parent_index view with contains edges to child views.",
        `views[${viewIndex}].sections`,
        { candidate_id: view.view_ref, repair: { action: "add_source_bound_sections_or_contains_child_views" } },
      ));
      continue;
    }
    if (view.generated !== "parent_index") {
      diagnostics.push(diagnostic(
        "error",
        "view.parent_index_generated_missing",
        "schema",
        "Sectionless parent views must declare generated: parent_index.",
        `views[${viewIndex}].generated`,
        { candidate_id: view.view_ref, repair: { action: "set_generated_parent_index" } },
      ));
    }
    for (const child of model.children) {
      const childView = viewByRef.get(child.view_ref);
      if (childView === undefined) continue;
      if (childView.collection !== view.collection) {
        diagnostics.push(diagnostic(
          "error",
          "view.parent_index_child_collection_mismatch",
          "schema",
          "Parent-index child views must stay in the same collection as the parent index.",
          `views[${viewIndex}].generated`,
          {
            candidate_id: view.view_ref,
            repair: {
              action: "split_parent_index_by_collection",
              parent_collection: view.collection,
              child_view_ref: child.view_ref,
              child_collection: childView.collection,
            },
          },
        ));
      }
      if (childView.sections.length === 0) {
        diagnostics.push(diagnostic(
          "error",
          "view.parent_index_child_has_no_sections",
          "schema",
          "Parent-index children must be source-bound child views, not another empty parent index.",
          `views[${viewIndex}].generated`,
          { candidate_id: view.view_ref, repair: { action: "point_contains_edges_to_source_bound_child_views" } },
        ));
      }
    }
  }
}

async function validateEdgeSourceSpanShape(input: {
  input: AlignValidationInput;
  edgeIndex: number;
  edgeType: string;
  sourceRef: string;
  diagnostics: AlignDiagnostic[];
}): Promise<void> {
  const resolved = await resolveProseSourceRef({
    projectRoot: input.input.projectRoot,
    index: input.input.evidence.index,
    sourceRef: input.sourceRef,
    snapshotMarkdownCache: input.input.evidence.snapshotMarkdownCache,
  });
  if (resolved === null || resolved.status !== "exact") return;
  if (input.edgeType !== "contains" && resolved.span.line_start !== resolved.span.line_end) {
    input.diagnostics.push(diagnostic(
      "error",
      "edge.source_ref_not_sentence_level",
      "edge",
      "Edge source_ref must be narrowed to a sentence-level span; use a single source line or move the relation to unresolved.",
      `edges[${input.edgeIndex}].source_refs`,
      {
        source_ref: input.sourceRef,
        repair: {
          action: "replace_with_sentence_level_source_ref_or_move_to_unresolved",
          current_line_range: `L${resolved.span.line_start}-${resolved.span.line_end}`,
        },
      },
    ));
  }
}

function addSharedSourceDiagnostics(payload: AlignPayload | undefined, diagnostics: AlignDiagnostic[]): void {
  const ownersByRef = new Map<string, string[]>();
  for (const view of payload?.views ?? []) {
    for (const section of view.sections) {
      for (const ref of section.source_refs) {
        const owners = ownersByRef.get(ref) ?? [];
        owners.push(section.section_ref);
        ownersByRef.set(ref, owners);
      }
    }
  }
  for (const [sourceRef, owners] of ownersByRef) {
    const uniqueOwners = [...new Set(owners)];
    if (uniqueOwners.length < 2) continue;
    diagnostics.push(diagnostic("info", "source_ref.shared", "support", "A source_ref is shared by multiple views or sections; this is allowed but must remain visible at confirmation.", "views.sections.source_refs", {
      source_ref: sourceRef,
      repair: { action: "review_shared_evidence", owners: uniqueOwners },
    }));
  }
}

async function validateUnresolvedSourceRefs(
  input: AlignValidationInput,
  payload: AlignPayload | undefined,
  diagnostics: AlignDiagnostic[],
): Promise<void> {
  for (const [issueIndex, issue] of (payload?.unresolved ?? []).entries()) {
    for (const [refIndex, ref] of (issue.source_refs ?? []).entries()) {
      await validateAlignSourceRef({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        sourceRef: ref,
        diagnostics,
        owner: `unresolved:${issue.issue}`,
        field: `unresolved[${issueIndex}].source_refs[${refIndex}]`,
      });
    }
  }
}

export async function validateAlignPayload(input: AlignValidationInput): Promise<{ payload?: AlignPayload; result: ValidateResult }> {
  const parsed = parseAlignPayload(input.rawPayload);
  const diagnostics = [...parsed.diagnostics];
  const payload = parsed.payload;
  validatePhaseShape(input, payload, diagnostics);
  const nodeRefs = await validateNodeSourceRefs(input, payload, diagnostics);
  const viewEndpointRefs = await validateViewSourceRefs(input, payload, nodeRefs, diagnostics);
  const localEndpointRefs = localEndpointRefsForPayload(payload, nodeRefs, viewEndpointRefs);
  const approvedEndpointRefs = payload === undefined
    ? new Set<string>()
    : await readExistingApprovedEndpointRefs(input.projectRoot);
  const endpointRefs = new Set<string>([
    ...localEndpointRefs,
    ...approvedEndpointRefs,
  ]);
  validateParentIndexViews(payload, diagnostics);
  validatePreferredNodeHints(payload, nodeRefs, diagnostics);
  await validateEdgeSourceRefs(input, payload, endpointRefs, diagnostics);
  addOrphanViewDiagnostics(
    payload,
    diagnostics,
    {
      approvedEndpointRefs,
      ...(input.approvedStructureRestore === true ? { approvedStructureRestore: true } : {}),
    },
  );
  await validateUnresolvedSourceRefs(input, payload, diagnostics);
  await addSectionMirrorDiagnostics(input, payload, diagnostics);
  await addMechanicalBoundaryDiagnostics({
    projectRoot: input.projectRoot,
    evidence: input.evidence,
    payload,
    diagnostics,
  });
  addSharedSourceDiagnostics(payload, diagnostics);
  if (payload !== undefined) {
    addStructureQualityDiagnostics(payload, diagnostics);
  }
  diagnostics.push(...largeNarrativeSplitDiagnostics(payload));
  const existingApprovedStructure = payload === undefined
    ? undefined
    : await readExistingApprovedStructureSummary({
        projectRoot: input.projectRoot,
        payload,
      });
  diagnostics.push(...existingApprovedStructureDiagnostics(existingApprovedStructure));
  let result = buildValidateResult({
    payload,
    diagnostics,
    phaseId: input.phaseId,
    phaseCollection: input.phaseCollection,
    ...(input.commandInputPath !== undefined ? { commandInputPath: input.commandInputPath } : {}),
  });
  if (payload !== undefined) {
    const { summary, report } = await writeStructureSummaryReport({
      projectRoot: input.projectRoot,
      evidence: input.evidence,
      payload,
      diagnostics,
      ...(existingApprovedStructure !== undefined ? { existingApprovedStructure } : {}),
    });
    const notice = structureReviewNotice({
      summary,
      report,
      confirmationReady: result.confirmation_ready,
      confirmationBlockers: result.confirmation_blockers,
    }) as unknown as Record<string, unknown>;
    const compact = compactStructureSummary({
      summary,
      diagnostics,
    }) as unknown as Record<string, unknown>;
    result = withStructureReviewArtifacts({
      result,
      notice,
      report: report as unknown as Record<string, unknown>,
      compact,
      ...(input.includeStructureSummary === true ? { summary: summary as unknown as Record<string, unknown> } : {}),
    });
  }
  return {
    ...(payload !== undefined ? { payload } : {}),
    result,
  };
}
