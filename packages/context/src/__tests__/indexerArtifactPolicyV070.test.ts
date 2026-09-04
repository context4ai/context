import { describe, expect, test } from "bun:test";
import {
  buildIndexerArtifactBundle,
  indexerOperatorContractDigest,
  indexerProviderManifestSchema,
  indexerProfileContractDigest,
  parseIndexerProviderManifest,
  resolveIndexerArtifactPolicyEligibility,
  validateIndexerArtifactBundlePolicy,
  validateIndexerArtifactPolicyEligibility,
  validateIndexerAuthoringFixture,
  validateIndexerProviderContractReferences,
  type IndexerArtifactBundleEntry,
  type IndexerOperatorContract,
  type IndexerProfileContract,
} from "../index.js";

function contracts() {
  const operatorPayload: Omit<IndexerOperatorContract, "contract_digest"> = {
    protocol: "context.indexer.operator-contract/v1",
    version: "1.0.0",
    selector_operators: ["all-inventory"],
    grouping_operators: ["by-subject-key"],
    metric_operators: ["discretionary-artifact-count"],
    threshold_operators: ["explicit", "inflation-sensitive"],
    selector_fact_paths: ["target.eligible", "target.reader_mode", "evidence.current"],
  };
  const operators: IndexerOperatorContract = {
    ...operatorPayload,
    contract_digest: indexerOperatorContractDigest(operatorPayload),
  };
  const profilePayload: Omit<IndexerProfileContract, "contract_digest"> = {
    protocol: "context.indexer.profile-contract/v1",
    version: "1.0.0",
    operator_contract_version: operators.version,
    operator_contract_digest: operators.contract_digest,
    coverage_domains: [
      "technical-structure",
      "public-contract",
      "business-semantics",
      "operations",
    ],
    profiles: [{
      id: "component-library",
      parser_requirements: [],
      inventory_domains: [{
        id: "inventory",
        selector: { operator: "all-inventory" },
        disposition_required: true,
      }],
      required_dispositions: ["owned", "excluded", "unsupported"],
      metrics: [{
        id: "discretionary-artifacts-per-unit",
        unit: "count",
        operator: "discretionary-artifact-count",
        threshold_policy: "inflation-sensitive",
        direction: "maximum",
      }],
      artifact_policy_variants: [{
        id: "standard",
        eligibility: {
          protocol: "context.indexer.selector/v1",
          expression: {
            op: "all",
            args: [
              { op: "equals", fact: "target.eligible", value: true },
              { op: "equals", fact: "target.reader_mode", value: "reference" },
            ],
          },
        },
        artifact_kinds: {
          required: ["content"],
          discretionary: ["examples"],
        },
        thresholds: {
          "discretionary-artifacts-per-unit": { recommended_max: 1 },
        },
      }],
      question_target_domains: [{
        id: "primary-subject",
        selector: { operator: "all-inventory" },
        grouping_operator: "by-subject-key",
        subject_key_kind: "component",
        granularity: "identity",
      }],
      reader_question_contracts: [{
        ref: "question:overview",
        semantic: "What current evidence explains this anonymous capability?",
        version: 1,
        coverage_domain: "public-contract",
        target_domain_ref: "primary-subject",
        target_selector: {
          protocol: "context.indexer.selector/v1",
          expression: { op: "equals", fact: "target.eligible", value: true },
        },
        evidence_contract: {
          accepted_kinds: ["code"],
          minimum_items: 1,
          minimum_distinct_sources: 1,
          provenance_constraints: {
            protocol: "context.indexer.selector/v1",
            expression: { op: "equals", fact: "evidence.current", value: true },
          },
        },
        allowed_exclusion_reason_codes: ["not-applicable"],
      }],
      layout_mappings: [{
        source_roles: ["authoritative-source"],
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kinds: ["content", "examples"],
        collection: "codeindex",
      }],
      variant_schema: { axes: [] },
    }],
    subject_key_schemas: [{
      profile: "component-library",
      version: 1,
      namespace: { operator: "canonical-source-module-namespace" },
      kinds: [{
        id: "component",
        local_key: { operator: "canonical-export-family" },
      }],
    }],
  };
  const profiles: IndexerProfileContract = {
    ...profilePayload,
    contract_digest: indexerProfileContractDigest(profilePayload),
  };
  return { operators, profiles };
}

