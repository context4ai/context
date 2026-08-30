import { describe, expect, test } from "bun:test";
import {
  indexerOperatorContractDigest,
  indexerProfileContractDigest,
  inflationSensitiveHardMaximum,
  validateIndexerOperatorContract,
  validateIndexerProfileContract,
  type IndexerOperatorContract,
  type IndexerProfileContract,
} from "../index.js";

function operatorContract(): IndexerOperatorContract {
  const payload: Omit<IndexerOperatorContract, "contract_digest"> = {
    protocol: "context.indexer.operator-contract/v1",
    version: "1.0.0",
    selector_operators: ["all-inventory", "public-identities", "eligible-standard"],
    grouping_operators: ["by-subject-key"],
    metric_operators: ["disposition-ratio", "discretionary-artifact-count"],
    threshold_operators: ["explicit", "inflation-sensitive"],
    selector_fact_paths: ["evidence.current", "target.visibility"],
  };
  return { ...payload, contract_digest: indexerOperatorContractDigest(payload) };
}

function profileContract(
  operators = operatorContract(),
): IndexerProfileContract {
  const payload: Omit<IndexerProfileContract, "contract_digest"> = {
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
        id: "public-identities",
        selector: { operator: "all-inventory" },
        disposition_required: true,
      }],
      required_dispositions: ["owned", "excluded", "unsupported"],
      metrics: [{
        id: "identity-disposition-coverage",
        unit: "ratio",
        operator: "disposition-ratio",
        threshold_policy: "explicit",
        direction: "minimum",
        recommended_min: 1,
        hard_min: 1,
      }, {
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
          expression: { op: "equals", fact: "target.visibility", value: "public" },
        },
        artifact_kinds: {
          required: ["content"],
          discretionary: ["contract", "examples"],
        },
        thresholds: {
          "discretionary-artifacts-per-unit": { recommended_max: 4 },
        },
      }],
      question_target_domains: [{
        id: "component",
        selector: { operator: "public-identities" },
        grouping_operator: "by-subject-key",
        subject_key_kind: "component",
        granularity: "identity",
      }],
      reader_question_contracts: [{
        ref: "question:failure-recovery",
        semantic: "How does this capability recover from failure?",
        version: 1,
        coverage_domain: "operations",
        target_domain_ref: "component",
        target_selector: {
          protocol: "context.indexer.selector/v1",
          expression: { op: "equals", fact: "target.visibility", value: "public" },
        },
        evidence_contract: {
          accepted_kinds: ["documentation", "runbook"],
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
        artifact_kinds: ["content", "contract", "examples"],
        collection: "codeindex",
      }],
      variant_schema: {
        axes: [{
          id: "library_mode",
          type: "enum",
          values: ["source", "generated-facade"],
          required: false,
        }],
      },
    }],
    subject_key_schemas: [{
      profile: "component-library",
      version: 1,
      namespace: { operator: "canonical-source-module-namespace" },
      kinds: [{
        id: "component",
        local_key: { operator: "canonical-export-family" },
      }],
      normalization: ["trim", "unicode-nfc", "preserve-case"],
    }],
  };
  return { ...payload, contract_digest: indexerProfileContractDigest(payload) };
}

