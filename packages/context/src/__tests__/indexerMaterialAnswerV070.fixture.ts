import {
  approveIndexerMaterialAnswer,
  buildIndexerMaterialAnswerBaselineReport,
  buildIndexerMaterialAnswerLayoutProposal,
  buildIndexerMaterialGapLedger,
  buildIndexerMaterialQuestionWorkset,
  buildIndexerQuestionTargetInventory,
  decideIndexerMaterialAnswerReview,
  indexerMaterialAnswerResultDigest,
  indexerMaterialAnswerSourceInputSetDigest,
  indexerMaterialGapQuestionKey,
  indexerProtocolDigest,
  indexerResolvedMaterialQuestionDigest,
  validateIndexerMaterialAnswerResult,
  type IndexerCurrentEvidenceSource,
  type IndexerMaterialAnswerResult,
  type IndexerMaterialGapLedger,
  type IndexerMaterialGapLedgerEntry,
  type IndexerResolvedMaterialQuestion,
  type IndexerSubjectKey,
  type IndexerUnresolvedMaterialGap,
} from "../index.js";

export const digest = (character: string) => `sha256:${character.repeat(64)}`;
export const REQUIREMENT_REF = "requirement:public-knowledge";
export const OWNER_REF = "owner-cell:public-knowledge#operations";
export const QUESTION_REF = "question:failure-recovery";

const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};

export function question(): IndexerResolvedMaterialQuestion {
  const payload: Omit<IndexerResolvedMaterialQuestion, "contract_digest"> = {
    ref: QUESTION_REF,
    authority: {
      kind: "cli-base-contract",
      ref: "contract:community-profile",
      digest: digest("a"),
    },
    contract_version: 1,
    semantic: "How does this capability recover from failure?",
    coverage_domain: "operations",
    target_domain_ref: "component",
    target_selector: {
      protocol: "context.indexer.selector/v1",
      expression: { op: "equals", fact: "target.visibility", value: "public" },
    },
    evidence_contract: {
      accepted_kinds: ["runbook"],
      minimum_items: 1,
      minimum_distinct_sources: 1,
    },
    allowed_exclusion_reason_codes: ["not-applicable"],
  };
  return { ...payload, contract_digest: indexerResolvedMaterialQuestionDigest(payload) };
}

export function inventory() {
  return buildIndexerQuestionTargetInventory({
    requirement_set_digest: digest("b"),
    profile_contract_digests: [digest("c")],
    source_inventory_digests: [digest("d")],
    items: [{
      target_domain_ref: "component",
      requirement_ref: REQUIREMENT_REF,
      owner_cell_ref: OWNER_REF,
      source_ref: "repo:sample@revision",
      module_ref: "module:packages/sample",
      subject_key: SUBJECT,
      canonical_fact_slice_digest: digest("e"),
    }],
  });
}

export function workset(predecessor: string) {
  const targetInventory = inventory();
  const targetRef = targetInventory.items[0]!.target_ref;
  const currentQuestion = question();
  return buildIndexerMaterialQuestionWorkset({
    question_target_inventory: targetInventory,
    resolved_questions: [{ requirement_ref: REQUIREMENT_REF, question: currentQuestion }],
    owner_cells: [{
      owner_cell_ref: OWNER_REF,
      owner_cell_digest: digest("f"),
      requirement_ref: REQUIREMENT_REF,
      coverage_domain: "operations",
      domain_state: "required",
    }],
    target_facts: { [targetRef]: { target: { visibility: "public" } } },
    allowed_selector_fact_paths: new Set(["target.visibility"]),
    routes: [{
      requirement_ref: REQUIREMENT_REF,
      question_ref: QUESTION_REF,
      target_ref: targetRef,
      authorized_source_refs: ["source:runbook"],
      candidates: [{
        indexer_id: "answer-indexer",
        operations: ["material-answer"],
        requirement_binding_role: "enricher",
        provider_operation_supported: true,
        supported_evidence_kinds: ["runbook"],
      }],
    }],
    predecessor_ledger_revision: predecessor,
    registry_digest: digest("1"),
    requirement_set_digest: digest("b"),
    source_input_digests: [digest("2")],
  });
}

