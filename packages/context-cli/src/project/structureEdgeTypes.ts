export const STRUCTURE_EDGE_TYPES = [
  "is_a",
  "contains",
  "depends_on",
  "corresponds_to",
  "causes",
  "triggers",
  "prerequisite",
  "applies_to",
  "verified_by",
  "supersedes",
] as const;

export const STRUCTURE_EDGE_CONFIDENCES = ["possible", "hypothesis"] as const;

export type StructureEdgeType = typeof STRUCTURE_EDGE_TYPES[number];
export type StructureEdgeConfidence = typeof STRUCTURE_EDGE_CONFIDENCES[number];