function eligibility() {
  const { operators, profiles } = contracts();
  return resolveIndexerArtifactPolicyEligibility({
    profile_id: "component-library",
    canonical_facts: {
      target: { reader_mode: "reference", eligible: true, ignored: "not-authority" },
    },
    provider_supported_variants: ["standard"],
    profile_contract: profiles,
    operator_contract: operators,
  });
}

function entries(): IndexerArtifactBundleEntry[] {
  return [{
    artifact_id: "overview",
    artifact_kind: "content",
    purpose: "required",
    reader_question_refs: ["question:overview"],
    evidence_refs: ["evidence:source"],
  }, {
    artifact_id: "examples",
    artifact_kind: "examples",
    purpose: "discretionary",
    reader_question_refs: ["question:examples"],
    evidence_refs: ["evidence:source"],
  }, {
    artifact_id: "overview-continuation",
    artifact_kind: "content",
    purpose: "semantic-split",
    reader_question_refs: ["question:overview"],
    evidence_refs: ["evidence:source"],
    split_of: "overview",
    boundary: {
      axis: "source-namespace",
      start_key: "m",
      end_key: "z",
    },
  }];
}

function providerManifest() {
  return parseIndexerProviderManifest(`
protocol: context.indexer.provider/v1
id: context-indexer-sample
version: 1.0.0
domains: [code]
activation:
  target_kinds: [package]
  required_signals:
    - { id: source, description: Current source is present. }
  supporting_signals: []
  negative_signals: []
provides:
  profiles: [component-library]
  operations:
    - { id: main-index, consumes: context.indexer.main-workset/v2, produces: context.indexer.main-result/v1 }
  source_roles: [authoritative-source]
  logical_units:
    - id: component-family
      identity: canonical-export-family
      artifacts:
        recommended: [content, examples]
        supported_policy_variants: [standard]
provider:
  instructions:
    - { path: references/guidance.md, profiles: [component-library] }
quality_guidance:
  metric_ids: [discretionary-artifacts-per-unit]
`);
}

