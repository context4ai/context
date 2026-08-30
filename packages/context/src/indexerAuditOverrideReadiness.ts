import {
  evaluateIndexerCandidateReviewReadiness,
  validateIndexerAuditReport,
  validateIndexerCandidateReviewReadinessInput,
} from "./indexerAuditProtocol.js";
import { validateIndexerProfileOverrideReceipt } from "./indexerAuditRevision.js";
import { indexerProtocolDigest } from "./indexerProtocolCommon.js";

export function evaluateIndexerCandidateReviewReadinessWithOverride(input: {
  request: unknown;
  precompile_report: unknown;
  postcompile_report: unknown;
  profile_override_receipt: unknown;
}) {
  const request = validateIndexerCandidateReviewReadinessInput(input.request);
  const baseline = evaluateIndexerCandidateReviewReadiness(input);
  const receipt = validateIndexerProfileOverrideReceipt(input.profile_override_receipt);
  const precompile = validateIndexerAuditReport(input.precompile_report);
  const postcompile = validateIndexerAuditReport(input.postcompile_report);
  if (
    request.profile_override_receipt_digest !== receipt.receipt_digest ||
    receipt.precompile_audit_report_digest !== precompile.report_digest ||
    receipt.audit_report_digest !== postcompile.report_digest ||
    indexerProtocolDigest(receipt.binding) !== indexerProtocolDigest(request.binding) ||
    !precompile.baseline.clear ||
    !postcompile.baseline.clear ||
    postcompile.profile.state === "passed" ||
    postcompile.profile.state === "not-applicable" ||
    indexerProtocolDigest(receipt.failed_metric_ids) !==
      indexerProtocolDigest(postcompile.profile.failed_metric_ids)
  ) {
    throw new TypeError("Indexer profile override receipt is stale or outside its profile failure");
  }
  if (baseline.state !== "profile-blocked") {
    throw new TypeError("Indexer profile override cannot replace a baseline failure or passed audit");
  }
  const payload = {
    protocol: baseline.protocol,
    state: "ready" as const,
    binding: baseline.binding,
    precompile_audit_report_digest: baseline.precompile_audit_report_digest,
    postcompile_audit_report_digest: baseline.postcompile_audit_report_digest,
    baseline_failed_check_ids: baseline.baseline_failed_check_ids,
    profile_state: baseline.profile_state,
    profile_failed_metric_ids: baseline.profile_failed_metric_ids,
    profile_override_receipt_digest: baseline.profile_override_receipt_digest,
    profile_override_applied: true,
    review_binding_digest: baseline.review_binding_digest,
  };
  return {
    ...payload,
    graph_outcome: "completed" as const,
    result_digest: indexerProtocolDigest(payload),
  };
}
