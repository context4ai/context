import {
  evaluateIndexerCandidateReviewReadiness,
  evaluateIndexerCandidateReviewReadinessWithOverride,
  buildIndexerAuditFacts,
  validateIndexerCandidateReviewReadinessInput,
} from "@c4a/context";
import { assertIndexerOutputSafe } from "@c4a/core";
import { readProjectIndexerAuditReport } from "./indexerAuditStore.js";
import {
  readProjectIndexerProfileAuditLedger,
  readProjectIndexerProfileFailureReport,
  readProjectIndexerProfileOverrideReceipt,
} from "./indexerProfileAuditStore.js";

export async function inspectProjectIndexerCandidateReviewReadiness(input: {
  projectRoot: string;
  value: unknown;
}) {
  const request = validateIndexerCandidateReviewReadinessInput(input.value);
  const precompileReport = await readProjectIndexerAuditReport({
    projectRoot: input.projectRoot,
    report_digest: request.precompile_audit_report_digest,
  });
  const postcompileReport = await readProjectIndexerAuditReport({
    projectRoot: input.projectRoot,
    report_digest: request.postcompile_audit_report_digest,
  });
  const reports = {
    request,
    precompile_report: precompileReport,
    postcompile_report: postcompileReport,
  };
  const receipt = request.profile_override_receipt_digest === null
    ? undefined
    : await readProjectIndexerProfileOverrideReceipt({
          projectRoot: input.projectRoot,
          receipt_digest: request.profile_override_receipt_digest,
        });
  const result = receipt === undefined
    ? evaluateIndexerCandidateReviewReadiness(reports)
    : evaluateIndexerCandidateReviewReadinessWithOverride({
        ...reports,
        profile_override_receipt: receipt,
      });
  const failureReport = receipt === undefined
    ? undefined
    : await readProjectIndexerProfileFailureReport({
        projectRoot: input.projectRoot,
        report_digest: receipt.failure_report_digest,
      });
  const ledger = receipt === undefined
    ? undefined
    : await readProjectIndexerProfileAuditLedger(input.projectRoot);
  const inspection = {
    ...result,
    audit_facts: buildIndexerAuditFacts({
      precompile_report: precompileReport,
      postcompile_report: postcompileReport,
      lineage: failureReport?.lineage,
      ledger,
      failure_report: failureReport,
      override_receipt: receipt,
    }),
    reason_code: result.state === "ready"
      ? "index-review-required" as const
      : result.state === "baseline-blocked"
      ? "index-baseline-audit-failed" as const
      : result.profile_state === "human-guidance-required"
      ? "index-profile-human-guidance-required" as const
      : "index-profile-revision-required" as const,
  };
  return assertIndexerOutputSafe({ channel: "review-sample", value: inspection });
}
