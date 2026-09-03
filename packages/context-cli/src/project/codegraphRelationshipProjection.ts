import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { STRUCTURE_EDGE_TYPES } from "./structureEdgeTypes.js";
import { isCodeIndexCollection } from "./codeIndexCollection.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function codegraphEdgesFromFrontmatter(
  frontmatter: Record<string, unknown>,
  path: string,
): Array<Record<string, unknown>> {
  if (frontmatter.code_edges === undefined) return [];
  if (!Array.isArray(frontmatter.code_edges)) {
    throw new ContextError(ExitCode.WorkspaceStateError, "approved code_edges must be an array", {
      category: ErrorCategory.WorkspaceStateInvalid,
      path,
    });
  }
  return frontmatter.code_edges.map((rawEdge, index) => {
    if (!isRecord(rawEdge)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "approved code edge must be an object", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path,
        edge_index: index,
      });
    }
    const type = rawEdge.type;
    const from = rawEdge.from;
    const to = rawEdge.to;
    const sourceRefs = rawEdge.source_refs;
    const relationshipMode = rawEdge.relationship_mode;
    const relationType = rawEdge.relation_type;
    if (
      typeof type !== "string" ||
      !(STRUCTURE_EDGE_TYPES as readonly string[]).includes(type) ||
      typeof from !== "string" ||
      typeof to !== "string" ||
      !Array.isArray(sourceRefs) ||
      sourceRefs.length === 0 ||
      sourceRefs.some((ref) => typeof ref !== "string" || !ref.startsWith("repo:")) ||
      (relationshipMode !== "source-backed-ast" && relationshipMode !== "source-backed-explicit") ||
      typeof relationType !== "string" ||
      relationType.trim().length === 0
    ) {
      throw new ContextError(ExitCode.WorkspaceStateError, "approved code edge is invalid", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path,
        edge_index: index,
      });
    }
    return {
      type,
      from,
      to,
      source_refs: sourceRefs,
      relationship_mode: relationshipMode,
      relation_type: relationType.trim(),
      ...(typeof rawEdge.note === "string" && rawEdge.note.trim().length > 0
        ? { note: rawEdge.note.trim() }
        : {}),
    };
  });
}

function sourceBackedCode(edge: Record<string, unknown>): boolean {
  return edge.relationship_mode === "source-backed-ast" ||
    edge.relationship_mode === "source-backed-explicit";
}

export function currentCodegraphEdges(input: {
  baseEdges: readonly Record<string, unknown>[];
  markdownEdges: readonly Record<string, unknown>[];
  endpointRefs: ReadonlySet<string>;
  onMissingEndpoint?: (message: string) => void;
}): Array<Record<string, unknown>> {
  const current = input.markdownEdges.filter((edge) => {
    const from = typeof edge.from === "string" ? edge.from : "";
    const to = typeof edge.to === "string" ? edge.to : "";
    const valid = input.endpointRefs.has(from) && input.endpointRefs.has(to);
    if (!valid) {
      input.onMissingEndpoint?.(
        `Dropped codegraph edge because an endpoint is not approved: ${from} -> ${to}`,
      );
    }
    return valid;
  });
  return [...input.baseEdges.filter((edge) => !sourceBackedCode(edge)), ...current];
}

export interface CodegraphRelationshipCoverage {
  state: "not-applicable" | "available" | "no-approved-source-backed-edges" | "unknown";
  modes: string[];
  codegraph_views: number;
  emitted_edges: number;
}

export function codegraphRelationshipCoverage(input: {
  views: readonly Record<string, unknown>[];
  edges: readonly Record<string, unknown>[];
}): CodegraphRelationshipCoverage {
  const codegraphViews = input.views.filter((view) =>
    typeof view.collection === "string" && isCodeIndexCollection(view.collection)
  );
  const declaredModes = [...new Set(codegraphViews.flatMap((view) =>
    typeof view.relationship_mode === "string" ? [view.relationship_mode] : []
  ))].sort();
  const endpointRefs = new Set(codegraphViews.flatMap((view) => [view.node_ref, view.view_ref])
    .filter((value): value is string => typeof value === "string"));
  const codegraphEdges = input.edges.filter((edge) =>
    sourceBackedCode(edge) &&
    typeof edge.from === "string" &&
    typeof edge.to === "string" &&
    endpointRefs.has(edge.from) &&
    endpointRefs.has(edge.to)
  );
  return {
    state: codegraphViews.length === 0
      ? "not-applicable"
      : codegraphEdges.length > 0
        ? "available"
        : declaredModes.includes("source-backed-ast") || declaredModes.includes("source-backed-explicit")
          ? "no-approved-source-backed-edges"
          : "unknown",
    modes: declaredModes,
    codegraph_views: codegraphViews.length,
    emitted_edges: codegraphEdges.length,
  };
}
