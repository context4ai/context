import {
  authorizeIndexerProfileOverride,
  buildIndexerAuditFacts,
  buildIndexerProfileFailureReport,
  indexerProtocolDigest,
  recordIndexerProfileAuditAttempt,
  validateIndexerProfileFailureReportInput,
  validateIndexerProfileFailureInspectionInput,
  validateIndexerProfileRevisionRecordInput,
  indexerProfileOverrideDecisionSchema,
} from "@c4a/context";
import { readProjectIndexerAuditReport } from "./indexerAuditStore.js";
import {
  readProjectIndexerProfileAuditLedger,
  readProjectIndexerProfileFailureReport,
  recordProjectIndexerProfileFailureReport,
  recordProjectIndexerProfileOverrideReceipt,
  writeProjectIndexerProfileAuditLedger,
} from "./indexerProfileAuditStore.js";

export async function recordProjectIndexerProfileRevision(input: {
  projectRoot: string;
  value: unknown;
}) {
  const request = validateIndexerProfileRevisionRecordInput(input.value);
  const ledger = await readProjectIndexerProfileAuditLedger(input.projectRoot);
  if (ledger.ledger_digest !== request.expected_ledger_digest) {
    throw new TypeError("Indexer profile revision input references a stale ledger");
  }
  const precompile = await readProjectIndexerAuditReport({
    projectRoot: input.projectRoot,
    report_digest: request.precompile_audit_report_digest,
  });
  const postcompile = await readProjectIndexerAuditReport({
    projectRoot: input.projectRoot,
    report_digest: request.audit_report_digest,
  });
  const { attempt, ledger: nextLedger } = recordIndexerProfileAuditAttempt({
    ledger,
    lineage: request.lineage,
    audit_report: postcompile,
    indexer_result_fingerprint: request.indexer_result_fingerprint,
    actions_taken: request.actions_taken,
    unresolved_reasons: request.unresolved_reasons,
  });
  const auditFacts = buildIndexerAuditFacts({
    precompile_report: precompile,
    postcompile_report: postcompile,
    lineage: request.lineage,
    ledger: nextLedger,
  });
  const persisted = await writeProjectIndexerProfileAuditLedger({
    projectRoot: input.projectRoot,
    expected_ledger_digest: request.expected_ledger_digest,
    ledger: nextLedger,
  });
  const state = attempt.attempt === 3
    ? "human-report-required" as const
    : "revision-required" as const;
  const payload = {
    protocol: "context.indexer.profile-revision-record-result/v1" as const,
    state,
    lineage_id: attempt.lineage_id,
    attempt: attempt.attempt,
    attempt_digest: attempt.attempt_digest,
    ledger_digest: persisted.ledger_digest,
    audit_facts: auditFacts,
  };
  return {
    ...payload,
    graph_outcome: state === "human-report-required"
      ? "completed" as const
      : "partial" as const,
    reason_code: state === "human-report-required"
      ? "index-profile-human-report-required" as const
      : "index-profile-revision-required" as const,
    result_digest: indexerProtocolDigest(payload),
  };
}

export async function reportProjectIndexerProfileFailure(input: {
  projectRoot: string;
  value: unknown;
}) {
  const request = validateIndexerProfileFailureReportInput(input.value);
  const ledger = await readProjectIndexerProfileAuditLedger(input.projectRoot);
  if (ledger.ledger_digest !== request.expected_ledger_digest) {
    throw new TypeError("Indexer profile failure report input references a stale ledger");
  }
  const report = await recordProjectIndexerProfileFailureReport({
    projectRoot: input.projectRoot,
    report: buildIndexerProfileFailureReport({
      ledger,
      lineage_id: request.lineage_id,
      precompile_audit_report: await readProjectIndexerAuditReport({
        projectRoot: input.projectRoot,
        report_digest: request.precompile_audit_report_digest,
      }),
      audit_report: await readProjectIndexerAuditReport({
        projectRoot: input.projectRoot,
        report_digest: request.audit_report_digest,
      }),
      module_profiles: request.module_profiles,
      expected_artifacts: request.expected_artifacts,
      metrics: request.metrics,
      likely_missing_inputs: request.likely_missing_inputs,
      capability_losses: request.capability_losses,
      options: request.options,
    }),
  });
  const precompile = await readProjectIndexerAuditReport({
    projectRoot: input.projectRoot,
    report_digest: report.precompile_audit_report_digest,
  });
  const postcompile = await readProjectIndexerAuditReport({
    projectRoot: input.projectRoot,
    report_digest: report.latest_audit_report_digest,
  });
  const lineageRecord = ledger.lineages.find((record) =>
    record.lineage.lineage_id === report.lineage.lineage_id
  );
  const auditFacts = buildIndexerAuditFacts({
    precompile_report: precompile,
    postcompile_report: postcompile,
    lineage: report.lineage,
    ledger,
    failure_report: report,
  });
  if (lineageRecord === undefined) {
    throw new TypeError("Indexer profile failure report lineage disappeared from its ledger");
  }
  const payload = {
    protocol: "context.indexer.profile-failure-report-result/v1" as const,
    state: "explicit-decision-required" as const,
    lineage_id: report.lineage.lineage_id,
    precompile_audit_report_digest: report.precompile_audit_report_digest,
    audit_report_digest: report.latest_audit_report_digest,
    failure_report_digest: report.report_digest,
    failed_metric_ids: report.metrics.map((metric) => metric.metric_id),
    attempts: report.attempts.map((attempt) => attempt.attempt_digest),
    capability_losses: report.capability_losses,
    options: report.options,
    audit_facts: auditFacts,
  };
  return {
    ...payload,
    graph_outcome: "completed" as const,
    reason_code: "index-profile-explicit-override-required" as const,
    result_digest: indexerProtocolDigest(payload),
  };
}

