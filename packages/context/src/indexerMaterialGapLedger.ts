import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  indexerCanonicalMaterialAnswerEvidenceSchema,
  indexerEvidenceItemRef,
  indexerMaterialAnswerBindingDigest,
  validateIndexerMaterialAnswerCandidateSet,
  type IndexerCanonicalMaterialAnswerEvidence,
} from "./indexerMaterialAnswer.js";
import {
  validateIndexerMaterialAnswerBaselineReport,
  validateIndexerMaterialAnswerReviewDecision,
} from "./indexerMaterialAnswerReview.js";
import {
  indexerMaterialQuestionWorksetSchema,
  validateIndexerMaterialQuestionWorkset,
} from "./indexerMaterialQuestionWorkset.js";
import {
  indexerMaterialQuestionKey,
  indexerQuestionRevisionDigest,
} from "./indexerQuestionAuthority.js";
import { buildIndexerPlannedMaterialAnswerProjection } from
  "./indexerPlannedMaterialAnswer.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const dependenciesSchema = z.object({
  requirement_digest: indexerDigestSchema,
  owner_cell_digest: indexerDigestSchema,
  emitted_question_digest: indexerDigestSchema,
  answer_landing_dependency_digest: indexerDigestSchema.optional(),
  source_input_set_digest: indexerDigestSchema,
}).strict();

const answerSchema = z.object({
  accepted_workset: indexerMaterialQuestionWorksetSchema,
  accepted_workset_digest: indexerDigestSchema,
  answer_indexer_id: indexerIdSchema,
  answer_provider_composition_fingerprint: indexerDigestSchema,
  answer_result_digest: indexerDigestSchema,
  review_decision_digest: indexerDigestSchema,
  evidence: z.array(indexerCanonicalMaterialAnswerEvidenceSchema).min(1),
}).strict();

const actualizationSchema = z.object({
  actualized_target_ref: indexerCanonicalRefSchema,
  section_ref: indexerCanonicalRefSchema.optional(),
  layout_digest: indexerDigestSchema,
  planned_answer_digest: indexerDigestSchema,
  actualization_digest: indexerDigestSchema,
}).strict();

const exclusionSchema = z.object({
  reason_code: indexerIdSchema,
  decision_digest: indexerDigestSchema,
}).strict();

const ledgerEntryBaseSchema = z.object({
  owner_cell_ref: indexerCanonicalRefSchema,
  question_ref: indexerCanonicalRefSchema,
  question_contract_digest: indexerDigestSchema,
  question_subject_target_ref: indexerCanonicalRefSchema,
  question_target_item_digest: indexerDigestSchema,
  answer_landing_ref: indexerCanonicalRefSchema.optional(),
  question_revision_digest: indexerDigestSchema,
  dependencies: dependenciesSchema,
});

const unresolvedEntrySchema = ledgerEntryBaseSchema.extend({
  state: z.literal("unresolved"),
}).strict();

const answerApprovedEntrySchema = ledgerEntryBaseSchema.extend({
  state: z.literal("answer-approved"),
  answer: answerSchema,
}).strict();

const resolvedEntrySchema = ledgerEntryBaseSchema.extend({
  state: z.literal("resolved"),
  answer: answerSchema,
  actualization: actualizationSchema,
}).strict();

const excludedEntrySchema = ledgerEntryBaseSchema.extend({
  state: z.literal("excluded-with-confirmed-reason"),
  exclusion: exclusionSchema,
}).strict();

export const indexerMaterialGapLedgerEntrySchema = z.discriminatedUnion("state", [
  unresolvedEntrySchema,
  answerApprovedEntrySchema,
  resolvedEntrySchema,
  excludedEntrySchema,
]);

export const indexerMaterialGapLedgerSchema = z.object({
  protocol: z.literal("context.indexer.material-gap-ledger/v1"),
  revision: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
  entries: z.array(indexerMaterialGapLedgerEntrySchema),
}).strict();

