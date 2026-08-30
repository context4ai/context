import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  indexerContractOverlayDigest,
  indexerOverlayAttestationDigest,
  indexerOverlayAttestationSigningPayload,
  indexerOverlayTrustBundleDigest,
  type IndexerContractOverlay,
  type IndexerOverlayAttestation,
  type IndexerOverlayTrustBundle,
  type IndexerOverlayTrustBundleEnvelope,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import {
  authorizeProjectIndexerContractOverlay,
  buildIndexerContractOverlayAuthorizationInput,
  buildIndexerContractOverlayValidationInput,
  validateProjectIndexerContractOverlay,
} from "../project/indexerContractOverlayValidation.js";
import { buildIndexerContractOverlayAuthorizationRoute } from
  "../project/indexerContractOverlayAuthorizationRoute.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const OPERATORS = bundledIndexerOperatorContract();
const PROFILES = bundledIndexerProfileContract(OPERATORS);
const BASE_PROFILE = PROFILES.profiles[0]!;

function overlay(): IndexerContractOverlay {
  const payload: Omit<IndexerContractOverlay, "overlay_digest"> = {
    protocol: "context.indexer.contract-overlay/v1",
    id: "sample-overlay",
    version: "1.0.0",
    extends: {
      profile: BASE_PROFILE.id,
      version: PROFILES.version,
      contract_digest: PROFILES.contract_digest,
    },
    operator_contract_version: OPERATORS.version,
    operator_contract_digest: OPERATORS.contract_digest,
    additions: {},
  };
  return { ...payload, overlay_digest: indexerContractOverlayDigest(payload) };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-overlay-gate-"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "contract-overlay-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  })}\n`, "utf8");
  return root;
}

function signedTrust(inputOverlay: IndexerContractOverlay): {
  attestation: IndexerOverlayAttestation;
  trustBundleEnvelope: IndexerOverlayTrustBundleEnvelope;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    protocol: "context.indexer.overlay-attestation/v1" as const,
    overlay: {
      protocol: inputOverlay.protocol,
      id: inputOverlay.id,
      version: inputOverlay.version,
      digest: inputOverlay.overlay_digest,
    },
    base: {
      profile: inputOverlay.extends.profile,
      version: PROFILES.version,
      contract_digest: PROFILES.contract_digest,
    },
    operator_contract: {
      version: OPERATORS.version,
      digest: OPERATORS.contract_digest,
    },
    issuer: "sample-issuer",
    key_id: "release-key",
    algorithm: "ed25519" as const,
  };
  const withSignature = {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(indexerOverlayAttestationSigningPayload(unsigned)),
      privateKey,
    ).toString("base64"),
  };
  const attestation: IndexerOverlayAttestation = {
    ...withSignature,
    attestation_digest: indexerOverlayAttestationDigest(withSignature),
  };
  const bundlePayload: Omit<IndexerOverlayTrustBundle, "policy_digest"> = {
    protocol: "context.indexer.overlay-trust-bundle/v1",
    policy_id: "sample-overlay-policy",
    policy_version: "1.0.0",
    issuers: [{
      id: unsigned.issuer,
      keys: [{
        key_id: unsigned.key_id,
        algorithm: "ed25519",
        public_key: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
        not_before: "2026-01-01T00:00:00.000Z",
        not_after: "2027-01-01T00:00:00.000Z",
      }],
    }],
    revocations: [],
  };
  const bundle: IndexerOverlayTrustBundle = {
    ...bundlePayload,
    policy_digest: indexerOverlayTrustBundleDigest(bundlePayload),
  };
  return {
    attestation,
    trustBundleEnvelope: {
      protocol: "context.indexer.overlay-trust-bundle-envelope/v1",
      adapter: "test-host",
      adapter_version: "1.0.0",
      management_authority_digest: digest("9"),
      bundle,
    },
  };
}

describe("Indexer contract overlay Action and Gate", () => {
  test("requires a non-delegable exact-project Gate and emits one unified receipt", async () => {
    const root = await workspace();
    const validationInput = buildIndexerContractOverlayValidationInput({
      project_ref: "project:sample",
      overlay: overlay(),
      base_contract: PROFILES,
      operator_contract: OPERATORS,
      provider_integrity: digest("8"),
    });
    const validation = validateProjectIndexerContractOverlay(validationInput);
    expect(validation).toMatchObject({
      outcome: "authorization-required",
      graph_outcome: "waiting-user",
      validation_input_digest: validationInput.input_digest,
      trust_receipt: null,
      authorization_request: {
        project_ref: "project:sample",
        provider_integrity: digest("8"),
      },
    });
    const validationPath = join(root, "overlay-validation.json");
    await writeFile(validationPath, `${JSON.stringify(validationInput, null, 2)}\n`, "utf8");
    expect(JSON.parse(await runCliInDir(root, [
      "indexer", "validate-indexer-contract-overlays",
      "--input", validationPath,
      "--format", "json",
    ]))).toMatchObject({
      outcome: "authorization-required",
      graph_outcome: "waiting-user",
      validation_input_digest: validationInput.input_digest,
    });
    const authorizationInput = buildIndexerContractOverlayAuthorizationInput({
      validation_input: validationInput,
      validation_result: validation,
      authority_ref: CONTEXT_WORKFLOW_AUTHORITIES.indexerContractOverlay,
      authority_scope_digest: digest("7"),
    });
    const inputPath = join(root, "overlay-authorization.json");
    await writeFile(inputPath, `${JSON.stringify(authorizationInput, null, 2)}\n`, "utf8");

    for (const authorities of [
      [CONTEXT_WORKFLOW_AUTHORITIES.evidenceMaintenance],
      [CONTEXT_WORKFLOW_AUTHORITIES.indexerContractOverlay],
    ]) {
      const routed = await buildIndexerContractOverlayAuthorizationRoute({
        projectRoot: root,
        authorization_input: authorizationInput,
        authorizationInputRef: inputPath,
        authorities,
      });
      expect(routed.route.gate).toMatchObject({
        id: "authorize-indexer-contract-overlay",
        authority: CONTEXT_WORKFLOW_AUTHORITIES.indexerContractOverlay,
        delegatable: false,
        resolution: "user",
      });
      expect(routed.route.commands[0]?.availability).toBe("after-human-confirmation");
    }

    const result = JSON.parse(await runCliInDir(root, [
      "indexer", "authorize-indexer-contract-overlay",
      "--input", inputPath,
      "--format", "json",
    ]));
    expect(result.validation).toMatchObject({
      outcome: "trusted",
      graph_outcome: "completed",
      trust_receipt: {
        trust_class: "project-authorized-exact-digest",
        project_ref: "project:sample",
        provider_integrity: digest("8"),
      },
    });
    expect(result.project_authorization).toMatchObject({
      authority_ref: CONTEXT_WORKFLOW_AUTHORITIES.indexerContractOverlay,
      authority_scope_digest: digest("7"),
    });

    expect(() => buildIndexerContractOverlayAuthorizationInput({
      validation_input: buildIndexerContractOverlayValidationInput({
        ...validationInput,
        project_ref: "project:other",
      }),
      validation_result: validation,
      authority_ref: CONTEXT_WORKFLOW_AUTHORITIES.indexerContractOverlay,
      authority_scope_digest: digest("7"),
    })).toThrow(/does not require project authorization|validation does not require|input/i);

    expect(() => validateProjectIndexerContractOverlay({
      ...validationInput,
      resolver_trust: "verified",
    })).toThrow(/unknown field/);
    expect(() => validateProjectIndexerContractOverlay(
      buildIndexerContractOverlayValidationInput({
        ...validationInput,
        overlay: { ...validationInput.overlay, overlay_digest: digest("6") },
      }),
    )).toThrow(/overlay digest/);
  });

  test("accepts enterprise trust locally and never routes it through project authorization", () => {
    const contractOverlay = overlay();
    const signed = signedTrust(contractOverlay);
    const input = buildIndexerContractOverlayValidationInput({
      project_ref: "project:sample",
      overlay: contractOverlay,
      base_contract: PROFILES,
      operator_contract: OPERATORS,
      provider_integrity: digest("8"),
      attestation: signed.attestation,
      trust_bundle_envelope: signed.trustBundleEnvelope,
    });
    expect(validateProjectIndexerContractOverlay(input)).toMatchObject({
      outcome: "trusted",
      graph_outcome: "completed",
      authorization_request: null,
      trust_receipt: {
        trust_class: "enterprise-signed",
        project_ref: null,
        overlay_digest: contractOverlay.overlay_digest,
      },
    });

    const missingTrustInput = buildIndexerContractOverlayValidationInput({
      project_ref: "project:sample",
      overlay: contractOverlay,
      base_contract: PROFILES,
      operator_contract: OPERATORS,
      provider_integrity: digest("8"),
      attestation: signed.attestation,
    });
    const missingTrustValidation = validateProjectIndexerContractOverlay(
      missingTrustInput,
    );
    expect(missingTrustValidation).toMatchObject({
      outcome: "authorization-required",
      authorization_request: {
        attestation_digest: signed.attestation.attestation_digest,
      },
    });
    const authorized = authorizeProjectIndexerContractOverlay(
      buildIndexerContractOverlayAuthorizationInput({
        validation_input: missingTrustInput,
        validation_result: missingTrustValidation,
        authority_ref: CONTEXT_WORKFLOW_AUTHORITIES.indexerContractOverlay,
        authority_scope_digest: digest("7"),
      }),
    );
    expect(authorized.validation.trust_receipt).toMatchObject({
      trust_class: "project-authorized-exact-digest",
      attestation_digest: signed.attestation.attestation_digest,
    });

    const unknownIssuerBundle = structuredClone(signed.trustBundleEnvelope);
    unknownIssuerBundle.bundle.issuers[0]!.id = "other-issuer";
    const unknownPolicyPayload = {
      ...unknownIssuerBundle.bundle,
      policy_digest: undefined,
    } as unknown as Omit<IndexerOverlayTrustBundle, "policy_digest">;
    unknownIssuerBundle.bundle.policy_digest =
      indexerOverlayTrustBundleDigest(unknownPolicyPayload);
    expect(validateProjectIndexerContractOverlay(
      buildIndexerContractOverlayValidationInput({
        project_ref: "project:sample",
        overlay: contractOverlay,
        base_contract: PROFILES,
        operator_contract: OPERATORS,
        provider_integrity: digest("8"),
        attestation: signed.attestation,
        trust_bundle_envelope: unknownIssuerBundle,
      }),
    )).toMatchObject({
      outcome: "authorization-required",
      authorization_request: {
        attestation_digest: signed.attestation.attestation_digest,
      },
    });

    const unknownKeyBundle = structuredClone(signed.trustBundleEnvelope);
    unknownKeyBundle.bundle.issuers[0]!.keys[0]!.key_id = "other-release-key";
    const unknownKeyPolicyPayload = {
      ...unknownKeyBundle.bundle,
      policy_digest: undefined,
    } as unknown as Omit<IndexerOverlayTrustBundle, "policy_digest">;
    unknownKeyBundle.bundle.policy_digest =
      indexerOverlayTrustBundleDigest(unknownKeyPolicyPayload);
    expect(validateProjectIndexerContractOverlay(
      buildIndexerContractOverlayValidationInput({
        project_ref: "project:sample",
        overlay: contractOverlay,
        base_contract: PROFILES,
        operator_contract: OPERATORS,
        provider_integrity: digest("8"),
        attestation: signed.attestation,
        trust_bundle_envelope: unknownKeyBundle,
      }),
    )).toMatchObject({
      outcome: "authorization-required",
      authorization_request: {
        attestation_digest: signed.attestation.attestation_digest,
      },
    });

    const forgedAttestation = structuredClone(signed.attestation);
    forgedAttestation.signature = Buffer.from("forged").toString("base64");
    forgedAttestation.attestation_digest = indexerOverlayAttestationDigest({
      ...forgedAttestation,
      attestation_digest: undefined,
    } as unknown as Omit<IndexerOverlayAttestation, "attestation_digest">);
    expect(() => validateProjectIndexerContractOverlay(
      buildIndexerContractOverlayValidationInput({
        project_ref: "project:sample",
        overlay: contractOverlay,
        base_contract: PROFILES,
        operator_contract: OPERATORS,
        provider_integrity: digest("8"),
        attestation: forgedAttestation,
        trust_bundle_envelope: signed.trustBundleEnvelope,
      }),
    )).toThrow(/signature is invalid/);
  });
});
