import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { STRUCTURE_EDGE_CONFIDENCES, STRUCTURE_EDGE_TYPES } from "./structureEdgeTypes.js";

const KNOWLEDGE_ROOT = "knowledge";
const APPROVED_STRUCTURE_PATH = join(KNOWLEDGE_ROOT, "structure.yaml");
const STRUCTURE_EDGE_CONFIDENCE_SET = new Set<string>(STRUCTURE_EDGE_CONFIDENCES);

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
    ...(options.tolerateMissingEndpoints !== undefined ? { tolerateMissingEndpoints: options.tolerateMissingEndpoints } : {}),
    ...(options.tolerateMissingSourceBackedAstEndpoints !== undefined
      ? { tolerateMissingSourceBackedAstEndpoints: options.tolerateMissingSourceBackedAstEndpoints }
      : {}),
    ...(options.onMissingEndpoint !== undefined ? { onMissingEndpoint: options.onMissingEndpoint } : {}),
  });
}