export type IndexerMaterialGapLedgerEntry = z.infer<
  typeof indexerMaterialGapLedgerEntrySchema
>;
export type IndexerMaterialGapLedger = z.infer<
  typeof indexerMaterialGapLedgerSchema
>;
export type IndexerUnresolvedMaterialGap = z.infer<typeof unresolvedEntrySchema>;

export function indexerMaterialGapQuestionKey(
  entry: Pick<
    IndexerMaterialGapLedgerEntry,
    "owner_cell_ref" | "question_contract_digest" | "question_subject_target_ref"
  >,
): string {
  return indexerMaterialQuestionKey({
    owner_cell_ref: entry.owner_cell_ref,
    question_contract_digest: entry.question_contract_digest,
    question_subject_target_ref: entry.question_subject_target_ref,
  });
}
export function indexerMaterialGapLedgerRevision(
  value: Omit<IndexerMaterialGapLedger, "revision">,
): string {
  return indexerProtocolDigest(value);
}

function sortEntries(
  entries: readonly IndexerMaterialGapLedgerEntry[],
): IndexerMaterialGapLedgerEntry[] {
  return [...entries].sort((left, right) =>
    compareIndexerCanonicalText(
      indexerMaterialGapQuestionKey(left),
      indexerMaterialGapQuestionKey(right),
    )
  );
}

export function buildIndexerMaterialGapLedger(input: {
  question_target_inventory_digest: string;
  entries: readonly IndexerMaterialGapLedgerEntry[];
}): IndexerMaterialGapLedger {
  const entries = sortEntries(
    input.entries.map((entry) => indexerMaterialGapLedgerEntrySchema.parse(entry)),
  );
  entries.forEach(validateEntry);
  const keys = entries.map(indexerMaterialGapQuestionKey);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("material gap ledger question identities must be unique");
  }
  const payload: Omit<IndexerMaterialGapLedger, "revision"> = {
    protocol: "context.indexer.material-gap-ledger/v1",
    question_target_inventory_digest: indexerDigestSchema.parse(
      input.question_target_inventory_digest,
    ),
    entries,
  };
  return indexerMaterialGapLedgerSchema.parse({
    ...payload,
    revision: indexerMaterialGapLedgerRevision(payload),
  });
}

function validateEvidence(evidence: IndexerCanonicalMaterialAnswerEvidence): void {
  const itemRef = indexerEvidenceItemRef({
    kind: evidence.kind,
    source_origin_ref: evidence.source_origin_ref,
    source_input_digest: evidence.source_input_digest,
    source_spans: evidence.source_spans,
    evidence_digest: evidence.evidence_digest,
  });
  if (itemRef !== evidence.evidence_item_ref) {
    throw new TypeError("retained Material Answer evidence item ref is invalid");
  }
  for (let index = 0; index < evidence.source_spans.length; index += 1) {
    const span = evidence.source_spans[index]!;
    const previous = evidence.source_spans[index - 1];
    if (
      previous !== undefined &&
      (span.unit !== previous.unit || span.start < previous.end_exclusive)
    ) {
      throw new TypeError("retained Material Answer spans are not canonical");
    }
  }
}