describe("CLI Indexer profile contract", () => {
  test("validates canonical operators, profile variants, SubjectKey, questions, and metrics", () => {
    const operators = operatorContract();
    const contract = profileContract(operators);

    expect(validateIndexerOperatorContract(operators)).toEqual(operators);
    expect(validateIndexerProfileContract(contract, operators)).toEqual(contract);
    expect(inflationSensitiveHardMaximum(4)).toBe(6);
    expect(inflationSensitiveHardMaximum(3)).toBe(5);
    expect(inflationSensitiveHardMaximum(0.531, "ratio")).toBe(0.8);
    expect(inflationSensitiveHardMaximum(0.8, "ratio")).toBe(1);
  });

  test("rejects canonical digest drift", () => {
    const operators = operatorContract();
    expect(() => validateIndexerOperatorContract({
      ...operators,
      selector_operators: [...operators.selector_operators, "new-selector"],
    })).toThrow(/digest/);

    const contract = profileContract(operators);
    expect(() => validateIndexerProfileContract({
      ...contract,
      version: "1.0.1",
    }, operators)).toThrow(/digest/);
  });

  test("rejects unregistered selector, grouping, and metric operators", () => {
    const operators = operatorContract();
    const contract = profileContract(operators);
    contract.profiles[0]!.inventory_domains[0]!.selector.operator = "provider-evaluator";
    contract.contract_digest = indexerProfileContractDigest({
      ...contract,
      contract_digest: undefined,
    } as unknown as Omit<IndexerProfileContract, "contract_digest">);
    expect(() => validateIndexerProfileContract(contract, operators)).toThrow(
      /unregistered operator provider-evaluator/,
    );
  });

  test("rejects malformed explicit thresholds", () => {
    const operators = operatorContract();
    const contract = profileContract(operators);
    const metric = contract.profiles[0]!.metrics[0]!;
    if (metric.threshold_policy !== "explicit" || metric.direction !== "minimum") {
      throw new Error("unexpected test metric");
    }
    metric.hard_min = 1;
    metric.recommended_min = 0.8;
    expect(() => validateIndexerProfileContract(contract, operators)).toThrow(/hard_min/);
  });

  test("allows Artifact policy thresholds only for inflation-sensitive metrics", () => {
    const operators = operatorContract();
    const contract = profileContract(operators);
    contract.profiles[0]!.artifact_policy_variants[0]!.thresholds = {
      "identity-disposition-coverage": { recommended_max: 1 },
    };
    contract.contract_digest = indexerProfileContractDigest({
      ...contract,
      contract_digest: undefined,
    } as unknown as Omit<IndexerProfileContract, "contract_digest">);
    expect(() => validateIndexerProfileContract(contract, operators)).toThrow(
      /only bind inflation-sensitive metrics/,
    );
  });

  test("rejects unknown target domains and SubjectKey kinds", () => {
    const operators = operatorContract();
    const unknownTarget = profileContract(operators);
    unknownTarget.profiles[0]!.reader_question_contracts[0]!.target_domain_ref = "unknown";
    unknownTarget.contract_digest = indexerProfileContractDigest({
      ...unknownTarget,
      contract_digest: undefined,
    } as unknown as Omit<IndexerProfileContract, "contract_digest">);
    expect(() => validateIndexerProfileContract(unknownTarget, operators)).toThrow(
      /unknown target domain/,
    );

    const unknownKind = profileContract(operators);
    unknownKind.profiles[0]!.question_target_domains[0]!.subject_key_kind = "service";
    unknownKind.contract_digest = indexerProfileContractDigest({
      ...unknownKind,
      contract_digest: undefined,
    } as unknown as Omit<IndexerProfileContract, "contract_digest">);
    expect(() => validateIndexerProfileContract(unknownKind, operators)).toThrow(
      /unknown SubjectKey kind/,
    );
  });

  test("does not accept Provider-defined thresholds or arbitrary SubjectKey operators", () => {
    const operators = operatorContract();
    const contract = profileContract(operators) as unknown as Record<string, unknown>;
    const profiles = contract.profiles as Array<Record<string, unknown>>;
    profiles[0]!.provider_thresholds = { hard_min: 0.5 };
    expect(() => validateIndexerProfileContract(contract, operators)).toThrow(/Unrecognized key/);

    const invalidSubject = profileContract(operators) as unknown as Record<string, unknown>;
    const subjects = invalidSubject.subject_key_schemas as Array<Record<string, unknown>>;
    const subject = subjects[0]!;
    subject.namespace = { operator: "display-title-template" };
    expect(() => validateIndexerProfileContract(invalidSubject, operators)).toThrow(/namespace/);
  });

  test("requires exactly one top-level SubjectKey authority for every community profile", () => {
    const operators = operatorContract();
    const missing = profileContract(operators) as unknown as Record<string, unknown>;
    missing.subject_key_schemas = [];
    expect(() => validateIndexerProfileContract(missing, operators)).toThrow(
      /subject_key_schemas|requires exactly one/,
    );

    const unknown = profileContract(operators) as unknown as Record<string, unknown>;
    const schemas = unknown.subject_key_schemas as Array<Record<string, unknown>>;
    schemas.push({ ...schemas[0], profile: "unknown-profile" });
    expect(() => validateIndexerProfileContract(unknown, operators)).toThrow(
      /unknown community profile/,
    );
  });
});