export async function overrideProjectIndexerProfileAudit(input: {
  projectRoot: string;
  value: unknown;
}) {
  const decision = indexerProfileOverrideDecisionSchema.parse(input.value);
  const report = await readProjectIndexerProfileFailureReport({
    projectRoot: input.projectRoot,
    report_digest: decision.failure_report_digest,
  });
  const receipt = await recordProjectIndexerProfileOverrideReceipt({
    projectRoot: input.projectRoot,
    receipt: authorizeIndexerProfileOverride({
      failure_report: report,
      precompile_audit_report: await readProjectIndexerAuditReport({
        projectRoot: input.projectRoot,
        report_digest: report.precompile_audit_report_digest,
      }),
      audit_report: await readProjectIndexerAuditReport({
        projectRoot: input.projectRoot,
        report_digest: decision.audit_report_digest,
      }),
      decision,
    }),
  });
  const ledger = await readProjectIndexerProfileAuditLedger(input.projectRoot);
  const auditFacts = buildIndexerAuditFacts({
    precompile_report: await readProjectIndexerAuditReport({
      projectRoot: input.projectRoot,
      report_digest: receipt.precompile_audit_report_digest,
    }),
    postcompile_report: await readProjectIndexerAuditReport({
      projectRoot: input.projectRoot,
      report_digest: receipt.audit_report_digest,
    }),
    lineage: report.lineage,
    ledger,
    failure_report: report,
    override_receipt: receipt,
  });
  const payload = {
    protocol: "context.indexer.profile-override-result/v1" as const,
    state: "profile-risk-overridden" as const,
    failure_report_digest: receipt.failure_report_digest,
    precompile_audit_report_digest: receipt.precompile_audit_report_digest,
    audit_report_digest: receipt.audit_report_digest,
    profile_override_receipt_digest: receipt.receipt_digest,
    indexer_result_fingerprint: receipt.indexer_result_fingerprint,
    failed_metric_ids: receipt.failed_metric_ids,
    confirmed_by: receipt.confirmed_by,
    confirmed_at: receipt.confirmed_at,
    audit_facts: auditFacts,
  };
  return {
    ...payload,
    graph_outcome: "completed" as const,
    reason_code: "index-profile-override-recorded" as const,
    result_digest: indexerProtocolDigest(payload),
  };
}

export async function inspectProjectIndexerProfileFailure(input: {
  projectRoot: string;
  value: unknown;
}) {
  const request = validateIndexerProfileFailureInspectionInput(input.value);
  const report = await readProjectIndexerProfileFailureReport({
    projectRoot: input.projectRoot,
    report_digest: request.failure_report_digest,
  });
  const payload = {
    protocol: "context.indexer.profile-failure-inspection-result/v1" as const,
    state: "explicit-decision-required" as const,
    failure_report: report,
    failed_metric_ids: report.metrics.map((metric) => metric.metric_id),
    capability_losses: report.capability_losses,
    options: report.options,
  };
  return {
    ...payload,
    graph_outcome: "completed" as const,
    reason_code: "index-profile-explicit-override-required" as const,
    result_digest: indexerProtocolDigest(payload),
  };
}