function validateEntry(entry: IndexerMaterialGapLedgerEntry): void {
  const questionKey = indexerMaterialGapQuestionKey(entry);
  const expectedRevision = indexerQuestionRevisionDigest({
    question_contract_digest: entry.question_contract_digest,
    question_key: questionKey,
    owner_cell_digest: entry.dependencies.owner_cell_digest,
    question_target_item_digest: entry.question_target_item_digest,
    ...(entry.dependencies.answer_landing_dependency_digest === undefined
      ? {}
      : {
          answer_landing_dependency_digest:
            entry.dependencies.answer_landing_dependency_digest,
        }),
  });
  if (expectedRevision !== entry.question_revision_digest) {
    throw new TypeError("material gap question revision is invalid");
  }
  if (entry.state === "answer-approved" || entry.state === "resolved") {
    const acceptedWorkset = validateIndexerMaterialQuestionWorkset(
      entry.answer.accepted_workset,
    );
    const acceptedItem = acceptedWorkset.items.find((item) =>
      item.question_key === questionKey
    );
    if (
      acceptedWorkset.workset_digest !== entry.answer.accepted_workset_digest ||
      acceptedItem === undefined ||
      acceptedItem.question_revision_digest !== entry.question_revision_digest ||
      acceptedItem.question.owner_cell_ref !== entry.owner_cell_ref ||
      acceptedItem.question.question_ref !== entry.question_ref ||
      acceptedItem.question.question_subject_target_ref !==
        entry.question_subject_target_ref
    ) {
      throw new TypeError("retained Material Answer workset binding is invalid");
    }
    const evidenceRefs = entry.answer.evidence.map((item) => item.evidence_item_ref);
    if (
      new Set(evidenceRefs).size !== evidenceRefs.length ||
      canonicalIndexerJson(evidenceRefs) !== canonicalIndexerJson([...evidenceRefs].sort())
    ) {
      throw new TypeError("retained Material Answer evidence is not canonical");
    }
    entry.answer.evidence.forEach(validateEvidence);
  }
  if (entry.state === "resolved") {
    if (entry.answer_landing_ref === undefined) {
      throw new TypeError("material answer actualization requires an answer landing");
    }
    const bindingDigest = indexerMaterialAnswerBindingDigestFromLedgerEntry(entry);
    const plannedAnswer = buildIndexerPlannedMaterialAnswerProjection({
      question_key: indexerMaterialGapQuestionKey(entry),
      question_revision_digest: entry.question_revision_digest,
      answer_landing_ref: entry.answer_landing_ref,
      binding_digest: bindingDigest,
      evidence_items: entry.answer.evidence,
    });
    const expectedActualization = indexerProtocolDigest({
      binding_digest: bindingDigest,
      planned_answer_digest: plannedAnswer.planned_answer_digest,
      answer_landing_ref: entry.answer_landing_ref,
      actualized_target_ref: entry.actualization.actualized_target_ref,
      ...(entry.actualization.section_ref === undefined
        ? {}
        : { section_ref: entry.actualization.section_ref }),
      layout_digest: entry.actualization.layout_digest,
    });
    if (
      entry.actualization.planned_answer_digest !==
        plannedAnswer.planned_answer_digest ||
      expectedActualization !== entry.actualization.actualization_digest
    ) {
      throw new TypeError("material answer actualization is invalid");
    }
  }
}

export function validateIndexerMaterialGapLedger(value: unknown): IndexerMaterialGapLedger {
  const ledger = indexerMaterialGapLedgerSchema.parse(value);
  const payload: Omit<IndexerMaterialGapLedger, "revision"> = {
    protocol: ledger.protocol,
    question_target_inventory_digest: ledger.question_target_inventory_digest,
    entries: ledger.entries,
  };
  if (indexerMaterialGapLedgerRevision(payload) !== ledger.revision) {
    throw new TypeError("material gap ledger revision is invalid");
  }
  ledger.entries.forEach(validateEntry);
  const keys = ledger.entries.map(indexerMaterialGapQuestionKey);
  if (
    new Set(keys).size !== keys.length ||
    canonicalIndexerJson(keys) !== canonicalIndexerJson([...keys].sort())
  ) {
    throw new TypeError("material gap ledger entries are not canonical");
  }
  return ledger;
}

function transitionLedger(input: {
  ledger: unknown;
  expected_revision: string;
  update: (entries: readonly IndexerMaterialGapLedgerEntry[]) =>
    readonly IndexerMaterialGapLedgerEntry[];
  question_target_inventory_digest?: string;
}): IndexerMaterialGapLedger {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material gap ledger CAS predecessor does not match current revision");
  }
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest:
      input.question_target_inventory_digest ?? ledger.question_target_inventory_digest,
    entries: input.update(ledger.entries),
  });
}

