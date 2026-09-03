import { describe, expect, test } from "bun:test";
import {
  authorizeIndexerLayoutChange,
  buildIndexerArtifactBundle,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerApprovedLayoutProjection,
  buildIndexerLayoutProposalSet,
  buildIndexerLayoutChangeConfirmation,
  buildIndexerSharedArtifactFingerprint,
  canonicalIndexerNodeRef,
  compareIndexerLayout,
  indexerArtifactResultDigest,
  indexerEvidenceBindingDigest,
  indexerProfileContractDigest,
  indexerProtocolDigest,
  indexerRenderedArtifactDigest,
  resolveIndexerLayout as resolveIndexerLayoutRaw,
  resolveIndexerSubjectKeySchemas,
  validateIndexerLayoutProposal,
  validateIndexerLayoutProposalSet,
  type IndexerArtifactResult,
  type IndexerRenderedArtifact,
  type IndexerSubjectKey,
} from "../index.js";
import { artifactPolicyContractsFixture } from "./indexerArtifactPolicyV070.fixture.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "anonymous-package",
  kind: "component",
  local_key: "button",
};
const SHARED_ARTIFACT_FINGERPRINT = buildIndexerSharedArtifactFingerprint({
  indexer_id: "component-indexer",
  program_digest: null,
  instructions_digest: digest("8"),
  template_set_digest: digest("9"),
});

function resolveIndexerLayout(
  input: Omit<
    Parameters<typeof resolveIndexerLayoutRaw>[0],
    "shared_artifact_fingerprint"
  >,
) {
  return resolveIndexerLayoutRaw({
    ...input,
    shared_artifact_fingerprint: SHARED_ARTIFACT_FINGERPRINT,
  });
}

function subjectKeySchemaSet(
  profileContract: unknown,
  operatorContract: unknown,
  indexerIds: readonly string[] = ["component-indexer"],
) {
  return resolveIndexerSubjectKeySchemas({
    profile_contract: profileContract,
    operator_contract: operatorContract,
    selections: indexerIds.map((indexerId) => ({
      indexer_id: indexerId,
      profile: "component-library",
      role: "primary" as const,
      provider_layer_id: "primary",
    })),
    providers: [],
  });
}

function artifactResult(
  extraSections: Array<{
    section_key: string;
    document_kind: string;
    reader_goal: string;
  }> = [],
): IndexerArtifactResult {
  const evidencePayload = {
    evidence_ref: "evidence:anonymous-component-source",
    kind: "code" as const,
    source_ref: "repo:anonymous@revision",
    module_ref: "module:components",
    locator: { path: "src/button.ts", start_line: 1, end_line: 10 },
    content_digest: digest("a"),
    coverage_tier: "ast-catalog" as const,
  };
  const evidence = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
  const sections = [{
    section_key: "summary",
    document_kind: "reference",
    reader_goal: "understand-capability",
  }, ...extraSections].map((section) => ({
    ...section,
    owner_indexer_id: "component-indexer",
    artifact_kind: "overview",
    blocks: [{
      block_id: `${section.section_key}-block`,
      layer: "semantic-prose" as const,
      markdown: "Anonymous capability evidence.",
      evidence_refs: [evidence.evidence_ref],
    }],
  }));
  const payload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: digest("1"),
    partition_plan_binding_digest: digest("2"),
    group_projection_digest: digest("3"),
    indexer_id: "component-indexer",
    provider_layer_ref: "provider:sample#layer:primary",
    provider_integrity: digest("4"),
    provider_bundle_digest: digest("5"),
    config_fingerprint: digest("6"),
    customization_fingerprint: null,
    requirement_ref: "requirement:anonymous-knowledge",
    source_ref: evidence.source_ref,
    module_ref: evidence.module_ref,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: "component:button",
      subject_key: SUBJECT,
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: digest("1"),
      group_projection_digest: digest("3"),
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      member_ids: ["member:button"],
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: digest("1"),
      group_projection_digest: digest("3"),
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      dispositions: [{
        member_id: "member:button",
        member_kind: "component",
        inventory_disposition: "owned",
        projection_disposition: "detailed",
        section_evidence: [{
          artifact_id: "button-overview",
          section_key: "summary",
          evidence_refs: [evidence.evidence_ref],
        }],
      }],
    }),
    facts: [],
    evidence_bindings: [evidence],
    artifacts: [{
      artifact_id: "button-overview",
      artifact_kind: "overview",
      artifact_policy_variant: "standard",
      representation: "sections",
      sections,
    }],
    artifact_bundle: buildIndexerArtifactBundle({
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "button-overview",
        artifact_kind: "overview",
        purpose: "required",
        reader_question_refs: ["question:overview"],
        evidence_refs: [evidence.evidence_ref],
      }],
    }),
    material_question_proposals: [],
    question_target_dispositions: [],
    diagnostics: [],
    input_digest: digest("7"),
  };
  return { ...payload, output_digest: indexerArtifactResultDigest(payload) };
}

