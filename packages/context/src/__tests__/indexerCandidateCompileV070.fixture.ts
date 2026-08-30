import {
  buildIndexerArtifactBundle,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerLayoutProposalSet,
  buildIndexerLayoutTransition,
  buildIndexerSharedArtifactFingerprint,
  canonicalIndexerNodeRef,
  indexerArtifactResultDigest,
  indexerEvidenceBindingDigest,
  indexerProtocolDigest,
  indexerRenderedArtifactDigest,
  resolveIndexerLayout,
  resolveIndexerSubjectKeySchemas,
  type IndexerArtifactResult,
  type IndexerRenderedArtifact,
  type IndexerSubjectKey,
} from "../index.js";
import { artifactPolicyContractsFixture } from "./indexerArtifactPolicyV070.fixture.js";

export const candidateCompileDigest = (character: string) =>
  `sha256:${character.repeat(64)}`;

const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "anonymous-package",
  kind: "component",
  local_key: "toggle",
};
const SHARED_ARTIFACT_FINGERPRINT = buildIndexerSharedArtifactFingerprint({
  indexer_id: "component-indexer",
  program_digest: null,
  instructions_digest: candidateCompileDigest("8"),
  template_set_digest: candidateCompileDigest("9"),
});

function resultFixture(): IndexerArtifactResult {
  const evidencePayload = {
    evidence_ref: "evidence:anonymous-toggle-source",
    kind: "code" as const,
    source_ref: "repo:anonymous@revision",
    module_ref: "module:components",
    locator: { path: "src/toggle.ts", start_line: 1, end_line: 12 },
    content_digest: candidateCompileDigest("a"),
    coverage_tier: "ast-catalog" as const,
  };
  const evidence = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
  const payload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: candidateCompileDigest("1"),
    partition_plan_binding_digest: candidateCompileDigest("2"),
    group_projection_digest: candidateCompileDigest("3"),
    indexer_id: "component-indexer",
    provider_layer_ref: "provider:sample#layer:primary",
    provider_integrity: candidateCompileDigest("4"),
    provider_bundle_digest: candidateCompileDigest("5"),
    config_fingerprint: candidateCompileDigest("6"),
    customization_fingerprint: null,
    requirement_ref: "requirement:anonymous-knowledge",
    source_ref: evidence.source_ref,
    module_ref: evidence.module_ref,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: "component:toggle",
      subject_key: SUBJECT,
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: candidateCompileDigest("1"),
      group_projection_digest: candidateCompileDigest("3"),
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      member_ids: ["member:toggle"],
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: candidateCompileDigest("1"),
      group_projection_digest: candidateCompileDigest("3"),
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      dispositions: [{
        member_id: "member:toggle",
        member_kind: "component",
        inventory_disposition: "owned",
        projection_disposition: "detailed",
        section_evidence: [{
          artifact_id: "toggle-overview",
          section_key: "summary",
          evidence_refs: [evidence.evidence_ref],
        }],
      }],
    }),
    facts: [],
    evidence_bindings: [evidence],
    artifacts: [{
      artifact_id: "toggle-overview",
      artifact_kind: "overview",
      artifact_policy_variant: "standard",
      representation: "sections",
      sections: [{
        section_key: "summary",
        owner_indexer_id: "component-indexer",
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kind: "overview",
        blocks: [{
          block_id: "summary-block",
          layer: "semantic-prose",
          markdown: "# Toggle\n\nAnonymous capability evidence.",
          evidence_refs: [evidence.evidence_ref],
        }],
      }],
    }],
    artifact_bundle: buildIndexerArtifactBundle({
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "toggle-overview",
        artifact_kind: "overview",
        purpose: "required",
        reader_question_refs: ["question:overview"],
        evidence_refs: [evidence.evidence_ref],
      }],
    }),
    material_question_proposals: [],
    question_target_dispositions: [],
    diagnostics: [],
    input_digest: candidateCompileDigest("7"),
  };
  return { ...payload, output_digest: indexerArtifactResultDigest(payload) };
}

function acceptedResult(result: IndexerArtifactResult) {
  const executionRequestDigest = result.input_digest;
  const runResult = {
    protocol: "context.indexer.run-result/v1" as const,
    operation: "main-index" as const,
    consumed_input_view_digest: candidateCompileDigest("9"),
    workset_read_receipt_digests: [candidateCompileDigest("b")],
    result: {
      protocol: "context.indexer.main-result/v1" as const,
      stage: "author" as const,
      workset_digest: result.author_workset_digest,
      execution_request_digest: executionRequestDigest,
      result,
    },
  };
  const runEnvelopePayload = {
    protocol: "context.indexer.run-envelope/v1" as const,
    stage: "author" as const,
    workset_digest: result.author_workset_digest,
    execution_request_digest: executionRequestDigest,
    source_ref: result.source_ref,
    module_ref: result.module_ref,
    logical_unit_ref: result.logical_unit.logical_unit_ref,
    source_snapshot_digest: candidateCompileDigest("a"),
    requirement_set_digest: candidateCompileDigest("b"),
    indexer_id: result.indexer_id,
    provider_layer_ref: result.provider_layer_ref,
    provider_integrity: result.provider_integrity,
    provider_bundle_digest: result.provider_bundle_digest,
    config_fingerprint: result.config_fingerprint,
    customization_fingerprint: result.customization_fingerprint,
    plan_binding_digest: result.partition_plan_binding_digest,
    runtime_fingerprint: candidateCompileDigest("c"),
    resource_binding_digest: candidateCompileDigest("d"),
    shared_artifact_fingerprint: SHARED_ARTIFACT_FINGERPRINT,
    parser_dependency_fingerprint: candidateCompileDigest("e"),
    source_role: result.source_role,
    source_precedence_digest: candidateCompileDigest("f"),
    metric_set_digest: candidateCompileDigest("0"),
    dependency_view_digest: candidateCompileDigest("1"),
    run_environment_digest: candidateCompileDigest("2"),
  };
  const runEnvelope = {
    ...runEnvelopePayload,
    envelope_digest: indexerProtocolDigest(runEnvelopePayload),
  };
  const acceptancePayload = {
    protocol: "context.indexer.main-accepted-result/v1" as const,
    workset_digest: result.author_workset_digest,
    stage: "author" as const,
    execution_request_digest: executionRequestDigest,
    result_digest: indexerProtocolDigest(result),
    receipt_digest: candidateCompileDigest("c"),
    run_envelope_digest: runEnvelope.envelope_digest,
    artifact_dependency_set_digest: candidateCompileDigest("e"),
  };
  return {
    run_result: runResult,
    accepted_record: {
      ...acceptancePayload,
      acceptance_digest: indexerProtocolDigest(acceptancePayload),
    },
    run_envelope: runEnvelope,
  };
}

