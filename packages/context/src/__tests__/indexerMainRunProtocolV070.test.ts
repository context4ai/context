import { describe, expect, test } from "bun:test";
import {
  buildIndexerAgentStepInput,
  buildIndexerAgentStepResult,
  buildIndexerAuthorDependencyView,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerMainRunRequest,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  buildIndexerMainWorkset,
  buildIndexerWorksetReadReceipt,
  buildIndexerWorksetReadRequest,
  buildIndexerWorksetReadResponse,
  canonicalIndexerNodeRef,
  composeIndexerLayerInput,
  indexerArtifactResultDigest,
  indexerCapabilityGroupMemberIdsDigest,
  indexerLayerFragmentDigest,
  indexerInventoryMembersDigest,
  indexerPartitionPlanCanonicalHash,
  indexerPartitionStrategySetDigest,
  validateAndMaterializeIndexerLayerFragment,
  validateIndexerAgentStepResult,
  validateIndexerMainRunResult,
  type IndexerArtifactResult,
  type IndexerLayerFragment,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
  type IndexerMainRunRequest,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
  type IndexerSubjectKey,
  type IndexerWorksetReadReceipt,
} from "../index.js";
import { artifactPolicyEligibilityFixture } from "./indexerArtifactPolicyV070.fixture.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};
const PARTITION_SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component-library",
  local_key: "root",
};
const STRATEGY: IndexerPartitionStrategy = {
  kind: "project-indexer",
  indexer_id: "component-library",
  strategy_id: "component-family",
  implementation_digest: digest("a"),
};
const STRATEGY_DIGEST = digest("b");
const STRATEGIES = [{ strategy_ref: STRATEGY, strategy_digest: STRATEGY_DIGEST }];
const PROVIDER = {
  layer_ref: "provider:sample#layer:primary",
  integrity: digest("c"),
  bundle_digest: digest("d"),
  config_fingerprint: digest("e"),
  customization_fingerprint: null,
};
const MEMBER_REF = "member:export/button";
const INVENTORY = [{ member_id: MEMBER_REF, member_kind: "component" as const }];
const TARGET_REF = "question-target:public-contract";
const ELIGIBILITY = artifactPolicyEligibilityFixture();
type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;

const PRIMARY_EXECUTION_PROJECTION = buildIndexerPrimaryExecutionProjection({
  indexer_id: "component-library",
  primary_registry_projection_digest: digest("1"),
  program_digest: null,
  instructions_digest: digest("a"),
  template_set_digest: digest("b"),
  config_digest: PROVIDER.config_fingerprint,
  cli_contract_digest: digest("c"),
  profile_contract_digest: digest("4"),
  resources: [{
    layer_ref: PROVIDER.layer_ref,
    phase: "primary",
    kind: "instructions",
    ref: "bundle:sample/instructions/main.md",
    digest: digest("a"),
  }],
});

const common = {
  indexer_id: "component-library",
  requirement_ref: "requirement:public-knowledge",
  owner_cell_refs: ["owner-cell:public-knowledge#public-contract"],
  source_ref: "repo:sample@revision",
  module_ref: "module:packages/sample",
  primary_registry_projection_digest: digest("1"),
  requirement_set_digest: digest("2"),
  primary_execution_fingerprint:
    PRIMARY_EXECUTION_PROJECTION.primary_execution_fingerprint,
  profile_contract_digest: digest("4"),
  subject_key_schema_digest: digest("5"),
  source_scope_digest: digest("6"),
  parser_contract_digest: digest("7"),
  primary_resource_binding_digest:
    PRIMARY_EXECUTION_PROJECTION.primary_resource_binding_digest,
  question_target_inventory_digest: digest("9"),
};

function dependencyView() {
  const logicalUnitRef = canonicalIndexerNodeRef(SUBJECT);
  return buildIndexerAuthorDependencyView({
    source_ref: common.source_ref,
    module_ref: common.module_ref,
    logical_unit_ref: logicalUnitRef,
    positive_nodes: [{
      kind: "logical-unit",
      logical_unit_ref: logicalUnitRef,
      group_projection_digest: digest("c"),
      targets: [{ level: "logical-unit" }],
    }],
    negative_nodes: [{
      kind: "group-input-set",
      scope_ref: logicalUnitRef,
      set_digest: indexerInventoryMembersDigest(INVENTORY),
      targets: [{ level: "logical-unit" }],
    }],
  });
}

