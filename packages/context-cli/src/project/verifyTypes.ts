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
}

export interface ProjectVerifyResult {
  ok: boolean;
  evidenceStatus: "pass" | "pass-with-unverifiable-evidence" | "fail";
  issues: ProjectVerifyIssue[];
}
