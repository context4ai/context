import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  type IndexerCurrentEvidenceSource,
  type IndexerSourceSpanRef,
} from "./indexerMaterialAnswer.js";
import {
  validateIndexerMaterialAnswerLayoutProposal,
} from "./indexerMaterialAnswerLayout.js";
import {
  evaluateIndexerMaterialAnswerEvidenceCompatibility,
  type IndexerMaterialAnswerEvidenceCompatibility,
} from "./indexerMaterialAnswerReview.js";
import {
  buildIndexerMaterialGapLedger,
  indexerMaterialAnswerBindingDigestFromLedgerEntry,
  indexerMaterialGapQuestionKey,
  validateIndexerMaterialGapLedger,
  type IndexerMaterialGapLedger,
  type IndexerMaterialGapLedgerEntry,
} from "./indexerMaterialGapLedger.js";
import {
  buildIndexerPlannedMaterialAnswerProjection,
  type IndexerPlannedMaterialAnswer,
} from "./indexerPlannedMaterialAnswer.js";
import type { IndexerResolvedMaterialQuestion } from "./indexerQuestionAuthority.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

type ApprovedAnswerEntry = Extract<
  IndexerMaterialGapLedgerEntry,
  { state: "answer-approved" | "resolved" }
>;

function replaceEntry(input: {
  ledger: IndexerMaterialGapLedger;
  expected_revision: string;
  question_key: string;
  replacement: IndexerMaterialGapLedgerEntry;
}): IndexerMaterialGapLedger {
  if (input.ledger.revision !== input.expected_revision) {
    throw new TypeError("material gap ledger CAS predecessor does not match current revision");
  }
  let found = false;
  const entries = input.ledger.entries.map((entry) => {
    if (indexerMaterialGapQuestionKey(entry) !== input.question_key) return entry;
    found = true;
    return input.replacement;
  });
  if (!found) throw new TypeError(`material gap ${input.question_key} does not exist`);
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest:
      input.ledger.question_target_inventory_digest,
    entries,
  });
}

function unresolvedEntry(entry: ApprovedAnswerEntry): IndexerMaterialGapLedgerEntry {
  return {
    owner_cell_ref: entry.owner_cell_ref,
    question_ref: entry.question_ref,
    question_contract_digest: entry.question_contract_digest,
    question_subject_target_ref: entry.question_subject_target_ref,
    question_target_item_digest: entry.question_target_item_digest,
    ...(entry.answer_landing_ref === undefined
      ? {}
      : { answer_landing_ref: entry.answer_landing_ref }),
    question_revision_digest: entry.question_revision_digest,
    state: "unresolved",
    dependencies: entry.dependencies,
  };
}

export function buildIndexerPlannedMaterialAnswer(
  entry: ApprovedAnswerEntry,
): IndexerPlannedMaterialAnswer {
  if (entry.answer_landing_ref === undefined) {
    throw new TypeError("planned material answer requires an answer landing");
  }
  return buildIndexerPlannedMaterialAnswerProjection({
    question_key: indexerMaterialGapQuestionKey(entry),
    question_revision_digest: entry.question_revision_digest,
    answer_landing_ref: entry.answer_landing_ref,
    binding_digest: indexerMaterialAnswerBindingDigestFromLedgerEntry(entry),
    evidence_items: entry.answer.evidence,
  });
}

export function reopenIndexerMaterialAnswerBinding(input: {
  ledger: unknown;
  expected_revision: string;
  question_key: string;
  binding_digest: string;
}): IndexerMaterialGapLedger {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material answer reopen CAS predecessor is stale");
  }
  const entry = ledger.entries.find((item) =>
    indexerMaterialGapQuestionKey(item) === input.question_key
  );
  if (entry === undefined || (entry.state !== "answer-approved" && entry.state !== "resolved")) {
    throw new TypeError("material answer reopen requires an approved answer");
  }
  if (indexerMaterialAnswerBindingDigestFromLedgerEntry(entry) !== input.binding_digest) {
    throw new TypeError("material answer reopen binding is stale");
  }
  return replaceEntry({
    ledger,
    expected_revision: input.expected_revision,
    question_key: input.question_key,
    replacement: unresolvedEntry(entry),
  });
}

