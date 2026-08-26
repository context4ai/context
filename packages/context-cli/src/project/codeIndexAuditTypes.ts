export type CodeIndexAuditDecision = "accept" | "revise" | "request-input";
export type CodeIndexAuditSignalSeverity = "advisory" | "elevated";
export type CodeIndexAuditDimensionStatus =
  | "below-floor"
  | "below-target"
  | "target"
  | "above-target"
  | "above-ceiling"
  | "not-applicable"
  | "unscorable";

export interface CodeIndexAuditDimension {
  dimension: string;
  observed: number | null;
  unit: "percent" | "lines" | "count";
  floor: number | null;
  target: number | null;
  ceiling: number | null;
  score: number | null;
  status: CodeIndexAuditDimensionStatus;
  previous_observed?: number | null;
  delta?: number | null;
  absolute_gate: boolean;
  evidence: Record<string, number | string | string[]>;
  recommended_actions: string[];
}

export interface CodeIndexAuditSignal {
  id: string;
  code: string;
  severity: CodeIndexAuditSignalSeverity;
  unit_id: string;
  view_ref?: string;
  message: string;
  metrics: Record<string, number | string>;
  absolute_gate?: boolean;
  recommended_actions?: string[];
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
  line_count: number;
  semantic_fact_lines: number;
  table_fact_rows: number;
  explanatory_lines: number;
  implementation_body_lines: number;
  signature_dump_lines?: number;
  generated_type_lines?: number;
  repeated_boilerplate_fact_lines?: number;
  template_residue_count: number;
  placeholder_section_count: number;
  referenced_file_count: number;
  referenced_symbol_count: number;
  referenced_files: string[];
  referenced_symbols: string[];
}

export interface CodeIndexAuditActionGuidance {
  action: string;
  failed_dimensions: string[];
  affected_pages: string[];
  template_paths: string[];
  configuration_fields: string[];
  expected_improvement: string[];
}

export interface CodeIndexAuditDimensionSnapshot {
  dimension: string;
  observed: number | null;
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
  dimensions: CodeIndexAuditDimension[];
  problem_fingerprint: string;
  absolute_failure_count: number;
  below_target_count: number;
  max_page_lines: number;
  recommended_actions: string[];
  action_guidance: CodeIndexAuditActionGuidance[];
}

export interface CodeIndexAuditReport {
  schema: "context.code-index-audit-report.v2";
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

export interface CodeIndexAuditRetryEntry {
  report_digest: string;
  unit_attempts: Array<{
    unit_id: string;
    problem_fingerprint: string;
    attempt: number;
    actions: string[];
    dimension_snapshot: CodeIndexAuditDimensionSnapshot[];
  }>;
}

export interface CodeIndexAuditRecord {
  schema: "context.code-index-audit.v3";
  scope_digest: string;
  decision: CodeIndexAuditDecisionPayload;
  retry_history: CodeIndexAuditRetryEntry[];
  accepted_draft_page_digests?: string[];
}

export interface CodeIndexAuditApplyResult {
  record: CodeIndexAuditRecord;
  report: CodeIndexAuditReport;
}

export interface CodeIndexAuditStatus {
  applicable: boolean;
  current: boolean;
  resolved: boolean;
  revision_required: boolean;
  input_required: boolean;
  guidance_required: boolean;
  guidance_units: Array<{
    unit_id: string;
    output_profile: string;
    problem_fingerprint: string;
    attempts: number;
    failed_dimensions: string[];
    attempted_actions: string[];
    dimension_deltas: Array<{
      dimension: string;
      before: number | null;
      after: number | null;
      delta: number | null;
      status: CodeIndexAuditDimensionStatus;
    }>;
  }>;
  report?: CodeIndexAuditReport;
  decision?: CodeIndexAuditDecisionPayload;
}
