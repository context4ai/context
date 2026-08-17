import type { ProjectVerifyIssue } from "../verify.js";

const CLOSE_REPAIRABLE_APPROVED_STRUCTURE_CODES = new Set([
  "approved-structure-invalid",
  "approved-structure-input-hash-invalid",
  "approved-structure-input-hash-mismatch",
  "approved-structure-source-inputs-invalid",
  "approved-structure-nodes-invalid",
  "approved-structure-views-invalid",
  "approved-structure-edges-invalid",
  "approved-structure-node-invalid",
  "approved-structure-node-missing",
  "approved-structure-node-not-approved",
  "approved-structure-node-projection-mismatch",
  "approved-structure-view-sections-invalid",
  "approved-structure-view-section-invalid",
  "approved-structure-view-section-projection-mismatch",
  "approved-parent-index-edge-missing",
  "approved-resource-source-path-unprojected",
]);

export function verifyErrorsAreCloseRepairable(
  issues: readonly ProjectVerifyIssue[],
): boolean {
  const errorCodes = issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
  return errorCodes.length > 0 &&
    issues.filter((issue) => issue.severity === "error").every((issue) =>
      CLOSE_REPAIRABLE_APPROVED_STRUCTURE_CODES.has(issue.code) ||
      (issue.code === "approved-source-ref-stale" && issue.path === "knowledge/structure.yaml")
    );
}
