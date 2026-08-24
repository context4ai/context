import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { STRUCTURE_EDGE_CONFIDENCES, STRUCTURE_EDGE_TYPES } from "./proseAlignTypes.js";
import {
  activeStructureSlots,
  readStructureSnapshot,
  structureSnapshotRelativePath,
} from "./proseStructureStore.js";
import { STRUCTURE_FILE as LIFECYCLE_STRUCTURE_PATH } from "./proseCompileConstants.js";

const KNOWLEDGE_ROOT = "knowledge";
const APPROVED_STRUCTURE_PATH = join(KNOWLEDGE_ROOT, "structure.yaml");
const STRUCTURE_EDGE_CONFIDENCE_SET = new Set<string>(STRUCTURE_EDGE_CONFIDENCES);

interface ManagedEdgeScope {
  source: string;
  collection: string;
  endpoints: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readEdgeArray(structure: Record<string, unknown>): unknown[] {
  return Array.isArray(structure.edges) ? structure.edges : [];
}

function normalizeApprovedEdges(input: {
  rawEdges: readonly unknown[];
  approvedEndpointRefs: ReadonlySet<string>;
  path: string;
  excludeManagedScopes?: readonly ManagedEdgeScope[];
  tolerateMissingEndpoints?: boolean;
  tolerateMissingSourceBackedAstEndpoints?: boolean;
  onMissingEndpoint?: (message: string) => void;
}): Array<Record<string, unknown>> {
  const allowed = new Set<string>(STRUCTURE_EDGE_TYPES);
  const edges: Array<Record<string, unknown>> = [];
  for (const [index, rawEdge] of input.rawEdges.entries()) {
    if (!isRecord(rawEdge)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure edge must be an object", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: input.path,
        edge_index: index,
      });
    }
    const type = rawEdge.type;
    const from = rawEdge.from;
    const to = rawEdge.to;
    if (typeof from !== "string" || typeof to !== "string") {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure edge must include string from/to endpoint refs", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: input.path,
        edge_index: index,
      });
    }
    const rawSourceRefs = rawEdge.source_refs;
    const sourceRefs = Array.isArray(rawSourceRefs)
      ? rawSourceRefs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
      : [];
    if (!Array.isArray(rawSourceRefs) || sourceRefs.length === 0 || sourceRefs.length !== rawSourceRefs.length) {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure edge must include non-empty source_refs[]", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: input.path,
        edge_index: index,
      });
    }
    if (
      input.excludeManagedScopes !== undefined &&
      input.excludeManagedScopes.some((scope) =>
        sourceRefs.some((ref) => sourceRefBelongsTo(ref, scope.source)) &&
        (scope.endpoints.has(from) || scope.endpoints.has(to) ||
          from.startsWith(`${scope.collection}:`) || to.startsWith(`${scope.collection}:`))
      )
    ) {
      continue;
    }
    if (!input.approvedEndpointRefs.has(from) || !input.approvedEndpointRefs.has(to)) {
      const detail = {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: input.path,
        edge_index: index,
        from,
        to,
        from_known: input.approvedEndpointRefs.has(from),
        to_known: input.approvedEndpointRefs.has(to),
      };
      const sourceBackedCode = rawEdge.relationship_mode === "source-backed-ast" ||
        rawEdge.relationship_mode === "source-backed-explicit";
      if (
        input.tolerateMissingEndpoints === true ||
        (input.tolerateMissingSourceBackedAstEndpoints === true && sourceBackedCode)
      ) {
        input.onMissingEndpoint?.(`Dropped structure edge ${index} from ${input.path} because an endpoint is not approved: ${from} -> ${to}`);
        continue;
      }
      throw new ContextError(ExitCode.WorkspaceStateError, "structure edge endpoint is not present in approved NodeRef, ViewRef, or SectionRef set", detail);
    }
    if (typeof type !== "string" || !allowed.has(type)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure edge has invalid type", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: input.path,
        edge_index: index,
        type,
        allowed_types: STRUCTURE_EDGE_TYPES,
      });
    }
    const confidence = rawEdge.confidence;
    if (confidence !== undefined && (typeof confidence !== "string" || !STRUCTURE_EDGE_CONFIDENCE_SET.has(confidence))) {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure edge confidence is invalid", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path: input.path,
        edge_index: index,
        confidence,
        allowed_confidence: STRUCTURE_EDGE_CONFIDENCES,
      });
    }
    edges.push({
      type,
      from,
      to,
      source_refs: sourceRefs,
      ...(typeof confidence === "string" ? { confidence } : {}),
      ...(typeof rawEdge.relationship_mode === "string"
        ? { relationship_mode: rawEdge.relationship_mode }
        : {}),
      ...(typeof rawEdge.relation_type === "string"
        ? { relation_type: rawEdge.relation_type }
        : {}),
      ...(typeof rawEdge.note === "string" && rawEdge.note.trim().length > 0 ? { note: rawEdge.note.trim() } : {}),
    });
  }
  return edges;
}