function templateFixture(): {
  result: IndexerArtifactResult;
  rendered: IndexerRenderedArtifact;
} {
  const result = artifactResult();
  result.artifacts = [{
    artifact_id: "button-overview",
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
    }, {
      section_key: "optional-examples",
      owner_indexer_id: "component-indexer",
      document_kind: "reference",
      reader_goal: "understand-capability",
      artifact_kind: "overview",
    }],
  }];
  const { output_digest: _digest, ...resultPayload } = result;
  void _digest;
  result.output_digest = indexerArtifactResultDigest(resultPayload);
  const markdown = "# Anonymous capability\n";
  const evidenceRefs = ["evidence:anonymous-component-source"];
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
    artifact_id: "button-overview",
    artifact_kind: "overview",
    artifact_policy_variant: "standard",
    template_id: "component-guide",
    profile: "component-library",
    template_digest: digest("9"),
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
  return {
    result,
    rendered: {
      ...renderedPayload,
      rendered_digest: indexerRenderedArtifactDigest(renderedPayload),
    },
  };
}

describe("compile-internal deterministic Indexer layout resolver", () => {
  test("derives Node, Artifact, internal View, Section, collection, and path", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const result = artifactResult();
    const proposal = resolveIndexerLayout({
      artifact_result: result,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    });
    expect(proposal.node.node_ref).toBe(canonicalIndexerNodeRef(SUBJECT));
    expect(proposal.artifacts[0]).toMatchObject({
      artifact_id: "button-overview",
      collection: "codeindex",
      sections: [{ section_key: "summary", state: "structured" }],
    });
    expect(proposal.artifacts[0]!.output_path).toBe(
      "knowledge/codeindex/components/button-overview.md",
    );
    expect(proposal.artifacts[0]!.internal_view_ref).toStartWith("view:artifact:");
    expect(validateIndexerLayoutProposal({
      proposal,
      artifact_result: result,
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    })).toEqual(proposal);
    expect(proposal).not.toHaveProperty("align");
  });

  test("keeps catalog-only accepted results in the layout set without creating a knowledge file", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const result = artifactResult();
    result.artifacts = [];
    result.artifact_bundle = null;
    const { output_digest: _digest, ...payload } = result;
    void _digest;
    result.output_digest = indexerArtifactResultDigest(payload);

    const proposal = resolveIndexerLayout({
      artifact_result: result,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    });
    expect(proposal.artifacts).toEqual([]);
    expect(validateIndexerLayoutProposal({
      proposal,
      artifact_result: result,
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    })).toEqual(proposal);
  });

  test("rejects missing mappings, cross-collection Artifacts, and forged paths", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const missing = artifactResult([{
      section_key: "details",
      document_kind: "unknown-document",
      reader_goal: "understand-capability",
    }]);
    expect(() => resolveIndexerLayout({
      artifact_result: missing,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    })).toThrow(/exactly one CLI collection/);

    const mixedProfiles = structuredClone(profiles);
    mixedProfiles.profiles[0]!.layout_mappings.push({
      source_roles: ["authoritative-source"],
      document_kind: "guide",
      reader_goal: "understand-capability",
      artifact_kinds: ["overview"],
      collection: "architecture",
    });
    const { contract_digest: _digest, ...contractPayload } = mixedProfiles;
    void _digest;
    mixedProfiles.contract_digest = indexerProfileContractDigest(contractPayload);
    const mixed = artifactResult([{
      section_key: "guide",
      document_kind: "guide",
      reader_goal: "understand-capability",
    }]);
    expect(() => resolveIndexerLayout({
      artifact_result: mixed,
      profile: "component-library",
      profile_contract: mixedProfiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(mixedProfiles, operators),
    })).toThrow(/multiple collections/);

    const proposal = resolveIndexerLayout({
      artifact_result: artifactResult(),
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    });
    proposal.artifacts[0]!.output_path = "knowledge/codeindex/forged.md";
    expect(() => validateIndexerLayoutProposal({
      proposal,
      artifact_result: artifactResult(),
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    })).toThrow(/stale or forged/);
  });

  test("enforces the resolved SubjectKey normalization and logical Section collision rules", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const normalizedProfiles = structuredClone(profiles);
    normalizedProfiles.subject_key_schemas[0]!.normalization = [
      "trim",
      "unicode-nfc",
      "lowercase",
    ];
    const { contract_digest: _profileDigest, ...profilePayload } = normalizedProfiles;
    void _profileDigest;
    normalizedProfiles.contract_digest = indexerProfileContractDigest(profilePayload);
    const nonNormalized = artifactResult();
    nonNormalized.logical_unit.subject_key.namespace = "Anonymous-Package";
    nonNormalized.logical_unit.logical_unit_ref = canonicalIndexerNodeRef(
      nonNormalized.logical_unit.subject_key,
    );
    const { output_digest: _outputDigest, ...nonNormalizedPayload } = nonNormalized;
    void _outputDigest;
    nonNormalized.output_digest = indexerArtifactResultDigest(nonNormalizedPayload);
    expect(() => resolveIndexerLayout({
      artifact_result: nonNormalized,
      profile: "component-library",
      profile_contract: normalizedProfiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(normalizedProfiles, operators),
    })).toThrow(/violates lowercase normalization/);

    const colliding = artifactResult();
    const originalArtifact = colliding.artifacts[0]!;
    colliding.artifacts.push({
      ...structuredClone(originalArtifact),
      artifact_id: "button-overview-copy",
    });
    colliding.artifact_bundle = buildIndexerArtifactBundle({
      logical_unit_ref: colliding.logical_unit.logical_unit_ref,
      artifact_policy_variant: "standard",
      artifacts: [
        ...colliding.artifact_bundle!.artifacts,
        {
          artifact_id: "button-overview-copy",
          artifact_kind: "overview",
          purpose: "required",
          reader_question_refs: ["question:overview"],
          evidence_refs: ["evidence:anonymous-component-source"],
        },
      ],
    });
    const { output_digest: _collisionDigest, ...collisionPayload } = colliding;
    void _collisionDigest;
    colliding.output_digest = indexerArtifactResultDigest(collisionPayload);
    expect(() => resolveIndexerLayout({
      artifact_result: colliding,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    })).toThrow(/colliding logical Section identities/);
  });

  test("closes a proposal set and rejects multiple Indexers owning one Node", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const result = artifactResult();
    const sharedSchemaSet = subjectKeySchemaSet(profiles, operators, [
      "component-indexer",
      "another-indexer",
    ]);
    const proposal = resolveIndexerLayout({
      artifact_result: result,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: sharedSchemaSet,
    });
    const proposalSet = buildIndexerLayoutProposalSet([proposal]);
    expect(validateIndexerLayoutProposalSet(proposalSet)).toEqual(proposalSet);

    const conflictingResult = structuredClone(result);
    conflictingResult.indexer_id = "another-indexer";
    const conflictingArtifact = conflictingResult.artifacts[0]!;
    if (conflictingArtifact.representation !== "sections") {
      throw new TypeError("test fixture must use structured Sections");
    }
    conflictingArtifact.sections[0]!.owner_indexer_id = "another-indexer";
    const { output_digest: _digest, ...conflictingPayload } = conflictingResult;
    void _digest;
    conflictingResult.output_digest = indexerArtifactResultDigest(conflictingPayload);
    const conflicting = resolveIndexerLayoutRaw({
      artifact_result: conflictingResult,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: sharedSchemaSet,
      shared_artifact_fingerprint: buildIndexerSharedArtifactFingerprint({
        indexer_id: "another-indexer",
        program_digest: null,
        instructions_digest: digest("8"),
        template_set_digest: digest("9"),
      }),
    });
    expect(() => buildIndexerLayoutProposalSet([proposal, conflicting])).toThrow(
      /conflicting Node ownership/,
    );
  });

  test("requests a non-delegable human Gate only for destructive layout diffs", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const result = artifactResult();
    const baseProposal = resolveIndexerLayout({
      artifact_result: result,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
    });
    const base = buildIndexerApprovedLayoutProjection(baseProposal);
    const first = compareIndexerLayout({ base: null, target: baseProposal });
    expect(first.requires_confirmation).toBe(false);
    expect(authorizeIndexerLayoutChange({ report: first })).toEqual(first);

    const movedProfiles = structuredClone(profiles);
    movedProfiles.profiles[0]!.layout_mappings[0]!.collection = "architecture";
    const { contract_digest: _digest, ...movedPayload } = movedProfiles;
    void _digest;
    movedProfiles.contract_digest = indexerProfileContractDigest(movedPayload);
    const movedProposal = resolveIndexerLayout({
      artifact_result: result,
      profile: "component-library",
      profile_contract: movedProfiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(movedProfiles, operators),
    });
    const moved = compareIndexerLayout({ base, target: movedProposal });
    expect(moved).toMatchObject({
      requires_confirmation: true,
      gate: {
        id: "confirm-layout-change",
        authority: "human",
        delegation: "forbidden",
      },
      changes: [{ kind: "collection-move" }],
    });
    expect(() => authorizeIndexerLayoutChange({ report: moved })).toThrow();
    const confirmation = buildIndexerLayoutChangeConfirmation({
      report: moved,
      actor_ref: "user:reviewer",
    });
    expect(authorizeIndexerLayoutChange({ report: moved, confirmation })).toEqual(moved);

    const forged = structuredClone(confirmation);
    forged.target_proposal_digest = baseProposal.proposal_digest;
    expect(() => authorizeIndexerLayoutChange({
      report: moved,
      confirmation: forged,
    })).toThrow(/stale or forged/);
  });

  test("uses actual rendered template Sections and omits absent optional projections", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const { result, rendered } = templateFixture();
    const proposal = resolveIndexerLayout({
      artifact_result: result,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
      rendered_artifacts: [rendered],
    });
    expect(proposal.artifacts[0]!.sections).toHaveLength(1);
    expect(proposal.artifacts[0]!.sections[0]).toMatchObject({
      section_key: "summary",
      state: "rendered",
      content_digest: rendered.sections[0]!.content_digest,
    });

    const changedProjection = structuredClone(rendered);
    changedProjection.sections[0]!.owner_indexer_id = "another-indexer";
    const { rendered_digest: _renderedDigest, ...renderedPayload } = changedProjection;
    void _renderedDigest;
    changedProjection.rendered_digest = indexerRenderedArtifactDigest(renderedPayload);
    expect(() => resolveIndexerLayout({
      artifact_result: result,
      profile: "component-library",
      profile_contract: profiles,
      operator_contract: operators,
      subject_key_schema_set: subjectKeySchemaSet(profiles, operators),
      rendered_artifacts: [changedProjection],
    })).toThrow(/changes projection intent/);
  });
});
