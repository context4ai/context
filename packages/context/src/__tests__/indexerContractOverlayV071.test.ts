import { describe, expect, test } from "bun:test";
import {
  createIndexerOverlayValidationReceipt,
  indexerContractOverlayDigest,
  indexerOperatorContractDigest,
  indexerProfileContractDigest,
  validateIndexerContractOverlay,
  validateIndexerOverlayValidationReceipt,
  type IndexerContractOverlay,
  type IndexerOperatorContract,
  type IndexerProfileContract,
} from "../index.js";

const DIGEST_C = `sha256:${"c".repeat(64)}`;

function operators(): IndexerOperatorContract {
  const payload: Omit<IndexerOperatorContract, "contract_digest"> = {
    protocol: "context.indexer.operator-contract/v1",
    version: "1.0.0",
    selector_operators: ["all-inventory", "service-targets", "required-facts"],
    grouping_operators: ["by-subject-key"],
    metric_operators: ["disposition-ratio", "artifact-count"],
    threshold_operators: ["explicit", "inflation-sensitive"],
    selector_fact_paths: ["target.required_facts"],
  };
  return { ...payload, contract_digest: indexerOperatorContractDigest(payload) };
}

function baseContract(operatorContract = operators()): IndexerProfileContract {
  const payload: Omit<IndexerProfileContract, "contract_digest"> = {
    protocol: "context.indexer.profile-contract/v1",
    version: "1.0.0",
    operator_contract_version: operatorContract.version,
    operator_contract_digest: operatorContract.contract_digest,
    coverage_domains: [
      "technical-structure",
      "public-contract",
      "business-semantics",
      "operations",
    ],
    profiles: [{
      id: "service",
      parser_requirements: [],
      inventory_domains: [{
        id: "service-inventory",
        selector: { operator: "all-inventory" },
        disposition_required: true,
      }],
      required_dispositions: ["owned", "excluded", "unsupported"],
      metrics: [{
        id: "disposition-coverage",
        unit: "ratio",
        operator: "disposition-ratio",
        threshold_policy: "explicit",
        direction: "minimum",
        recommended_min: 0.9,
        hard_min: 0.8,
      }, {
        id: "artifact-count",
        unit: "count",
        operator: "artifact-count",
        threshold_policy: "explicit",
        direction: "maximum",
        recommended_max: 5,
        hard_max: 8,
      }, {
        id: "discretionary-artifacts-per-unit",
        unit: "count",
        operator: "artifact-count",
        threshold_policy: "inflation-sensitive",
        direction: "maximum",
      }],
      artifact_policy_variants: [{
        id: "standard",
        eligibility: {
          protocol: "context.indexer.selector/v1",
          expression: { op: "equals", fact: "target.required_facts", value: true },
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
        id: "service",
        selector: { operator: "service-targets" },
        grouping_operator: "by-subject-key",
        subject_key_kind: "service",
        granularity: "module",
      }],
      reader_question_contracts: [],
      layout_mappings: [{
        source_roles: ["authoritative-source"],
        document_kind: "reference",
        reader_goal: "understand-capability",
        artifact_kinds: ["content", "contract", "examples"],
        collection: "codeindex",
      }],
      variant_schema: { axes: [] },
    }],
    subject_key_schemas: [{
      profile: "service",
      version: 1,
      namespace: { operator: "canonical-service-namespace" },
      kinds: [{
        id: "service",
        local_key: { operator: "canonical-module-identity" },
      }],
    }],
  };
  return { ...payload, contract_digest: indexerProfileContractDigest(payload) };
}

function overlay(
  base = baseContract(),
  operatorContract = operators(),
): IndexerContractOverlay {
  const payload: Omit<IndexerContractOverlay, "overlay_digest"> = {
    protocol: "context.indexer.contract-overlay/v1",
    id: "service-reliability",
    version: "1.0.0",
    extends: {
      profile: "service",
      version: base.version,
      contract_digest: base.contract_digest,
    },
    operator_contract_version: operatorContract.version,
    operator_contract_digest: operatorContract.contract_digest,
    additions: {
      required_dispositions: ["evidence-linked"],
      question_target_domains: [{
        id: "service-operation",
        selector: { operator: "service-targets" },
        grouping_operator: "by-subject-key",
        subject_key_kind: "service",
        granularity: "identity",
      }],
      reader_question_contracts: [{
        ref: "question:recovery-behavior",
        semantic: "What recovery behavior is required?",
        version: 1,
        coverage_domain: "operations",
        target_domain_ref: "service-operation",
        target_selector: {
          protocol: "context.indexer.selector/v1",
          expression: { op: "equals", fact: "target.required_facts", value: true },
        },
        evidence_contract: {
          accepted_kinds: ["documentation", "runbook"],
          minimum_items: 2,
          minimum_distinct_sources: 1,
        },
        allowed_exclusion_reason_codes: ["not-applicable"],
      }],
    },
    metric_tightenings: [{
      metric_ref: "disposition-coverage",
      direction: "minimum",
      recommended_min: 0.95,
      hard_min: 0.9,
    }],
    artifact_policy_threshold_tightenings: [{
      variant_ref: "standard",
      metric_ref: "discretionary-artifacts-per-unit",
      recommended_max: 3,
    }],
  };
  return { ...payload, overlay_digest: indexerContractOverlayDigest(payload) };
}

function validationFixture() {
  const operatorContract = operators();
  const base = baseContract(operatorContract);
  const contractOverlay = overlay(base, operatorContract);
  const validation = validateIndexerContractOverlay({
    overlay: contractOverlay,
    baseContract: base,
    operatorContract,
  });
  return { operatorContract, base, contractOverlay, validation };
}

describe("data-only Indexer contract overlays", () => {
  test("adds obligations and tightens a base metric without redefining the base", () => {
    const { validation } = validationFixture();
    const metric = validation.effectiveProfile.metrics.find((item) =>
      item.id === "disposition-coverage"
    );
    expect(metric).toMatchObject({ recommended_min: 0.95, hard_min: 0.9 });
    expect(validation.effectiveProfile.artifact_policy_variants[0]?.thresholds).toEqual({
      "discretionary-artifacts-per-unit": { recommended_max: 3 },
    });
    expect(validation.report).toMatchObject({
      monotonic: true,
      tightened_metric_refs: ["disposition-coverage"],
      tightened_artifact_policy_refs: [
        "standard:discretionary-artifacts-per-unit",
      ],
    });
    expect(validation.report.added_refs).toContain("question:recovery-behavior");
  });

  test("rejects threshold weakening, base redefinition, and unknown operators", () => {
    const operatorContract = operators();
    const base = baseContract(operatorContract);

    const weaker = overlay(base, operatorContract);
    weaker.metric_tightenings![0] = {
      metric_ref: "disposition-coverage",
      direction: "minimum",
      hard_min: 0.7,
    };
    weaker.overlay_digest = indexerContractOverlayDigest({
      ...weaker,
      overlay_digest: undefined,
    } as unknown as Omit<IndexerContractOverlay, "overlay_digest">);
    expect(() => validateIndexerContractOverlay({
      overlay: weaker,
      baseContract: base,
      operatorContract,
    })).toThrow(/cannot lower minimum threshold/);

    const weakerArtifactPolicy = overlay(base, operatorContract);
    weakerArtifactPolicy.artifact_policy_threshold_tightenings![0]!.recommended_max = 6;
    weakerArtifactPolicy.overlay_digest = indexerContractOverlayDigest({
      ...weakerArtifactPolicy,
      overlay_digest: undefined,
    } as unknown as Omit<IndexerContractOverlay, "overlay_digest">);
    expect(() => validateIndexerContractOverlay({
      overlay: weakerArtifactPolicy,
      baseContract: base,
      operatorContract,
    })).toThrow(/cannot raise artifact policy threshold/);

    const duplicate = overlay(base, operatorContract);
    duplicate.additions.metrics = [base.profiles[0]!.metrics[0]!];
    duplicate.overlay_digest = indexerContractOverlayDigest({
      ...duplicate,
      overlay_digest: undefined,
    } as unknown as Omit<IndexerContractOverlay, "overlay_digest">);
    expect(() => validateIndexerContractOverlay({
      overlay: duplicate,
      baseContract: base,
      operatorContract,
    })).toThrow(/cannot redefine disposition-coverage/);

    const unknownOperator = overlay(base, operatorContract);
    unknownOperator.additions.inventory_domains = [{
      id: "extra-domain",
      selector: { operator: "embedded-evaluator" },
      disposition_required: true,
    }];
    unknownOperator.overlay_digest = indexerContractOverlayDigest({
      ...unknownOperator,
      overlay_digest: undefined,
    } as unknown as Omit<IndexerContractOverlay, "overlay_digest">);
    expect(() => validateIndexerContractOverlay({
      overlay: unknownOperator,
      baseContract: base,
      operatorContract,
    })).toThrow(/unregistered operator embedded-evaluator/);
  });

  test("rejects executable evaluator and command fields structurally", () => {
    const { operatorContract, base, contractOverlay } = validationFixture();
    expect(() => validateIndexerContractOverlay({
      overlay: { ...contractOverlay, evaluator: "scripts/evaluate.mjs" },
      baseContract: base,
      operatorContract,
    })).toThrow(/Unrecognized key/);
    expect(() => validateIndexerContractOverlay({
      overlay: {
        ...contractOverlay,
        additions: { ...contractOverlay.additions, command: "run checks" },
      },
      baseContract: base,
      operatorContract,
    })).toThrow(/Unrecognized key/);
  });
});

describe("Indexer overlay validation receipts", () => {
  test("binds static conformance to the exact project and Provider integrity", () => {
    const fixture = validationFixture();
    const receipt = createIndexerOverlayValidationReceipt({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:sample",
    });
    expect(receipt).toMatchObject({
      protocol: "context.indexer.overlay-validation-receipt/v1",
      project_ref: "project:sample",
      overlay_digest: fixture.contractOverlay.overlay_digest,
      base_contract_digest: fixture.base.contract_digest,
      provider_integrity: DIGEST_C,
      operator_contract_digest: fixture.operatorContract.contract_digest,
      conformance_report_digest: fixture.validation.report.report_digest,
    });
    expect(validateIndexerOverlayValidationReceipt({
      value: receipt,
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:sample",
    })).toEqual(receipt);
  });

  test("rejects stale project, Provider and receipt digests", () => {
    const fixture = validationFixture();
    const receipt = createIndexerOverlayValidationReceipt({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:sample",
    });
    expect(() => validateIndexerOverlayValidationReceipt({
      value: receipt,
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: `sha256:${"d".repeat(64)}`,
      projectRef: "project:sample",
    })).toThrow(/stale|another validation/);
    expect(() => validateIndexerOverlayValidationReceipt({
      value: receipt,
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:other",
    })).toThrow(/stale|another validation/);
    expect(() => validateIndexerOverlayValidationReceipt({
      value: { ...receipt, receipt_digest: `sha256:${"e".repeat(64)}` },
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:sample",
    })).toThrow(/receipt digest/);
  });
});
