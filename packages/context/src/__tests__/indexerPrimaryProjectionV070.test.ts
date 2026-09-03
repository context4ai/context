import { describe, expect, test } from "bun:test";
import {
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerRunEnvironment,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerPrimaryRegistryProjection,
  canonicalIndexerNodeRef,
  composeIndexerLayerInput,
  indexerArtifactResultDigest,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  resolveEffectiveIndexerComposers,
  type IndexerRegistry,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};
const MEMBER_REF = "member:button";
const INVENTORY = [{ member_id: MEMBER_REF, member_kind: "component" as const }];

const REGISTRY_YAML = `
protocol: context.indexer.registry/v1
requirements:
  - id: public-knowledge
    reader_goals: [understand-api]
    coverage_domains:
      public_contract: required
      operations: optional
    target_scope:
      targets:
        - source_ref: repo:sample
          module_refs: [module:sample]
    evidence_source_scope:
      targets:
        - source_ref: repo:sample
          module_refs: [module:sample]
indexers:
  - id: component-library
    operations: [main-index]
    requirement_bindings:
      - requirement_ref: public-knowledge
        coverage_domains: [public_contract, operations]
        owned_scope:
          ref: requirement:public-knowledge#target_scope
        role: primary
    read_scope:
      refs: [requirement:public-knowledge#target_scope]
    profile:
      primary:
        id: component-library
        provider: community
        variants:
          application_mode: library
      additional: []
      composers: []
    providers:
      - id: community
        role: primary
        skill: context-indexer-code
        version: 1.0.0
        integrity: ${digest("1")}
        distribution:
          kind: cli-bundled
          locator: cli-bundled://context/context-indexer-code
        config:
          public_entry: src/index.ts
      - id: extension
        role: extension
        skill: context-indexer-examples
        version: 1.0.0
        integrity: ${digest("2")}
        distribution:
          kind: cli-bundled
          locator: cli-bundled://context/context-indexer-examples
`;

function registryWithComposer(): IndexerRegistry {
  const registry = structuredClone(parseIndexerRegistry(REGISTRY_YAML));
  registry.indexers[0]!.profile.composers = [{
    id: "examples",
    provider: "extension",
  }];
  return registry;
}

function primary(registry: IndexerRegistry, resourceDigest = digest("8")) {
  const registryProjection = buildIndexerPrimaryRegistryProjection({
    registry,
    indexer_id: "component-library",
  });
  const executionProjection = buildIndexerPrimaryExecutionProjection({
    indexer_id: "component-library",
    primary_registry_projection_digest: registryProjection.projection_digest,
    program_digest: digest("3"),
    instructions_digest: digest("4"),
    template_set_digest: digest("5"),
    config_digest: digest("6"),
    cli_contract_digest: digest("7"),
    profile_contract_digest: digest("9"),
    resources: [{
      layer_ref: "provider:community#layer:primary",
      phase: "primary",
      kind: "instructions",
      ref: "bundle:community/instructions/main.md",
      digest: resourceDigest,
    }],
  });
  return { registryProjection, executionProjection };
}

