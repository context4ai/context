import { describe, expect, test } from "bun:test";
import {
  buildIndexerArtifactDependencySet,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerGeneratedAuthoringAudit,
  buildIndexerRunEnvelope,
  buildIndexerSourceIdentityInventory,
  buildIndexerStructuredDeclarationSet,
  buildIndexerStructuredClaimSet,
  canonicalIndexerNodeRef,
  indexerArtifactDependencySetDigest,
  indexerEvidenceBindingDigest,
  indexerSectionEvidenceCarrierRef,
  validateIndexerArtifactDependencySet,
  validateIndexerGeneratedAuthoringAudit,
} from "../index.js";
import {
  MEMBER_REF,
  INPUT_DIGEST,
  PROVIDER,
  QUESTION_TARGET,
  SUBJECT,
  TARGET_SUBJECT,
  artifactResult,
  authorDependencyView,
  authorWorkset,
  digest,
  rehashArtifactResult as rehash,
  runEnvironment,
  validateArtifactResultFixture as validate,
} from "./indexerArtifactResultV070.fixture.js";

describe("ArtifactResult ABI", () => {
  test("validates author/provider binding, evidence, projection intent, and material gap", () => {
    const workset = authorWorkset();
    const result = artifactResult(workset);
    expect(validate(result, workset)).toEqual(result);
    expect(result).not.toHaveProperty("collection");
    expect(result).not.toHaveProperty("output_path");
  });

  test("normalizes source spans and logical-unit inputs into Artifact positive and negative dependencies", () => {
    const workset = authorWorkset();
    const result = artifactResult(workset);
    const artifact = result.artifacts[0]!;
    if (artifact.representation !== "sections") throw new Error("expected sections");
    artifact.sections[0]!.blocks = [{
      block_id: "summary-catalog",
      layer: "deterministic-block",
      renderer: "json-code-block",
      fact_refs: ["fact:button-summary"],
    }];
    rehash(result);
    expect(validate(result, workset)).toEqual(result);
    const dependencyView = authorDependencyView();
    const runEnvelope = buildIndexerRunEnvelope({
      workset,
      execution_request_digest: INPUT_DIGEST,
      final_authority: PROVIDER,
      run_environment: runEnvironment(workset),
    });
    const dependencySet = buildIndexerArtifactDependencySet({
      result,
      workset,
      run_envelope: runEnvelope,
      dependency_view: dependencyView,
    });
    expect(validateIndexerArtifactDependencySet({
      value: dependencySet,
      result,
      workset,
      run_envelope: runEnvelope,
      dependency_view: dependencyView,
    })).toEqual(dependencySet);
    expect(dependencySet).toMatchObject({
      protocol: "context.indexer.artifact-dependency-set/v1",
      result_digest: result.output_digest,
      author_workset_digest: workset.workset_digest,
      source_ref: result.source_ref,
      logical_unit_ref: result.logical_unit.logical_unit_ref,
      artifacts: [{
        artifact_id: "button-overview",
        sections: [{
          section_key: "summary",
          negative_dependency_refs: dependencySet.artifacts[0]!.sections[0]!
            .negative_dependency_refs,
        }],
      }],
    });
    expect(dependencySet.positive_dependencies.map((item) => item.kind).sort()).toEqual([
      "contract-metric",
      "logical-unit",
      "selected-fact",
      "source-span",
      "template-policy-fragment",
    ]);
    expect(dependencySet.negative_dependencies.map((item) => item.kind).sort()).toEqual([
      "absence-assertion",
      "candidate-pool",
      "directory-membership",
      "export-set",
      "group-input-set",
      "precedence-winner",
      "route-set",
    ]);

    const stale = structuredClone(dependencySet);
    const staleGroupInput = stale.negative_dependencies.find((item) =>
      item.kind === "group-input-set"
    )!;
    staleGroupInput.set_digest = digest("f");
    const payload = Object.fromEntries(
      Object.entries(stale).filter(([key]) => key !== "dependency_set_digest"),
    ) as Omit<typeof stale, "dependency_set_digest">;
    stale.dependency_set_digest = indexerArtifactDependencySetDigest(payload);
    expect(() => validateIndexerArtifactDependencySet({
      value: stale,
      result,
      workset,
      run_envelope: runEnvelope,
      dependency_view: dependencyView,
    })).toThrow(/does not match.*dependency view/);
  });

  test("validates structured Section declarations but never scans semantic prose", () => {
    const result = artifactResult();
    const sourceFact = {
      fact_ref: "source-fact:button-handler",
      fact_kind: "code-symbol",
      qualified_item_path: "symbol:function:handleButton@4",
      signature_digest: digest("6"),
    };
    const sourceInventory = buildIndexerSourceIdentityInventory({
      source_ref: result.source_ref,
      module_ref: result.module_ref,
      source_input_digest: digest("7"),
      files: [{
        normalized_path: "src/button.ts",
        content_digest: result.evidence_bindings[0]!.content_digest,
        facts: [sourceFact],
      }],
    });
    result.structured_declarations = buildIndexerStructuredDeclarationSet({
      source_identity_inventory_digest: sourceInventory.inventory_digest,
      declarations: [{
        carrier_kind: "section-evidence",
        carrier_ref: indexerSectionEvidenceCarrierRef({
          logical_unit_ref: result.logical_unit.logical_unit_ref,
          artifact_id: "button-overview",
          section_key: "summary",
        }),
        declaration_kind: "handler",
        source_ref: result.source_ref,
        module_ref: result.module_ref,
        target: {
          target_type: "item",
          normalized_path: "src/button.ts",
          source_fact_ref: sourceFact.fact_ref,
          qualified_item_path: sourceFact.qualified_item_path,
          signature_digest: sourceFact.signature_digest,
        },
        evidence_refs: [result.evidence_bindings[0]!.evidence_ref],
      }],
    });
    rehash(result);
    expect(validate(result, authorWorkset(), {
      source_identity_inventory: sourceInventory,
    })).toEqual(result);
    expect(() => validate(result)).toThrow(/current CLI source identity inventory/);

    const proseOnly = artifactResult();
    const artifact = proseOnly.artifacts[0]!;
    if (artifact.representation !== "sections") throw new Error("expected sections");
    const block = artifact.sections[0]!.blocks[0]!;
    if (block.layer !== "semantic-prose") throw new Error("expected semantic prose");
    block.markdown = "See src/not-real.ts and fakeMethod() for an illustrative example.";
    rehash(proseOnly);
    expect(validate(proseOnly)).toEqual(proseOnly);
  });

  test("requires 100% owner-local evidence coverage for emitted structured claims", () => {
    const result = artifactResult();
    result.structured_claims = buildIndexerStructuredClaimSet({
      author_workset_digest: result.author_workset_digest,
      logical_unit_ref: result.logical_unit.logical_unit_ref,
      claims: [{
        claim_ref: "claim:button-public-contract",
        claim_kind: "public-contract",
        subject_ref: result.logical_unit.logical_unit_ref,
        owner: {
          artifact_id: "button-overview",
          section_key: "summary",
        },
        evidence_refs: [result.evidence_bindings[0]!.evidence_ref],
      }],
    });
    rehash(result);
    expect(validate(result)).toEqual(result);

    const audit = buildIndexerGeneratedAuthoringAudit(result);
    expect(validateIndexerGeneratedAuthoringAudit(audit)).toMatchObject({
      protocol: "context.indexer.generated-authoring-audit/v1",
      hard_findings: [],
      structured_claim_count: 1,
      evidence_covered_structured_claim_count: 1,
      agent_review_required: true,
      semantic_prose_review_targets: [{
        artifact_id: "button-overview",
        section_key: "summary",
        content_ref: "block:summary-block",
        advisory_code: "semantic-prose-agent-review-required",
      }],
    });
    expect(() => validateIndexerGeneratedAuthoringAudit({
      ...audit,
      audit_digest: digest("0"),
    })).toThrow(/audit digest is invalid/);

    const outsideOwnerEvidence = structuredClone(result);
    const secondEvidencePayload = {
      evidence_ref: "evidence:button-test",
      kind: "test-result" as const,
      source_ref: outsideOwnerEvidence.source_ref,
      module_ref: outsideOwnerEvidence.module_ref,
      locator: {
        path: "src/button.test.ts",
        start_line: 1,
        end_line: 10,
      },
      content_digest: digest("9"),
      coverage_tier: "lightweight-evidence" as const,
    };
    outsideOwnerEvidence.evidence_bindings.push({
      ...secondEvidencePayload,
      binding_digest: indexerEvidenceBindingDigest(secondEvidencePayload),
    });
    outsideOwnerEvidence.structured_claims = buildIndexerStructuredClaimSet({
      author_workset_digest: outsideOwnerEvidence.author_workset_digest,
      logical_unit_ref: outsideOwnerEvidence.logical_unit.logical_unit_ref,
      claims: [{
        claim_ref: "claim:button-public-contract",
        claim_kind: "public-contract",
        subject_ref: outsideOwnerEvidence.logical_unit.logical_unit_ref,
        owner: { artifact_id: "button-overview", section_key: "summary" },
        evidence_refs: [secondEvidencePayload.evidence_ref],
      }],
    });
    rehash(outsideOwnerEvidence);
    expect(() => validate(outsideOwnerEvidence)).toThrow(
      /evidence is not carried by its owner Section/,
    );

    const unauthorizedSubject = structuredClone(result);
    unauthorizedSubject.structured_claims = buildIndexerStructuredClaimSet({
      author_workset_digest: unauthorizedSubject.author_workset_digest,
      logical_unit_ref: unauthorizedSubject.logical_unit.logical_unit_ref,
      claims: [{
        claim_ref: "claim:button-public-contract",
        claim_kind: "public-contract",
        subject_ref: "member:outside-authority",
        owner: { artifact_id: "button-overview", section_key: "summary" },
        evidence_refs: [unauthorizedSubject.evidence_bindings[0]!.evidence_ref],
      }],
    });
    rehash(unauthorizedSubject);
    expect(() => validate(unauthorizedSubject)).toThrow(/unauthorized subject/);
  });

  test("hard-fails controlled placeholders even inside structurally rich output", () => {
    const placeholder = artifactResult();
    const placeholderArtifact = placeholder.artifacts[0]!;
    if (placeholderArtifact.representation !== "sections") throw new Error("expected sections");
    const placeholderBlock = placeholderArtifact.sections[0]!.blocks[0]!;
    if (placeholderBlock.layer !== "semantic-prose") throw new Error("expected semantic prose");
    placeholderBlock.markdown = [
      "## Capability summary",
      "",
      "The component exposes a documented workflow with several apparent details.",
      "",
      "| Stage | Responsibility |",
      "| --- | --- |",
      "| Input | Validate the request |",
      "| Output | Return a normalized response |",
      "",
      "### Runtime platform",
      "",
      "[TODO]",
    ].join("\n");
    rehash(placeholder);
    expect(() => validate(placeholder)).toThrow(/generated-placeholder/);

    const empty = artifactResult();
    const emptyArtifact = empty.artifacts[0]!;
    if (emptyArtifact.representation !== "sections") throw new Error("expected sections");
    const emptyBlock = emptyArtifact.sections[0]!.blocks[0]!;
    if (emptyBlock.layer !== "semantic-prose") throw new Error("expected semantic prose");
    emptyBlock.markdown = "## Summary";
    rehash(empty);
    expect(() => validate(empty)).toThrow(/empty-required-section/);

    const unresolvedVariable = artifactResult();
    const evidenceRef = unresolvedVariable.evidence_bindings[0]!.evidence_ref;
    unresolvedVariable.artifacts = [{
      artifact_id: "button-overview",
      artifact_kind: "overview",
      artifact_policy_variant: "standard",
      representation: "template",
      template_id: "component-guide",
      variables: {
        summary: {
          value: "{{variable:summary}}",
          fact_refs: [],
          evidence_refs: [evidenceRef],
        },
      },
      section_projections: [{
        section_key: "summary",
        owner_indexer_id: unresolvedVariable.indexer_id,
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kind: "overview",
      }],
    }];
    rehash(unresolvedVariable);
    expect(() => validate(unresolvedVariable)).toThrow(/generated-placeholder/);
  });

  test("routes structurally rich speculative prose to Agent Review", () => {
    const result = artifactResult();
    const artifact = result.artifacts[0]!;
    if (artifact.representation !== "sections") throw new Error("expected sections");
    const block = artifact.sections[0]!.blocks[0]!;
    if (block.layer !== "semantic-prose") throw new Error("expected semantic prose");
    block.markdown = [
      "## Recovery model",
      "",
      "The implementation may retry through a platform service that is not present in current evidence.",
      "",
      "| Phase | Assumed behavior |",
      "| --- | --- |",
      "| Failure | The platform likely records the operation |",
      "| Resume | A worker may replay the request |",
    ].join("\n");
    rehash(result);
    expect(validate(result)).toEqual(result);
    expect(buildIndexerGeneratedAuthoringAudit(result)).toMatchObject({
      hard_findings: [],
      agent_review_required: true,
      semantic_prose_review_targets: [{
        advisory_code: "semantic-prose-agent-review-required",
      }],
    });
  });

  test("binds deterministic blocks to canonical Facts instead of arbitrary block values", () => {
    const result = artifactResult();
    const artifact = result.artifacts[0]!;
    if (artifact.representation !== "sections") throw new Error("expected sections");
    artifact.sections[0]!.blocks = [{
      block_id: "summary-catalog",
      layer: "deterministic-block",
      renderer: "json-code-block",
      fact_refs: ["fact:button-summary"],
    }];
    rehash(result);
    expect(validate(result)).toEqual(result);

    const unknownFact = structuredClone(result);
    const unknownArtifact = unknownFact.artifacts[0]!;
    if (unknownArtifact.representation !== "sections") throw new Error("expected sections");
    const block = unknownArtifact.sections[0]!.blocks[0]!;
    if (block.layer !== "deterministic-block") throw new Error("expected deterministic block");
    block.fact_refs = ["fact:unknown"];
    rehash(unknownFact);
    expect(() => validate(unknownFact)).toThrow("unknown ArtifactResult Fact");
  });

  test("binds every capability-group member to evidence projected by a real Section", () => {
    const memberIds = [MEMBER_REF, "member:hook/use-button"];
    const workset = authorWorkset(false, memberIds);
    const result = artifactResult(workset, [], memberIds);
    const evidenceRef = result.evidence_bindings[0]!.evidence_ref;
    result.capability_group_evidence = buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: memberIds,
      capability_groups: [{
        capability_key: "button-public-control",
        member_evidence: memberIds.map((member_id) => ({
          member_id,
          evidence_refs: [evidenceRef],
        })),
        section_evidence: [{
          artifact_id: "button-overview",
          section_key: "summary",
          evidence_refs: [evidenceRef],
        }],
      }],
    });
    const capabilityGroupRef = result.capability_group_evidence.capability_groups[0]!
      .capability_group_ref;
    result.inventory_dispositions = buildIndexerInventoryDispositionSet({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      dispositions: memberIds.map((member_id) => ({
        member_id,
        member_kind: "component" as const,
        inventory_disposition: "owned" as const,
        projection_disposition: "capability-group" as const,
        capability_group_ref: capabilityGroupRef,
      })),
    });
    rehash(result);
    expect(validate(result, workset)).toEqual(result);

    const missingSection = structuredClone(result);
    missingSection.capability_group_evidence = buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: memberIds,
      capability_groups: [{
        capability_key: "button-public-control",
        member_evidence: memberIds.map((member_id) => ({
          member_id,
          evidence_refs: [evidenceRef],
        })),
        section_evidence: [{
          artifact_id: "button-overview",
          section_key: "missing",
          evidence_refs: [evidenceRef],
        }],
      }],
    });
    rehash(missingSection);
    expect(() => validate(missingSection, workset)).toThrow(/unknown Section/);
  });

  test("rejects inventory kind drift and request-material without a blocking question gap", () => {
    const kindDrift = artifactResult();
    const evidenceRef = kindDrift.evidence_bindings[0]!.evidence_ref;
    kindDrift.inventory_dispositions = buildIndexerInventoryDispositionSet({
      author_workset_digest: kindDrift.author_workset_digest,
      group_projection_digest: kindDrift.group_projection_digest,
      logical_unit_ref: kindDrift.logical_unit.logical_unit_ref,
      dispositions: [{
        member_id: MEMBER_REF,
        member_kind: "service",
        inventory_disposition: "owned",
        projection_disposition: "boundary-only",
        evidence_refs: [evidenceRef],
      }],
    });
    rehash(kindDrift);
    expect(() => validate(kindDrift)).toThrow(/does not match its author workset/);

    const missingGap = artifactResult();
    missingGap.question_target_dispositions = [{
      question_target_key: QUESTION_TARGET,
      state: "answered",
      evidence_binding_digest: missingGap.evidence_bindings[0]!.binding_digest,
    }];
    missingGap.inventory_dispositions = buildIndexerInventoryDispositionSet({
      author_workset_digest: missingGap.author_workset_digest,
      group_projection_digest: missingGap.group_projection_digest,
      logical_unit_ref: missingGap.logical_unit.logical_unit_ref,
      dispositions: [{
        member_id: MEMBER_REF,
        member_kind: "component",
        inventory_disposition: "request-material",
        material_question_proposal_ref: "proposal:public-contract-gap",
      }],
    });
    rehash(missingGap);
    expect(() => validate(missingGap)).toThrow(/lacks a blocking material gap/);
  });

  test("rejects output digest, provider, or source authority drift", () => {
    const outputDrift = artifactResult();
    outputDrift.output_digest = digest("f");
    expect(() => validate(outputDrift)).toThrow(/output digest/);

    const providerDrift = artifactResult();
    providerDrift.provider_integrity = digest("e");
    rehash(providerDrift);
    expect(() => validate(providerDrift)).toThrow(/authority\/workset/);

    const sourceDrift = artifactResult();
    sourceDrift.evidence_bindings[0]!.source_ref = "repo:other@revision";
    const evidence = sourceDrift.evidence_bindings[0]!;
    evidence.binding_digest = indexerEvidenceBindingDigest({
      evidence_ref: evidence.evidence_ref,
      kind: evidence.kind,
      source_ref: evidence.source_ref,
      module_ref: evidence.module_ref,
      locator: evidence.locator,
      content_digest: evidence.content_digest,
      coverage_tier: evidence.coverage_tier,
    });
    rehash(sourceDrift);
    expect(() => validate(sourceDrift)).toThrow(/escapes its source\/module/);
  });

  test("rejects unknown evidence, ineligible policy, and inconsistent Section projection", () => {
    const unknownEvidence = artifactResult();
    const sections = unknownEvidence.artifacts[0]!;
    if (sections.representation !== "sections") throw new Error("expected sections");
    const block = sections.sections[0]!.blocks[0]!;
    if (block.layer !== "semantic-prose") throw new Error("expected semantic prose");
    block.evidence_refs = ["evidence:unknown"];
    rehash(unknownEvidence);
    expect(() => validate(unknownEvidence)).toThrow(/unknown evidence/);

    const policy = artifactResult();
    policy.artifacts[0]!.artifact_policy_variant = "unregistered";
    rehash(policy);
    expect(() => validate(policy)).toThrow(/ineligible policy variant/);

    const projection = artifactResult();
    const projectionArtifact = projection.artifacts[0]!;
    if (projectionArtifact.representation !== "sections") throw new Error("expected sections");
    projectionArtifact.sections[0]!.artifact_kind = "another-kind";
    rehash(projection);
    expect(() => validate(projection)).toThrow(/projection does not match/);
  });

  test("validates template variable evidence and template Section projection authority", () => {
    const result = artifactResult();
    const evidenceRef = result.evidence_bindings[0]!.evidence_ref;
    result.artifacts = [{
      artifact_id: "button-overview",
      artifact_kind: "overview",
      artifact_policy_variant: "standard",
      representation: "template",
      template_id: "component-guide",
      variables: {
        summary: {
          value: "A public control.",
          fact_refs: [],
          evidence_refs: [evidenceRef],
        },
      },
      section_projections: [{
        section_key: "summary",
        owner_indexer_id: result.indexer_id,
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kind: "overview",
      }],
    }];
    rehash(result);
    expect(validate(result)).toEqual(result);

    const unknownEvidence = structuredClone(result);
    const template = unknownEvidence.artifacts[0]!;
    if (template.representation !== "template") throw new Error("expected template");
    template.variables.summary!.evidence_refs = ["evidence:unknown"];
    rehash(unknownEvidence);
    expect(() => validate(unknownEvidence)).toThrow(/unknown evidence/);

    const projection = structuredClone(result);
    const projected = projection.artifacts[0]!;
    if (projected.representation !== "template") throw new Error("expected template");
    projected.section_projections[0]!.owner_indexer_id = "another-indexer";
    rehash(projection);
    expect(() => validate(projection)).toThrow(/projection does not match/);
  });

  test("rejects unknown question targets and dangling material proposals", () => {
    const unknownTarget = artifactResult();
    unknownTarget.question_target_dispositions[0]!.question_target_key =
      "question-target:unknown";
    rehash(unknownTarget);
    expect(() => validate(unknownTarget)).toThrow(/unknown CLI target/);

    const dangling = artifactResult();
    dangling.question_target_dispositions = [];
    rehash(dangling);
    expect(() => validate(dangling)).toThrow(/proposal is not referenced/);
  });

  test("validates exact TargetResolutionView reuse and rejects outside identities", () => {
    const workset = authorWorkset(true);
    const queryRef = workset.target_resolution_view!.entries[0]!.query_ref;
    const result = artifactResult(workset, [{
      query_ref: queryRef,
      disposition: "reuse-existing",
      target_subject_key: TARGET_SUBJECT,
      target_node_ref: canonicalIndexerNodeRef(TARGET_SUBJECT),
    }]);
    expect(validate(result, workset)).toEqual(result);

    const outside = artifactResult(workset, [{
      query_ref: queryRef,
      disposition: "reuse-existing",
      target_subject_key: SUBJECT,
      target_node_ref: canonicalIndexerNodeRef(SUBJECT),
    }]);
    expect(() => validate(outside, workset)).toThrow(
      /index-target-resolution-invalid: resolved identity mismatch/,
    );
  });

  test("requires an absent target to choose an explicit independent or material path", () => {
    const workset = authorWorkset("absent");
    const queryRef = workset.target_resolution_view!.entries[0]!.query_ref;
    const independent = artifactResult(workset, [{
      query_ref: queryRef,
      disposition: "create-independent",
      subject_key: TARGET_SUBJECT,
      reason_code: "independent-reader-value",
      evidence_refs: ["evidence:button-source"],
    }]);
    expect(validate(independent, workset)).toEqual(independent);

    const material = artifactResult(workset, [{
      query_ref: queryRef,
      disposition: "request-material",
      missing_facts: ["independent-reader-value"],
      source_hints: ["source:architecture-guide"],
    }]);
    expect(validate(material, workset)).toEqual(material);

    const silentFallback = artifactResult(workset);
    expect(() => validate(silentFallback, workset)).toThrow(
      /ArtifactResult must close every TargetResolutionView query/,
    );
    const inventedReuse = artifactResult(workset, [{
      query_ref: queryRef,
      disposition: "reuse-existing",
      target_subject_key: TARGET_SUBJECT,
      target_node_ref: canonicalIndexerNodeRef(TARGET_SUBJECT),
    }]);
    expect(() => validate(inventedReuse, workset)).toThrow(
      /resolved identity mismatch/,
    );
  });

  test("permits resolved targets to become independent only with a distinct evidenced identity", () => {
    const workset = authorWorkset("resolved");
    const queryRef = workset.target_resolution_view!.entries[0]!.query_ref;
    const independent = artifactResult(workset, [{
      query_ref: queryRef,
      disposition: "create-independent",
      subject_key: SUBJECT,
      reason_code: "independent-reader-value",
      evidence_refs: ["evidence:button-source"],
    }]);
    expect(validate(independent, workset)).toEqual(independent);

    const sameIdentity = artifactResult(workset, [{
      query_ref: queryRef,
      disposition: "create-independent",
      subject_key: TARGET_SUBJECT,
      reason_code: "independent-reader-value",
      evidence_refs: ["evidence:button-source"],
    }]);
    expect(() => validate(sameIdentity, workset)).toThrow(
      /must introduce a distinct SubjectKey/,
    );

    const unknownQuery = artifactResult(workset, [{
      query_ref: digest("e"),
      disposition: "unsupported",
      missing_capabilities: ["subject-catalog"],
    }]);
    expect(() => validate(unknownQuery, workset)).toThrow(
      /must close every TargetResolutionView query/,
    );
  });

  test("does not allow a primary workset to invent target resolution", () => {
    const result = artifactResult(authorWorkset(), [{
      query_ref: digest("f"),
      disposition: "unsupported",
      missing_capabilities: ["subject-catalog"],
    }]);
    expect(() => validate(result)).toThrow(
      /index-target-resolution-invalid: primary author Result cannot invent target resolution entries/,
    );
  });

  test("strict schema rejects output paths and Provider-owned collection", () => {
    const result = artifactResult() as unknown as Record<string, unknown>;
    result.output_path = "knowledge/output.md";
    result.collection = "codeindex";
    expect(() => validate(result)).toThrow();
  });
});
