import {
  authorizeProjectIndexerOverlay,
  indexerContractOverlaySchema,
  indexerOverlayAttestationSchema,
  indexerOverlayProjectAuthorizationDigest,
  indexerOverlayProjectAuthorizationSchema,
  indexerOverlayTrustBundleEnvelopeSchema,
  indexerProtocolDigest,
  canonicalIndexerJson,
  indexerProfileContractSchema,
  indexerOperatorContractSchema,
  validateIndexerContractOverlay,
  validateIndexerOverlayAttestation,
  validateIndexerOverlayTrustBundleEnvelope,
  verifyEnterpriseIndexerOverlayTrust,
  type IndexerContractOverlay,
  type IndexerOperatorContract,
  type IndexerOverlayAttestation,
  type IndexerOverlayConformanceReport,
  type IndexerOverlayProjectAuthorization,
  type IndexerOverlayTrustBundleEnvelope,
  type IndexerOverlayTrustReceipt,
  type IndexerProfileContract,
  type IndexerProfileContractEntry,
} from "@c4a/context";

export interface IndexerContractOverlayValidationInput {
  protocol: "context.indexer.contract-overlay-validation-input/v1";
  project_ref: string;
  overlay: IndexerContractOverlay;
  base_contract: IndexerProfileContract;
  operator_contract: IndexerOperatorContract;
  provider_integrity: string;
  attestation: IndexerOverlayAttestation | null;
  trust_bundle_envelope: IndexerOverlayTrustBundleEnvelope | null;
  project_authorization: IndexerOverlayProjectAuthorization | null;
  input_digest: string;
}

function parseDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${field} must be a sha256 digest`);
  }
  return value;
}

export interface IndexerContractOverlayAuthorizationRequest {
  protocol: "context.indexer.contract-overlay-authorization-request/v1";
  project_ref: string;
  overlay_digest: string;
  attestation_digest: string | null;
  base_contract_digest: string;
  provider_integrity: string;
  operator_contract_digest: string;
  conformance_report_digest: string;
  request_digest: string;
}

export interface IndexerContractOverlayValidationResult {
  protocol: "context.indexer.contract-overlay-validation-result/v1";
  outcome: "trusted" | "authorization-required";
  graph_outcome: "completed" | "waiting-user";
  validation_input_digest: string;
  project_ref: string;
  overlay: IndexerContractOverlay;
  effective_profile: IndexerProfileContractEntry;
  conformance_report: IndexerOverlayConformanceReport;
  trust_receipt: IndexerOverlayTrustReceipt | null;
  authorization_request: IndexerContractOverlayAuthorizationRequest | null;
  result_digest: string;
}

export interface IndexerContractOverlayAuthorizationInput {
  protocol: "context.indexer.contract-overlay-authorization-input/v1";
  validation_input: IndexerContractOverlayValidationInput;
  expected_conformance_report_digest: string;
  authority_ref: string;
  authority_scope_digest: string;
  input_digest: string;
}

export interface IndexerContractOverlayAuthorizationResult {
  protocol: "context.indexer.contract-overlay-authorization-result/v1";
  trusted_validation_input: IndexerContractOverlayValidationInput;
  validation: IndexerContractOverlayValidationResult;
  project_authorization: IndexerOverlayProjectAuthorization;
  result_digest: string;
}

function validationInputPayload(value: IndexerContractOverlayValidationInput) {
  return {
    protocol: value.protocol,
    project_ref: value.project_ref,
    overlay: value.overlay,
    base_contract: value.base_contract,
    operator_contract: value.operator_contract,
    provider_integrity: value.provider_integrity,
    attestation: value.attestation,
    trust_bundle_envelope: value.trust_bundle_envelope,
    project_authorization: value.project_authorization,
  };
}

export function validateIndexerContractOverlayValidationInput(
  value: unknown,
): IndexerContractOverlayValidationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer contract overlay validation input must be an object");
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "protocol",
    "project_ref",
    "overlay",
    "base_contract",
    "operator_contract",
    "provider_integrity",
    "attestation",
    "trust_bundle_envelope",
    "project_authorization",
    "input_digest",
  ]);
  const unexpected = Object.keys(raw).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new TypeError(`Indexer contract overlay validation input has unknown field ${unexpected}`);
  }
  if (
    raw.protocol !== "context.indexer.contract-overlay-validation-input/v1" ||
    typeof raw.project_ref !== "string" || raw.project_ref.length === 0
  ) {
    throw new TypeError("Indexer contract overlay validation input is incomplete");
  }
  const input: IndexerContractOverlayValidationInput = {
    protocol: raw.protocol,
    project_ref: raw.project_ref,
    overlay: indexerContractOverlaySchema.parse(raw.overlay),
    base_contract: indexerProfileContractSchema.parse(raw.base_contract),
    operator_contract: indexerOperatorContractSchema.parse(raw.operator_contract),
    provider_integrity: parseDigest(raw.provider_integrity, "provider_integrity"),
    attestation: raw.attestation === null
      ? null
      : indexerOverlayAttestationSchema.parse(raw.attestation),
    trust_bundle_envelope: raw.trust_bundle_envelope === null
      ? null
      : indexerOverlayTrustBundleEnvelopeSchema.parse(raw.trust_bundle_envelope),
    project_authorization: raw.project_authorization === null
      ? null
      : indexerOverlayProjectAuthorizationSchema.parse(raw.project_authorization),
    input_digest: parseDigest(raw.input_digest, "input_digest"),
  };
  if (indexerProtocolDigest(validationInputPayload(input)) !== input.input_digest) {
    throw new TypeError("Indexer contract overlay validation input digest is invalid");
  }
  const hasAttestation = input.attestation !== null;
  const hasTrustBundle = input.trust_bundle_envelope !== null;
  const hasProjectAuthorization = input.project_authorization !== null;
  if (
    (hasTrustBundle && !hasAttestation) ||
    (hasTrustBundle && hasProjectAuthorization)
  ) {
    throw new TypeError("Indexer contract overlay trust inputs are incomplete or conflicting");
  }
  return input;
}

export function buildIndexerContractOverlayValidationInput(input: {
  project_ref: string;
  overlay: IndexerContractOverlay;
  base_contract: IndexerProfileContract;
  operator_contract: IndexerOperatorContract;
  provider_integrity: string;
  attestation?: IndexerContractOverlayValidationInput["attestation"];
  trust_bundle_envelope?: IndexerContractOverlayValidationInput["trust_bundle_envelope"];
  project_authorization?: IndexerContractOverlayValidationInput["project_authorization"];
}): IndexerContractOverlayValidationInput {
  const payload = {
    protocol: "context.indexer.contract-overlay-validation-input/v1" as const,
    project_ref: input.project_ref,
    overlay: input.overlay,
    base_contract: input.base_contract,
    operator_contract: input.operator_contract,
    provider_integrity: input.provider_integrity,
    attestation: input.attestation ?? null,
    trust_bundle_envelope: input.trust_bundle_envelope ?? null,
    project_authorization: input.project_authorization ?? null,
  };
  return validateIndexerContractOverlayValidationInput({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

function authorizationRequest(input: {
  validation: ReturnType<typeof validateIndexerContractOverlay>;
  project_ref: string;
  provider_integrity: string;
  base_contract_digest: string;
  operator_contract_digest: string;
  attestation_digest: string | null;
}): IndexerContractOverlayAuthorizationRequest {
  const payload = {
    protocol: "context.indexer.contract-overlay-authorization-request/v1" as const,
    project_ref: input.project_ref,
    overlay_digest: input.validation.overlay.overlay_digest,
    attestation_digest: input.attestation_digest,
    base_contract_digest: input.base_contract_digest,
    provider_integrity: input.provider_integrity,
    operator_contract_digest: input.operator_contract_digest,
    conformance_report_digest: input.validation.report.report_digest,
  };
  return { ...payload, request_digest: indexerProtocolDigest(payload) };
}

function validationResult(input: {
  validation_input_digest: string;
  project_ref: string;
  validation: ReturnType<typeof validateIndexerContractOverlay>;
  trust_receipt: IndexerOverlayTrustReceipt | null;
  authorization_request: IndexerContractOverlayAuthorizationRequest | null;
}): IndexerContractOverlayValidationResult {
  const payload = {
    protocol: "context.indexer.contract-overlay-validation-result/v1" as const,
    outcome: input.trust_receipt === null ? "authorization-required" as const : "trusted" as const,
    graph_outcome: input.trust_receipt === null ? "waiting-user" as const : "completed" as const,
    validation_input_digest: input.validation_input_digest,
    project_ref: input.project_ref,
    overlay: input.validation.overlay,
    effective_profile: input.validation.effectiveProfile,
    conformance_report: input.validation.report,
    trust_receipt: input.trust_receipt,
    authorization_request: input.authorization_request,
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}

export function validateProjectIndexerContractOverlay(
  value: unknown,
): IndexerContractOverlayValidationResult {
  const input = validateIndexerContractOverlayValidationInput(value);
  const validation = validateIndexerContractOverlay({
    overlay: input.overlay,
    baseContract: input.base_contract,
    operatorContract: input.operator_contract,
  });
  const attestation = input.attestation === null
    ? null
    : validateIndexerOverlayAttestation(
      input.attestation,
      validation.overlay,
      input.base_contract,
      input.operator_contract,
    );
  if (input.attestation !== null && input.trust_bundle_envelope !== null) {
    const trustEnvelope = validateIndexerOverlayTrustBundleEnvelope(
      input.trust_bundle_envelope,
    );
    const matchingIssuer = trustEnvelope.bundle.issuers.find((issuer) =>
      issuer.id === attestation!.issuer
    );
    const hasMatchingKey = matchingIssuer?.keys.some((key) =>
      key.key_id === attestation!.key_id
    ) ?? false;
    if (hasMatchingKey) {
      return validationResult({
        validation_input_digest: input.input_digest,
        project_ref: input.project_ref,
        validation,
        trust_receipt: verifyEnterpriseIndexerOverlayTrust({
          overlayValidation: validation,
          baseContract: input.base_contract,
          operatorContract: input.operator_contract,
          providerIntegrity: input.provider_integrity,
          attestation,
          trustBundleEnvelope: trustEnvelope,
        }),
        authorization_request: null,
      });
    }
  }
  if (input.project_authorization !== null) {
    return validationResult({
      validation_input_digest: input.input_digest,
      project_ref: input.project_ref,
      validation,
      trust_receipt: authorizeProjectIndexerOverlay({
        overlayValidation: validation,
        baseContract: input.base_contract,
        operatorContract: input.operator_contract,
        providerIntegrity: input.provider_integrity,
        projectRef: input.project_ref,
        declaredAttestationDigest: attestation?.attestation_digest ?? null,
        authorization: input.project_authorization,
      }),
      authorization_request: null,
    });
  }
  return validationResult({
    validation_input_digest: input.input_digest,
    project_ref: input.project_ref,
    validation,
    trust_receipt: null,
    authorization_request: authorizationRequest({
      validation,
      project_ref: input.project_ref,
      provider_integrity: input.provider_integrity,
      base_contract_digest: input.base_contract.contract_digest,
      operator_contract_digest: input.operator_contract.contract_digest,
      attestation_digest: attestation?.attestation_digest ?? null,
    }),
  });
}

export function validateIndexerContractOverlayValidationResult(input: {
  validation_input: unknown;
  validation_result: unknown;
}): IndexerContractOverlayValidationResult {
  const validationInput = validateIndexerContractOverlayValidationInput(input.validation_input);
  const expected = validateProjectIndexerContractOverlay(validationInput);
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(input.validation_result)) {
    throw new TypeError("Indexer contract overlay validation Result is stale or invalid");
  }
  return expected;
}

function authorizationInputPayload(value: IndexerContractOverlayAuthorizationInput) {
  return {
    protocol: value.protocol,
    validation_input: value.validation_input,
    expected_conformance_report_digest: value.expected_conformance_report_digest,
    authority_ref: value.authority_ref,
    authority_scope_digest: value.authority_scope_digest,
  };
}

export function validateIndexerContractOverlayAuthorizationInput(
  value: unknown,
): IndexerContractOverlayAuthorizationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer contract overlay authorization input must be an object");
  }
  const raw = value as Partial<IndexerContractOverlayAuthorizationInput>;
  if (
    raw.protocol !== "context.indexer.contract-overlay-authorization-input/v1" ||
    typeof raw.authority_ref !== "string" || raw.authority_ref.length === 0 ||
    typeof raw.authority_scope_digest !== "string" ||
    typeof raw.expected_conformance_report_digest !== "string" ||
    typeof raw.input_digest !== "string"
  ) {
    throw new TypeError("Indexer contract overlay authorization input is incomplete");
  }
  if (raw.authority_ref !== "context.indexer-contract-overlay") {
    throw new TypeError("Indexer contract overlay requires the independent overlay authority");
  }
  const validationInput = validateIndexerContractOverlayValidationInput(raw.validation_input);
  if (validationInput.project_authorization !== null) {
    throw new TypeError("Indexer contract overlay Gate requires an untrusted input");
  }
  const input: IndexerContractOverlayAuthorizationInput = {
    protocol: raw.protocol,
    validation_input: validationInput,
    expected_conformance_report_digest: parseDigest(
      raw.expected_conformance_report_digest,
      "expected_conformance_report_digest",
    ),
    authority_ref: raw.authority_ref,
    authority_scope_digest: parseDigest(raw.authority_scope_digest, "authority_scope_digest"),
    input_digest: parseDigest(raw.input_digest, "input_digest"),
  };
  if (indexerProtocolDigest(authorizationInputPayload(input)) !== input.input_digest) {
    throw new TypeError("Indexer contract overlay authorization input digest is invalid");
  }
  return input;
}

export function buildIndexerContractOverlayAuthorizationInput(input: {
  validation_input: IndexerContractOverlayValidationInput;
  validation_result: IndexerContractOverlayValidationResult;
  authority_ref: string;
  authority_scope_digest: string;
}): IndexerContractOverlayAuthorizationInput {
  if (
    input.validation_result.outcome !== "authorization-required" ||
    input.validation_result.authorization_request === null ||
    input.validation_result.validation_input_digest !== input.validation_input.input_digest ||
    input.validation_result.project_ref !== input.validation_input.project_ref
  ) {
    throw new TypeError("Indexer contract overlay validation does not require project authorization");
  }
  const payload = {
    protocol: "context.indexer.contract-overlay-authorization-input/v1" as const,
    validation_input: validateIndexerContractOverlayValidationInput(input.validation_input),
    expected_conformance_report_digest:
      input.validation_result.conformance_report.report_digest,
    authority_ref: input.authority_ref,
    authority_scope_digest: input.authority_scope_digest,
  };
  return validateIndexerContractOverlayAuthorizationInput({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function authorizeProjectIndexerContractOverlay(
  value: unknown,
): IndexerContractOverlayAuthorizationResult {
  const input = validateIndexerContractOverlayAuthorizationInput(value);
  const initial = validateProjectIndexerContractOverlay(input.validation_input);
  if (
    initial.outcome !== "authorization-required" ||
    initial.authorization_request === null ||
    initial.conformance_report.report_digest !== input.expected_conformance_report_digest
  ) {
    throw new TypeError("Indexer contract overlay authorization report is stale");
  }
  const request = initial.authorization_request;
  const authorizationPayload: Omit<
    IndexerOverlayProjectAuthorization,
    "authorization_receipt_digest"
  > = {
    protocol: "context.indexer.overlay-project-authorization/v1",
    project_ref: request.project_ref,
    overlay_digest: request.overlay_digest,
    attestation_digest: request.attestation_digest,
    base_contract_digest: request.base_contract_digest,
    provider_integrity: request.provider_integrity,
    operator_contract_digest: request.operator_contract_digest,
    conformance_report_digest: request.conformance_report_digest,
    authority_ref: input.authority_ref,
    authority_scope_digest: input.authority_scope_digest,
  };
  const projectAuthorization = indexerOverlayProjectAuthorizationSchema.parse({
    ...authorizationPayload,
    authorization_receipt_digest:
      indexerOverlayProjectAuthorizationDigest(authorizationPayload),
  });
  const validationInput = buildIndexerContractOverlayValidationInput({
    project_ref: input.validation_input.project_ref,
    overlay: input.validation_input.overlay,
    base_contract: input.validation_input.base_contract,
    operator_contract: input.validation_input.operator_contract,
    provider_integrity: input.validation_input.provider_integrity,
    attestation: input.validation_input.attestation,
    project_authorization: projectAuthorization,
  });
  const payload = {
    protocol: "context.indexer.contract-overlay-authorization-result/v1" as const,
    trusted_validation_input: validationInput,
    validation: validateProjectIndexerContractOverlay(validationInput),
    project_authorization: projectAuthorization,
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}
