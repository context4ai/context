import {
  canonicalIndexerJson,
  createIndexerOverlayValidationReceipt,
  indexerContractOverlaySchema,
  indexerOperatorContractSchema,
  indexerProfileContractSchema,
  indexerProtocolDigest,
  validateIndexerContractOverlay,
  type IndexerContractOverlay,
  type IndexerOperatorContract,
  type IndexerOverlayConformanceReport,
  type IndexerOverlayValidationReceipt,
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
  input_digest: string;
}
export interface IndexerContractOverlayValidationResult {
  protocol: "context.indexer.contract-overlay-validation-result/v1";
  outcome: "valid";
  graph_outcome: "completed";
  validation_input_digest: string;
  project_ref: string;
  overlay: IndexerContractOverlay;
  effective_profile: IndexerProfileContractEntry;
  conformance_report: IndexerOverlayConformanceReport;
  validation_receipt: IndexerOverlayValidationReceipt;
  result_digest: string;
}

function parseDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${field} must be a sha256 digest`);
  }
  return value;
}

function validationInputPayload(value: IndexerContractOverlayValidationInput) {
  return {
    protocol: value.protocol,
    project_ref: value.project_ref,
    overlay: value.overlay,
    base_contract: value.base_contract,
    operator_contract: value.operator_contract,
    provider_integrity: value.provider_integrity,
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
    "input_digest",
  ]);
  const unexpected = Object.keys(raw).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new TypeError(`Indexer contract overlay validation input has unknown field ${unexpected}`);
  }
  if (
    raw.protocol !== "context.indexer.contract-overlay-validation-input/v1" ||
    typeof raw.project_ref !== "string" ||
    raw.project_ref.length === 0
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
    input_digest: parseDigest(raw.input_digest, "input_digest"),
  };
  if (indexerProtocolDigest(validationInputPayload(input)) !== input.input_digest) {
    throw new TypeError("Indexer contract overlay validation input digest is invalid");
  }
  return input;
}

export function buildIndexerContractOverlayValidationInput(input: {
  project_ref: string;
  overlay: IndexerContractOverlay;
  base_contract: IndexerProfileContract;
  operator_contract: IndexerOperatorContract;
  provider_integrity: string;
}): IndexerContractOverlayValidationInput {
  const payload = {
    protocol: "context.indexer.contract-overlay-validation-input/v1" as const,
    project_ref: input.project_ref,
    overlay: input.overlay,
    base_contract: input.base_contract,
    operator_contract: input.operator_contract,
    provider_integrity: input.provider_integrity,
  };
  return validateIndexerContractOverlayValidationInput({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

function buildValidationResult(input: {
  validationInput: IndexerContractOverlayValidationInput;
  validation: ReturnType<typeof validateIndexerContractOverlay>;
}): IndexerContractOverlayValidationResult {
  const validationReceipt = createIndexerOverlayValidationReceipt({
    overlayValidation: input.validation,
    baseContract: input.validationInput.base_contract,
    operatorContract: input.validationInput.operator_contract,
    providerIntegrity: input.validationInput.provider_integrity,
    projectRef: input.validationInput.project_ref,
  });
  const payload = {
    protocol: "context.indexer.contract-overlay-validation-result/v1" as const,
    outcome: "valid" as const,
    graph_outcome: "completed" as const,
    validation_input_digest: input.validationInput.input_digest,
    project_ref: input.validationInput.project_ref,
    overlay: input.validation.overlay,
    effective_profile: input.validation.effectiveProfile,
    conformance_report: input.validation.report,
    validation_receipt: validationReceipt,
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
  return buildValidationResult({ validationInput: input, validation });
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
