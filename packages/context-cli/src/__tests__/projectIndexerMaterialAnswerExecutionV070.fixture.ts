import {
  buildIndexerMaterialAnswerExecutionPlan,
  buildIndexerMaterialGapLedger,
  buildIndexerMaterialQuestionWorkset,
  buildIndexerQuestionTargetInventory,
  composeIndexerLayerInput,
  canonicalOwnerCellRef,
  indexerMaterialAnswerResultDigest,
  indexerMaterialAnswerProviderCompositionFingerprint,
  indexerMaterialAnswerSourceInputSetDigest,
  indexerProtocolDigest,
  indexerResolvedMaterialQuestionDigest,
  parseIndexerRegistry,
  type IndexerMaterialAnswerResult,
  type IndexerResolvedMaterialQuestion,
} from "@c4a/context";

export const digest = (character: string) => `sha256:${character.repeat(64)}`;
export const REQUIREMENT_REF = "requirement:public-knowledge";
export const OWNER_REF = canonicalOwnerCellRef({
  requirementRef: "public-knowledge",
  coverageDomain: "operations",
  sourceRef: "repo:sample",
  moduleRef: "module:packages/sample",
});
export const QUESTION_REF = "question:failure-recovery";
export const MATERIAL_PROVIDER_INTEGRITY = digest("4");
export const OWNER_CELL_DIGEST = indexerProtocolDigest({
  owner_cell_ref: OWNER_REF,
  owner_indexer_ids: [],
});

export function resolvedQuestion(): IndexerResolvedMaterialQuestion {
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

export function materialRegistry() {
  const currentQuestion = resolvedQuestion();
  return parseIndexerRegistry(JSON.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "public-knowledge",
      reader_goals: ["understand-operations"],
      coverage_domains: { operations: "required" },
      questions: [{
        ref: currentQuestion.ref,
        authority: currentQuestion.authority,
        contract_version: currentQuestion.contract_version,
        contract_digest: currentQuestion.contract_digest,
      }],
      target_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:packages/sample"] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "source:runbook", module_refs: [] }],
      },
      exclusions: [],
    }],
    indexers: [{
      id: "answer-indexer",
      operations: ["material-answer"],
      requirement_bindings: [{
        requirement_ref: "public-knowledge",
        coverage_domains: ["operations"],
        owned_scope: { ref: "requirement:public-knowledge#target_scope" },
        role: "enricher",
      }],
      read_scope: { refs: ["requirement:public-knowledge#evidence_source_scope"] },
      profile: {
        primary: { id: "domain-reference", provider: "answer-provider", variants: {} },
        additional: [],
        composers: [],
      },
      providers: [{
        id: "answer-provider",
        role: "primary",
        skill: "context-indexer-answer",
        version: "1.0.0",
        integrity: MATERIAL_PROVIDER_INTEGRITY,
        distribution: {
          kind: "workspace",
          locator: "workspace://skills/context-indexer-answer",
        },
      }],
    }],
  }));
}

export function inventory(requirementSetDigest = digest("b")) {
  return buildIndexerQuestionTargetInventory({
    requirement_set_digest: requirementSetDigest,
    profile_contract_digests: [digest("c")],
    source_inventory_digests: [digest("d")],
    items: [{
      target_domain_ref: "component",
      requirement_ref: REQUIREMENT_REF,
      owner_cell_ref: OWNER_REF,
      source_ref: "repo:sample@revision",
      module_ref: "module:packages/sample",
      subject_key: {
        protocol: "context.subject-key/v1",
        namespace: "sample-package",
        kind: "component",
        local_key: "button",
      },
      canonical_fact_slice_digest: digest("e"),
    }],
  });
}

export function materialLedger(requirementSetDigest = digest("b")) {
  const targetInventory = inventory(requirementSetDigest);
  const provisional = materialWorkset({
    predecessor: digest("0"),
    requirementSetDigest,
  });
  const item = provisional.items[0]!;
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest: targetInventory.inventory_digest,
    entries: [{
      owner_cell_ref: item.question.owner_cell_ref,
      question_ref: item.question.question_ref,
      question_contract_digest: item.question_contract_digest,
      question_subject_target_ref: item.question.question_subject_target_ref,
      question_target_item_digest: item.question.question_target_item_digest,
      answer_landing_ref: item.question.answer_landing_ref,
      question_revision_digest: item.question_revision_digest,
      state: "unresolved",
      dependencies: {
        requirement_digest: requirementSetDigest,
        owner_cell_digest: OWNER_CELL_DIGEST,
        emitted_question_digest: digest("3"),
        answer_landing_dependency_digest: indexerProtocolDigest({
          answer_landing_ref: item.question.answer_landing_ref,
        }),
        source_input_set_digest: indexerMaterialAnswerSourceInputSetDigest([digest("2")]),
      },
    }],
  });
}

