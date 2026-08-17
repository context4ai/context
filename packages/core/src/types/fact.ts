export enum FactKind {
  Description = "description",
  Spec = "spec",
  Warning = "warning",
  Principle = "principle",
  Decision = "decision",
  Incident = "incident",
  Guide = "guide",
  Example = "example",
  Changelog = "changelog",
}

export enum FactSourceType {
  Code = "code",
  Doc = "doc",
  Oncall = "oncall",
  Meeting = "meeting",
  Manual = "manual",
}

export enum FactStatus {
  Proposed = "proposed",
  Active = "active",
  Deprecated = "deprecated",
}

export enum FactConfidence {
  Verified = "verified",
  Confirmed = "confirmed",
  Inferred = "inferred",
  Speculative = "speculative",
}

export enum FactRelation {
  Implements = "implements",
  Refines = "refines",
  Conflicts = "conflicts",
  Supersedes = "supersedes",
  References = "references",
}

export type FactAnchorType = "node" | "edge";

export interface FactSourceSpan {
  start: number;
  end: number;
}

export interface RelatedFact {
  fact_id: string;
  relation: FactRelation;
}

export interface FactRecord {
  id: string;
  anchor_id: string;
  anchor_type: FactAnchorType;
  kind: FactKind;
  content: string;
  detail: string | null;
  source_type: FactSourceType;
  source_ref: string;
  source_span: FactSourceSpan | null;
  related_facts: RelatedFact[] | null;
  valid_from: number | null;
  valid_until: number | null;
  status: FactStatus;
  confidence: FactConfidence;
  workspace_id: string | null;
  /** Redundant source_id inherited from anchor Node's source_id.
   *  Used for fast fact_count filtering without parsing anchor_id or querying GraphStore. */
  source_id: string | null;
  created_at: string;
  updated_at: string;
}