function replaceEntry(
  entries: readonly IndexerMaterialGapLedgerEntry[],
  questionKey: string,
  replacement: IndexerMaterialGapLedgerEntry,
): IndexerMaterialGapLedgerEntry[] {
  let found = false;
  const next = entries.map((entry) => {
    if (indexerMaterialGapQuestionKey(entry) !== questionKey) return entry;
    found = true;
    return replacement;
  });
  if (!found) throw new TypeError(`material gap ${questionKey} does not exist`);
  return next;
}

export function checkpointIndexerEmittedMaterialGaps(input: {
  ledger: unknown;
  expected_revision: string;
  authoritative_owner_cell_refs: readonly string[];
  current_entries: readonly IndexerUnresolvedMaterialGap[];
  complete_inventory_digest?: string;
}): IndexerMaterialGapLedger {
  const currentLedger = validateIndexerMaterialGapLedger(input.ledger);
  const ownerRefs = new Set(input.authoritative_owner_cell_refs);
  if (ownerRefs.size !== input.authoritative_owner_cell_refs.length) {
    throw new TypeError("authoritative owner-cell refs must be unique");
  }
  const current = input.current_entries.map((entry) => unresolvedEntrySchema.parse(entry));
  if (current.some((entry) => !ownerRefs.has(entry.owner_cell_ref))) {
    throw new TypeError("current material gaps exceed the authoritative owner-cell set");
  }
  if (
    input.complete_inventory_digest !== undefined &&
    currentLedger.entries.some((entry) => !ownerRefs.has(entry.owner_cell_ref))
  ) {
    throw new TypeError(
      "a complete question target inventory requires authority for every retained owner",
    );
  }
  return transitionLedger({
    ledger: currentLedger,
    expected_revision: input.expected_revision,
    ...(input.complete_inventory_digest === undefined
      ? {}
      : { question_target_inventory_digest: input.complete_inventory_digest }),
    update: (entries) => {
      const currentByKey = new Map(
        current.map((entry) => [indexerMaterialGapQuestionKey(entry), entry]),
      );
      if (currentByKey.size !== current.length) {
        throw new TypeError("current material gap identities must be unique");
      }
      const next = entries.flatMap((entry) => {
        if (!ownerRefs.has(entry.owner_cell_ref)) return [entry];
        const replacement = currentByKey.get(indexerMaterialGapQuestionKey(entry));
        if (replacement === undefined) return [];
        currentByKey.delete(indexerMaterialGapQuestionKey(entry));
        const sameDependencies =
          replacement.question_revision_digest === entry.question_revision_digest &&
          canonicalIndexerJson(replacement.dependencies) ===
            canonicalIndexerJson(entry.dependencies);
        return [sameDependencies ? entry : replacement];
      });
      return [...next, ...currentByKey.values()];
    },
  });
}

