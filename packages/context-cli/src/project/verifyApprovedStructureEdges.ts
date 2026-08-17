import { join } from "node:path";
import { STRUCTURE_EDGE_CONFIDENCES, STRUCTURE_EDGE_TYPES } from "./proseAlignTypes.js";
import { validateCanonicalEvidenceSourceRef } from "./verifyCanonicalSourceRefs.js";
import { isRecord } from "./verifyFrontmatter.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
import {
  type ApprovedViewIssueContext,
  type EvidenceIndexCache,
  type SourceRegistryLookup,
} from "./verifySourceRefs.js";

const APPROVED_STRUCTURE_PATH = join("knowledge", "structure.yaml");

function approvedStructureEdgeRecords(
  parsed: Record<string, unknown>,
  issues: ProjectVerifyIssue[],
): Array<{ edge: Record<string, unknown>; index: number }> | undefined {
  if (parsed.edges === undefined) return [];
  if (Array.isArray(parsed.edges)) {
    const records: Array<{ edge: Record<string, unknown>; index: number }> = [];
    for (const [index, edge] of parsed.edges.entries()) {
      if (isRecord(edge)) {
        records.push({ edge, index });
        continue;
      }
      issues.push({
        severity: "error",
        code: "approved-structure-edge-invalid",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure edge ${index} must be an object`,
      });
    }
    return records;
  }
  issues.push({
    severity: "error",
    code: "approved-structure-edge-invalid",
    path: APPROVED_STRUCTURE_PATH,
    message: "approved structure edges must be an array",
  });
  return undefined;
}

async function validateApprovedStructureEdgeSourceRefs(input: {
  edge: Record<string, unknown>;
  endpointContexts: ReadonlyMap<string, ApprovedViewIssueContext>;
  evidenceIndexCache: EvidenceIndexCache;
  index: number;
  issues: ProjectVerifyIssue[];
  projectRoot: string;
  sourceRegistry: SourceRegistryLookup;
  sourceOrphanedViewRefs: ReadonlySet<string>;
}): Promise<void> {
  if (!Array.isArray(input.edge.source_refs) || input.edge.source_refs.length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-edge-source-refs-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: `approved structure edge ${input.index} must include source_refs[]`,
    });
    return;
  }
  for (const ref of input.edge.source_refs) {
    if (typeof ref !== "string" || ref.trim().length === 0) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-edge-source-refs-invalid",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure edge ${input.index} source_refs[] must contain non-empty strings`,
      });
      continue;
    }
    const contexts = edgeIssueContexts(input.edge, input.endpointContexts);
    const context = contexts[0];
    const sourceOrphaned = contexts.some((candidate) =>
      input.sourceOrphanedViewRefs.has(candidate.view_ref)
    );
    await validateCanonicalEvidenceSourceRef({
      projectRoot: input.projectRoot,
      ref,
      sourceRegistry: input.sourceRegistry,
      evidenceIndexCache: input.evidenceIndexCache,
      issues: input.issues,
      path: APPROVED_STRUCTURE_PATH,
      unresolvedSeverity: "error",
      ...(sourceOrphaned ? { sourceOrphaned: true } : {}),
      ...(context !== undefined ? { context } : {}),
    });
  }
}

function edgeIssueContexts(
  edge: Record<string, unknown>,
  endpointContexts: ReadonlyMap<string, ApprovedViewIssueContext>,
): ApprovedViewIssueContext[] {
  const contexts: ApprovedViewIssueContext[] = [];
  for (const endpoint of [edge.from, edge.to]) {
    if (typeof endpoint !== "string") continue;
    const context = endpointContexts.get(endpoint);
    if (context !== undefined && !contexts.some((candidate) => candidate.view_ref === context.view_ref)) {
      contexts.push(context);
    }
  }
  return contexts;
}

async function validateApprovedStructureEdgeRecord(input: {
  allowedConfidence: ReadonlySet<string>;
  allowedTypes: ReadonlySet<string>;
  edge: Record<string, unknown>;
  endpointContexts: ReadonlyMap<string, ApprovedViewIssueContext>;
  endpointRefs: ReadonlySet<string>;
  evidenceIndexCache: EvidenceIndexCache;
  index: number;
  issues: ProjectVerifyIssue[];
  projectRoot: string;
  sourceRegistry: SourceRegistryLookup;
  sourceOrphanedViewRefs: ReadonlySet<string>;
}): Promise<void> {
  if (typeof input.edge.type !== "string" || !input.allowedTypes.has(input.edge.type)) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-edge-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: `approved structure edge ${input.index} has invalid type`,
    });
  }
  for (const endpoint of ["from", "to"] as const) {
    const value = input.edge[endpoint];
    if (typeof value !== "string" || !input.endpointRefs.has(value)) {
      input.issues.push({
        severity: "error",
        code: "approved-structure-edge-invalid",
        path: APPROVED_STRUCTURE_PATH,
        message: `approved structure edge ${input.index} has invalid ${endpoint} endpoint ref`,
      });
    }
  }
  if (input.edge.confidence !== undefined &&
    (typeof input.edge.confidence !== "string" || !input.allowedConfidence.has(input.edge.confidence))) {
    input.issues.push({
      severity: "error",
      code: "approved-structure-edge-confidence-invalid",
      path: APPROVED_STRUCTURE_PATH,
      message: `approved structure edge ${input.index} has invalid confidence`,
    });
  }
  await validateApprovedStructureEdgeSourceRefs(input);
}

export async function validateApprovedStructureEdgeRecords(input: {
  parsed: Record<string, unknown>;
  endpointContexts: ReadonlyMap<string, ApprovedViewIssueContext>;
  endpointRefs: ReadonlySet<string>;
  evidenceIndexCache: EvidenceIndexCache;
  issues: ProjectVerifyIssue[];
  projectRoot: string;
  sourceRegistry: SourceRegistryLookup;
  sourceOrphanedViewRefs: ReadonlySet<string>;
}): Promise<void> {
  const edges = approvedStructureEdgeRecords(input.parsed, input.issues);
  if (edges === undefined) return;
  const allowedTypes = new Set<string>(STRUCTURE_EDGE_TYPES);
  const allowedConfidence = new Set<string>(STRUCTURE_EDGE_CONFIDENCES);
  for (const { edge, index } of edges) {
    await validateApprovedStructureEdgeRecord({
      allowedConfidence,
      allowedTypes,
      edge,
      endpointContexts: input.endpointContexts,
      endpointRefs: input.endpointRefs,
      evidenceIndexCache: input.evidenceIndexCache,
      index,
      issues: input.issues,
      projectRoot: input.projectRoot,
      sourceRegistry: input.sourceRegistry,
      sourceOrphanedViewRefs: input.sourceOrphanedViewRefs,
    });
  }
}
