import type { Grounding } from "./node.js";

export enum EdgeType {
  Contains = "contains",
  Imports = "imports",
  ImportsType = "imports_type",
  Calls = "calls",
  Extends = "extends",
  Implements = "implements",
  ParamType = "param_type",
  ReturnType = "return_type",
  OfType = "of_type",
  DependsOn = "depends_on",
  RelatedTo = "related_to",
  Corresponds = "corresponds",
  Refines = "refines",
  AnchoredTo = "anchored_to",
  Supersedes = "supersedes",
  Conflicts = "conflicts",
  References = "references",
}

export enum EdgeSource {
  Ast = "ast",
  Doc = "doc",
  Manual = "manual",
}

export interface EdgeRecord {
  id: string;
  type: EdgeType;
  from_id: string;
  to_id: string;
  grounding: Grounding;
  source: EdgeSource;
  confidence: number;
  valid_from: number | null;
  valid_until: number | null;
  created_at: string;
  updated_at: string;
}