function partitionWorkset(): IndexerMainPartitionWorkset {
  const workset = buildIndexerMainWorkset({
    ...common,
    stage: "partition",
    partition_subject_key: PARTITION_SUBJECT,
    strategy_set_digest: indexerPartitionStrategySetDigest(STRATEGIES),
    reader_question_refs: ["question:public-contract"],
    partition_input_digests: [digest("f")],
    partition_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    allowed_question_target_refs: [TARGET_REF],
  });
  if (workset.stage !== "partition") throw new Error("expected partition");
  return workset;
}

function authorWorkset(
  requirementSetDigest = common.requirement_set_digest,
): IndexerMainAuthorWorkset {
  const view = dependencyView();
  const workset = buildIndexerMainWorkset({
    ...common,
    requirement_set_digest: requirementSetDigest,
    stage: "author",
    partition_plan_binding_digest: digest("a"),
    group_key: "component:button",
    logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest([MEMBER_REF]),
    member_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    group_projection_digest: digest("c"),
    group_dependency_view_digest: view.view_digest,
    allowed_artifact_policy_variants: ELIGIBILITY.eligible_variants.map((variant) => variant.id),
    artifact_policy_eligibility_digest: ELIGIBILITY.eligibility_digest,
  });
  if (workset.stage !== "author") throw new Error("expected author");
  return workset;
}

function request(workset: IndexerMainPartitionWorkset | IndexerMainAuthorWorkset) {
  return buildIndexerMainRunRequest({
    workset,
    ...(workset.stage === "partition"
      ? {
          partition_strategy_attempt: {
            strategy_order: 0,
            strategy_ref: STRATEGY,
            strategy_digest: STRATEGY_DIGEST,
            previous_attempt_digest: null,
          },
        }
      : {}),
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: PROVIDER.layer_ref,
      fragments: [],
    }),
    final_authority: PROVIDER,
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("a"),
      parser_dependency_fingerprint: digest("b"),
      source_role: "authoritative-source",
      source_precedence_digest: digest("c"),
      metric_set_digest: digest("d"),
      dependency_view_digest: workset.stage === "author"
        ? workset.group_dependency_view_digest
        : null,
      primary_execution_projection: PRIMARY_EXECUTION_PROJECTION,
    }),
  });
}

function readReceipt(
  workset: IndexerMainPartitionWorkset | IndexerMainAuthorWorkset,
): IndexerWorksetReadReceipt {
  const readRequest = buildIndexerWorksetReadRequest({
    workset_digest: workset.workset_digest,
    read_kind: "source",
    requested_refs: [workset.source_ref],
    allowed_refs: [workset.source_ref],
    page_size: 10,
  });
  const response = buildIndexerWorksetReadResponse({
    request: readRequest,
    items: [{ ref: workset.source_ref, value: { content: "export const value = 1;" } }],
  });
  return buildIndexerWorksetReadReceipt({ request: readRequest, responses: [response] });
}

function partitionPlan(workset: IndexerMainPartitionWorkset): IndexerPartitionPlan {
  const payload: Omit<CompletePartitionPlan, "canonical_hash"> = {
    protocol: "context.indexer.partition-plan/v1",
    status: "complete",
    binding: {
      partition_workset_digest: workset.workset_digest,
      indexer_id: workset.indexer_id,
      indexer_fingerprint: workset.primary_execution_fingerprint,
      requirement_digest: workset.requirement_set_digest,
      subject_key_schema_digest: workset.subject_key_schema_digest,
      source_scope_digest: workset.source_scope_digest,
      source_refs: [workset.source_ref],
      module_ref: workset.module_ref,
      partition_subject_key: workset.partition_subject_key,
      parent_scope_ref: workset.module_ref!,
      inventory_digest: workset.partition_inventory_digest,
      question_target_inventory_digest: workset.question_target_inventory_digest,
    },
    strategy_ref: STRATEGY,
    strategy_digest: STRATEGY_DIGEST,
    unit_type: "component-family",
    partition_axis: "canonical-export-root",
    reader_question_refs: workset.reader_question_refs,
    groups: [{
      group_key: "component:button",
      subject_key: SUBJECT,
      subject_intent: "primary",
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      label: "Button",
      reader_question_refs: workset.reader_question_refs,
      question_target_bindings: [{
        target_ref: TARGET_REF,
        role: "primary-carrier",
      }],
      member_ids: [MEMBER_REF],
    }],
    member_dispositions: [{
      member_id: MEMBER_REF,
      member_kind: "component",
      inventory_disposition: "owned",
      group_key: "component:button",
    }],
    failure: null,
  };
  return { ...payload, canonical_hash: indexerPartitionPlanCanonicalHash(payload) };
}