export function candidateCompileFixture() {
  const contracts = artifactPolicyContractsFixture();
  const result = resultFixture();
  const subjectKeySchemaSet = resolveIndexerSubjectKeySchemas({
    profile_contract: contracts.profiles,
    operator_contract: contracts.operators,
    selections: [{
      indexer_id: result.indexer_id,
      profile: "component-library",
      role: "primary",
      provider_layer_id: "primary",
    }],
    providers: [],
  });
  const proposal = resolveIndexerLayout({
    artifact_result: result,
    profile: "component-library",
    profile_contract: contracts.profiles,
    operator_contract: contracts.operators,
    subject_key_schema_set: subjectKeySchemaSet,
    shared_artifact_fingerprint: SHARED_ARTIFACT_FINGERPRINT,
  });
  const layoutSet = buildIndexerLayoutProposalSet([proposal]);
  const transition = buildIndexerLayoutTransition({
    layout_proposal_set: layoutSet,
    base_projections: [],
    planned_output: { state: "not-required" },
  });
  return {
    ...contracts,
    result,
    accepted: acceptedResult(result),
    subjectKeySchemaSet,
    proposal,
    layoutSet,
    transition,
  };
}

export function candidateCompileTemplateFixture() {
  const fixture = candidateCompileFixture();
  const result = structuredClone(fixture.result);
  result.artifacts = [{
    artifact_id: "toggle-overview",
    artifact_kind: "overview",
    artifact_policy_variant: "standard",
    representation: "template",
    template_id: "component-guide",
    variables: {},
    section_projections: [{
      section_key: "summary",
      owner_indexer_id: "component-indexer",
      document_kind: "reference",
      reader_goal: "understand-capability",
      artifact_kind: "overview",
    }],
  }];
  const { output_digest: _digest, ...payload } = result;
  void _digest;
  result.output_digest = indexerArtifactResultDigest(payload);
  const markdown = "# Toggle template\n\nRendered evidence.";
  const evidenceRefs = ["evidence:anonymous-toggle-source"];
  const contentBlocks = [{
    layer: "semantic-prose" as const,
    markdown,
    fact_refs: [],
    evidence_refs: evidenceRefs,
    content_digest: indexerProtocolDigest({
      layer: "semantic-prose",
      markdown,
      fact_refs: [],
      evidence_refs: evidenceRefs,
    }),
  }];
  const renderedPayload: Omit<IndexerRenderedArtifact, "rendered_digest"> = {
    protocol: "context.indexer.rendered-artifact/v1",
    artifact_result_digest: result.output_digest,
    artifact_id: "toggle-overview",
    artifact_kind: "overview",
    artifact_policy_variant: "standard",
    template_id: "component-guide",
    profile: "component-library",
    template_digest: candidateCompileDigest("d"),
    template_origin: "provider",
    sections: [{
      section_key: "summary",
      owner_indexer_id: "component-indexer",
      document_kind: "reference",
      reader_goal: "understand-capability",
      artifact_kind: "overview",
      markdown,
      content_blocks: contentBlocks,
      evidence_refs: evidenceRefs,
      content_digest: indexerProtocolDigest({
        markdown,
        content_blocks: contentBlocks,
        evidence_refs: evidenceRefs,
      }),
    }],
    material_question_gaps: [],
    review_ready: true,
  };
  const rendered = {
    ...renderedPayload,
    rendered_digest: indexerRenderedArtifactDigest(renderedPayload),
  };
  const proposal = resolveIndexerLayout({
    artifact_result: result,
    profile: "component-library",
    profile_contract: fixture.profiles,
    operator_contract: fixture.operators,
    subject_key_schema_set: fixture.subjectKeySchemaSet,
    shared_artifact_fingerprint: SHARED_ARTIFACT_FINGERPRINT,
    rendered_artifacts: [rendered],
  });
  const layoutSet = buildIndexerLayoutProposalSet([proposal]);
  return {
    ...fixture,
    result,
    rendered,
    accepted: { ...acceptedResult(result), rendered_artifacts: [rendered] },
    proposal,
    layoutSet,
    transition: buildIndexerLayoutTransition({
      layout_proposal_set: layoutSet,
      base_projections: [],
      planned_output: { state: "not-required" },
    }),
  };
}
