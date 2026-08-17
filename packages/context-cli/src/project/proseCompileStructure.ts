import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CompileProsePhaseDefinition } from "@c4a/context";
import {
  parseDocumentSourceLocator,
  parseSpanSourceRef,
} from "@c4a/extract";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { approvedKnowledgeInputHash } from "./close.js";
import { loadProseEvidence } from "./proseAlignEvidence.js";
import { validateAlignPayload } from "./proseAlignPayload.js";
import {
  STRUCTURE_EDGE_TYPES,
  STRUCTURE_EDGE_CONFIDENCES,
  STRUCTURE_SCHEMA_VERSION,
  type AlignPayload,
  type EvidenceContext,
  type StructureEdgePlan,
  type StructureNodePlan,
  type StructureSectionPlan,
  type StructureUnresolvedIssue,
  type StructureViewPlan,
} from "./proseAlignTypes.js";
import { STRUCTURE_FILE } from "./proseCompileConstants.js";
import { withProjectWriteLock } from "./writeLock.js";
import { PARENT_INDEX_GENERATED_KIND } from "./parentIndexView.js";
import {
  archiveActiveStructure,
  currentStructureSlotDigest,
  readStructureSnapshot,
  writeStructureSnapshot,
} from "./proseStructureStore.js";

const APPROVED_STRUCTURE_FILE = "knowledge/structure.yaml";
const APPROVED_STRUCTURE_SCHEMA_VERSION = "context.approved-structure.v1";
const STRUCTURE_EDGE_TYPE_SET = new Set<string>(STRUCTURE_EDGE_TYPES);
const STRUCTURE_EDGE_CONFIDENCE_SET = new Set<string>(STRUCTURE_EDGE_CONFIDENCES);

function workspaceError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid,
    ...detail,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