function worksets(registry: IndexerRegistry, resourceDigest = digest("8")) {
  const projections = primary(registry, resourceDigest);
  const common = {
    indexer_id: "component-library",
    requirement_ref: "requirement:public-knowledge",
    owner_cell_refs: ["owner-cell:public-knowledge#public-contract"],
    source_ref: "repo:sample",
    module_ref: "module:sample",
    primary_registry_projection_digest:
      projections.registryProjection.projection_digest,
    requirement_set_digest: digest("a"),
    primary_execution_fingerprint:
      projections.executionProjection.primary_execution_fingerprint,
    profile_contract_digest: digest("9"),
    subject_key_schema_digest: digest("b"),
    source_scope_digest: digest("c"),
    source_binding_digest: digest("d"),
    primary_resource_binding_digest:
      projections.executionProjection.primary_resource_binding_digest,
    question_target_inventory_digest: digest("e"),
  };
  const partitionStrategy = {
    strategy_ref: {
      kind: "cli-builtin" as const,
      strategy_id: "module-root",
      implementation_digest: digest("f"),
    },
    strategy_digest: digest("0"),
  };
  const partition = buildIndexerMainWorkset({
    ...common,
    stage: "partition",
    partition_subject_key: {
      ...SUBJECT,
      kind: "component-library",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest([partitionStrategy]),
    reader_question_refs: ["question:public-contract"],
    partition_input_digests: [digest("0")],
    partition_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    allowed_question_target_refs: ["question-target:public-contract"],
  });
  const author = buildIndexerMainWorkset({
    ...common,
    stage: "author",
    partition_plan_binding_digest: digest("2"),
    group_key: "component:button",
    logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
    member_ids_digest: indexerProtocolDigest({ member_ids: [MEMBER_REF] }),
    member_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    group_projection_digest: digest("4"),
    group_dependency_view_digest: digest("5"),
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: digest("6"),
  });
  const authority = {
    layer_ref: "provider:community#layer:primary",
    integrity: digest("1"),
    bundle_digest: digest("7"),
    config_fingerprint: digest("6"),
    customization_fingerprint: null,
  };
  if (author.stage !== "author") throw new Error("expected author workset");
  const partitionRequest = buildIndexerMainRunRequest({
    workset: partition,
    partition_strategy_attempt: {
      strategy_order: 0,
      ...partitionStrategy,
      previous_attempt_digest: null,
    },
    composition_input: composeIndexerLayerInput({
      workset_digest: partition.workset_digest,
      final_authority_layer_ref: authority.layer_ref,
      fragments: [],
    }),
    final_authority: authority,
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("8"),
      source_dependency_fingerprint: partition.source_binding_digest,
      source_role: "authoritative-source",
      source_precedence_digest: digest("a"),
      metric_set_digest: digest("b"),
      dependency_view_digest: null,
      primary_execution_projection: projections.executionProjection,
    }),
  });
  const authorRequest = buildIndexerMainRunRequest({
    workset: author,
    composition_input: composeIndexerLayerInput({
      workset_digest: author.workset_digest,
      final_authority_layer_ref: authority.layer_ref,
      fragments: [],
    }),
    final_authority: authority,
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("8"),
      source_dependency_fingerprint: author.source_binding_digest,
      source_role: "authoritative-source",
      source_precedence_digest: digest("a"),
      metric_set_digest: digest("b"),
      dependency_view_digest: author.group_dependency_view_digest,
      primary_execution_projection: projections.executionProjection,
    }),
  });
  const artifactPayload = {
    protocol: "context.indexer.artifact-result/v1" as const,
    author_workset_digest: author.workset_digest,
    partition_plan_binding_digest: author.partition_plan_binding_digest,
    group_projection_digest: author.group_projection_digest,
    indexer_id: author.indexer_id,
    provider_layer_ref: authority.layer_ref,
    provider_integrity: authority.integrity,
    provider_bundle_digest: authority.bundle_digest,
    config_fingerprint: authority.config_fingerprint,
    customization_fingerprint: authority.customization_fingerprint,
    requirement_ref: author.requirement_ref,
    source_ref: author.source_ref,
    module_ref: author.module_ref,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: author.group_key,
      subject_key: SUBJECT,
      logical_unit_ref: author.logical_unit_ref,
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: author.workset_digest,
      group_projection_digest: author.group_projection_digest,
      logical_unit_ref: author.logical_unit_ref,
      member_ids: [MEMBER_REF],
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: author.workset_digest,
      group_projection_digest: author.group_projection_digest,
      logical_unit_ref: author.logical_unit_ref,
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
    diagnostics: [{ code: "no-output-required", message: "No output required." }],
    input_digest: authorRequest.execution_request_digest,
  };
  const artifactResult = {
    ...artifactPayload,
    output_digest: indexerArtifactResultDigest(artifactPayload),
  };
  const primaryResult = {
    protocol: "context.indexer.run-result/v1" as const,
    operation: "main-index" as const,
    consumed_input_view_digest: authorRequest.composition_input.view_digest,
    result: {
      protocol: "context.indexer.main-result/v1" as const,
      stage: "author" as const,
      workset_digest: author.workset_digest,
      execution_request_digest: authorRequest.execution_request_digest,
      result: artifactResult,
    },
  };
  const primaryResultDigest = indexerProtocolDigest(primaryResult);
  return {
    ...projections,
    partition,
    author,
    partitionRequest,
    authorRequest,
    primaryResult,
    primaryResultDigest,
  };
}

