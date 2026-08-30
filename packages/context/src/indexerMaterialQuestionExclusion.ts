import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  buildIndexerMaterialGapLedger,
  indexerMaterialGapQuestionKey,
  validateIndexerMaterialGapLedger,
  type IndexerMaterialGapLedger,
} from "./indexerMaterialGapLedger.js";
import {
  indexerResolvedMaterialQuestionDigest,
  indexerResolvedMaterialQuestionSchema,
  type IndexerResolvedMaterialQuestion,
} from "./indexerQuestionAuthority.js";
import {
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const readerImpactSchema = z.string().min(1).refine(
  (value) => value.normalize("NFC") === value,
  "reader impact must use Unicode NFC normalization",
);

export const indexerMaterialQuestionExclusionReportSchema = z.object({
  protocol: z.literal("context.indexer.material-question-exclusion-report/v1"),
  project_ref: indexerCanonicalRefSchema,
  ledger_revision: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
  question_key: indexerCanonicalRefSchema,
  question_ref: indexerCanonicalRefSchema,
  question_contract_digest: indexerDigestSchema,
  question_subject_target_ref: indexerCanonicalRefSchema,
  question_target_item_digest: indexerDigestSchema,
  question_revision_digest: indexerDigestSchema,
  reason_code: indexerIdSchema,
  severity: z.enum(["blocking", "recommended"]),
  reader_impact: readerImpactSchema,
  report_digest: indexerDigestSchema,
}).strict();

export const indexerMaterialQuestionExclusionConfirmationSchema = z.object({
  protocol: z.literal("context.indexer.material-question-exclusion-confirmation/v1"),
  project_ref: indexerCanonicalRefSchema,
  question_key: indexerCanonicalRefSchema,
  question_contract_digest: indexerDigestSchema,
  question_subject_target_ref: indexerCanonicalRefSchema,
  question_target_item_digest: indexerDigestSchema,
  reason_code: indexerIdSchema,
  report_digest: indexerDigestSchema,
  authority: z.literal("human"),
  non_delegable: z.literal(true),
  confirmed_by: z.string().min(1),
  confirmed_at: z.string().datetime({ offset: true }),
  decision_digest: indexerDigestSchema,
}).strict();

export type IndexerMaterialQuestionExclusionReport = z.infer<
  typeof indexerMaterialQuestionExclusionReportSchema
>;
export type IndexerMaterialQuestionExclusionConfirmation = z.infer<
  typeof indexerMaterialQuestionExclusionConfirmationSchema
>;

function withoutDigest<T extends object, K extends keyof T>(
  value: T,
  field: K,
): Omit<T, K> {
  const payload: Partial<T> = { ...value };
  Reflect.deleteProperty(payload, field);
  return payload as Omit<T, K>;
}

export function indexerMaterialQuestionExclusionReportDigest(
  value: Omit<IndexerMaterialQuestionExclusionReport, "report_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function indexerMaterialQuestionExclusionDecisionDigest(
  value: Omit<IndexerMaterialQuestionExclusionConfirmation, "decision_digest">,
): string {
  return indexerProtocolDigest(value);
}

function validateResolvedQuestion(
  value: unknown,
): IndexerResolvedMaterialQuestion {
  const question = indexerResolvedMaterialQuestionSchema.parse(value);
  const payload = withoutDigest(question, "contract_digest");
  if (indexerResolvedMaterialQuestionDigest(payload) !== question.contract_digest) {
    throw new TypeError("material question exclusion contract digest is invalid");
  }
  return question;
}

function expectedReport(input: {
  ledger: IndexerMaterialGapLedger;
  project_ref: string;
  question_key: string;
  resolved_question: IndexerResolvedMaterialQuestion;
  reason_code: string;
  domain_state: "required" | "optional" | "out-of-scope";
  reader_impact: string;
}): Omit<IndexerMaterialQuestionExclusionReport, "report_digest"> {
  if (input.domain_state === "out-of-scope") {
    throw new TypeError("out-of-scope material questions cannot enter the exclusion Gate");
  }
  if (!(input.resolved_question.allowed_exclusion_reason_codes ?? [])
    .includes(input.reason_code)) {
    throw new TypeError("material question exclusion reason is not contract-allowlisted");
  }
  const entry = input.ledger.entries.find((item) =>
    indexerMaterialGapQuestionKey(item) === input.question_key
  );
  if (entry === undefined || entry.state !== "unresolved") {
    throw new TypeError("only a current unresolved material gap can be proposed for exclusion");
  }
  if (
    entry.question_ref !== input.resolved_question.ref ||
    entry.question_contract_digest !== input.resolved_question.contract_digest
  ) {
    throw new TypeError("material question exclusion contract is stale or belongs to another pair");
  }
  return {
    protocol: "context.indexer.material-question-exclusion-report/v1",
    project_ref: indexerCanonicalRefSchema.parse(input.project_ref),
    ledger_revision: input.ledger.revision,
    question_target_inventory_digest: input.ledger.question_target_inventory_digest,
    question_key: input.question_key,
    question_ref: entry.question_ref,
    question_contract_digest: entry.question_contract_digest,
    question_subject_target_ref: entry.question_subject_target_ref,
    question_target_item_digest: entry.question_target_item_digest,
    question_revision_digest: entry.question_revision_digest,
    reason_code: input.reason_code,
    severity: input.domain_state === "required" ? "blocking" : "recommended",
    reader_impact: readerImpactSchema.parse(input.reader_impact),
  };
}

export function proposeIndexerMaterialQuestionExclusion(input: {
  ledger: unknown;
  expected_revision: string;
  project_ref: string;
  question_key: string;
  resolved_question: unknown;
  reason_code: string;
  domain_state: "required" | "optional" | "out-of-scope";
  reader_impact: string;
}): IndexerMaterialQuestionExclusionReport {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material question exclusion proposal CAS is stale");
  }
  const payload = expectedReport({
    ledger,
    project_ref: input.project_ref,
    question_key: input.question_key,
    resolved_question: validateResolvedQuestion(input.resolved_question),
    reason_code: input.reason_code,
    domain_state: input.domain_state,
    reader_impact: input.reader_impact,
  });
  return indexerMaterialQuestionExclusionReportSchema.parse({
    ...payload,
    report_digest: indexerMaterialQuestionExclusionReportDigest(payload),
  });
}

