import {
  confirmIndexerRequirementWorkset,
  validateIndexerRequirementWorksetReport,
} from "@c4a/context";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function routeProjectIndexerRequirementConfirmation(input: {
  projectRoot: string;
  value: unknown;
}) {
  void input.projectRoot;
  const value = record(input.value, "requirement confirmation route input");
  if (value.protocol !== "context.indexer.requirement-confirmation-route-input/v1") {
    throw new TypeError("requirement confirmation route input protocol is invalid");
  }
  const report = validateIndexerRequirementWorksetReport(value.report);
  return {
    protocol: "context.indexer.requirement-confirmation-route-result/v1" as const,
    report,
    outcome: report.requires_human_confirmation
      ? "requirement-contraction-confirmation-required" as const
      : "requirement-confirmation-required" as const,
    graph_outcome: report.requires_human_confirmation
      ? "blocked" as const
      : "waiting-user" as const,
  };
}

export function confirmProjectIndexerRequirementWorkset(input: {
  projectRoot: string;
  value: unknown;
}) {
  void input.projectRoot;
  const value = record(input.value, "requirement confirmation Action input");
  if (value.protocol !== "context.indexer.requirement-confirmation-action-input/v1") {
    throw new TypeError("requirement confirmation Action input protocol is invalid");
  }
  const authority = value.authority;
  if (authority !== "managed" && authority !== "human") {
    throw new TypeError("requirement confirmation authority must be managed or human");
  }
  const confirmation = confirmIndexerRequirementWorkset({
    report: validateIndexerRequirementWorksetReport(value.report),
    authority,
    confirmed_by: text(value.confirmed_by, "confirmed_by"),
    confirmed_at: text(value.confirmed_at, "confirmed_at"),
  });
  return {
    protocol: "context.indexer.requirement-confirmation-action-result/v1" as const,
    confirmation,
    graph_outcome: "completed" as const,
  };
}
