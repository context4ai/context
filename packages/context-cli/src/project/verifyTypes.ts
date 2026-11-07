export interface ProjectVerifyIssue {
  severity: "error" | "warning";
  code: string;
  path?: string;
  line?: number;
  collection?: string;
  view_ref?: string;
  node_ref?: string;
  source_keys?: string[];
  message: string;
  reference_states?: Array<{ section_id: string; state: "current" | "moved" | "ambiguous" | "not-found" | "unavailable"; reason?: string }>;
}

export interface ProjectVerifyResult {
  ok: boolean;
  evidenceStatus: "pass" | "pass-with-unverifiable-evidence" | "fail";
  issues: ProjectVerifyIssue[];
}
