import { describe, expect, test } from "bun:test";
import {
  assertIndexerPhysicalArtifactAuditPassed,
  auditIndexerPhysicalArtifacts,
  buildIndexerArtifactBundle,
  buildIndexerLayoutProposalSet,
  buildIndexerNavigationArtifactPlan,
  buildIndexerSharedArtifactFingerprint,
  canonicalIndexerNodeRef,
  indexerLayoutSectionIdentityRef,
  indexerProtocolDigest,
  validateIndexerArtifactManifest,
  validateIndexerPhysicalArtifactAudit,
  type IndexerArtifactBundle,
  type IndexerLayoutProposal,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (value: string) => indexerProtocolDigest({ value });
const SHARED_ARTIFACT_FINGERPRINT = buildIndexerSharedArtifactFingerprint({
  indexer_id: "sample-indexer",
  program_digest: null,
  instructions_digest: digest("instructions"),
  template_set_digest: digest("templates"),
});

type ArtifactSpec = {
  id: string;
  kind: string;
  purpose: "required" | "discretionary" | "semantic-split";
  state?: "ready" | "material-gap";
  splitOf?: string;
  boundary?: { axis: string; start_key: string; end_key: string };
};

function logicalUnit(namespace: string, specs: readonly ArtifactSpec[]): {
  proposal: IndexerLayoutProposal;
  bundle: IndexerArtifactBundle;
} {
  const subject: IndexerSubjectKey = {
    protocol: "context.subject-key/v1",
    namespace,
    kind: "capability",
    local_key: "overview",
  };
  const nodeRef = canonicalIndexerNodeRef(subject);
  const nodeDigest = nodeRef.replace(/^node:subject:sha256:/u, "");
  const artifactRefs = new Map(specs.map((spec) => [
    spec.id,
    `artifact:subject:${digest(`${namespace}:${spec.id}`)}`,
  ]));
  const artifacts = specs.map((spec) => {
    const artifactRef = artifactRefs.get(spec.id)!;
    const state = spec.state ?? "ready";
    const sectionKey = `${spec.id}-summary`;
    const sectionIdentityRef = indexerLayoutSectionIdentityRef({
      node_ref: nodeRef,
      owner_indexer_id: "sample-indexer",
      artifact_kind: spec.kind,
      section_key: sectionKey,
    });
    return {
      artifact_ref: artifactRef,
      node_ref: nodeRef,
      artifact_id: spec.id,
      artifact_kind: spec.kind,
      internal_view_ref: `view:artifact:${digest(`${namespace}:${spec.id}:view`)}`,
      collection: "codeindex" as const,
      output_path: `knowledge/codeindex/${nodeDigest}/${spec.id}.md`,
      shared_artifact_fingerprint_digest:
        SHARED_ARTIFACT_FINGERPRINT.fingerprint_digest,
      purpose: spec.purpose,
      split_of_artifact_ref: spec.purpose === "semantic-split"
        ? artifactRefs.get(spec.splitOf!)!
        : null,
      split_boundary: spec.purpose === "semantic-split" ? spec.boundary! : null,
      sections: [{
        section_ref: `section:subject:${digest(`${namespace}:${spec.id}:summary`)}`,
        section_identity_ref: sectionIdentityRef,
        section_key: sectionKey,
        owner_indexer_id: "sample-indexer",
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kind: spec.kind,
        state: state === "ready" ? "structured" as const : "material-gap" as const,
        content_digest: state === "ready" ? digest(`${namespace}:${spec.id}:content`) : null,
        evidence_refs: state === "ready" ? ["evidence:anonymous-source"] : [],
        material_question_proposal_ref: state === "ready"
          ? null
          : `proposal:material-gap:${digest(`${namespace}:${spec.id}:gap`)}`,
        collection_resolution_digest: digest(`${namespace}:${spec.id}:collection`),
      }],
    };
  });
  const payload: Omit<IndexerLayoutProposal, "proposal_digest"> = {
    protocol: "context.indexer.layout-proposal/v1",
    indexer_id: "sample-indexer",
    source_ref: `repo:${namespace}@revision`,
    profile: "component-library",
    profile_contract_digest: digest("profile-contract"),
    subject_key_schema_set_digest: digest("subject-schema-set"),
    subject_key_schema_digest: digest("subject-schema"),
    artifact_result_digest: digest(`${namespace}:result`),
    post_author_composition_fingerprint: null,
    shared_artifact_fingerprint: SHARED_ARTIFACT_FINGERPRINT,
    node: { node_ref: nodeRef, subject_key: subject },
    artifacts,
  };
  return {
    proposal: { ...payload, proposal_digest: indexerProtocolDigest(payload) },
    bundle: buildIndexerArtifactBundle({
      logical_unit_ref: nodeRef,
      artifact_policy_variant: "standard",
      artifacts: specs.map((spec) => spec.purpose === "semantic-split"
        ? {
          artifact_id: spec.id,
          artifact_kind: spec.kind,
          purpose: spec.purpose,
          split_of: spec.splitOf!,
          boundary: spec.boundary!,
          reader_question_refs: ["question:overview"],
          evidence_refs: ["evidence:anonymous-source"],
        }
        : {
          artifact_id: spec.id,
          artifact_kind: spec.kind,
          purpose: spec.purpose,
          reader_question_refs: ["question:overview"],
          evidence_refs: ["evidence:anonymous-source"],
        }),
    }),
  };
}

function fileFor(
  proposal: IndexerLayoutProposal,
  artifactId: string,
  markdown = "# Anonymous capability\n\nCurrent evidence explains this capability.\n",
) {
  const artifact = proposal.artifacts.find((item) => item.artifact_id === artifactId);
  if (artifact === undefined) throw new Error(`missing fixture Artifact ${artifactId}`);
  return { output_path: artifact.output_path, markdown };
}

describe("physical Artifact manifest and audit", () => {
  test("accepts catalog-only logical units without manufacturing an empty physical Artifact", () => {
    const published = logicalUnit("anonymous-published", [{
      id: "overview",
      kind: "overview",
      purpose: "required",
    }]);
    const catalogOnly = logicalUnit("anonymous-catalog-only", [{
      id: "unused",
      kind: "overview",
      purpose: "required",
    }]).proposal;
    const { proposal_digest: _digest, ...catalogPayload } = catalogOnly;
    void _digest;
    catalogPayload.artifacts = [];
    const catalogProposal: IndexerLayoutProposal = {
      ...catalogPayload,
      proposal_digest: indexerProtocolDigest(catalogPayload),
    };
    const layoutSet = buildIndexerLayoutProposalSet([
      published.proposal,
      catalogProposal,
    ]);
    const result = auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [published.bundle, null],
      files: [fileFor(published.proposal, "overview")],
    });

    expect(result.audit.state).toBe("passed");
    expect(result.audit.summary.logical_unit_count).toBe(2);
    expect(result.audit.summary.physical_artifact_count).toBe(1);
    expect(result.audit.logical_unit_fan_out).toHaveLength(1);
  });

  test("closes multi-Artifact Bundles, fan-out, semantic splits, and registered navigation", () => {
    const component = logicalUnit("anonymous-components", [{
      id: "overview",
      kind: "overview",
      purpose: "required",
    }, {
      id: "examples",
      kind: "examples",
      purpose: "discretionary",
    }, {
      id: "overview-continuation",
      kind: "overview",
      purpose: "semantic-split",
      splitOf: "overview",
      boundary: { axis: "capability", start_key: "m", end_key: "z" },
    }]);
    const service = logicalUnit("anonymous-service", [{
      id: "guide",
      kind: "overview",
      purpose: "required",
    }]);
    const layoutSet = buildIndexerLayoutProposalSet([component.proposal, service.proposal]);
    const childRefs = layoutSet.proposals.flatMap((proposal) =>
      proposal.artifacts.map((artifact) => artifact.artifact_ref)
    );
    const groupNavigation = buildIndexerNavigationArtifactPlan({
      navigation_ref: "navigation:codeindex:capabilities",
      artifact_id: "capabilities-index",
      output_path: "knowledge/codeindex/capabilities/index.md",
      child_artifact_refs: childRefs,
    });
    const rootNavigation = buildIndexerNavigationArtifactPlan({
      navigation_ref: "navigation:codeindex:root",
      artifact_id: "index",
      output_path: "knowledge/codeindex/index.md",
      child_artifact_refs: [groupNavigation.artifact_ref],
    });
    const result = auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [component.bundle, service.bundle],
      navigation_artifacts: [rootNavigation, groupNavigation],
      files: [
        ...component.proposal.artifacts.map((artifact) =>
          fileFor(component.proposal, artifact.artifact_id)
        ),
        fileFor(service.proposal, "guide"),
        { output_path: groupNavigation.output_path, markdown: "# Capabilities\n\n- Capability guide\n" },
        { output_path: rootNavigation.output_path, markdown: "# Index\n\n- Capabilities\n" },
      ],
    });

    expect(result.audit.state).toBe("passed");
    expect(result.audit.summary).toEqual({
      logical_unit_count: 2,
      planned_bundle_artifact_count: 4,
      complete_bundle_artifact_count: 4,
      physical_artifact_count: 6,
      registered_physical_artifact_count: 6,
      navigation_artifact_count: 2,
      empty_artifact_count: 0,
      orphan_artifact_count: 0,
      missing_artifact_count: 0,
      unresolved_material_artifact_count: 0,
    });
    expect(result.audit.logical_unit_fan_out).toContainEqual(expect.objectContaining({
      logical_unit_ref: component.bundle.logical_unit_ref,
      planned_artifact_count: 3,
      materialized_artifact_count: 3,
      discretionary_fan_out: 1,
      semantic_split_part_count: 1,
    }));
    expect(JSON.stringify(result.manifest)).not.toContain("Current evidence explains");
    expect(validateIndexerArtifactManifest(result.manifest)).toEqual(result.manifest);
    expect(validateIndexerPhysicalArtifactAudit({
      ...result,
      layout_proposal_set: layoutSet,
      artifact_bundles: [component.bundle, service.bundle],
      navigation_artifacts: [rootNavigation, groupNavigation],
    })).toEqual(result.audit);
    expect(assertIndexerPhysicalArtifactAuditPassed({
      ...result,
      layout_proposal_set: layoutSet,
      artifact_bundles: [component.bundle, service.bundle],
      navigation_artifacts: [rootNavigation, groupNavigation],
    })).toEqual(result.audit);
  });

  test("reports missing, empty, and orphan physical Artifacts without hiding samples", () => {
    const unit = logicalUnit("anonymous-incomplete", [{
      id: "overview",
      kind: "overview",
      purpose: "required",
    }, {
      id: "examples",
      kind: "examples",
      purpose: "discretionary",
    }]);
    const layoutSet = buildIndexerLayoutProposalSet([unit.proposal]);
    const result = auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
      files: [{
        ...fileFor(unit.proposal, "overview"),
        markdown: "---\ntitle: Empty\n---\n# Empty\n<!-- no reader content -->\n",
      }, {
        output_path: "knowledge/codeindex/orphan.md",
        markdown: "# Orphan\n\nThis file has no registered owner.\n",
      }],
    });

    expect(result.audit.state).toBe("failed");
    expect(result.audit.diagnostics.map((item) => item.code)).toEqual([
      "empty-physical-artifact",
      "missing-physical-artifact",
      "orphan-physical-artifact",
    ]);
    expect(result.audit.summary).toMatchObject({
      complete_bundle_artifact_count: 0,
      empty_artifact_count: 1,
      missing_artifact_count: 1,
      orphan_artifact_count: 1,
    });
    expect(() => assertIndexerPhysicalArtifactAuditPassed({
      ...result,
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
    })).toThrow(/empty-physical-artifact/);
  });

  test("keeps material-gap Artifacts blocked even when a file is supplied", () => {
    const unit = logicalUnit("anonymous-gap", [{
      id: "overview",
      kind: "overview",
      purpose: "required",
      state: "material-gap",
    }]);
    const layoutSet = buildIndexerLayoutProposalSet([unit.proposal]);
    const result = auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
      files: [fileFor(unit.proposal, "overview")],
    });

    expect(result.audit.diagnostics).toEqual([expect.objectContaining({
      code: "unresolved-material-artifact",
      logical_unit_ref: unit.bundle.logical_unit_ref,
    })]);
    expect(result.audit.summary.complete_bundle_artifact_count).toBe(0);
    expect(result.audit.summary.missing_artifact_count).toBe(0);
  });

  test("rejects layout/Bundle drift, duplicate files, and ungrounded navigation", () => {
    const unit = logicalUnit("anonymous-structural", [{
      id: "overview",
      kind: "overview",
      purpose: "required",
    }]);
    const unrelated = logicalUnit("anonymous-other", [{
      id: "other",
      kind: "overview",
      purpose: "required",
    }]);
    const layoutSet = buildIndexerLayoutProposalSet([unit.proposal]);

    expect(() => auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unrelated.bundle],
      files: [],
    })).toThrow(/lacks an Artifact Bundle/);
    const file = fileFor(unit.proposal, "overview");
    expect(() => auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
      files: [file, file],
    })).toThrow(/file paths must be unique/);
    const navigation = buildIndexerNavigationArtifactPlan({
      navigation_ref: "navigation:codeindex:root",
      artifact_id: "index",
      output_path: "knowledge/codeindex/index.md",
      child_artifact_refs: ["artifact:subject:unknown"],
    });
    expect(() => auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
      navigation_artifacts: [navigation],
      files: [file],
    })).toThrow(/unknown child/);

    const firstSeed = buildIndexerNavigationArtifactPlan({
      navigation_ref: "navigation:codeindex:first",
      artifact_id: "first",
      output_path: "knowledge/codeindex/first.md",
      child_artifact_refs: [unit.proposal.artifacts[0]!.artifact_ref],
    });
    const secondSeed = buildIndexerNavigationArtifactPlan({
      navigation_ref: "navigation:codeindex:second",
      artifact_id: "second",
      output_path: "knowledge/codeindex/second.md",
      child_artifact_refs: [unit.proposal.artifacts[0]!.artifact_ref],
    });
    const first = buildIndexerNavigationArtifactPlan({
      ...firstSeed,
      child_artifact_refs: [secondSeed.artifact_ref],
    });
    const second = buildIndexerNavigationArtifactPlan({
      ...secondSeed,
      child_artifact_refs: [firstSeed.artifact_ref],
    });
    expect(() => auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
      navigation_artifacts: [first, second],
      files: [file],
    })).toThrow(/cycle/);
  });

  test("reports the 1500-line readability threshold as advisory only", () => {
    const unit = logicalUnit("anonymous-large", [{
      id: "catalog",
      kind: "overview",
      purpose: "required",
    }]);
    const layoutSet = buildIndexerLayoutProposalSet([unit.proposal]);
    const markdown = ["# Large catalog", ...Array.from({ length: 1501 }, (_, index) => `entry ${index}`)]
      .join("\n");
    const result = auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
      files: [fileFor(unit.proposal, "catalog", markdown)],
    });

    expect(result.audit.state).toBe("passed");
    expect(result.audit.readability_advisories).toEqual([expect.objectContaining({
      code: "physical-artifact-reader-body-over-1500-lines",
      reader_body_line_count: 1502,
    })]);
  });

  test("recomputes audit ownership and rejects a digest-consistent forged manifest", () => {
    const unit = logicalUnit("anonymous-forgery", [{
      id: "overview",
      kind: "overview",
      purpose: "required",
    }]);
    const layoutSet = buildIndexerLayoutProposalSet([unit.proposal]);
    const result = auditIndexerPhysicalArtifacts({
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
      files: [fileFor(unit.proposal, "overview")],
    });
    const forged = structuredClone(result.manifest);
    const owner = forged.files[0]!.owner;
    if (owner.kind !== "logical-unit") throw new Error("expected logical-unit owner");
    owner.logical_unit_ref = "node:subject:forged";
    const { manifest_digest: _digest, ...payload } = forged;
    void _digest;
    forged.manifest_digest = indexerProtocolDigest(payload);

    expect(() => validateIndexerPhysicalArtifactAudit({
      audit: result.audit,
      manifest: forged,
      layout_proposal_set: layoutSet,
      artifact_bundles: [unit.bundle],
    })).toThrow(/changes its planned owner/);
  });
});