export function indexerMaterialAnswerActualizationDigest(input: {
  binding_digest: string;
  planned_answer_digest: string;
  answer_landing_ref: string;
  actualized_target_ref: string;
  section_ref?: string;
  layout_digest: string;
}): string {
  return indexerProtocolDigest(input);
}

export function actualizeIndexerMaterialAnswer(input: {
  ledger: unknown;
  expected_revision: string;
  question_key: string;
  binding_digest: string;
  layout_proposal: unknown;
  current_question_revision_digest: string;
  current_question: IndexerResolvedMaterialQuestion;
  current_provider_composition_fingerprints: ReadonlySet<string>;
  current_source_input_digests: readonly string[];
  current_sources: readonly IndexerCurrentEvidenceSource[];
  resolve_evidence_digest: (input: {
    source: IndexerCurrentEvidenceSource;
    source_spans: readonly IndexerSourceSpanRef[];
  }) => string;
}): {
  ledger: IndexerMaterialGapLedger;
  state: "resolved" | "answer-approved" | "unresolved";
  reason_codes: string[];
  evidence_compatibility: IndexerMaterialAnswerEvidenceCompatibility;
  layout_proposal_digest: string;
  planned_answer: IndexerPlannedMaterialAnswer | null;
} {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material answer actualization CAS predecessor is stale");
  }
  const layoutProposal = validateIndexerMaterialAnswerLayoutProposal(
    input.layout_proposal,
  );
  const entry = ledger.entries.find((item) =>
    indexerMaterialGapQuestionKey(item) === input.question_key
  );
  if (entry === undefined || (entry.state !== "answer-approved" && entry.state !== "resolved")) {
    throw new TypeError("material answer actualization requires an approved answer");
  }
  const expectedBinding = indexerMaterialAnswerBindingDigestFromLedgerEntry(entry);
  const plannedAnswer = entry.answer_landing_ref === undefined
    ? null
    : buildIndexerPlannedMaterialAnswer(entry);
  const compatibility = evaluateIndexerMaterialAnswerEvidenceCompatibility({
    question_key: input.question_key,
    question_revision_digest: input.current_question_revision_digest,
    question_contract_digest: entry.question_contract_digest,
    binding_digest: expectedBinding,
    expected_source_input_set_digest: entry.dependencies.source_input_set_digest,
    current_source_input_digests: input.current_source_input_digests,
    current_question: input.current_question,
    evidence: entry.answer.evidence,
    current_sources: input.current_sources,
    resolve_evidence_digest: input.resolve_evidence_digest,
  });
  const staleReasons: string[] = [];
  if (
    input.binding_digest !== expectedBinding ||
    input.current_question_revision_digest !== entry.question_revision_digest
  ) staleReasons.push("question-or-binding-stale");
  if (
    !input.current_provider_composition_fingerprints.has(
      entry.answer.answer_provider_composition_fingerprint,
    )
  ) staleReasons.push("provider-composition-stale");
  if (compatibility.state === "incompatible") {
    staleReasons.push(...compatibility.reason_codes);
  }
  const canonicalStaleReasons = [...new Set(staleReasons)].sort(
    compareIndexerCanonicalText,
  );
  if (canonicalStaleReasons.length > 0) {
    return {
      ledger: replaceEntry({
        ledger,
        expected_revision: input.expected_revision,
        question_key: input.question_key,
        replacement: unresolvedEntry(entry),
      }),
      state: "unresolved",
      reason_codes: canonicalStaleReasons,
      evidence_compatibility: compatibility,
      layout_proposal_digest: layoutProposal.proposal_digest,
      planned_answer: plannedAnswer,
    };
  }
  const matchingMappings = layoutProposal.landing_mappings.filter((mapping) =>
    mapping.answer_landing_ref === entry.answer_landing_ref
  );
  if (entry.answer_landing_ref === undefined || matchingMappings.length !== 1) {
    return {
      ledger: replaceEntry({
        ledger,
        expected_revision: input.expected_revision,
        question_key: input.question_key,
        replacement: unresolvedEntry(entry),
      }),
      state: "unresolved",
      reason_codes: [
        entry.answer_landing_ref === undefined
          ? "answer-landing-missing"
          : "answer-landing-not-unique",
      ],
      evidence_compatibility: compatibility,
      layout_proposal_digest: layoutProposal.proposal_digest,
      planned_answer: plannedAnswer,
    };
  }
  if (plannedAnswer === null) {
    throw new TypeError("material answer actualization requires a planned answer");
  }
  const mapping = matchingMappings[0]!;
  const actualizationPayload = {
    binding_digest: expectedBinding,
    planned_answer_digest: plannedAnswer.planned_answer_digest,
    answer_landing_ref: entry.answer_landing_ref,
    actualized_target_ref: mapping.actualized_target_ref,
    ...(mapping.section_ref === undefined ? {} : { section_ref: mapping.section_ref }),
    layout_digest: layoutProposal.layout_digest,
  };
  const replacement: IndexerMaterialGapLedgerEntry = {
    owner_cell_ref: entry.owner_cell_ref,
    question_ref: entry.question_ref,
    question_contract_digest: entry.question_contract_digest,
    question_subject_target_ref: entry.question_subject_target_ref,
    question_target_item_digest: entry.question_target_item_digest,
    answer_landing_ref: entry.answer_landing_ref,
    question_revision_digest: entry.question_revision_digest,
    state: "resolved",
    dependencies: entry.dependencies,
    answer: entry.answer,
    actualization: {
      actualized_target_ref: mapping.actualized_target_ref,
      ...(mapping.section_ref === undefined ? {} : { section_ref: mapping.section_ref }),
      layout_digest: layoutProposal.layout_digest,
      planned_answer_digest: plannedAnswer.planned_answer_digest,
      actualization_digest:
        indexerMaterialAnswerActualizationDigest(actualizationPayload),
    },
  };
  return {
    ledger: replaceEntry({
      ledger,
      expected_revision: input.expected_revision,
      question_key: input.question_key,
      replacement,
    }),
    state: "resolved",
    reason_codes: [],
    evidence_compatibility: compatibility,
    layout_proposal_digest: layoutProposal.proposal_digest,
    planned_answer: plannedAnswer,
  };
}