export function validateIndexerMaterialQuestionExclusionReport(input: {
  ledger: unknown;
  report: unknown;
  resolved_question: unknown;
  domain_state: "required" | "optional" | "out-of-scope";
}): IndexerMaterialQuestionExclusionReport {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  const report = indexerMaterialQuestionExclusionReportSchema.parse(input.report);
  const expected = expectedReport({
    ledger,
    project_ref: report.project_ref,
    question_key: report.question_key,
    resolved_question: validateResolvedQuestion(input.resolved_question),
    reason_code: report.reason_code,
    domain_state: input.domain_state,
    reader_impact: report.reader_impact,
  });
  if (
    report.ledger_revision !== ledger.revision ||
    indexerMaterialQuestionExclusionReportDigest(expected) !== report.report_digest ||
    indexerProtocolDigest(expected) !== indexerProtocolDigest(withoutDigest(report, "report_digest"))
  ) {
    throw new TypeError("material question exclusion report is stale or invalid");
  }
  return report;
}

export function confirmIndexerMaterialQuestionExclusion(input: {
  report: unknown;
  authority: "human" | "managed";
  confirmed_by: string;
  confirmed_at: string;
}): IndexerMaterialQuestionExclusionConfirmation {
  const report = indexerMaterialQuestionExclusionReportSchema.parse(input.report);
  if (
    indexerMaterialQuestionExclusionReportDigest(withoutDigest(report, "report_digest")) !==
      report.report_digest
  ) {
    throw new TypeError("material question exclusion report digest is invalid");
  }
  if (input.authority !== "human") {
    throw new TypeError("confirm-material-question-exclusion cannot use managed delegation");
  }
  const payload: Omit<IndexerMaterialQuestionExclusionConfirmation, "decision_digest"> = {
    protocol: "context.indexer.material-question-exclusion-confirmation/v1",
    project_ref: report.project_ref,
    question_key: report.question_key,
    question_contract_digest: report.question_contract_digest,
    question_subject_target_ref: report.question_subject_target_ref,
    question_target_item_digest: report.question_target_item_digest,
    reason_code: report.reason_code,
    report_digest: report.report_digest,
    authority: "human",
    non_delegable: true,
    confirmed_by: input.confirmed_by,
    confirmed_at: input.confirmed_at,
  };
  return indexerMaterialQuestionExclusionConfirmationSchema.parse({
    ...payload,
    decision_digest: indexerMaterialQuestionExclusionDecisionDigest(payload),
  });
}

export function validateIndexerMaterialQuestionExclusionConfirmation(input: {
  report: unknown;
  confirmation: unknown;
}): IndexerMaterialQuestionExclusionConfirmation {
  const report = indexerMaterialQuestionExclusionReportSchema.parse(input.report);
  const confirmation = indexerMaterialQuestionExclusionConfirmationSchema.parse(
    input.confirmation,
  );
  const payload = withoutDigest(confirmation, "decision_digest");
  if (
    confirmation.project_ref !== report.project_ref ||
    confirmation.question_key !== report.question_key ||
    confirmation.question_contract_digest !== report.question_contract_digest ||
    confirmation.question_subject_target_ref !== report.question_subject_target_ref ||
    confirmation.question_target_item_digest !== report.question_target_item_digest ||
    confirmation.reason_code !== report.reason_code ||
    confirmation.report_digest !== report.report_digest ||
    indexerMaterialQuestionExclusionDecisionDigest(payload) !== confirmation.decision_digest
  ) {
    throw new TypeError("material question exclusion confirmation is stale or invalid");
  }
  return confirmation;
}

export function applyIndexerMaterialQuestionExclusion(input: {
  ledger: unknown;
  expected_revision: string;
  report: unknown;
  confirmation: unknown;
  resolved_question: unknown;
  domain_state: "required" | "optional" | "out-of-scope";
}): IndexerMaterialGapLedger {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material question exclusion apply CAS is stale");
  }
  const report = validateIndexerMaterialQuestionExclusionReport({
    ledger,
    report: input.report,
    resolved_question: input.resolved_question,
    domain_state: input.domain_state,
  });
  const confirmation = validateIndexerMaterialQuestionExclusionConfirmation({
    report,
    confirmation: input.confirmation,
  });
  const entries = ledger.entries.map((entry) =>
    indexerMaterialGapQuestionKey(entry) === report.question_key
      ? {
          ...entry,
          state: "excluded-with-confirmed-reason" as const,
          exclusion: {
            reason_code: report.reason_code,
            decision_digest: confirmation.decision_digest,
          },
        }
      : entry
  );
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest: ledger.question_target_inventory_digest,
    entries,
  });
}
