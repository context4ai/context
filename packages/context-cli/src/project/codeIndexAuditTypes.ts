export type CodeIndexAuditDecision = "accept" | "revise" | "request-input";
export type CodeIndexAuditSignalSeverity = "advisory" | "elevated";

export interface CodeIndexAuditSignal {
  id: string;
  code: string;
  severity: CodeIndexAuditSignalSeverity;
  unit_id: string;
  view_ref?: string;
  message: string;
  metrics: Record<string, number | string>;
}

export interface CodeIndexAuditPageMetrics {
  view_ref: string;
  module: string;
  path: string;
  candidate_fingerprint: string;
  content_digest: string;
  effective_chars: number;
  section_count: number;
  evidence_count: number;
  section_scoped_evidence_count: number;
  relation_count: number;
  relation_evidence_count: number;
  source_count: number;
}

export interface CodeIndexAuditUnitReport {
  id: string;
  output_owner: string;
  output_profile: string;
  module_types: string[];
  input_sources: string[];
  page_count: number;
  effective_chars: number;
  evidence_count: number;
  section_count: number;
  relation_count: number;
  covered_sources: string[];
  uncovered_sources: string[];
  signal_count: number;
  elevated_signal_count: number;
}

export interface CodeIndexAuditReport {
  schema: "context.code-index-audit-report.v1";
  digest: string;
  scope_digest: string;
  source: "draft-and-approved" | "approved" | "preview";
  summary: {
    units: number;
    pages: number;
    effective_chars: number;
    evidence: number;
    sections: number;
    relations: number;
    signals: number;
    elevated_signals: number;
  };
  units: CodeIndexAuditUnitReport[];
  pages: CodeIndexAuditPageMetrics[];
  page_samples: CodeIndexAuditPageMetrics[];
  signals: CodeIndexAuditSignal[];
  review_requirements: {
    compare_registered_sources_with_user_scope: true;
    inspect_signal_samples: true;
    choose: CodeIndexAuditDecision[];
  };
}

export interface CodeIndexAuditSignalAssessment {
  signal_id: string;
  disposition: "fix" | "acceptable" | "not-applicable";
  reason: string;
}

export interface CodeIndexAuditDecisionPayload {
  schema: "context.code-index-audit-decision.v1";
  report_digest: string;
  decision: CodeIndexAuditDecision;
  summary: string;
  reviewed_units: string[];
  scope_assessment: {
    matches_requested_scope: boolean;
    omissions: string[];
    summary: string;
  };
  signal_assessments: CodeIndexAuditSignalAssessment[];
  revision_plan?: {
    units: string[];
    actions: string[];
  };
  requested_material?: string[];
}

export interface CodeIndexAuditHistoryEntry {
  report_digest: string;
  scope_digest: string;
  decision: CodeIndexAuditDecision;
  summary: string;
  reviewed_units: string[];
  elevated_signal_count: number;
}

export interface CodeIndexAuditRecord {
  schema: "context.code-index-audit.v1";
  report: CodeIndexAuditReport;
  decision: CodeIndexAuditDecisionPayload;
  history: CodeIndexAuditHistoryEntry[];
}

export interface CodeIndexAuditStatus {
  applicable: boolean;
  current: boolean;
  resolved: boolean;
  revision_required: boolean;
  input_required: boolean;
  report?: CodeIndexAuditReport;
  decision?: CodeIndexAuditDecisionPayload;
  history: CodeIndexAuditHistoryEntry[];
}