describe("primary-only registry and execution projections", () => {
  test("derives one implementation, instructions, and template fingerprint per Indexer", () => {
    const registry = parseIndexerRegistry(REGISTRY_YAML);
    const baseline = worksets(registry);
    const shared = baseline.executionProjection.shared_artifact_fingerprint;
    expect(shared).toMatchObject({
      indexer_id: "component-library",
      instructions_fingerprint: digest("4"),
      template_fingerprint: digest("5"),
    });
    expect(
      baseline.authorRequest.run_environment.primary_execution_projection
        .shared_artifact_fingerprint,
    ).toEqual(shared);

    const changedInstructions = buildIndexerPrimaryExecutionProjection({
      indexer_id: "component-library",
      primary_registry_projection_digest:
        baseline.registryProjection.projection_digest,
      program_digest: digest("3"),
      instructions_digest: digest("a"),
      template_set_digest: digest("5"),
      config_digest: digest("6"),
      cli_contract_digest: digest("7"),
      profile_contract_digest: digest("9"),
      resources: baseline.executionProjection.resources,
    });
    expect(
      changedInstructions.shared_artifact_fingerprint.fingerprint_digest,
    ).not.toBe(shared.fingerprint_digest);
  });

  test("keeps composer-only selection outside every primary identity", () => {
    const withoutComposer = parseIndexerRegistry(REGISTRY_YAML);
    const withComposer = registryWithComposer();
    expect(indexerRegistryDigests(withComposer).registryDigest).not.toBe(
      indexerRegistryDigests(withoutComposer).registryDigest,
    );

    const emptyComposerSet = resolveEffectiveIndexerComposers({
      selections: [],
      manifest_layers: [],
      current_profiles: ["component-library"],
    });
    const selectedComposerSet = resolveEffectiveIndexerComposers({
      selections: [{
        id: "examples",
        provider: "extension",
        composer_selection_entry_digest: digest("c"),
      }],
      manifest_layers: [{
        provider: "extension",
        layer_ref: "provider:extension#layer:supporting",
        layer_integrity: digest("2"),
        bundle_digest: digest("d"),
        composers: [{ id: "examples", supported_profiles: ["component-library"] }],
      }],
      current_profiles: ["component-library"],
    });
    expect(selectedComposerSet.effective_composer_set_digest).not.toBe(
      emptyComposerSet.effective_composer_set_digest,
    );

    const before = worksets(withoutComposer);
    const after = worksets(withComposer);
    expect(after.registryProjection).toEqual(before.registryProjection);
    expect(after.executionProjection).toEqual(before.executionProjection);
    expect(after.partition).toEqual(before.partition);
    expect(after.author).toEqual(before.author);
    expect(after.partitionRequest).toEqual(before.partitionRequest);
    expect(after.authorRequest).toEqual(before.authorRequest);
    expect(after.primaryResult).toEqual(before.primaryResult);
    expect(after.primaryResultDigest).toBe(before.primaryResultDigest);
  });

  test("makes owner, profile, primary config, and primary resource changes stale", () => {
    const baseline = parseIndexerRegistry(REGISTRY_YAML);
    const base = worksets(baseline);

    const ownerChanged = structuredClone(baseline);
    ownerChanged.indexers[0]!.requirement_bindings[0]!.coverage_domains = [
      "public_contract",
    ];
    expect(primary(ownerChanged).registryProjection.projection_digest).not.toBe(
      base.registryProjection.projection_digest,
    );

    const profileChanged = structuredClone(baseline);
    profileChanged.indexers[0]!.profile.primary.variants = {
      application_mode: "workspace",
    };
    expect(primary(profileChanged).registryProjection.projection_digest).not.toBe(
      base.registryProjection.projection_digest,
    );

    const configChanged = structuredClone(baseline);
    configChanged.indexers[0]!.providers[0]!.config = {
      public_entry: "src/public.ts",
    };
    const configWorksets = worksets(configChanged);
    expect(configWorksets.partition.workset_digest).not.toBe(
      base.partition.workset_digest,
    );
    expect(configWorksets.authorRequest.execution_request_digest).not.toBe(
      base.authorRequest.execution_request_digest,
    );

    const resourceWorksets = worksets(baseline, digest("f"));
    expect(resourceWorksets.executionProjection.primary_resource_binding_digest).not.toBe(
      base.executionProjection.primary_resource_binding_digest,
    );
    expect(resourceWorksets.author.workset_digest).not.toBe(base.author.workset_digest);
    expect(resourceWorksets.primaryResultDigest).not.toBe(base.primaryResultDigest);
  });
});