export function approveIndexerMaterialAnswer(input: {
  ledger: unknown;
  workset: unknown;
  candidate_set: unknown;
  baseline_report: unknown;
  review_decision: unknown;
}): {
  ledger: IndexerMaterialGapLedger;
  consumed_workset_digest: string;
  binding_digest: string;
} {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  const workset = validateIndexerMaterialQuestionWorkset(input.workset);
  const candidateSet = validateIndexerMaterialAnswerCandidateSet(input.candidate_set);
  const baselineReport = validateIndexerMaterialAnswerBaselineReport(
    input.baseline_report,
  );
  const reviewDecision = validateIndexerMaterialAnswerReviewDecision({
    decision: input.review_decision,
    baseline_report: baselineReport,
    candidate_set: candidateSet,
  });
  if (
    ledger.revision !== workset.predecessor_ledger_revision ||
    candidateSet.workset_digest !== workset.workset_digest ||
    baselineReport.workset_digest !== workset.workset_digest
  ) {
    throw new TypeError("Material Answer approval CAS/workset binding is stale");
  }
  if (reviewDecision.decision !== "approved") {
    throw new TypeError("Material Answer approval requires an approved limited Review");
  }
  const questionKey = reviewDecision.question_key;
  const worksetItem = workset.items.find((item) => item.question_key === questionKey);
  const candidate = candidateSet.evaluations.find((item) =>
    item.question_key === questionKey && item.state === "candidate"
  );
  if (worksetItem === undefined || candidate === undefined || candidate.state !== "candidate") {
    throw new TypeError("Material Answer approval requires a current reviewable candidate");
  }
  if (
    baselineReport.question_contract_digest !== worksetItem.question_contract_digest ||
    baselineReport.question_target_item_digest !==
      worksetItem.question.question_target_item_digest ||
    baselineReport.answer_landing_ref !== worksetItem.question.answer_landing_ref ||
    baselineReport.binding_digest !== candidate.binding_digest
  ) {
    throw new TypeError("Material Answer limited Review baseline is stale");
  }
  const entry = ledger.entries.find((item) =>
    indexerMaterialGapQuestionKey(item) === questionKey
  );
  if (
    entry === undefined ||
    entry.state !== "unresolved" ||
    entry.owner_cell_ref !== worksetItem.question.owner_cell_ref ||
    entry.question_ref !== worksetItem.question.question_ref ||
    entry.question_contract_digest !== worksetItem.question_contract_digest ||
    entry.question_subject_target_ref !==
      worksetItem.question.question_subject_target_ref ||
    entry.question_target_item_digest !==
      worksetItem.question.question_target_item_digest ||
    entry.question_revision_digest !== worksetItem.question_revision_digest ||
    entry.answer_landing_ref !== worksetItem.question.answer_landing_ref
  ) {
    throw new TypeError("Material Answer approval does not match the retained gap");
  }
  const answer = answerSchema.parse({
    accepted_workset: workset,
    accepted_workset_digest: workset.workset_digest,
    answer_indexer_id: candidateSet.answer_indexer_id,
    answer_provider_composition_fingerprint:
      candidateSet.answer_provider_composition_fingerprint,
    answer_result_digest: candidateSet.answer_result_digest,
    review_decision_digest: reviewDecision.decision_digest,
    evidence: candidate.evidence,
  });
  const replacement = answerApprovedEntrySchema.parse({
    ...entry,
    state: "answer-approved",
    answer,
  });
  const nextLedger = transitionLedger({
    ledger,
    expected_revision: workset.predecessor_ledger_revision,
    update: (entries) => replaceEntry(entries, questionKey, replacement),
  });
  return {
    ledger: nextLedger,
    consumed_workset_digest: workset.workset_digest,
    binding_digest: candidate.binding_digest,
  };
}

export function indexerMaterialAnswerBindingDigestFromLedgerEntry(
  entry: Extract<
    IndexerMaterialGapLedgerEntry,
    { state: "answer-approved" | "resolved" }
  >,
): string {
  return indexerMaterialAnswerBindingDigest({
    accepted_workset_digest: entry.answer.accepted_workset_digest,
    question_key: indexerMaterialGapQuestionKey(entry),
    question_revision_digest: entry.question_revision_digest,
    answer_indexer_id: entry.answer.answer_indexer_id,
    answer_provider_composition_fingerprint:
      entry.answer.answer_provider_composition_fingerprint,
    answer_result_digest: entry.answer.answer_result_digest,
    evidence: entry.answer.evidence,
  });
}

export function deriveIndexerMaterialGapSeverity(input: {
  domain_state: "required" | "optional" | "out-of-scope";
}): "blocking" | "recommended" | undefined {
  if (input.domain_state === "required") return "blocking";
  if (input.domain_state === "optional") return "recommended";
  return undefined;
}
