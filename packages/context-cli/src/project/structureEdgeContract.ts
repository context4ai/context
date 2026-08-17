import { STRUCTURE_EDGE_CONFIDENCES, STRUCTURE_EDGE_TYPES } from "./proseAlignTypes.js";

export interface StructureEdgeContractResult {
  validationScope: "structure";
  valid: boolean;
  checked: number;
  allowedTypes: readonly string[];
  allowedConfidence: readonly string[];
}

function collectEndpointRefs(structure: Record<string, unknown> | null): Set<string> {
  // Persisted edge contracts accept only NodeRef, ViewRef, and SectionRef endpoints.
  // Align-only collection roots are intentionally excluded from committed structures.
  const refs = new Set<string>();
  if (Array.isArray(structure?.nodes)) {
    for (const node of structure.nodes) {
      if (node !== null && typeof node === "object" && !Array.isArray(node)) {
        const nodeRef = (node as Record<string, unknown>).node_ref;
        if (typeof nodeRef === "string" && nodeRef.trim().length > 0) refs.add(nodeRef);
      }
    }
  }
  if (Array.isArray(structure?.views)) {
    for (const view of structure.views) {
      if (view === null || typeof view !== "object" || Array.isArray(view)) continue;
      const record = view as Record<string, unknown>;
      if (typeof record.view_ref === "string" && record.view_ref.trim().length > 0) refs.add(record.view_ref);
      if (!Array.isArray(record.sections)) continue;
      for (const section of record.sections) {
        if (section === null || typeof section !== "object" || Array.isArray(section)) continue;
        const sectionRef = (section as Record<string, unknown>).section_ref;
        if (typeof sectionRef === "string" && sectionRef.trim().length > 0) refs.add(sectionRef);
      }
    }
  }
  return refs;
}

export function validateStructureEdgeContract(structure: Record<string, unknown> | null): StructureEdgeContractResult {
  const endpointRefs = collectEndpointRefs(structure);
  const edges = Array.isArray(structure?.edges) ? structure.edges : [];
  const allowed = new Set<string>(STRUCTURE_EDGE_TYPES);
  const allowedConfidence = new Set<string>(STRUCTURE_EDGE_CONFIDENCES);
  const valid = edges.every((edge) => {
    if (edge === null || typeof edge !== "object" || Array.isArray(edge)) return false;
    const record = edge as Record<string, unknown>;
    return typeof record.type === "string" &&
      allowed.has(record.type) &&
      typeof record.from === "string" &&
      endpointRefs.has(record.from) &&
      typeof record.to === "string" &&
      endpointRefs.has(record.to) &&
      Array.isArray(record.source_refs) &&
      record.source_refs.length > 0 &&
      record.source_refs.every((ref) => typeof ref === "string" && ref.trim().length > 0) &&
      (record.confidence === undefined || (typeof record.confidence === "string" && allowedConfidence.has(record.confidence)));
  });
  return {
    validationScope: "structure",
    valid,
    checked: edges.length,
    allowedTypes: STRUCTURE_EDGE_TYPES,
    allowedConfidence: STRUCTURE_EDGE_CONFIDENCES,
  };
}