function artifactResult(currentRequest: IndexerMainRunRequest): IndexerArtifactResult {
  if (currentRequest.workset.stage !== "author") throw new Error("expected author request");
  const workset = currentRequest.workset;
  const payload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: workset.workset_digest,
    partition_plan_binding_digest: workset.partition_plan_binding_digest,
    group_projection_digest: workset.group_projection_digest,
    indexer_id: workset.indexer_id,
    provider_layer_ref: PROVIDER.layer_ref,
    provider_integrity: PROVIDER.integrity,
    provider_bundle_digest: PROVIDER.bundle_digest,
    config_fingerprint: PROVIDER.config_fingerprint,
    customization_fingerprint: null,
    requirement_ref: workset.requirement_ref,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: workset.group_key,
      subject_key: SUBJECT,
      logical_unit_ref: workset.logical_unit_ref,
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: [MEMBER_REF],
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      dispositions: [{
        member_id: MEMBER_REF,
        member_kind: "component",
        inventory_disposition: "unsupported",
        missing_capabilities: ["reader-projection"],
      }],
    }),
    facts: [],
    evidence_bindings: [],
    artifacts: [],
    artifact_bundle: null,
    material_question_proposals: [],
    question_target_dispositions: [],
    diagnostics: [{ code: "no-output-required", message: "No reader Artifact is required." }],
    input_digest: currentRequest.execution_request_digest,
  };
  return { ...payload, output_digest: indexerArtifactResultDigest(payload) };
}