export function invalidateIndexerMaterialAnswerActualizations(input: {
  ledger: unknown;
  expected_revision: string;
  invalidated_layout_digest: string;
  affected_answer_landing_refs?: readonly string[];
}): {
  ledger: IndexerMaterialGapLedger;
  reopened_question_keys: string[];
} {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material answer layout invalidation CAS predecessor is stale");
  }
  const invalidatedLayoutDigest = indexerDigestSchema.parse(
    input.invalidated_layout_digest,
  );
  const affectedRefs = input.affected_answer_landing_refs === undefined
    ? undefined
    : new Set(input.affected_answer_landing_refs.map((ref) =>
      indexerCanonicalRefSchema.parse(ref)
    ));
  if (
    affectedRefs !== undefined &&
    affectedRefs.size !== input.affected_answer_landing_refs!.length
  ) {
    throw new TypeError("affected material-answer landing refs must be unique");
  }
  const reopenedQuestionKeys: string[] = [];
  const entries = ledger.entries.map((entry): IndexerMaterialGapLedgerEntry => {
    if (
      entry.state !== "resolved" ||
      entry.actualization.layout_digest !== invalidatedLayoutDigest ||
      (affectedRefs !== undefined && !affectedRefs.has(entry.answer_landing_ref!))
    ) return entry;
    reopenedQuestionKeys.push(indexerMaterialGapQuestionKey(entry));
    return {
      owner_cell_ref: entry.owner_cell_ref,
      question_ref: entry.question_ref,
      question_contract_digest: entry.question_contract_digest,
      question_subject_target_ref: entry.question_subject_target_ref,
      question_target_item_digest: entry.question_target_item_digest,
      answer_landing_ref: entry.answer_landing_ref,
      question_revision_digest: entry.question_revision_digest,
      state: "answer-approved",
      dependencies: entry.dependencies,
      answer: entry.answer,
    };
  });
  return {
    ledger: buildIndexerMaterialGapLedger({
      question_target_inventory_digest: ledger.question_target_inventory_digest,
      entries,
    }),
    reopened_question_keys: reopenedQuestionKeys.sort(compareIndexerCanonicalText),
  };
}

