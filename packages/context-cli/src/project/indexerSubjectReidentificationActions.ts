import {
  analyzeIndexerSubjectKeySchemaTransition,
  authorizeIndexerSubjectReidentification,
  canonicalIndexerJson,
  enforceIndexerSubjectKeySchemaTransition,
} from "@c4a/context";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function transition(value: Record<string, unknown>) {
  return {
    old_schema: value.old_schema,
    new_schema: value.new_schema,
    approved_subjects: list(value.approved_subjects, "approved_subjects"),
    proposed_mappings: list(value.proposed_mappings, "proposed_mappings"),
  };
}

function exactReport(value: Record<string, unknown>) {
  const expected = analyzeIndexerSubjectKeySchemaTransition(transition(value));
  if (
    value.report !== undefined &&
    canonicalIndexerJson(value.report) !== canonicalIndexerJson(expected)
  ) {
    throw new TypeError("SubjectKey re-identification report is stale");
  }
  return expected;
}

export function validateProjectIndexerSubjectKeySchemas(input: {
  projectRoot: string;
  value: unknown;
}) {
  void input.projectRoot;
  const value = record(input.value, "validate-subject-key-schemas input");
  if (value.protocol !== "context.indexer.subject-key-validation-input/v1") {
    throw new TypeError("validate-subject-key-schemas input protocol is invalid");
  }
  const projectRef = text(value.project_ref, "project_ref");
  const report = exactReport(value);
  if (!report.activation_allowed) {
    return {
      protocol: "context.indexer.subject-key-validation-result/v1" as const,
      outcome: "index-subject-reidentification-invalid" as const,
      report,
      authorization_digest: null,
      graph_outcome: "failed" as const,
    };
  }
  if (report.gate_required && value.authorization === undefined) {
    return {
      protocol: "context.indexer.subject-key-validation-result/v1" as const,
      outcome: "index-subject-reidentification-required" as const,
      report,
      authorization_digest: null,
      graph_outcome: "blocked" as const,
    };
  }
  enforceIndexerSubjectKeySchemaTransition({
    report,
    ...transition(value),
    project_ref: projectRef,
    ...(value.authorization === undefined ? {} : { authorization: value.authorization }),
  });
  const authorization = value.authorization === undefined
    ? undefined
    : record(value.authorization, "SubjectKey re-identification authorization");
  return {
    protocol: "context.indexer.subject-key-validation-result/v1" as const,
    outcome: "subject-key-schema-current" as const,
    report,
    authorization_digest: authorization?.authorization_digest ?? null,
    graph_outcome: "completed" as const,
  };
}

export function confirmProjectIndexerSubjectReidentification(input: {
  projectRoot: string;
  value: unknown;
}) {
  void input.projectRoot;
  const value = record(input.value, "confirm-subject-reidentification input");
  if (value.protocol !== "context.indexer.subject-reidentification-confirmation-input/v1") {
    throw new TypeError("confirm-subject-reidentification input protocol is invalid");
  }
  const report = exactReport(value);
  const authorization = authorizeIndexerSubjectReidentification({
    report,
    project_ref: text(value.project_ref, "project_ref"),
    authorized_by: text(value.authorized_by, "authorized_by"),
    authorized_at: text(value.authorized_at, "authorized_at"),
  });
  return {
    protocol: "context.indexer.subject-reidentification-confirmation-result/v1" as const,
    report,
    authorization,
    graph_outcome: "completed" as const,
  };
}
