import {
  indexerOperatorContractDigest,
  indexerProfileContractDigest,
  resolveIndexerArtifactPolicyEligibility,
  type IndexerOperatorContract,
  type IndexerProfileContract,
} from "../index.js";

export function artifactPolicyContractsFixture() {
  const operatorPayload: Omit<IndexerOperatorContract, "contract_digest"> = {
    protocol: "context.indexer.operator-contract/v1",
    version: "1.0.0",
    selector_operators: ["all-inventory"],
    grouping_operators: ["by-subject-key"],
    metric_operators: ["discretionary-artifact-count"],
    threshold_operators: ["explicit", "inflation-sensitive"],
    selector_fact_paths: ["target.eligible"],
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
          expression: { op: "equals", fact: "target.eligible", value: true },
        },
        artifact_kinds: {
          required: ["overview"],
          discretionary: ["examples"],
        },
        thresholds: {
          "discretionary-artifacts-per-unit": { recommended_max: 4 },
        },
      }],
      question_target_domains: [],
      reader_question_contracts: [],
      layout_mappings: [{
        source_roles: ["authoritative-source"],
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kinds: ["overview", "examples"],
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

export function artifactPolicyEligibilityFixture() {
  const { operators, profiles } = artifactPolicyContractsFixture();
  return resolveIndexerArtifactPolicyEligibility({
    profile_id: "component-library",
    canonical_facts: { target: { eligible: true } },
    provider_supported_variants: ["standard"],
    profile_contract: profiles,
    operator_contract: operators,
  });
}
