import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerAuthorDependencyView,
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerQuestionTargetInventory,
  canonicalIndexerNodeRef,
  canonicalOwnerCellRef,
  composeIndexerLayerInput,
  indexerArtifactResultDigest,
  indexerCapabilityGroupMemberIdsDigest,
  indexerEvidenceBindingDigest,
  indexerInventoryMembersDigest,
  indexerProtocolDigest,
  indexerRegistryDigests,
  planIndexerPostAuthorComposition,
  resolveEffectiveIndexerComposers,
  type IndexerArtifactPolicyEligibility,
  type IndexerArtifactResult,
  type IndexerMainAuthorWorkset,
  type IndexerRegistry,
  type IndexerSubjectKey,
} from "@c4a/context";
import {
  acceptIndexerMainRunStore,
  prepareIndexerMainRunStore,
  readAcceptedIndexerMainAuthorResultRecords,
  startIndexerMainRunStore,
} from "../project/indexerMainRunStore.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { prepareIndexerPostAuthorRunStore } from
  "../project/indexerPostAuthorRunStore.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SOURCE_REF = "repo:sample";
const MODULE_REF = "module:service";
const MEMBER_REF = "member:worker";
const INVENTORY = [{ member_id: MEMBER_REF, member_kind: "service" as const }];
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample",
  kind: "service",
  local_key: "worker",
};

const PRIMARY_EXECUTION_PROJECTION = buildIndexerPrimaryExecutionProjection({
  indexer_id: "service-indexer",
  primary_registry_projection_digest: digest("d"),
  program_digest: null,
  instructions_digest: digest("8"),
  template_set_digest: digest("9"),
  config_digest: digest("a"),
  cli_contract_digest: digest("0"),
  profile_contract_digest: digest("b"),
  resources: [{
    layer_ref: "provider:community#layer:primary",
    phase: "primary",
    kind: "instructions",
    ref: "bundle:community/instructions/main.md",
    digest: digest("8"),
  }],
});

function registry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "knowledge",
      reader_goals: ["understand-service"],
      coverage_domains: { architecture: "required" },
      target_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: [MODULE_REF] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: [MODULE_REF] }],
      },
    }],
    indexers: [{
      id: "service-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "knowledge",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:knowledge#target_scope"] },
      profile: { primary: { id: "domain-service", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: digest("a"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  };
}

function eligibility(): IndexerArtifactPolicyEligibility {
  const payload: Omit<IndexerArtifactPolicyEligibility, "eligibility_digest"> = {
    protocol: "context.indexer.artifact-policy-eligibility/v1",
    profile_id: "domain-service",
    profile_contract_digest: digest("b"),
    operator_contract_digest: digest("c"),
    canonical_facts: [],
    provider_supported_variants: ["standard"],
    eligible_variants: [{
      id: "standard",
      required_artifact_kinds: ["overview"],
      discretionary_artifact_kinds: [],
      thresholds: [],
    }],
  };
  return { ...payload, eligibility_digest: indexerProtocolDigest(payload) };
}

function dependencyView() {
  const logicalUnitRef = canonicalIndexerNodeRef(SUBJECT);
  return buildIndexerAuthorDependencyView({
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    logical_unit_ref: logicalUnitRef,
    positive_nodes: [{
      kind: "source-span",
      evidence_ref: "evidence:worker-boundary",
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      locator: { path: "src/worker.ts", start_line: 1, end_line: 1 },
      content_digest: digest("b"),
      targets: [],
    }, {
      kind: "logical-unit",
      logical_unit_ref: logicalUnitRef,
      group_projection_digest: digest("6"),
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

function authorWorkset(requirementSetDigest: string): IndexerMainAuthorWorkset {
  const view = dependencyView();
  const current = buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "service-indexer",
    requirement_ref: "requirement:knowledge",
    owner_cell_refs: [canonicalOwnerCellRef({
      requirementRef: "knowledge",
      coverageDomain: "architecture",
      sourceRef: SOURCE_REF,
      moduleRef: MODULE_REF,
    })],
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    primary_registry_projection_digest: digest("d"),
    requirement_set_digest: requirementSetDigest,
    primary_execution_fingerprint:
      PRIMARY_EXECUTION_PROJECTION.primary_execution_fingerprint,
    profile_contract_digest: digest("b"),
    subject_key_schema_digest: digest("f"),
    source_scope_digest: digest("0"),
    source_binding_digest: digest("1"),
    primary_resource_binding_digest:
      PRIMARY_EXECUTION_PROJECTION.primary_resource_binding_digest,
    question_target_inventory_digest: digest("3"),
    partition_plan_binding_digest: digest("4"),
    group_key: "service:worker",
    logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest([MEMBER_REF]),
    member_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    group_projection_digest: digest("6"),
    group_dependency_view_digest: view.view_digest,
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: eligibility().eligibility_digest,
  });
  if (current.stage !== "author") throw new Error("expected author workset");
  return current;
}

function runFixture(requirementSetDigest: string) {
  const workset = authorWorkset(requirementSetDigest);
  const provider = {
    layer_ref: "provider:community#layer:primary",
    integrity: digest("8"),
    bundle_digest: digest("9"),
    config_fingerprint: digest("a"),
    customization_fingerprint: null,
  };
  const request = buildIndexerMainRunRequest({
    workset,
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: provider.layer_ref,
      fragments: [],
    }),
    final_authority: provider,
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("c"),
      source_dependency_fingerprint: workset.source_binding_digest,
      source_role: "authoritative-source",
      source_precedence_digest: digest("e"),
      metric_set_digest: digest("f"),
      dependency_view_digest: workset.group_dependency_view_digest,
      primary_execution_projection: PRIMARY_EXECUTION_PROJECTION,
    }),
  });
  const evidencePayload = {
    evidence_ref: "evidence:worker-boundary",
    kind: "code" as const,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    locator: { path: "src/worker.ts", start_line: 1, end_line: 1 },
    content_digest: digest("b"),
    coverage_tier: "ast-catalog" as const,
  };
  const evidence = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
  const artifactPayload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: workset.workset_digest,
    partition_plan_binding_digest: workset.partition_plan_binding_digest,
    group_projection_digest: workset.group_projection_digest,
    indexer_id: workset.indexer_id,
    provider_layer_ref: provider.layer_ref,
    provider_integrity: provider.integrity,
    provider_bundle_digest: provider.bundle_digest,
    config_fingerprint: provider.config_fingerprint,
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
        member_kind: "service",
        inventory_disposition: "owned",
        projection_disposition: "boundary-only",
        evidence_refs: [evidence.evidence_ref],
      }],
    }),
    facts: [],
    evidence_bindings: [evidence],
    artifacts: [],
    artifact_bundle: null,
    material_question_proposals: [],
    question_target_dispositions: [],
    diagnostics: [{ code: "no-output-required", message: "No reader Artifact required." }],
    input_digest: request.execution_request_digest,
  };
  const artifact = {
    ...artifactPayload,
    output_digest: indexerArtifactResultDigest(artifactPayload),
  };
  return {
    workset,
    spec: {
      protocol: "context.indexer.main-run-spec/v1",
      request,
      validation: {
        stage: "author",
        dependency_view: dependencyView(),
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: eligibility(),
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [],
      },
    },
    result: {
      protocol: "context.indexer.run-result/v1",
      operation: "main-index",
      consumed_input_view_digest: request.composition_input.view_digest,
      result: {
        protocol: "context.indexer.main-result/v1",
        stage: "author",
        workset_digest: workset.workset_digest,
        execution_request_digest: request.execution_request_digest,
        result: artifact,
      },
    },
  };
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-reconciliation-"));
  const currentRegistry = registry();
  const requirementSetDigest = indexerRegistryDigests(currentRegistry).requirementSetDigest;
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "reconciliation-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(
    join(root, "src", "indexers.yaml"),
    YAML.stringify(currentRegistry),
    "utf8",
  );
  return { root, currentRegistry, requirementSetDigest };
}