const approvedMaterialAnswerProjectionSchema = z.object({
  question_key: indexerCanonicalRefSchema,
  binding_digest: indexerDigestSchema,
  planned_answer_digest: indexerDigestSchema,
  actualization_digest: indexerDigestSchema,
  actualized_target_ref: indexerCanonicalRefSchema,
  section_ref: indexerCanonicalRefSchema.optional(),
  evidence_item_refs: z.array(indexerCanonicalRefSchema).min(1),
  evidence_set_digest: indexerDigestSchema,
}).strict();

export type IndexerApprovedMaterialAnswerProjection = z.infer<
  typeof approvedMaterialAnswerProjectionSchema
>;

function approvedMaterialAnswerProjectionKey(
  projection: IndexerApprovedMaterialAnswerProjection,
): string {
  return [projection.question_key, projection.binding_digest].join("\u0000");
}

export function closeIndexerResolvedMaterialAnswers(input: {
  ledger: unknown;
  expected_revision: string;
  approved_structure_bindings: readonly IndexerApprovedMaterialAnswerProjection[];
}): IndexerMaterialGapLedger {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material gap ledger CAS predecessor does not match current revision");
  }
  const approved = new Map(input.approved_structure_bindings.map((binding) => {
    const projection = approvedMaterialAnswerProjectionSchema.parse(binding);
    const evidenceRefs = projection.evidence_item_refs;
    if (
      new Set(evidenceRefs).size !== evidenceRefs.length ||
      canonicalIndexerJson(evidenceRefs) !== canonicalIndexerJson([...evidenceRefs].sort()) ||
      projection.evidence_set_digest !== indexerProtocolDigest({
        evidence_item_refs: evidenceRefs,
      })
    ) {
      throw new TypeError("approved material answer provenance is not canonical");
    }
    return [approvedMaterialAnswerProjectionKey(projection), projection] as const;
  }));
  if (approved.size !== input.approved_structure_bindings.length) {
    throw new TypeError("approved material answer structure bindings must be unique");
  }
  const entries = ledger.entries.filter((entry) => {
    if (entry.state !== "resolved") return true;
    const questionKey = indexerMaterialGapQuestionKey(entry);
    const bindingDigest = indexerMaterialAnswerBindingDigestFromLedgerEntry(entry);
    const key = [questionKey, bindingDigest].join("\u0000");
    const projection = approved.get(key);
    const evidenceRefs = entry.answer.evidence.map((item) => item.evidence_item_ref);
    if (
      projection === undefined ||
      projection.planned_answer_digest !== entry.actualization.planned_answer_digest ||
      projection.actualization_digest !== entry.actualization.actualization_digest ||
      projection.actualized_target_ref !== entry.actualization.actualized_target_ref ||
      projection.section_ref !== entry.actualization.section_ref ||
      canonicalIndexerJson(projection.evidence_item_refs) !==
        canonicalIndexerJson(evidenceRefs)
    ) {
      throw new TypeError("resolved material answer is absent from approved structure");
    }
    approved.delete(key);
    return false;
  });
  if (approved.size > 0) {
    throw new TypeError("approved structure references an unknown resolved material answer");
  }
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest: ledger.question_target_inventory_digest,
    entries,
  });
}
