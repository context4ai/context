import type { ProjectStatus } from "./statusTypes.js";
import type { ProjectVerifyIssue } from "./verify.js";

export function evidenceWarningState(
  issues: readonly ProjectVerifyIssue[],
): ProjectStatus["evidenceWarnings"] {
  if (issues.some((issue) => issue.code === "source-document-missing")) {
    return "orphaned";
  }
  if (issues.some((issue) => issue.code === "approved-source-ref-stale")) {
    return "stale";
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return "degraded";
  }
  return "none";
}

export function evidenceStatusForStatus(input: {
  verifyErrors: number;
  verifyWarnings: number;
}): ProjectStatus["evidenceStatus"] {
  if (input.verifyErrors > 0) return "fail";
  return input.verifyWarnings > 0
    ? "pass-with-unverifiable-evidence"
    : "pass";
}
