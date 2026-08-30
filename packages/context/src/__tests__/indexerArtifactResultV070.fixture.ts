import {
  buildIndexerArtifactBundle,
  buildIndexerAuthorDependencyView,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerMainWorkset,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  buildIndexerTargetResolutionView,
  canonicalIndexerNodeRef,
  indexerArtifactResultDigest,
  indexerCapabilityGroupMemberIdsDigest,
  indexerEvidenceBindingDigest,
  indexerDependencyNodeRef,
  indexerInventoryMembersDigest,
  indexerProtocolDigest,
  validateIndexerArtifactResult,
  type IndexerArtifactResult,
  type IndexerAuthorDependencyView,
  type IndexerMainAuthorWorkset,
  type IndexerRunEnvironment,
  type IndexerSubjectKey,
} from "../index.js";
import { artifactPolicyEligibilityFixture } from "./indexerArtifactPolicyV070.fixture.js";

export const digest = (character: string) => `sha256:${character.repeat(64)}`;
export const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};
export const TARGET_SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "shared-package",
  kind: "component",
  local_key: "button",
};
export const PROVIDER = {
  layer_ref: "provider:sample#layer:primary",
  integrity: digest("a"),
  bundle_digest: digest("b"),
  config_fingerprint: digest("c"),
  customization_fingerprint: null,
};
export const INPUT_DIGEST = digest("d");
export const QUESTION_TARGET = "question-target:public-contract";
export const QUESTION_REF = "question:public-contract";
export const MEMBER_REF = "member:export/button";
export const ELIGIBILITY = artifactPolicyEligibilityFixture();
export const PRIMARY_EXECUTION_PROJECTION = buildIndexerPrimaryExecutionProjection({
  indexer_id: "component-library",
  primary_registry_projection_digest: digest("1"),
  program_digest: null,
  instructions_digest: digest("a"),
  template_set_digest: digest("b"),
  config_digest: PROVIDER.config_fingerprint,
  cli_contract_digest: digest("d"),
  profile_contract_digest: digest("4"),
  resources: [{
    layer_ref: PROVIDER.layer_ref,
    phase: "primary",
    kind: "instructions",
    ref: "bundle:sample/instructions/main.md",
    digest: digest("a"),
  }],
});

const EVIDENCE_NODE = {
  kind: "source-span" as const,
  evidence_ref: "evidence:button-source",
  source_ref: "repo:sample@revision",
  module_ref: "module:packages/sample",
  locator: {
    path: "src/button.ts",
    start_line: 1,
    end_line: 20,
  },
  content_digest: digest("5"),
  targets: [],
};
const FACT = {
  fact_ref: "fact:button-summary",
  fact_kind: "component-summary",
  subject_key: SUBJECT,
  value: { summary: "public button" },
  evidence_refs: [EVIDENCE_NODE.evidence_ref],
};

export function authorDependencyView(
  memberIds: readonly string[] = [MEMBER_REF],
): IndexerAuthorDependencyView {
  const logicalUnitRef = canonicalIndexerNodeRef(SUBJECT);
  return buildIndexerAuthorDependencyView({
    source_ref: EVIDENCE_NODE.source_ref,
    module_ref: EVIDENCE_NODE.module_ref,
    logical_unit_ref: logicalUnitRef,
    positive_nodes: [EVIDENCE_NODE, {
      kind: "selected-fact",
      fact_ref: FACT.fact_ref,
      fact_digest: indexerProtocolDigest(FACT),
      source_span_node_refs: [indexerDependencyNodeRef({
        polarity: "positive",
        node: EVIDENCE_NODE,
      })],
      targets: [],
    }, {
      kind: "logical-unit",
      logical_unit_ref: logicalUnitRef,
      group_projection_digest: digest("2"),
      targets: [{ level: "logical-unit" }],
    }, {
      kind: "template-policy-fragment",
      target_ref: "policy:component-overview",
      content_digest: digest("a"),
      targets: [{ level: "artifact-kind", artifact_kind: "overview" }],
    }, {
      kind: "contract-metric",
      target_ref: "metric:component-evidence",
      content_digest: digest("b"),
      targets: [{ level: "section", artifact_kind: "overview", section_key: "summary" }],
    }],
    negative_nodes: [{
      kind: "group-input-set",
      scope_ref: logicalUnitRef,
      set_digest: indexerInventoryMembersDigest(memberIds.map((member_id) => ({
        member_id,
        member_kind: "component",
      }))),
      targets: [{ level: "logical-unit" }],
    }, ...([
      "directory-membership",
      "export-set",
      "route-set",
      "candidate-pool",
      "precedence-winner",
      "absence-assertion",
    ] as const).map((kind, index) => ({
      kind,
      scope_ref: `${kind}:component-button`,
      set_digest: digest(String.fromCharCode("a".charCodeAt(0) + index)),
      targets: [{
        level: "section" as const,
        artifact_kind: "overview",
        section_key: "summary",
      }],
    }))],
  });
}

export function runEnvironment(
  workset: IndexerMainAuthorWorkset,
): IndexerRunEnvironment {
  return buildIndexerRunEnvironment({
    source_snapshot_digest: digest("e"),
    parser_dependency_fingerprint: digest("f"),
    source_role: "authoritative-source",
    source_precedence_digest: digest("0"),
    metric_set_digest: digest("1"),
    dependency_view_digest: workset.group_dependency_view_digest,
    primary_execution_projection: PRIMARY_EXECUTION_PROJECTION,
  });
}