export function materialWorkset(input: {
  predecessor: string;
  requirementSetDigest?: string;
  registryDigest?: string;
  eligible?: boolean;
}) {
  const requirementSetDigest = input.requirementSetDigest ?? digest("b");
  const targetInventory = inventory(requirementSetDigest);
  const targetRef = targetInventory.items[0]!.target_ref;
  return buildIndexerMaterialQuestionWorkset({
    question_target_inventory: targetInventory,
    resolved_questions: [{
      requirement_ref: REQUIREMENT_REF,
      question: resolvedQuestion(),
    }],
    owner_cells: [{
      owner_cell_ref: OWNER_REF,
      owner_cell_digest: OWNER_CELL_DIGEST,
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
      authorized_source_refs: input.eligible === false ? [] : ["source:runbook"],
      candidates: input.eligible === false ? [] : [{
        indexer_id: "answer-indexer",
        operations: ["material-answer"],
        requirement_binding_role: "enricher",
        provider_operation_supported: true,
        supported_evidence_kinds: ["runbook"],
      }],
    }],
    predecessor_ledger_revision: input.predecessor,
    registry_digest: input.registryDigest ?? digest("1"),
    requirement_set_digest: requirementSetDigest,
    source_input_digests: [digest("2")],
  });
}

export const SOURCE = {
  source_ref: "source:runbook",
  source_origin_ref: "origin:runbook",
  source_input_digest: digest("2"),
  source_role: "runbook",
  evidence_kinds: ["runbook"] as const,
  span_unit: "line" as const,
  span_extent: 100,
  snapshot_current: true as const,
  locator_valid: true as const,
  tool_trust: "verified",
};

export function executionPlan(input?: { emptyEligibility?: boolean }) {
  const ledger = materialLedger();
  const workset = materialWorkset({
    predecessor: ledger.revision,
    eligible: input?.emptyEligibility !== true,
  });
  const authority = {
    answer_indexer_id: "answer-indexer",
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: "provider:answer#layer:primary",
      fragments: [],
    }),
    final_authority: {
      layer_ref: "provider:answer#layer:primary",
      integrity: digest("a"),
      bundle_digest: digest("b"),
      config_fingerprint: digest("c"),
      customization_fingerprint: null,
    },
  };
  return buildIndexerMaterialAnswerExecutionPlan({
    workset,
    authorities: input?.emptyEligibility === true ? [] : [{
      ...authority,
      answer_provider_composition_fingerprint:
        indexerMaterialAnswerProviderCompositionFingerprint(authority),
    }],
  });
}

export function materialRunResult(input: {
  plan: ReturnType<typeof executionPlan>;
  empty?: boolean;
}) {
  const run = input.plan.runs[0]!;
  const item = run.request.workset.items[0]!;
  const payload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
    protocol: "context.indexer.material-answer-result/v1",
    workset_digest: input.plan.workset_digest,
    execution_request_digest: run.request.execution_request_digest,
    answer_indexer_id: run.answer_indexer_id,
    answer_provider_composition_fingerprint:
      run.request.answer_provider_composition_fingerprint,
    bindings: input.empty === true ? [] : [{
      workset_digest: input.plan.workset_digest,
      question_key: item.question_key,
      question_revision_digest: item.question_revision_digest,
      evidence_claims: [{
        kind: "runbook",
        source_ref: SOURCE.source_ref,
        source_spans: [{ unit: "line", start: 10, end_exclusive: 20 }],
        evidence_digest: digest("6"),
      }],
    }],
  };
  return {
    protocol: "context.indexer.run-result/v1" as const,
    operation: "material-answer" as const,
    consumed_input_view_digest: run.request.composition_input.view_digest,
    result: { ...payload, result_digest: indexerMaterialAnswerResultDigest(payload) },
  };
}
