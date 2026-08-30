import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  authorizeProjectIndexerOverlay,
  indexerContractOverlayDigest,
  indexerOperatorContractDigest,
  indexerOverlayAttestationDigest,
  indexerOverlayAttestationSigningPayload,
  indexerOverlayProjectAuthorizationDigest,
  indexerOverlayTrustBundleDigest,
  indexerProfileContractDigest,
  validateIndexerContractOverlay,
  verifyEnterpriseIndexerOverlayTrust,
  type IndexerContractOverlay,
  type IndexerOperatorContract,
  type IndexerOverlayAttestation,
  type IndexerOverlayProjectAuthorization,
  type IndexerOverlayTrustBundle,
  type IndexerOverlayTrustBundleEnvelope,
  type IndexerProfileContract,
} from "../index.js";

const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;

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

function signedTrustFixture() {
  const fixture = validationFixture();
  const keyPair = generateKeyPairSync("ed25519");
  const unsigned: Omit<IndexerOverlayAttestation, "signature" | "attestation_digest"> = {
    protocol: "context.indexer.overlay-attestation/v1",
    overlay: {
      protocol: "context.indexer.contract-overlay/v1",
      id: fixture.contractOverlay.id,
      version: fixture.contractOverlay.version,
      digest: fixture.contractOverlay.overlay_digest,
    },
    base: {
      profile: fixture.contractOverlay.extends.profile,
      version: fixture.base.version,
      contract_digest: fixture.base.contract_digest,
    },
    operator_contract: {
      version: fixture.operatorContract.version,
      digest: fixture.operatorContract.contract_digest,
    },
    issuer: "example-issuer",
    key_id: "release-key",
    algorithm: "ed25519",
  };
  const signature = sign(
    null,
    Buffer.from(indexerOverlayAttestationSigningPayload(unsigned)),
    keyPair.privateKey,
  ).toString("base64");
  const attestationPayload: Omit<IndexerOverlayAttestation, "attestation_digest"> = {
    ...unsigned,
    signature,
  };
  const attestation: IndexerOverlayAttestation = {
    ...attestationPayload,
    attestation_digest: indexerOverlayAttestationDigest(attestationPayload),
  };
  const trustPayload: Omit<IndexerOverlayTrustBundle, "policy_digest"> = {
    protocol: "context.indexer.overlay-trust-bundle/v1",
    policy_id: "managed-overlay-policy",
    policy_version: "1.0.0",
    issuers: [{
      id: "example-issuer",
      keys: [{
        key_id: "release-key",
        algorithm: "ed25519",
        public_key: keyPair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
        not_before: "2026-01-01T00:00:00.000Z",
        not_after: "2027-01-01T00:00:00.000Z",
      }],
    }],
    revocations: [],
  };
  const trustBundle: IndexerOverlayTrustBundle = {
    ...trustPayload,
    policy_digest: indexerOverlayTrustBundleDigest(trustPayload),
  };
  const trustBundleEnvelope: IndexerOverlayTrustBundleEnvelope = {
    protocol: "context.indexer.overlay-trust-bundle-envelope/v1",
    adapter: "example-host",
    adapter_version: "1.0.0",
    management_authority_digest: DIGEST_D,
    bundle: trustBundle,
  };
  return { ...fixture, attestation, trustBundleEnvelope };
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

describe("Indexer overlay trust", () => {
  test("verifies a detached Ed25519 attestation against a Host-provided trust bundle", () => {
    const fixture = signedTrustFixture();
    const receipt = verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: fixture.attestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    });
    expect(receipt).toMatchObject({
      protocol: "context.indexer.overlay-trust-receipt/v1",
      trust_class: "enterprise-signed",
      project_ref: null,
      overlay_digest: fixture.contractOverlay.overlay_digest,
      attestation_digest: fixture.attestation.attestation_digest,
      base_contract_digest: fixture.base.contract_digest,
      provider_integrity: DIGEST_C,
      operator_contract_digest: fixture.operatorContract.contract_digest,
      conformance_report_digest: fixture.validation.report.report_digest,
      trust_adapter: fixture.trustBundleEnvelope.adapter,
      trust_adapter_version: fixture.trustBundleEnvelope.adapter_version,
      trust_management_authority_digest:
        fixture.trustBundleEnvelope.management_authority_digest,
      trust_policy_digest: fixture.trustBundleEnvelope.bundle.policy_digest,
      authorization_receipt_digest: null,
    });
    expect(receipt.receipt_digest).toMatch(/^sha256:/);
  });

  test("binds the exact Host adapter version and management authority into freshness", () => {
    const fixture = signedTrustFixture();
    const verifyFixture = (trustBundleEnvelope: IndexerOverlayTrustBundleEnvelope) =>
      verifyEnterpriseIndexerOverlayTrust({
        overlayValidation: fixture.validation,
        baseContract: fixture.base,
        operatorContract: fixture.operatorContract,
        providerIntegrity: DIGEST_C,
        attestation: fixture.attestation,
        trustBundleEnvelope,
        now: new Date("2026-08-27T12:00:00.000Z"),
      });
    const current = verifyFixture(fixture.trustBundleEnvelope);
    const nextAdapter = verifyFixture({
      ...fixture.trustBundleEnvelope,
      adapter_version: "1.1.0",
    });
    const nextAuthority = verifyFixture({
      ...fixture.trustBundleEnvelope,
      management_authority_digest: DIGEST_E,
    });
    expect(nextAdapter.receipt_digest).not.toBe(current.receipt_digest);
    expect(nextAuthority.receipt_digest).not.toBe(current.receipt_digest);
    expect(nextAdapter).toMatchObject({
      trust_adapter: "example-host",
      trust_adapter_version: "1.1.0",
      trust_management_authority_digest: DIGEST_D,
    });
    expect(nextAuthority.trust_management_authority_digest).toBe(DIGEST_E);
  });

  test("rejects invalid signatures, expired keys, revocation, and policy digest drift", () => {
    const fixture = signedTrustFixture();
    const verifyFixture = () => verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: fixture.attestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    });

    fixture.attestation.signature = Buffer.from("forged").toString("base64");
    fixture.attestation.attestation_digest = indexerOverlayAttestationDigest({
      ...fixture.attestation,
      attestation_digest: undefined,
    } as unknown as Omit<IndexerOverlayAttestation, "attestation_digest">);
    expect(verifyFixture).toThrow(/signature is invalid/);

    const expired = signedTrustFixture();
    expired.trustBundleEnvelope.bundle.issuers[0]!.keys[0]!.not_after =
      "2026-08-27T11:00:00.000Z";
    const expiredPayload = {
      ...expired.trustBundleEnvelope.bundle,
      policy_digest: undefined,
    } as unknown as Omit<IndexerOverlayTrustBundle, "policy_digest">;
    expired.trustBundleEnvelope.bundle.policy_digest = indexerOverlayTrustBundleDigest(expiredPayload);
    expect(() => verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: expired.validation,
      baseContract: expired.base,
      operatorContract: expired.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: expired.attestation,
      trustBundleEnvelope: expired.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    })).toThrow(/validity window/);

    const revoked = signedTrustFixture();
    revoked.trustBundleEnvelope.bundle.revocations.push({
      issuer: "example-issuer",
      key_id: "release-key",
      revoked_at: "2026-08-27T10:00:00.000Z",
    });
    const revokedPayload = {
      ...revoked.trustBundleEnvelope.bundle,
      policy_digest: undefined,
    } as unknown as Omit<IndexerOverlayTrustBundle, "policy_digest">;
    revoked.trustBundleEnvelope.bundle.policy_digest = indexerOverlayTrustBundleDigest(revokedPayload);
    expect(() => verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: revoked.validation,
      baseContract: revoked.base,
      operatorContract: revoked.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: revoked.attestation,
      trustBundleEnvelope: revoked.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    })).toThrow(/revoked/);

    const drift = signedTrustFixture();
    drift.trustBundleEnvelope.bundle.policy_digest = DIGEST_D;
    expect(() => verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: drift.validation,
      baseContract: drift.base,
      operatorContract: drift.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: drift.attestation,
      trustBundleEnvelope: drift.trustBundleEnvelope,
    })).toThrow(/trust bundle digest/);
  });

  test("supports bounded key overlap, then makes the revoked key and old policy stale", () => {
    const fixture = signedTrustFixture();
    const oldReceipt = verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: fixture.attestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    });
    const nextKeyPair = generateKeyPairSync("ed25519");
    const nextUnsigned: Omit<
      IndexerOverlayAttestation,
      "signature" | "attestation_digest"
    > = {
      protocol: fixture.attestation.protocol,
      overlay: fixture.attestation.overlay,
      base: fixture.attestation.base,
      operator_contract: fixture.attestation.operator_contract,
      issuer: fixture.attestation.issuer,
      key_id: "release-key-next",
      algorithm: fixture.attestation.algorithm,
    };
    const nextSignature = sign(
      null,
      Buffer.from(indexerOverlayAttestationSigningPayload(nextUnsigned)),
      nextKeyPair.privateKey,
    ).toString("base64");
    const nextAttestationPayload = { ...nextUnsigned, signature: nextSignature };
    const nextAttestation: IndexerOverlayAttestation = {
      ...nextAttestationPayload,
      attestation_digest: indexerOverlayAttestationDigest(nextAttestationPayload),
    };
    fixture.trustBundleEnvelope.bundle.policy_version = "1.1.0";
    fixture.trustBundleEnvelope.bundle.issuers[0]!.keys.push({
      key_id: "release-key-next",
      algorithm: "ed25519",
      public_key: nextKeyPair.publicKey.export({
        type: "spki",
        format: "der",
      }).toString("base64"),
      not_before: "2026-08-01T00:00:00.000Z",
      not_after: "2027-08-01T00:00:00.000Z",
    });
    const overlapPayload = {
      ...fixture.trustBundleEnvelope.bundle,
      policy_digest: undefined,
    } as unknown as Omit<IndexerOverlayTrustBundle, "policy_digest">;
    fixture.trustBundleEnvelope.bundle.policy_digest =
      indexerOverlayTrustBundleDigest(overlapPayload);

    expect(verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: fixture.attestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    }).trust_policy_digest).toBe(fixture.trustBundleEnvelope.bundle.policy_digest);
    expect(verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: nextAttestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    }).trust_policy_digest).toBe(fixture.trustBundleEnvelope.bundle.policy_digest);

    fixture.trustBundleEnvelope.bundle.policy_version = "1.2.0";
    fixture.trustBundleEnvelope.bundle.revocations.push({
      issuer: "example-issuer",
      key_id: "release-key",
      revoked_at: "2026-08-28T00:00:00.000Z",
    });
    const revokedPolicyPayload = {
      ...fixture.trustBundleEnvelope.bundle,
      policy_digest: undefined,
    } as unknown as Omit<IndexerOverlayTrustBundle, "policy_digest">;
    fixture.trustBundleEnvelope.bundle.policy_digest =
      indexerOverlayTrustBundleDigest(revokedPolicyPayload);
    expect(() => verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: fixture.attestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-28T12:00:00.000Z"),
    })).toThrow(/revoked/);
    const currentReceipt = verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: nextAttestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-28T12:00:00.000Z"),
    });
    expect(currentReceipt.receipt_digest).not.toBe(oldReceipt.receipt_digest);
    expect(currentReceipt.trust_policy_digest).not.toBe(oldReceipt.trust_policy_digest);
  });

  test("recomputes conformance and rejects a caller-forged report", () => {
    const fixture = signedTrustFixture();
    fixture.validation.report.report_digest = DIGEST_D;
    expect(() => verifyEnterpriseIndexerOverlayTrust({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      attestation: fixture.attestation,
      trustBundleEnvelope: fixture.trustBundleEnvelope,
      now: new Date("2026-08-27T12:00:00.000Z"),
    })).toThrow(/canonical current report/);
  });

  test("authorizes only the exact current project and digest set", () => {
    const fixture = validationFixture();
    const payload: Omit<
      IndexerOverlayProjectAuthorization,
      "authorization_receipt_digest"
    > = {
      protocol: "context.indexer.overlay-project-authorization/v1",
      project_ref: "project:sample",
      overlay_digest: fixture.contractOverlay.overlay_digest,
      attestation_digest: null,
      base_contract_digest: fixture.base.contract_digest,
      provider_integrity: DIGEST_C,
      operator_contract_digest: fixture.operatorContract.contract_digest,
      conformance_report_digest: fixture.validation.report.report_digest,
      authority_ref: "authority:indexer-contract-overlay",
      authority_scope_digest: DIGEST_D,
    };
    const authorization: IndexerOverlayProjectAuthorization = {
      ...payload,
      authorization_receipt_digest: indexerOverlayProjectAuthorizationDigest(payload),
    };
    expect(authorizeProjectIndexerOverlay({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:sample",
      declaredAttestationDigest: null,
      authorization,
    })).toMatchObject({
      trust_class: "project-authorized-exact-digest",
      project_ref: "project:sample",
      trust_adapter: null,
      trust_adapter_version: null,
      trust_management_authority_digest: null,
      trust_policy_digest: null,
    });

    expect(() => authorizeProjectIndexerOverlay({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:other",
      declaredAttestationDigest: null,
      authorization,
    })).toThrow(/project_ref/);
  });

  test("binds an untrusted attestation digest to exact project authorization", () => {
    const fixture = signedTrustFixture();
    const payload: Omit<
      IndexerOverlayProjectAuthorization,
      "authorization_receipt_digest"
    > = {
      protocol: "context.indexer.overlay-project-authorization/v1",
      project_ref: "project:sample",
      overlay_digest: fixture.contractOverlay.overlay_digest,
      attestation_digest: fixture.attestation.attestation_digest,
      base_contract_digest: fixture.base.contract_digest,
      provider_integrity: DIGEST_C,
      operator_contract_digest: fixture.operatorContract.contract_digest,
      conformance_report_digest: fixture.validation.report.report_digest,
      authority_ref: "authority:indexer-contract-overlay",
      authority_scope_digest: DIGEST_D,
    };
    const authorization: IndexerOverlayProjectAuthorization = {
      ...payload,
      authorization_receipt_digest: indexerOverlayProjectAuthorizationDigest(payload),
    };
    expect(authorizeProjectIndexerOverlay({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:sample",
      declaredAttestationDigest: fixture.attestation.attestation_digest,
      authorization,
    })).toMatchObject({
      trust_class: "project-authorized-exact-digest",
      attestation_digest: fixture.attestation.attestation_digest,
    });
    expect(() => authorizeProjectIndexerOverlay({
      overlayValidation: fixture.validation,
      baseContract: fixture.base,
      operatorContract: fixture.operatorContract,
      providerIntegrity: DIGEST_C,
      projectRef: "project:sample",
      declaredAttestationDigest: null,
      authorization,
    })).toThrow(/attestation_digest/);
  });
});