async function readStructureFile(projectRoot: string): Promise<unknown | null> {
  const structurePath = join(projectRoot, STRUCTURE_FILE);
  if (!existsSync(structurePath)) {
    return null;
  }
  let raw: string;
  try {
    raw = await readFile(structurePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw workspaceError(".tmp/context-runtime/lifecycle/structure.yaml cannot be read", {
      path: STRUCTURE_FILE,
      reason: message,
      next: "Restore or regenerate structure.yaml with alignProse, validate it, and ask the user to confirm it before compiling.",
    });
  }
  try {
    return YAML.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw workspaceError(`.tmp/context-runtime/lifecycle/structure.yaml is invalid YAML: ${message}`, {
      path: STRUCTURE_FILE,
      next: `Fix ${STRUCTURE_FILE}, then rerun align validate before compile.`,
    });
  }
}

async function readApprovedStructureFile(projectRoot: string): Promise<unknown | null> {
  const structurePath = join(projectRoot, APPROVED_STRUCTURE_FILE);
  if (!existsSync(structurePath)) return null;
  try {
    return YAML.parse(await readFile(structurePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw workspaceError(`knowledge/structure.yaml is invalid YAML: ${message}`, {
      path: APPROVED_STRUCTURE_FILE,
      next: "Run context close --format json after fixing approved knowledge, or return to align structure gate.",
    });
  }
}

async function compileStructureSlotDigest(input: {
  projectRoot: string;
  sourceKey: string;
  collection: string;
}): Promise<string | undefined> {
  const slotDigest = await currentStructureSlotDigest(
    input.projectRoot,
    input.sourceKey,
    input.collection,
  );
  const current = await readStructureFile(input.projectRoot);
  if (current === null || !isRecord(current) || !Array.isArray(current.sources) || !Array.isArray(current.views)) {
    return slotDigest;
  }
  const currentOwnsTarget = current.sources.includes(input.sourceKey) && current.views.some((view) =>
    isRecord(view) && view.collection === input.collection
  );
  if (!currentOwnsTarget) return slotDigest;
  const lifecycle = isRecord(current.lifecycle) ? current.lifecycle : undefined;
  const currentDigest = lifecycle === undefined
    ? undefined
    : stringField(lifecycle, "structure_digest");
  return slotDigest !== undefined && slotDigest !== currentDigest
    ? slotDigest
    : undefined;
}

function parseApprovedSections(value: unknown, viewRef: string): StructureSectionPlan[] {
  if (!Array.isArray(value)) return [];
  const sections: StructureSectionPlan[] = [];
  for (const rawSection of value) {
    if (!isRecord(rawSection)) continue;
    const id = stringField(rawSection, "id");
    const kind = stringField(rawSection, "kind");
    const summary = stringField(rawSection, "summary");
    const sourceRefs = stringArray(rawSection.source_refs);
    if (id === undefined || kind === undefined || sourceRefs.length === 0) continue;
    sections.push({
      id,
      section_ref: `${viewRef}#${id}`,
      kind,
      ...(summary !== undefined ? { summary } : {}),
      source_refs: sourceRefs,
    });
  }
  return sections;
}

function parseApprovedNodes(value: unknown): StructureNodePlan[] {
  if (!Array.isArray(value)) return [];
  const nodes: StructureNodePlan[] = [];
  for (const rawNode of value) {
    if (!isRecord(rawNode)) continue;
    const nodeRef = stringField(rawNode, "node_ref");
    const title = stringField(rawNode, "title");
    const nodeType = stringField(rawNode, "node_type");
    const summary = stringField(rawNode, "summary");
    if (nodeRef === undefined || title === undefined || nodeType === undefined) continue;
    nodes.push({
      node_ref: nodeRef,
      title,
      node_type: nodeType,
      ...(summary !== undefined ? { summary } : {}),
      ...(Array.isArray(rawNode.tags) ? { tags: stringArray(rawNode.tags) } : {}),
    });
  }
  return nodes;
}

function parseApprovedViews(value: unknown, nodes: readonly StructureNodePlan[]): StructureViewPlan[] {
  if (!Array.isArray(value)) return [];
  const nodeByRef = new Map(nodes.map((node) => [node.node_ref, node]));
  const views: StructureViewPlan[] = [];
  for (const rawView of value) {
    if (!isRecord(rawView)) continue;
    const viewRef = stringField(rawView, "view_ref");
    const nodeRef = stringField(rawView, "node_ref");
    const collection = stringField(rawView, "collection") as StructureViewPlan["collection"] | undefined;
    const containment = stringField(rawView, "containment");
    const slug = stringField(rawView, "slug");
    const title = stringField(rawView, "title") ?? (nodeRef === undefined ? undefined : nodeByRef.get(nodeRef)?.title);
    const nodeType = stringField(rawView, "node_type") ?? (nodeRef === undefined ? undefined : nodeByRef.get(nodeRef)?.node_type);
    const path = stringField(rawView, "path");
    const generated = stringField(rawView, "generated");
    if (viewRef === undefined || nodeRef === undefined || collection === undefined || containment === undefined || slug === undefined || title === undefined || nodeType === undefined || path === undefined) continue;
    const sections = parseApprovedSections(rawView.sections, viewRef);
    if (sections.length === 0 && generated !== PARENT_INDEX_GENERATED_KIND) continue;
    const summary = stringField(rawView, "summary");
    views.push({
      view_ref: viewRef,
      node_ref: nodeRef,
      collection,
      containment,
      slug,
      ...(generated === PARENT_INDEX_GENERATED_KIND ? { generated } : {}),
      title,
      node_type: nodeType,
      path,
      ...(summary !== undefined ? { summary } : {}),
      sections,
    });
  }
  return views;
}

function parseApprovedEdges(value: unknown): StructureEdgePlan[] {
  if (!Array.isArray(value)) return [];
  const edges: StructureEdgePlan[] = [];
  for (const rawEdge of value) {
    if (!isRecord(rawEdge)) continue;
    const type = stringField(rawEdge, "type");
    const from = stringField(rawEdge, "from");
    const to = stringField(rawEdge, "to");
    const note = stringField(rawEdge, "note");
    const confidence = stringField(rawEdge, "confidence");
    const sourceRefs = stringArray(rawEdge.source_refs);
    if (type === undefined || from === undefined || to === undefined || sourceRefs.length === 0) continue;
    edges.push({
      type: type as StructureEdgePlan["type"],
      from,
      to,
      source_refs: sourceRefs,
      ...(confidence !== undefined && STRUCTURE_EDGE_CONFIDENCE_SET.has(confidence) ? { confidence: confidence as NonNullable<StructureEdgePlan["confidence"]> } : {}),
      ...(note !== undefined ? { note } : {}),
    });
  }
  return edges;
}

function sourceRefMatchesEvidence(input: {
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

function sourceRefsMatchEvidence(input: {
  evidence: EvidenceContext;
  sourceRefs: readonly string[];
}): boolean {
  return input.sourceRefs.length > 0 &&
    input.sourceRefs.every((sourceRef) => sourceRefMatchesEvidence({ evidence: input.evidence, sourceRef }));
}

function endpointAliasesForView(view: StructureViewPlan): string[] {
  return [
    view.node_ref,
    view.view_ref,
    ...view.sections.map((section) => section.section_ref),
  ];
}

function filterApprovedStructureForEvidence(input: {
  evidence: EvidenceContext;
  nodes: readonly StructureNodePlan[];
  views: readonly StructureViewPlan[];
  edges: readonly StructureEdgePlan[];
}): {
  nodes: StructureNodePlan[];
  views: StructureViewPlan[];
  edges: StructureEdgePlan[];
} {
  const currentSourceEdges = input.edges.filter((edge) =>
    sourceRefsMatchEvidence({ evidence: input.evidence, sourceRefs: edge.source_refs })
  );
  const edgeEndpointRefs = new Set(currentSourceEdges.flatMap((edge) => [edge.from, edge.to]));
  const views = input.views.flatMap((view) => {
    const hasCurrentSourceSection = view.sections.some((section) =>
      sourceRefsMatchEvidence({ evidence: input.evidence, sourceRefs: section.source_refs })
    );
    const edgeTouchesView = endpointAliasesForView(view).some((endpoint) => edgeEndpointRefs.has(endpoint));
    if (!hasCurrentSourceSection && !(view.generated === PARENT_INDEX_GENERATED_KIND && edgeTouchesView)) return [];
    return [view];
  });
  const localEndpoints = new Set(views.flatMap(endpointAliasesForView));
  const edges = currentSourceEdges.filter((edge) =>
    localEndpoints.has(edge.from) || localEndpoints.has(edge.to)
  );
  const nodeRefs = new Set(views.map((view) => view.node_ref));
  const nodes = input.nodes.filter((node) => nodeRefs.has(node.node_ref));
  return { nodes, views, edges };
}

function assertApprovedEdgeContract(value: unknown, endpointRefs: ReadonlySet<string>): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw workspaceError("knowledge/structure.yaml edges must be an array", {
      path: APPROVED_STRUCTURE_FILE,
      next: "Run context verify --format json, then context close --format json; if the edge still fails, return to the structure gate.",
    });
  }
  for (const [index, rawEdge] of value.entries()) {
    if (!isRecord(rawEdge)) {
      throw workspaceError("knowledge/structure.yaml edge must be an object", {
        path: APPROVED_STRUCTURE_FILE,
        edge_index: index,
        next: "Run context verify --format json, then context close --format json; if the edge still fails, return to the structure gate.",
      });
    }
    const type = rawEdge.type;
    const from = rawEdge.from;
    const to = rawEdge.to;
    const sourceRefs = rawEdge.source_refs;
    if (typeof type !== "string" || !STRUCTURE_EDGE_TYPE_SET.has(type)) {
      throw workspaceError("knowledge/structure.yaml edge type is invalid for compile", {
        path: APPROVED_STRUCTURE_FILE,
        edge_index: index,
        type,
        allowed_types: STRUCTURE_EDGE_TYPES,
        next: "Run context verify --format json, then context close --format json; if the edge still fails, return to the structure gate.",
      });
    }
    if (typeof from !== "string" || !endpointRefs.has(from)) {
      throw workspaceError("knowledge/structure.yaml edge from node is not approved", {
        path: APPROVED_STRUCTURE_FILE,
        edge_index: index,
        from,
        next: "Run context verify --format json, then context close --format json; if the edge still fails, return to the structure gate.",
      });
    }
    if (typeof to !== "string" || !endpointRefs.has(to)) {
      throw workspaceError("knowledge/structure.yaml edge to node is not approved", {
        path: APPROVED_STRUCTURE_FILE,
        edge_index: index,
        to,
        next: "Run context verify --format json, then context close --format json; if the edge still fails, return to the structure gate.",
      });
    }
    if (!Array.isArray(sourceRefs) ||
      sourceRefs.length === 0 ||
      sourceRefs.some((ref) => typeof ref !== "string" || ref.trim().length === 0)) {
      throw workspaceError("knowledge/structure.yaml edge source_refs are invalid for compile", {
        path: APPROVED_STRUCTURE_FILE,
        edge_index: index,
        next: "Run context verify --format json, then context close --format json; if the edge still fails, return to the structure gate.",
      });
    }
    if (rawEdge.confidence !== undefined &&
      (typeof rawEdge.confidence !== "string" || !STRUCTURE_EDGE_CONFIDENCE_SET.has(rawEdge.confidence))) {
      throw workspaceError("knowledge/structure.yaml edge confidence is invalid for compile", {
        path: APPROVED_STRUCTURE_FILE,
        edge_index: index,
        confidence: rawEdge.confidence,
        allowed_confidence: STRUCTURE_EDGE_CONFIDENCES,
        next: "Run context verify --format json, then context close --format json; if the edge still fails, return to the structure gate.",
      });
    }
  }
}

function approvedStructureToAlignPayload(input: {
  rawStructure: Record<string, unknown>;
  evidence: EvidenceContext;
}): AlignPayload {
  const approvedNodes = parseApprovedNodes(input.rawStructure.nodes);
  const approvedViews = parseApprovedViews(input.rawStructure.views, approvedNodes);
  if (approvedNodes.length === 0 || approvedViews.length === 0) {
    throw workspaceError("knowledge/structure.yaml has no compile-ready nodes/views", {
      path: APPROVED_STRUCTURE_FILE,
      next: "Run alignProse, validate and confirm structure, then compile again.",
    });
  }
  assertApprovedEdgeContract(input.rawStructure.edges, new Set([
    ...approvedNodes.map((node) => node.node_ref),
    ...approvedViews.map((view) => view.view_ref),
    ...approvedViews.flatMap((view) => view.sections.map((section) => section.section_ref)),
  ]));
  const filtered = filterApprovedStructureForEvidence({
    evidence: input.evidence,
    nodes: approvedNodes,
    views: approvedViews,
    edges: parseApprovedEdges(input.rawStructure.edges),
  });
  if (filtered.nodes.length === 0 || filtered.views.length === 0) {
    throw workspaceError("knowledge/structure.yaml has no compile-ready views for this source", {
      path: APPROVED_STRUCTURE_FILE,
      source: `${input.evidence.source.sourceType}:${input.evidence.source.sourceName}`,
      next: "Run compileProse for a source that owns approved source_refs, or return to align for this source.",
    });
  }
  const sources = stringArray(input.rawStructure.sources);
  const body = {
    schema_version: STRUCTURE_SCHEMA_VERSION as "context.structure.v1",
    sources: sources.length > 0 ? sources : [`${input.evidence.source.sourceType}:${input.evidence.source.sourceName}`],
    evidence_snapshot_hash: typeof input.rawStructure.evidence_snapshot_hash === "string"
      ? input.rawStructure.evidence_snapshot_hash
      : input.evidence.index.snapshot_hash,
    nodes: filtered.nodes,
    views: filtered.views,
    edges: filtered.edges,
    unresolved: [] as StructureUnresolvedIssue[],
  };
  const structureDigest = digest(body);
  return {
    ...body,
    lifecycle: {
      state: "confirmed",
      confirmed_by: "approved-structure",
      confirmed_at: typeof input.rawStructure.closed_at === "string" ? input.rawStructure.closed_at : "approved-structure",
      structure_digest: structureDigest,
    },
    payload_digest: digest(input.rawStructure),
    structure_digest: structureDigest,
  };
}

async function assertApprovedStructureFresh(input: {
  projectRoot: string;
  rawStructure: Record<string, unknown>;
}): Promise<void> {
  if (input.rawStructure.schema_version !== APPROVED_STRUCTURE_SCHEMA_VERSION) {
    throw workspaceError("knowledge/structure.yaml uses an unsupported approved structure schema", {
      path: APPROVED_STRUCTURE_FILE,
      schema_version: input.rawStructure.schema_version,
      expected_schema_version: APPROVED_STRUCTURE_SCHEMA_VERSION,
      next: "Run context close --format json to rebuild approved structure, then compile again.",
    });
  }
  const expectedInputHash = await approvedKnowledgeInputHash(input.projectRoot);
  if (input.rawStructure.input_hash !== expectedInputHash) {
    throw workspaceError("knowledge/structure.yaml is stale for compile", {
      path: APPROVED_STRUCTURE_FILE,
      input_hash: input.rawStructure.input_hash,
      expected_input_hash: expectedInputHash,
      next: "Run context close --format json to rebuild approved structure, then compile again.",
    });
  }
}

function alignPayloadInput(payload: AlignPayload): Record<string, unknown> {
  return {
    schema_version: payload.schema_version,
    sources: payload.sources,
    evidence_snapshot_hash: payload.evidence_snapshot_hash,
    nodes: payload.nodes,
    views: payload.views,
    edges: payload.edges,
    unresolved: payload.unresolved,
    ...(payload.user_or_agent_hints !== undefined ? { user_or_agent_hints: payload.user_or_agent_hints } : {}),
    lifecycle: payload.lifecycle,
  };
}

async function loadConfirmedStructure(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  evidence: EvidenceContext;
  structureDigest?: string;
  readOnly?: boolean;
  allowInvalidStructureForReadOnly?: boolean;
  allowInvalidApprovedStructureForReadOnly?: boolean;
}): Promise<AlignPayload> {
  let rawStructure = input.structureDigest === undefined
    ? await readStructureFile(input.projectRoot)
    : await readStructureSnapshot(input.projectRoot, input.structureDigest);
  if (rawStructure === null && input.structureDigest !== undefined) {
    const active = await readStructureFile(input.projectRoot);
    const activeDigest = isRecord(active) && isRecord(active.lifecycle)
      ? stringField(active.lifecycle, "structure_digest")
      : undefined;
    if (activeDigest === input.structureDigest) {
      rawStructure = active;
    } else if (input.readOnly !== true) {
      await archiveActiveStructure(input.projectRoot);
      rawStructure = await readStructureSnapshot(
        input.projectRoot,
        input.structureDigest,
      );
    }
  }
  if (rawStructure === null) {
    if (input.structureDigest !== undefined) {
      throw workspaceError("candidate structure snapshot is missing", {
        structure_digest: input.structureDigest,
        source: `${input.evidence.source.sourceType}:${input.evidence.source.sourceName}`,
        next: `Rerun align:${input.evidence.source.sourceType}:${input.evidence.source.sourceName}:${input.phase.collection}, confirm the structure, and retry Review. Reuse existing decisions only if the regenerated structure digest is unchanged.`,
      });
    }
    const approvedStructure = await readApprovedStructureFile(input.projectRoot);
    if (!isRecord(approvedStructure)) {
      throw workspaceError("compileProse requires confirmed .tmp/context-runtime/lifecycle/structure.yaml or approved knowledge/structure.yaml", {
        path: STRUCTURE_FILE,
        approved_structure: APPROVED_STRUCTURE_FILE,
        next: "Run alignProse, validate the structure, and ask the user to confirm it before compiling.",
      });
    }
    await assertApprovedStructureFresh({
      projectRoot: input.projectRoot,
      rawStructure: approvedStructure,
    });
    const restored = approvedStructureToAlignPayload({
      rawStructure: approvedStructure,
      evidence: input.evidence,
    });
    const validated = await validateAlignPayload({
      projectRoot: input.projectRoot,
      phaseId: input.phase.id,
      phaseCollection: input.phase.collection,
      evidence: input.evidence,
      rawPayload: alignPayloadInput(restored),
      approvedStructureRestore: true,
    });
    if (validated.payload === undefined || !validated.result.valid) {
      if (
        (input.allowInvalidStructureForReadOnly === true || input.allowInvalidApprovedStructureForReadOnly === true) &&
        validated.payload !== undefined
      ) {
        return validated.payload;
      }
      throw workspaceError("knowledge/structure.yaml is not valid for compile", {
        path: APPROVED_STRUCTURE_FILE,
        diagnostics: validated.result.diagnostics,
        next: "Run context verify --format json, then context close --format json; if the edge or source_ref still fails, return to the structure gate.",
      });
    }
    return validated.payload;
  }
  const validated = await validateAlignPayload({
    projectRoot: input.projectRoot,
    phaseId: input.phase.id,
    phaseCollection: input.phase.collection,
    evidence: input.evidence,
    rawPayload: rawStructure,
  });
  if (validated.payload === undefined || !validated.result.valid) {
    if (input.allowInvalidStructureForReadOnly === true && validated.payload !== undefined) {
      const state = validated.payload.lifecycle.state;
      if (state === "confirmed" || state === "frozen") return validated.payload;
    }
    throw workspaceError(".tmp/context-runtime/lifecycle/structure.yaml is not valid for compile", {
      diagnostics: validated.result.diagnostics,
      next: `context run align:${input.evidence.source.sourceType}:${input.evidence.source.sourceName}:${input.phase.collection} --validate --input ${STRUCTURE_FILE} --format json`,
    });
  }
  const state = validated.payload.lifecycle.state;
  if (state !== "confirmed" && state !== "frozen") {
    throw workspaceError(".tmp/context-runtime/lifecycle/structure.yaml must be confirmed before compile", {
      code: "prose-structure-confirmation-required",
      lifecycle_state: state,
      next: "context status --format json",
    });
  }
  if (state === "frozen" &&
    validated.payload.lifecycle.frozen_snapshot_hash !== undefined &&
    validated.payload.lifecycle.frozen_snapshot_hash !== null &&
    validated.payload.lifecycle.frozen_snapshot_hash !== input.evidence.index.snapshot_hash) {
    throw workspaceError("frozen structure snapshot hash does not match current evidence", {
      expected_snapshot_hash: input.evidence.index.snapshot_hash,
      actual_snapshot_hash: validated.payload.lifecycle.frozen_snapshot_hash,
      next: "Return to align structure gate or recapture the source before compiling.",
    });
  }
  return validated.payload;
}

async function freezeStructureIfNeeded(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  evidence: EvidenceContext;
  structure: AlignPayload;
}): Promise<AlignPayload> {
  const ownedStructure: AlignPayload = input.structure.lifecycle.phase_collection === undefined
    ? {
        ...input.structure,
        lifecycle: {
          ...input.structure.lifecycle,
          phase_collection: input.phase.collection,
        },
      }
    : input.structure;
  if (
    ownedStructure.lifecycle.state === "frozen" ||
    ownedStructure.lifecycle.confirmed_by === "approved-structure"
  ) {
    await withProjectWriteLock(input.projectRoot, "compile-structure-snapshot", async () => {
      await writeStructureSnapshot(input.projectRoot, ownedStructure);
    });
    return ownedStructure;
  }
  return withProjectWriteLock(input.projectRoot, "compile-structure-freeze", async () => {
    const nextStructure: AlignPayload = {
      ...ownedStructure,
      lifecycle: {
        ...ownedStructure.lifecycle,
        state: "frozen",
        frozen_at: new Date().toISOString(),
        frozen_snapshot_hash: input.evidence.index.snapshot_hash,
      },
    };
    await archiveActiveStructure(input.projectRoot);
    await writeStructureSnapshot(input.projectRoot, nextStructure);
    const structurePath = join(input.projectRoot, STRUCTURE_FILE);
    await mkdir(dirname(structurePath), { recursive: true });
    await writeFile(structurePath, YAML.stringify({
      schema_version: nextStructure.schema_version,
      sources: nextStructure.sources,
      evidence_snapshot_hash: nextStructure.evidence_snapshot_hash,
      nodes: nextStructure.nodes,
      views: nextStructure.views,
      edges: nextStructure.edges,
      unresolved: nextStructure.unresolved,
      ...(nextStructure.user_or_agent_hints !== undefined ? { user_or_agent_hints: nextStructure.user_or_agent_hints } : {}),
      lifecycle: {
        ...nextStructure.lifecycle,
        structure_digest: nextStructure.structure_digest,
      },
    }), "utf8");
    return loadConfirmedStructure({
      projectRoot: input.projectRoot,
      phase: input.phase,
      evidence: input.evidence,
    });
  });
}

export async function loadCompileInput(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  readOnly?: boolean;
  allowInvalidStructureForReadOnly?: boolean;
  allowInvalidApprovedStructureForReadOnly?: boolean;
}): Promise<{
  evidence: EvidenceContext;
  structure: AlignPayload;
}> {
  const evidence = await loadProseEvidence({
    projectRoot: input.projectRoot,
    phase: input.phase,
  });
  const sourceKey = `${evidence.source.sourceType}:${evidence.source.sourceName}`;
  const structureDigest = await compileStructureSlotDigest({
    projectRoot: input.projectRoot,
    sourceKey,
    collection: input.phase.collection,
  });
  const structure = await loadConfirmedStructure({
    projectRoot: input.projectRoot,
    phase: input.phase,
    evidence,
    ...(structureDigest !== undefined ? { structureDigest } : {}),
    ...(input.readOnly === true ? { readOnly: true } : {}),
    ...(input.allowInvalidStructureForReadOnly === true ? { allowInvalidStructureForReadOnly: true } : {}),
    ...(input.allowInvalidApprovedStructureForReadOnly === true ? { allowInvalidApprovedStructureForReadOnly: true } : {}),
  });
  if (input.readOnly === true) {
    return { evidence, structure };
  }
  return {
    evidence,
    structure: await freezeStructureIfNeeded({
      projectRoot: input.projectRoot,
      phase: input.phase,
      evidence,
      structure,
    }),
  };
}

export async function currentCompileStructureDigest(input: {
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  structureDigest?: string;
}): Promise<string> {
  const evidence = await loadProseEvidence({
    projectRoot: input.projectRoot,
    phase: input.phase,
  });
  const sourceKey = `${evidence.source.sourceType}:${evidence.source.sourceName}`;
  const activeStructureDigest = input.structureDigest ?? await compileStructureSlotDigest({
    projectRoot: input.projectRoot,
    sourceKey,
    collection: input.phase.collection,
  });
  const structure = await loadConfirmedStructure({
    projectRoot: input.projectRoot,
    phase: input.phase,
    evidence,
    ...(activeStructureDigest !== undefined ? { structureDigest: activeStructureDigest } : {}),
  });
  return structure.structure_digest;
}