function sourceRefBelongsTo(sourceRef: string, source: string): boolean {
  return sourceRef === source || sourceRef.startsWith(`${source}#`) || sourceRef.startsWith(`${source}/`);
}

function uniqueEdges(edges: readonly Record<string, unknown>[]): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const edge of edges) byKey.set(JSON.stringify(edge), edge);
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, edge]) => edge);
}

function structureEndpointRefs(structure: Record<string, unknown>): string[] {
  const refs: string[] = [];
  if (Array.isArray(structure.nodes)) {
    for (const node of structure.nodes) {
      if (isRecord(node) && typeof node.node_ref === "string") refs.push(node.node_ref);
    }
  }
  if (Array.isArray(structure.views)) {
    for (const view of structure.views) {
      if (!isRecord(view)) continue;
      if (typeof view.view_ref === "string") refs.push(view.view_ref);
      if (!Array.isArray(view.sections)) continue;
      for (const section of view.sections) {
        if (isRecord(section) && typeof section.section_ref === "string") refs.push(section.section_ref);
      }
    }
  }
  return refs;
}

async function readYamlRecord(projectRoot: string, relPath: string): Promise<Record<string, unknown> | null> {
  const absPath = join(projectRoot, relPath);
  if (!existsSync(absPath)) return null;
  try {
    const parsed = YAML.parse(await readFile(absPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    throw new ContextError(ExitCode.WorkspaceStateError, `${relPath} is invalid YAML`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      path: relPath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function readApprovedStructureEdges(
  projectRoot: string,
  approvedEndpointRefs: ReadonlySet<string>,
  options: {
    tolerateInvalidYaml?: boolean;
    onInvalidYaml?: (message: string) => void;
    tolerateMissingEndpoints?: boolean;
    tolerateMissingSourceBackedAstEndpoints?: boolean;
    onMissingEndpoint?: (message: string) => void;
    excludeManagedScopes?: readonly ManagedEdgeScope[];
  } = {},
): Promise<Array<Record<string, unknown>>> {
  let structure: Record<string, unknown> | null;
  try {
    structure = await readYamlRecord(projectRoot, APPROVED_STRUCTURE_PATH);
  } catch (error) {
    if (options.tolerateInvalidYaml === true) {
      options.onInvalidYaml?.(error instanceof Error ? error.message : String(error));
      return [];
    }
    throw error;
  }
  if (structure === null) return [];
  return normalizeApprovedEdges({
    rawEdges: readEdgeArray(structure),
    approvedEndpointRefs,
    path: APPROVED_STRUCTURE_PATH,
    ...(options.excludeManagedScopes !== undefined ? { excludeManagedScopes: options.excludeManagedScopes } : {}),
    ...(options.tolerateMissingEndpoints !== undefined ? { tolerateMissingEndpoints: options.tolerateMissingEndpoints } : {}),
    ...(options.tolerateMissingSourceBackedAstEndpoints !== undefined
      ? { tolerateMissingSourceBackedAstEndpoints: options.tolerateMissingSourceBackedAstEndpoints }
      : {}),
    ...(options.onMissingEndpoint !== undefined ? { onMissingEndpoint: options.onMissingEndpoint } : {}),
  });
}

export async function readConfirmedStructureEdges(
  projectRoot: string,
  approvedEndpointRefs: ReadonlySet<string>,
  options: {
    tolerateInvalidYaml?: boolean;
    onInvalidYaml?: (message: string) => void;
    tolerateMissingEndpoints?: boolean;
    onMissingEndpoint?: (message: string) => void;
  } = {},
): Promise<Array<Record<string, unknown>>> {
  return (await readConfirmedStructureEdgeProjection(projectRoot, approvedEndpointRefs, options)) ?? [];
}

export async function readConfirmedStructureEdgeProjection(
  projectRoot: string,
  approvedEndpointRefs: ReadonlySet<string>,
  options: {
    tolerateInvalidYaml?: boolean;
    onInvalidYaml?: (message: string) => void;
    tolerateMissingEndpoints?: boolean;
    onMissingEndpoint?: (message: string) => void;
  } = {},
): Promise<Array<Record<string, unknown>> | null> {
  const slots = await activeStructureSlots(projectRoot);
  if (slots.length > 0) {
    const endpointsByDigest = new Map<string, ReadonlySet<string>>();
    const snapshotEdges: Array<Record<string, unknown>> = [];
    for (const structureDigest of [...new Set(slots.map((slot) => slot.structureDigest))].sort()) {
      const structure = await readStructureSnapshot(projectRoot, structureDigest);
      if (!isRecord(structure)) {
        throw new ContextError(ExitCode.WorkspaceStateError, "active structure snapshot is missing", {
          category: ErrorCategory.WorkspaceStateInvalid,
          structure_digest: structureDigest,
          path: structureSnapshotRelativePath(structureDigest),
          next: "Rerun alignProse and confirm the affected source structure before close.",
        });
      }
      endpointsByDigest.set(structureDigest, new Set(structureEndpointRefs(structure)));
      snapshotEdges.push(...normalizeApprovedEdges({
        rawEdges: readEdgeArray(structure),
        approvedEndpointRefs,
        path: structureSnapshotRelativePath(structureDigest),
        ...(options.tolerateMissingEndpoints !== undefined ? { tolerateMissingEndpoints: options.tolerateMissingEndpoints } : {}),
        ...(options.onMissingEndpoint !== undefined ? { onMissingEndpoint: options.onMissingEndpoint } : {}),
      }));
    }
    const managedScopes = slots.map((slot): ManagedEdgeScope => ({
      source: slot.source,
      collection: slot.collection,
      endpoints: endpointsByDigest.get(slot.structureDigest) ?? new Set<string>(),
    }));
    const unmanagedApprovedEdges = await readApprovedStructureEdges(projectRoot, approvedEndpointRefs, {
      excludeManagedScopes: managedScopes,
      ...(options.tolerateInvalidYaml !== undefined ? { tolerateInvalidYaml: options.tolerateInvalidYaml } : {}),
      ...(options.onInvalidYaml !== undefined ? { onInvalidYaml: options.onInvalidYaml } : {}),
    });
    return uniqueEdges([...unmanagedApprovedEdges, ...snapshotEdges]);
  }
  let structure: Record<string, unknown> | null;
  try {
    structure = await readYamlRecord(projectRoot, LIFECYCLE_STRUCTURE_PATH);
  } catch (error) {
    if (options.tolerateInvalidYaml === true) {
      options.onInvalidYaml?.(error instanceof Error ? error.message : String(error));
      return [];
    }
    throw error;
  }
  if (structure === null) return null;
  const lifecycle = isRecord(structure.lifecycle) ? structure.lifecycle : {};
  if (lifecycle.state !== "confirmed" && lifecycle.state !== "frozen") return null;
  return normalizeApprovedEdges({
    rawEdges: readEdgeArray(structure),
    approvedEndpointRefs,
    path: LIFECYCLE_STRUCTURE_PATH,
    ...(options.tolerateMissingEndpoints !== undefined ? { tolerateMissingEndpoints: options.tolerateMissingEndpoints } : {}),
    ...(options.onMissingEndpoint !== undefined ? { onMissingEndpoint: options.onMissingEndpoint } : {}),
  });
}