describe("main Indexer run protocol", () => {
  test("validates a partition Result only against a partition request", () => {
    const workset = partitionWorkset();
    const currentRequest = request(workset);
    const receipt = readReceipt(workset);
    const result = {
      protocol: "context.indexer.run-result/v1",
      operation: "main-index",
      consumed_input_view_digest: currentRequest.composition_input.view_digest,
      workset_read_receipt_digests: [receipt.receipt_digest],
      result: {
        protocol: "context.indexer.main-result/v1",
        stage: "partition",
        workset_digest: workset.workset_digest,
        execution_request_digest: currentRequest.execution_request_digest,
        result: partitionPlan(workset),
      },
    };
    const validated = validateIndexerMainRunResult({
      request: currentRequest,
      result,
      workset_read_receipts: [receipt],
      validation: {
        stage: "partition",
        canonical_inventory_members: INVENTORY,
        authorized_source_refs: [workset.source_ref],
        authorized_strategies: STRATEGIES,
        required_question_target_refs: [TARGET_REF],
      },
    });
    expect(validated.operation_result).toEqual(result.result.result);
    expect(validated.authoring_audit).toBeNull();
    expect(validated.artifact_dependency_set).toBeNull();
  });

  test("validates an author ArtifactResult and consumed InputView digest", () => {
    const workset = authorWorkset();
    const currentRequest = request(workset);
    const receipt = readReceipt(workset);
    const artifact = artifactResult(currentRequest);
    const result = {
      protocol: "context.indexer.run-result/v1",
      operation: "main-index",
      consumed_input_view_digest: currentRequest.composition_input.view_digest,
      workset_read_receipt_digests: [receipt.receipt_digest],
      result: {
        protocol: "context.indexer.main-result/v1",
        stage: "author",
        workset_digest: workset.workset_digest,
        execution_request_digest: currentRequest.execution_request_digest,
        result: artifact,
      },
    };
    const validated = validateIndexerMainRunResult({
      request: currentRequest,
      result,
      workset_read_receipts: [receipt],
      validation: {
        stage: "author",
        dependency_view: dependencyView(),
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: ELIGIBILITY,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [],
      },
    });
    expect(validated.operation_result).toEqual(artifact);
    expect(validated.authoring_audit).toMatchObject({
      protocol: "context.indexer.generated-authoring-audit/v1",
      hard_findings: [],
      agent_review_required: false,
      semantic_prose_review_targets: [],
    });
    expect(validated.artifact_dependency_set).toMatchObject({
      protocol: "context.indexer.artifact-dependency-set/v1",
      result_digest: artifact.output_digest,
      author_workset_digest: workset.workset_digest,
      logical_unit_ref: artifact.logical_unit.logical_unit_ref,
      artifacts: [],
      negative_dependencies: [{
        kind: "group-input-set",
        set_digest: indexerInventoryMembersDigest(INVENTORY),
      }],
    });

    result.consumed_input_view_digest = digest("0");
    expect(() => validateIndexerMainRunResult({
      request: currentRequest,
      result,
      workset_read_receipts: [receipt],
      validation: {
        stage: "author",
        dependency_view: dependencyView(),
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: ELIGIBILITY,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [],
      },
    })).toThrow(/request\/stage\/input view/);

    result.consumed_input_view_digest = currentRequest.composition_input.view_digest;
    result.workset_read_receipt_digests = [digest("1")];
    expect(() => validateIndexerMainRunResult({
      request: currentRequest,
      result,
      workset_read_receipts: [receipt],
      validation: {
        stage: "author",
        dependency_view: dependencyView(),
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: ELIGIBILITY,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [],
      },
    })).toThrow(/CLI-issued read receipt set/);
  });

  test("does not accept an extractor Result bound to a reduced requirement set", () => {
    const reducedRequest = request(authorWorkset(digest("0")));
    const confirmedRequest = request(authorWorkset(common.requirement_set_digest));
    const confirmedReceipt = readReceipt(confirmedRequest.workset);
    const reducedArtifact = artifactResult(reducedRequest);
    const reducedResult = {
      protocol: "context.indexer.run-result/v1",
      operation: "main-index",
      consumed_input_view_digest: reducedRequest.composition_input.view_digest,
      workset_read_receipt_digests: [confirmedReceipt.receipt_digest],
      result: {
        protocol: "context.indexer.main-result/v1",
        stage: "author",
        workset_digest: reducedRequest.workset.workset_digest,
        execution_request_digest: reducedRequest.execution_request_digest,
        result: reducedArtifact,
      },
    };

    expect(reducedRequest.workset.workset_digest).not.toBe(
      confirmedRequest.workset.workset_digest,
    );
    expect(() => validateIndexerMainRunResult({
      request: confirmedRequest,
      result: reducedResult,
      workset_read_receipts: [confirmedReceipt],
      validation: {
        stage: "author",
        dependency_view: dependencyView(),
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: ELIGIBILITY,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [],
      },
    })).toThrow(/request\/stage\/input view|workset/);
  });

  test("pre-authority payload changes the execution request identity", () => {
    const workset = authorWorkset();
    const emptyRequest = request(workset);
    const fragmentPayload: Omit<IndexerLayerFragment, "fragment_digest"> = {
      protocol: "context.indexer.layer-fragment/v1",
      workset_digest: workset.workset_digest,
      layer_ref: "provider:extension#layer:supporting",
      layer_integrity: digest("a"),
      phase: "pre-authority",
      kind: "template-variables",
      target_refs: [workset.logical_unit_ref],
      payload: {
        protocol: "context.indexer.fragment.template-variables/v1",
        variables: [{
          target_ref: workset.logical_unit_ref,
          template_id: "overview",
          variable_id: "summary",
          value: "enriched",
          evidence_refs: [],
        }],
      },
    };
    const fragment: IndexerLayerFragment = {
      ...fragmentPayload,
      fragment_digest: indexerLayerFragmentDigest(fragmentPayload),
    };
    const materialized = validateAndMaterializeIndexerLayerFragment({
      fragment,
      expected_workset_digest: workset.workset_digest,
      expected_layer_ref: fragment.layer_ref,
      expected_layer_integrity: fragment.layer_integrity,
      allowed_kinds: ["template-variables"],
      allowed_target_refs: [workset.logical_unit_ref],
      validator_contract_digest: digest("b"),
    });
    const enrichedRequest = buildIndexerMainRunRequest({
      workset,
      composition_input: composeIndexerLayerInput({
        workset_digest: workset.workset_digest,
        final_authority_layer_ref: PROVIDER.layer_ref,
        fragments: [materialized],
      }),
      final_authority: PROVIDER,
      run_environment: emptyRequest.run_environment,
    });
    expect(enrichedRequest.composition_input.view_digest).not.toBe(
      emptyRequest.composition_input.view_digest,
    );
    expect(enrichedRequest.execution_request_digest).not.toBe(
      emptyRequest.execution_request_digest,
    );
  });

  test("rejects a stage swap, forged request digest, and extension fragment envelope", () => {
    const currentRequest = request(authorWorkset());
    const receipt = readReceipt(currentRequest.workset);
    expect(() => buildIndexerMainRunRequest({
      workset: currentRequest.workset,
      composition_input: currentRequest.composition_input,
      final_authority: { ...PROVIDER, config_fingerprint: digest("0") },
      run_environment: currentRequest.run_environment,
    })).toThrow(/config does not match final authority/);

    const staleProjection = buildIndexerPrimaryExecutionProjection({
      indexer_id: "component-library",
      primary_registry_projection_digest: digest("1"),
      program_digest: null,
      instructions_digest: digest("f"),
      template_set_digest: digest("b"),
      config_digest: PROVIDER.config_fingerprint,
      cli_contract_digest: digest("c"),
      profile_contract_digest: digest("4"),
      resources: PRIMARY_EXECUTION_PROJECTION.resources,
    });
    const {
      protocol: _environmentProtocol,
      environment_digest: _environmentDigest,
      ...environmentInput
    } = currentRequest.run_environment;
    void _environmentProtocol;
    void _environmentDigest;
    expect(() => buildIndexerMainRunRequest({
      workset: currentRequest.workset,
      composition_input: currentRequest.composition_input,
      final_authority: PROVIDER,
      run_environment: buildIndexerRunEnvironment({
        ...environmentInput,
        primary_execution_projection: staleProjection,
      }),
    })).toThrow(/primary execution projection does not match its workset/);

    const forged = structuredClone(currentRequest);
    forged.execution_request_digest = digest("0");
    expect(() => validateIndexerMainRunResult({
      request: forged,
      result: {},
      workset_read_receipts: [receipt],
      validation: {
        stage: "author",
        dependency_view: dependencyView(),
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: ELIGIBILITY,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [],
      },
    })).toThrow(/execution request digest/);

    expect(() => validateIndexerMainRunResult({
      request: currentRequest,
      result: {
        protocol: "context.indexer.layer-fragment-result/v1",
        request_digest: currentRequest.execution_request_digest,
        fragments: [],
        result_digest: digest("1"),
      },
      workset_read_receipts: [receipt],
      validation: {
        stage: "author",
        dependency_view: dependencyView(),
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: ELIGIBILITY,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [],
      },
    })).toThrow();
  });

  test("separates stable Agent output identity from runtime execution provenance", () => {
    const workset = partitionWorkset();
    const currentRequest = request(workset);
    const receipt = readReceipt(workset);
    const runResult = {
      protocol: "context.indexer.run-result/v1" as const,
      operation: "main-index" as const,
      consumed_input_view_digest: currentRequest.composition_input.view_digest,
      workset_read_receipt_digests: [receipt.receipt_digest],
      result: {
        protocol: "context.indexer.main-result/v1" as const,
        stage: "partition" as const,
        workset_digest: workset.workset_digest,
        execution_request_digest: currentRequest.execution_request_digest,
        result: partitionPlan(workset),
      },
    };
    const stepInput = buildIndexerAgentStepInput({
      run_request: currentRequest,
      instruction_request_digest: digest("e"),
    });
    const first = buildIndexerAgentStepResult({
      step_input: stepInput,
      instruction_payload_digest: digest("f"),
      run_result: runResult,
      adapter: "codex",
      adapter_version: "1.2.3",
      model: "example-model",
      execution_id: "execution-1",
    });
    const resumed = buildIndexerAgentStepResult({
      step_input: stepInput,
      instruction_payload_digest: digest("f"),
      run_result: runResult,
      adapter: "codex",
      adapter_version: "1.2.3",
      model: "example-model",
      execution_id: "execution-2",
    });
    expect(first.stable_result_digest).toBe(resumed.stable_result_digest);
    expect(first.execution_receipt.receipt_digest).not.toBe(
      resumed.execution_receipt.receipt_digest,
    );
    expect(validateIndexerAgentStepResult({
      step_input: stepInput,
      result: first,
      expected_instruction_payload_digest: digest("f"),
    })).toEqual(first);
    expect(() => validateIndexerAgentStepResult({
      step_input: stepInput,
      result: first,
      expected_instruction_payload_digest: digest("0"),
    })).toThrow(/stale/);
  });
});