describe("CLI-owned Artifact policy eligibility", () => {
  test("recomputes canonical facts and derives the inflation hard maximum", () => {
    const report = eligibility();
    const { operators, profiles } = contracts();
    expect(validateIndexerArtifactPolicyEligibility({
      report,
      profile_contract: profiles,
      operator_contract: operators,
    })).toEqual(report);
    expect(report.canonical_facts).toEqual([
      { path: "target.eligible", value: true },
      { path: "target.reader_mode", value: "reference" },
    ]);
    expect(report.eligible_variants[0]?.thresholds[0]).toMatchObject({
      recommended_max: 1,
      hard_max: 2,
    });
  });

  test("rejects unregistered, ineligible, and forged Provider choices", () => {
    const { operators, profiles } = contracts();
    expect(() => resolveIndexerArtifactPolicyEligibility({
      profile_id: "component-library",
      canonical_facts: { target: { eligible: true, reader_mode: "reference" } },
      provider_supported_variants: ["expanded"],
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/unregistered/);
    expect(() => resolveIndexerArtifactPolicyEligibility({
      profile_id: "component-library",
      canonical_facts: { target: { eligible: false, reader_mode: "reference" } },
      provider_supported_variants: ["standard"],
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/no eligible/);
    const forged = eligibility();
    forged.eligible_variants[0]!.thresholds[0]!.hard_max = 99;
    expect(() => validateIndexerArtifactPolicyEligibility({
      report: forged,
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/digest|forged/);
  });

  test("allows required Artifacts when the requirement has no canonical questions", () => {
    const bundle = buildIndexerArtifactBundle({
      logical_unit_ref: "node:questionless-documentation",
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "overview",
        artifact_kind: "content",
        purpose: "required",
        reader_question_refs: [],
        evidence_refs: ["evidence:source"],
      }],
    });
    expect(validateIndexerArtifactBundlePolicy({
      bundle,
      eligibility: eligibility(),
      actual_artifacts: [{
        artifact_id: "overview",
        artifact_kind: "content",
        evidence_refs: ["evidence:source"],
      }],
      allowed_question_refs: [],
      known_evidence_refs: ["evidence:source"],
    })).toEqual(bundle);
  });
});

describe("Provider references to CLI-owned Artifact policy", () => {
  test("accepts only registered metrics, variants, and Artifact kinds", () => {
    const { operators, profiles } = contracts();
    const manifest = providerManifest();
    expect(validateIndexerProviderContractReferences({
      manifest,
      selected_profiles: ["component-library"],
      profile_contract: profiles,
      operator_contract: operators,
    })).toBeUndefined();

    const unknownMetric = structuredClone(manifest);
    unknownMetric.quality_guidance!.metric_ids = ["provider-defined-metric"];
    expect(() => validateIndexerProviderContractReferences({
      manifest: unknownMetric,
      selected_profiles: ["component-library"],
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/unregistered metric/);

    const unknownVariant = structuredClone(manifest);
    unknownVariant.provides.logical_units![0]!.artifacts!.supported_policy_variants = [
      "expanded",
    ];
    expect(() => validateIndexerProviderContractReferences({
      manifest: unknownVariant,
      selected_profiles: ["component-library"],
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/unregistered Artifact policy variant/);

    const unknownKind = structuredClone(manifest);
    unknownKind.provides.logical_units![0]!.artifacts!.recommended = ["provider-page"];
    expect(() => validateIndexerProviderContractReferences({
      manifest: unknownKind,
      selected_profiles: ["component-library"],
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/unregistered Artifact kind/);
  });

  test("accepts a base profile selected only as an extension Provider composer target", () => {
    const { operators, profiles } = contracts();
    const extension = structuredClone(providerManifest());
    extension.provides.profiles = ["example/component-extension"];
    extension.provides.composers = [{
      id: "navigation",
      supported_profiles: ["component-library"],
    }];
    extension.provider.instructions![0]!.profiles = ["example/component-extension"];
    extension.composition = {
      extensions: [{
        profile: "example/component-extension",
        extends: "component-library",
        variant_schema: {
          axes: [{
            id: "mode",
            type: "enum",
            values: ["default"],
            required: false,
          }],
        },
        subject_key_schema: {
          version: 1,
          namespace: { operator: "canonical-source-module-namespace" },
          kinds: [{
            id: "component",
            local_key: { operator: "canonical-export-family" },
          }],
          normalization: [],
        },
      }],
    };
    const manifest = indexerProviderManifestSchema.parse(extension);
    expect(validateIndexerProviderContractReferences({
      manifest,
      selected_profiles: ["component-library"],
      profile_contract: profiles,
      operator_contract: operators,
    })).toBeUndefined();
  });

  test("rejects Provider-owned numeric Artifact limits structurally", () => {
    expect(() => parseIndexerProviderManifest(`
protocol: context.indexer.provider/v1
id: context-indexer-sample
version: 1.0.0
domains: [code]
activation:
  target_kinds: [package]
  required_signals:
    - { id: source, description: Current source is present. }
  supporting_signals: []
  negative_signals: []
provides:
  profiles: [component-library]
  operations:
    - { id: main-index, consumes: context.indexer.main-workset/v2, produces: context.indexer.main-result/v1 }
  logical_units:
    - id: component-family
      identity: canonical-export-family
      artifacts:
        recommended: [content]
        supported_policy_variants: [standard]
        hard_max: 9
provider:
  instructions:
    - { path: references/guidance.md, profiles: [component-library] }
    `)).toThrow(/hard_max|Unrecognized key/);
  });

  test("validates a structurally anonymous authoring fixture against Provider and CLI authority", () => {
    const { operators, profiles } = contracts();
    const manifest = providerManifest();
    const fixture = {
      protocol: "context.indexer.authoring-fixture/v1",
      id: "anonymous-component-library",
      anonymized: true,
      profile: "component-library",
      source_role: "authoritative-source",
      logical_unit_id: "component-family",
      logical_unit_ref: "node:anonymous-component-library",
      canonical_facts: {
        target: { eligible: true, reader_mode: "reference" },
      },
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "overview",
        artifact_kind: "content",
        purpose: "required",
        reader_question_refs: ["question:overview"],
        evidence_refs: ["evidence:anonymous-component-source"],
      }],
      evidence_refs: ["evidence:anonymous-component-source"],
    };
    expect(validateIndexerAuthoringFixture({
      fixture,
      manifest,
      profile_contract: profiles,
      operator_contract: operators,
    }).bundle.artifact_policy_variant).toBe("standard");

    const unprovidedRole = structuredClone(fixture);
    unprovidedRole.source_role = "private-source";
    expect(() => validateIndexerAuthoringFixture({
      fixture: unprovidedRole,
      manifest,
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/unprovided source role/);

    const nonAnonymousEvidence = structuredClone(fixture);
    nonAnonymousEvidence.artifacts[0]!.evidence_refs = ["evidence:private-source"];
    nonAnonymousEvidence.evidence_refs = ["evidence:private-source"];
    expect(() => validateIndexerAuthoringFixture({
      fixture: nonAnonymousEvidence,
      manifest,
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/anonymous evidence namespace/);
  });
});

describe("logical-unit Artifact Bundle", () => {
  test("separates required, discretionary, and semantic-split Artifacts", () => {
    const bundle = buildIndexerArtifactBundle({
      logical_unit_ref: "node:subject:sample",
      artifact_policy_variant: "standard",
      artifacts: entries().reverse(),
    });
    expect(validateIndexerArtifactBundlePolicy({
      bundle,
      eligibility: eligibility(),
      actual_artifacts: bundle.artifacts.map((entry) => ({
        artifact_id: entry.artifact_id,
        artifact_kind: entry.artifact_kind,
        evidence_refs: entry.evidence_refs,
      })),
      allowed_question_refs: ["question:examples", "question:overview"],
      known_evidence_refs: ["evidence:source"],
    })).toEqual(bundle);
    expect(bundle).toMatchObject({
      discretionary_artifact_count: 1,
      semantic_split_part_count: 1,
    });
  });

  test("rejects incomplete, orphaned, overlapping, and excessive fan-out", () => {
    const missing = entries().filter((entry) => entry.artifact_kind !== "content");
    const missingBundle = buildIndexerArtifactBundle({
      logical_unit_ref: "node:subject:sample",
      artifact_policy_variant: "standard",
      artifacts: missing,
    });
    expect(() => validateIndexerArtifactBundlePolicy({
      bundle: missingBundle,
      eligibility: eligibility(),
      actual_artifacts: missingBundle.artifacts,
      allowed_question_refs: ["question:examples"],
      known_evidence_refs: ["evidence:source"],
    })).toThrow(/missing required kind/);

    const excessive = [entries()[0]!, ...["a", "b", "c"].map((suffix) => ({
      artifact_id: `examples-${suffix}`,
      artifact_kind: "examples",
      purpose: "discretionary" as const,
      reader_question_refs: ["question:examples"],
      evidence_refs: ["evidence:source"],
    }))];
    const excessiveBundle = buildIndexerArtifactBundle({
      logical_unit_ref: "node:subject:sample",
      artifact_policy_variant: "standard",
      artifacts: excessive,
    });
    expect(() => validateIndexerArtifactBundlePolicy({
      bundle: excessiveBundle,
      eligibility: eligibility(),
      actual_artifacts: excessiveBundle.artifacts,
      allowed_question_refs: ["question:examples", "question:overview"],
      known_evidence_refs: ["evidence:source"],
    })).toThrow(/fan-out/);

    expect(() => buildIndexerArtifactBundle({
      logical_unit_ref: "node:subject:sample",
      artifact_policy_variant: "standard",
      artifacts: [...entries(), {
        artifact_id: "overlap",
        artifact_kind: "content",
        purpose: "semantic-split",
        reader_question_refs: ["question:overview"],
        evidence_refs: ["evidence:source"],
        split_of: "overview",
        boundary: { axis: "source-namespace", start_key: "q", end_key: "zz" },
      }],
    })).toThrow(/non-overlapping/);

    const orphan = buildIndexerArtifactBundle({
      logical_unit_ref: "node:subject:sample",
      artifact_policy_variant: "standard",
      artifacts: entries(),
    });
    expect(() => validateIndexerArtifactBundlePolicy({
      bundle: orphan,
      eligibility: eligibility(),
      actual_artifacts: orphan.artifacts.slice(1),
      allowed_question_refs: ["question:examples", "question:overview"],
      known_evidence_refs: ["evidence:source"],
    })).toThrow(/actual Artifact set/);
  });

  test("rejects one-method-per-page inflation for a single logical unit", () => {
    const methodPages = [entries()[0]!, ...["create", "read", "update"].map((method) => ({
      artifact_id: `method-${method}`,
      artifact_kind: "examples",
      purpose: "discretionary" as const,
      reader_question_refs: ["question:examples"],
      evidence_refs: ["evidence:source"],
    }))];
    const inflated = buildIndexerArtifactBundle({
      logical_unit_ref: "node:subject:single-method-service",
      artifact_policy_variant: "standard",
      artifacts: methodPages,
    });

    expect(inflated.discretionary_artifact_count).toBe(3);
    expect(() => validateIndexerArtifactBundlePolicy({
      bundle: inflated,
      eligibility: eligibility(),
      actual_artifacts: inflated.artifacts,
      allowed_question_refs: ["question:examples", "question:overview"],
      known_evidence_refs: ["evidence:source"],
    })).toThrow(/discretionary fan-out exceeds its CLI hard maximum/);
  });
});