export function authorWorkset(
  target: boolean | "resolved" | "absent" = false,
  memberIds: readonly string[] = [MEMBER_REF],
): IndexerMainAuthorWorkset {
  const dependencyView = authorDependencyView(memberIds);
  const targetView = target ? buildIndexerTargetResolutionView({
    requirement_ref: "requirement:public-knowledge",
    subject_key_schema_digest: digest("5"),
    query_digest: digest("e"),
    entries: [target === "absent"
      ? {
          query_ref: digest("f"),
          state: "absent",
        }
      : {
          query_ref: digest("f"),
          state: "resolved",
          subject_key: TARGET_SUBJECT,
          node_ref: canonicalIndexerNodeRef(TARGET_SUBJECT),
        }],
  }) : undefined;
  const value = buildIndexerMainWorkset({
    stage: "author",
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
    partition_plan_binding_digest: digest("0"),
    group_key: "component:button",
    logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest(memberIds),
    member_inventory_digest: indexerInventoryMembersDigest(memberIds.map((member_id) => ({
      member_id,
      member_kind: "component",
    }))),
    group_projection_digest: digest("2"),
    group_dependency_view_digest: dependencyView.view_digest,
    ...(targetView === undefined ? {} : { target_resolution_view: targetView }),
    allowed_artifact_policy_variants: ELIGIBILITY.eligible_variants.map((variant) => variant.id),
    artifact_policy_eligibility_digest: ELIGIBILITY.eligibility_digest,
  });
  if (value.stage !== "author") throw new Error("expected author workset");
  return value;
}

export function artifactResult(
  workset = authorWorkset(),
  targetResolutionDispositions: IndexerArtifactResult["logical_unit"]["target_resolution_dispositions"] = [],
  memberIds: readonly string[] = [MEMBER_REF],
): IndexerArtifactResult {
  const evidencePayload = {
    evidence_ref: EVIDENCE_NODE.evidence_ref,
    kind: "code" as const,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    locator: EVIDENCE_NODE.locator,
    content_digest: EVIDENCE_NODE.content_digest,
    coverage_tier: "ast-catalog" as const,
  };
  const evidenceBinding = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
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
    customization_fingerprint: PROVIDER.customization_fingerprint,
    requirement_ref: workset.requirement_ref,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: workset.group_key,
      subject_key: SUBJECT,
      logical_unit_ref: workset.logical_unit_ref,
      target_resolution_dispositions: targetResolutionDispositions,
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: memberIds,
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      dispositions: memberIds.map((member_id) => ({
        member_id,
        member_kind: "component" as const,
        inventory_disposition: "owned" as const,
        projection_disposition: "detailed" as const,
        section_evidence: [{
          artifact_id: "button-overview",
          section_key: "summary",
          evidence_refs: [evidenceBinding.evidence_ref],
        }],
      })),
    }),
    facts: [FACT],
    evidence_bindings: [evidenceBinding],
    artifacts: [{
      artifact_id: "button-overview",
      artifact_kind: "overview",
      artifact_policy_variant: "standard",
      representation: "sections",
      sections: [{
        section_key: "summary",
        owner_indexer_id: workset.indexer_id,
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kind: "overview",
        blocks: [{
          block_id: "summary-block",
          layer: "semantic-prose",
          markdown: "A public control.",
          evidence_refs: [evidenceBinding.evidence_ref],
        }],
      }],
    }],
    artifact_bundle: buildIndexerArtifactBundle({
      logical_unit_ref: workset.logical_unit_ref,
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "button-overview",
        artifact_kind: "overview",
        purpose: "required",
        reader_question_refs: [QUESTION_REF],
        evidence_refs: [evidenceBinding.evidence_ref],
      }],
    }),
    material_question_proposals: [{
      proposal_ref: "proposal:public-contract-gap",
      requirement_ref: workset.requirement_ref,
      question_ref: QUESTION_REF,
      question_target_key: QUESTION_TARGET,
      answer_landing_hint: {
        artifact_id: "button-overview",
        section_key: "summary",
      },
      source_hints: [workset.source_ref],
    }],
    question_target_dispositions: [{
      question_target_key: QUESTION_TARGET,
      state: "material-gap",
      material_question_proposal_ref: "proposal:public-contract-gap",
    }],
    diagnostics: [],
    input_digest: INPUT_DIGEST,
  };
  return {
    ...payload,
    output_digest: indexerArtifactResultDigest(payload),
  };
}

export function validateArtifactResultFixture(
  result: unknown,
  workset = authorWorkset(),
  declarationValidation: {
    source_identity_inventory?: unknown;
    authorized_declaration_carriers?: {
      catalog_refs?: readonly string[];
      manifest_refs?: readonly string[];
    };
  } = {},
) {
  return validateIndexerArtifactResult({
    result,
    workset,
    expected_provider: PROVIDER,
    expected_input_digest: INPUT_DIGEST,
    expected_subject_key: SUBJECT,
    artifact_policy_eligibility: ELIGIBILITY,
    allowed_source_roles: ["authoritative-source"],
    allowed_question_targets: [{
      question_target_key: QUESTION_TARGET,
      question_ref: QUESTION_REF,
    }],
    ...declarationValidation,
  });
}

export function rehashArtifactResult(result: IndexerArtifactResult): void {
  const payload = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "output_digest"),
  ) as Omit<IndexerArtifactResult, "output_digest">;
  result.output_digest = indexerArtifactResultDigest(payload);
}
