import { z } from "zod";
import {
  type IndexerAuditReport,
  validateIndexerAuditReport,
} from "./indexerAuditProtocol.js";
import {
  type IndexerProfileAuditLedger,
  type IndexerProfileFailureReport,
  type IndexerProfileOverrideReceipt,
  type IndexerProfileProblemLineage,
  validateIndexerProfileAuditLedger,
  validateIndexerProfileFailureReport,
  validateIndexerProfileOverrideReceipt,
  validateIndexerProfileProblemLineage,
} from "./indexerAuditRevision.js";
import {
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const indexerAuditFactsSchema = z.object({
  protocol: z.literal("context.indexer.audit-facts/v1"),
  audit: z.object({
    baseline_clear: z.boolean(),
    profile_state: z.enum([
      "not-applicable",
      "passed",
      "revision-required",
      "human-guidance-required",
    ]),
    problem_lineage_id: indexerDigestSchema.nullable(),
    profile_attempt_count: z.number().int().min(0).max(3),
    profile_report_digest: indexerDigestSchema.nullable(),
    profile_override_eligible: z.boolean(),
    profile_override_receipt_digest: indexerDigestSchema.nullable(),
  }).strict(),
  facts_digest: indexerDigestSchema,
}).strict();

export type IndexerAuditFacts = z.infer<typeof indexerAuditFactsSchema>;

interface IndexerAuditFactsInput {
  precompile_report: unknown;
  postcompile_report: unknown;
  lineage?: unknown;
  ledger?: unknown;
  failure_report?: unknown;
  override_receipt?: unknown;
}

interface IndexerAuditRevisionState {
  lineage: IndexerProfileProblemLineage | undefined;
  ledger: IndexerProfileAuditLedger | undefined;
  record: IndexerProfileAuditLedger["lineages"][number] | undefined;
}

function validateMatchingReports(input: IndexerAuditFactsInput): {
  precompile: IndexerAuditReport;
  postcompile: IndexerAuditReport;
} {
  const precompile = validateIndexerAuditReport(input.precompile_report);
  const postcompile = validateIndexerAuditReport(input.postcompile_report);
  if (
    precompile.stage !== "precompile" ||
    postcompile.stage !== "postcompile" ||
    precompile.binding.requirement_set_digest !== postcompile.binding.requirement_set_digest ||
    precompile.binding.registry_digest !== postcompile.binding.registry_digest ||
    precompile.binding.inventory_digest !== postcompile.binding.inventory_digest
  ) {
    throw new TypeError("Indexer audit Facts require current matching pre/post reports");
  }
  return { precompile, postcompile };
}

function validateRevisionState(
  input: IndexerAuditFactsInput,
  postcompile: IndexerAuditReport,
): IndexerAuditRevisionState {
  if ((input.lineage === undefined) !== (input.ledger === undefined)) {
    throw new TypeError("Indexer audit Facts require lineage and ledger together");
  }
  const lineage = input.lineage === undefined
    ? undefined
    : validateIndexerProfileProblemLineage(input.lineage);
  const ledger = input.ledger === undefined
    ? undefined
    : validateIndexerProfileAuditLedger(input.ledger);
  const record = lineage === undefined
    ? undefined
    : ledger?.lineages.find((candidate) =>
        candidate.lineage.lineage_id === lineage.lineage_id
      );
  if (lineage !== undefined && record === undefined) {
    throw new TypeError("Indexer audit Facts lineage is missing from the attempt ledger");
  }
  const latestAttempt = record?.attempts.at(-1);
  if (
    latestAttempt !== undefined &&
    latestAttempt.audit_report_digest !== postcompile.report_digest
  ) {
    throw new TypeError("Indexer audit Facts attempt ledger is stale for postcompile audit");
  }
  return { lineage, ledger, record };
}

function validateDecisionState(
  input: IndexerAuditFactsInput,
  reports: { precompile: IndexerAuditReport; postcompile: IndexerAuditReport },
  revision: IndexerAuditRevisionState,
): {
  failureReport: IndexerProfileFailureReport | undefined;
  receipt: IndexerProfileOverrideReceipt | undefined;
} {
  const { precompile, postcompile } = reports;
  const failureReport = input.failure_report === undefined
    ? undefined
    : validateIndexerProfileFailureReport(input.failure_report);
  if (
    failureReport !== undefined &&
    (
      failureReport.precompile_audit_report_digest !== precompile.report_digest ||
      failureReport.latest_audit_report_digest !== postcompile.report_digest ||
      failureReport.lineage.lineage_id !== revision.lineage?.lineage_id ||
      revision.record?.attempts.length !== 3
    )
  ) {
    throw new TypeError("Indexer audit Facts failure report is stale or lacks three attempts");
  }
  const receipt = input.override_receipt === undefined
    ? undefined
    : validateIndexerProfileOverrideReceipt(input.override_receipt);
  if (
    receipt !== undefined &&
    (
      failureReport === undefined ||
      !precompile.baseline.clear ||
      !postcompile.baseline.clear ||
      receipt.failure_report_digest !== failureReport.report_digest ||
      receipt.precompile_audit_report_digest !== precompile.report_digest ||
      receipt.audit_report_digest !== postcompile.report_digest ||
      indexerProtocolDigest(receipt.binding) !== indexerProtocolDigest({
        requirement_set_digest: postcompile.binding.requirement_set_digest,
        registry_digest: postcompile.binding.registry_digest,
        inventory_digest: postcompile.binding.inventory_digest,
        layout_digest: postcompile.binding.layout_digest,
        candidate_set_digest: postcompile.binding.candidate_set_digest,
        effective_revision_digest: postcompile.binding.effective_revision_digest,
      }) ||
      indexerProtocolDigest(receipt.failed_metric_ids) !==
        indexerProtocolDigest(postcompile.profile.failed_metric_ids)
    )
  ) {
    throw new TypeError("Indexer audit Facts override receipt is stale");
  }
  return { failureReport, receipt };
}

export function buildIndexerAuditFacts(
  input: IndexerAuditFactsInput,
): IndexerAuditFacts {
  const reports = validateMatchingReports(input);
  const revision = validateRevisionState(input, reports.postcompile);
  const decision = validateDecisionState(input, reports, revision);
  const { precompile, postcompile } = reports;
  const baselineClear = precompile.baseline.clear && postcompile.baseline.clear;
  const failedProfile = postcompile.profile.state !== "passed" &&
    postcompile.profile.state !== "not-applicable";
  const payload = {
    protocol: "context.indexer.audit-facts/v1" as const,
    audit: {
      baseline_clear: baselineClear,
      profile_state: postcompile.profile.state,
      problem_lineage_id: revision.lineage?.lineage_id ?? null,
      profile_attempt_count: revision.record?.attempts.length ?? 0,
      profile_report_digest: postcompile.profile.report_digest,
      profile_override_eligible: baselineClear && failedProfile &&
        revision.record?.attempts.length === 3 &&
        decision.failureReport !== undefined && decision.receipt === undefined,
      profile_override_receipt_digest: decision.receipt?.receipt_digest ?? null,
    },
  };
  return indexerAuditFactsSchema.parse({
    ...payload,
    facts_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerAuditFacts(value: unknown): IndexerAuditFacts {
  const facts = indexerAuditFactsSchema.parse(value);
  if (indexerProtocolDigest({ protocol: facts.protocol, audit: facts.audit }) !== facts.facts_digest) {
    throw new TypeError("Indexer audit Facts digest is invalid");
  }
  return facts;
}