describe("project Indexer result reconciliation", () => {
  test("reconciles accepted Author results without a second gap state machine", async () => {
    const current = await project();
    const run = runFixture(current.requirementSetDigest);
    await prepareIndexerMainRunStore({
      projectRoot: current.root,
      workset_set: buildIndexerMainWorksetSet([run.workset]),
      run_specs: [run.spec],
    });
    await startIndexerMainRunStore({
      projectRoot: current.root,
      workset_digest: run.workset.workset_digest,
    });
    await acceptIndexerMainRunStore({
      projectRoot: current.root,
      workset_digest: run.workset.workset_digest,
      result: run.result,
    });
    const [acceptedAuthor] = await readAcceptedIndexerMainAuthorResultRecords(
      current.root,
    );
    if (acceptedAuthor === undefined) throw new Error("expected accepted Author result");
    const artifact = run.result.result.result;
    const effectiveComposers = resolveEffectiveIndexerComposers({
      selections: [],
      manifest_layers: [],
      current_profiles: ["domain-service"],
    });
    const postAuthorPlan = planIndexerPostAuthorComposition({
      effective_composer_set: effectiveComposers,
      author_workset_digest: run.workset.workset_digest,
      primary_result_digest: acceptedAuthor.accepted_record.result_digest,
      primary_facts: [],
      primary_artifacts: [],
      validator_contract_digest: digest("b"),
      current_profile_binding_digest: digest("c"),
      allowed_target_refs: [artifact.logical_unit.logical_unit_ref],
    });
    await prepareIndexerPostAuthorRunStore({
      projectRoot: current.root,
      requirement_set_digest: current.requirementSetDigest,
      plan: postAuthorPlan,
      effective_composer_set: effectiveComposers,
      validator_contract_digest: digest("b"),
      accepted_input_view_digest: run.result.consumed_input_view_digest,
    });
    const inventory = buildIndexerQuestionTargetInventory({
      requirement_set_digest: current.requirementSetDigest,
      profile_contract_digests: [digest("b")],
      source_inventory_digests: [digest("c")],
      items: [],
    });
    const inputPath = join(current.root, "reconcile.json");
    const reconciliationInput = {
      protocol: "context.indexer.result-reconciliation-input/v1",
      requirement_set_digest: current.requirementSetDigest,
      question_target_inventory: inventory,
      resolved_questions: [],
      target_facts: {},
      allowed_selector_fact_paths: [],
      registered_material_sources: [],
    };
    await writeFile(inputPath, `${JSON.stringify(reconciliationInput, null, 2)}\n`, "utf8");
    const report = JSON.parse(await runCliInDir(current.root, [
      "indexer",
      "reconcile-indexer-results",
      "--input",
      inputPath,
      "--format",
      "json",
    ]));
    expect(report).toMatchObject({
      outcome: "complete",
      graph_outcome: "completed",
      can_report_complete: true,
    });
    expect(report.domains[0]).toMatchObject({
      coverage_domain: "architecture",
      state: "completed",
    });
  });
});