export function unresolvedEntry(): IndexerUnresolvedMaterialGap {
  const provisional = workset(digest("0"));
  const item = provisional.items[0]!;
  return {
    owner_cell_ref: item.question.owner_cell_ref,
    question_ref: item.question.question_ref,
    question_contract_digest: item.question_contract_digest,
    question_subject_target_ref: item.question.question_subject_target_ref,
    question_target_item_digest: item.question.question_target_item_digest,
    answer_landing_ref: item.question.answer_landing_ref,
    question_revision_digest: item.question_revision_digest,
    state: "unresolved",
    dependencies: {
      requirement_digest: digest("b"),
      owner_cell_digest: digest("f"),
      emitted_question_digest: digest("3"),
      answer_landing_dependency_digest: indexerProtocolDigest({
        answer_landing_ref: item.question.answer_landing_ref,
      }),
      source_input_set_digest: indexerMaterialAnswerSourceInputSetDigest([
        digest("2"),
      ]),
    },
  };
}

export function ledger(
  entries: IndexerMaterialGapLedgerEntry[] = [unresolvedEntry()],
) {
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest: inventory().inventory_digest,
    entries,
  });
}

export const SOURCE: IndexerCurrentEvidenceSource = {
  source_ref: "source:runbook",
  source_origin_ref: "origin:runbook",
  source_input_digest: digest("2"),
  source_role: "runbook",
  evidence_kinds: ["runbook"],
  span_unit: "line",
  span_extent: 100,
  snapshot_current: true,
  locator_valid: true,
  tool_trust: "verified",
};

export function candidate(currentLedger: IndexerMaterialGapLedger) {
  const currentWorkset = workset(currentLedger.revision);
  const payload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
    protocol: "context.indexer.material-answer-result/v1",
    workset_digest: currentWorkset.workset_digest,
    execution_request_digest: digest("4"),
    answer_indexer_id: "answer-indexer",
    answer_provider_composition_fingerprint: digest("5"),
    bindings: [{
      workset_digest: currentWorkset.workset_digest,
      question_key: currentWorkset.items[0]!.question_key,
      question_revision_digest: currentWorkset.items[0]!.question_revision_digest,
      evidence_claims: [{
        kind: "runbook",
        source_ref: SOURCE.source_ref,
        source_spans: [{ unit: "line", start: 10, end_exclusive: 20 }],
        evidence_digest: digest("6"),
      }],
    }],
  };
  const answerResult = {
    ...payload,
    result_digest: indexerMaterialAnswerResultDigest(payload),
  };
  const candidateSet = validateIndexerMaterialAnswerResult({
    result: answerResult,
    workset: currentWorkset,
    expected_execution_request_digest: digest("4"),
    expected_provider_composition_fingerprint: digest("5"),
    current_sources: [SOURCE],
    resolve_evidence_digest: () => digest("6"),
  }).candidate_set;
  return { currentWorkset, candidateSet };
}

export function approve(currentLedger = ledger()) {
  const { currentWorkset, candidateSet } = candidate(currentLedger);
  const baselineReport = buildIndexerMaterialAnswerBaselineReport({
    workset: currentWorkset,
    candidate_set: candidateSet,
    question_key: currentWorkset.items[0]!.question_key,
  });
  const reviewDecision = decideIndexerMaterialAnswerReview({
    baseline_report: baselineReport,
    decision: "approved",
  });
  const approved = approveIndexerMaterialAnswer({
    ledger: currentLedger,
    workset: currentWorkset,
    candidate_set: candidateSet,
    baseline_report: baselineReport,
    review_decision: reviewDecision,
  });
  return {
    ...approved,
    workset: currentWorkset,
    candidateSet,
    baselineReport,
    reviewDecision,
  };
}

export function proposal(
  landingMappings: Array<{
    answer_landing_ref: string;
    actualized_target_ref: string;
    section_ref?: string;
  }>,
  layoutDigest = digest("8"),
) {
  return buildIndexerMaterialAnswerLayoutProposal({
    layout_digest: layoutDigest,
    landing_mappings: landingMappings,
  });
}

export function actualizationAuthority() {
  return {
    current_question_revision_digest: workset(digest("0")).items[0]!
      .question_revision_digest,
    current_question: question(),
    current_provider_composition_fingerprints: new Set([digest("5")]),
    current_source_input_digests: [digest("2")],
    current_sources: [SOURCE],
    resolve_evidence_digest: () => digest("6"),
  };
}

export function questionKey(currentLedger: IndexerMaterialGapLedger): string {
  return indexerMaterialGapQuestionKey(currentLedger.entries[0]!);
}
