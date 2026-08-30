import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerOverlayQuestionAmendment,
  buildIndexerOverlayQuestionRegistryApplyProposal,
  canonicalIndexerJson,
  confirmIndexerRequirementAmendment,
  indexerProtocolDigest,
  indexerRegistryDigests,
  indexerRegistrySchema,
  parseIndexerRegistry,
  validateIndexerOverlayQuestionAmendment,
  type IndexerOverlayQuestionAmendment,
  type IndexerOverlayQuestionRegistryApplyProposal,
  type IndexerRequirementAmendmentConfirmation,
  type IndexerRegistry,
} from "@c4a/context";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import {
  rebindIndexerSelectionToOverlayRequirement,
  type IndexerOverlayQuestionRebindReceipt,
} from "./indexerOverlayQuestionRebind.js";
import type {
  IndexerResolvedSelectionInput,
  IndexerSelectionFinalReport,
  IndexerSelectionStaticReport,
} from "./indexerSelectionValidation.js";
import {
  validateIndexerContractOverlayValidationInput,
  validateIndexerContractOverlayValidationResult,
  type IndexerContractOverlayValidationInput,
  type IndexerContractOverlayValidationResult,
} from "./indexerContractOverlayValidation.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export interface IndexerOverlayQuestionProposalInput {
  protocol: "context.indexer.overlay-question-proposal-input/v1";
  trusted_validation_input: IndexerContractOverlayValidationInput;
  trusted_validation_result: IndexerContractOverlayValidationResult;
  registry: IndexerRegistry;
  requirement_id: string;
  input_digest: string;
}

export interface IndexerOverlayQuestionRebindInput {
  protocol: "context.indexer.overlay-question-rebind-input/v1";
  trusted_validation_input: IndexerContractOverlayValidationInput;
  trusted_validation_result: IndexerContractOverlayValidationResult;
  base_registry: IndexerRegistry;
  amendment: IndexerOverlayQuestionAmendment;
  confirmation: IndexerRequirementAmendmentConfirmation;
  base_static_report: IndexerSelectionStaticReport;
  base_final_report: IndexerSelectionFinalReport;
  resolved: IndexerResolvedSelectionInput[];
  customizations: IndexerCustomizationView[];
  input_digest: string;
}

export interface IndexerOverlayQuestionRebindResult {
  protocol: "context.indexer.overlay-question-rebind-result/v1";
  rebind_receipt: IndexerOverlayQuestionRebindReceipt;
  proposal: IndexerOverlayQuestionRegistryApplyProposal;
  result_digest: string;
}

export interface IndexerOverlayQuestionProviderRequiredResult {
  protocol: "context.indexer.overlay-question-provider-required/v1";
  outcome: "indexer-provider-required";
  reason: "base-registry-authority-changed";
  base_registry_digest: string;
  current_registry_digest: string;
  result_digest: string;
}

function exactObject(value: unknown, protocol: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${protocol} input must be an object`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.protocol !== protocol) throw new TypeError(`${protocol} input protocol is invalid`);
  const allowed = new Set(keys);
  const unexpected = Object.keys(raw).find((key) => !allowed.has(key));
  if (unexpected !== undefined) throw new TypeError(`${protocol} has unknown field ${unexpected}`);
  return raw;
}

function trustedOverlay(input: {
  validation_input: unknown;
  validation_result: unknown;
}): {
  validationInput: IndexerContractOverlayValidationInput;
  validationResult: IndexerContractOverlayValidationResult;
} {
  const validationInput = validateIndexerContractOverlayValidationInput(input.validation_input);
  const validationResult = validateIndexerContractOverlayValidationResult({
    validation_input: validationInput,
    validation_result: input.validation_result,
  });
  if (validationResult.outcome !== "trusted" || validationResult.trust_receipt === null) {
    throw new TypeError("overlay question lifecycle requires a current trusted overlay receipt");
  }
  return { validationInput, validationResult };
}

function validateDigest(value: unknown, payload: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value) || indexerProtocolDigest(payload) !== value) {
    throw new TypeError(`${label} digest is invalid`);
  }
  return value;
}

export function validateIndexerOverlayQuestionProposalInput(
  value: unknown,
): IndexerOverlayQuestionProposalInput {
  const raw = exactObject(value, "context.indexer.overlay-question-proposal-input/v1", [
    "protocol",
    "trusted_validation_input",
    "trusted_validation_result",
    "registry",
    "requirement_id",
    "input_digest",
  ]);
  const trusted = trustedOverlay({
    validation_input: raw.trusted_validation_input,
    validation_result: raw.trusted_validation_result,
  });
  if (typeof raw.requirement_id !== "string" || raw.requirement_id.length === 0) {
    throw new TypeError("overlay question proposal requirement id is invalid");
  }
  const input: IndexerOverlayQuestionProposalInput = {
    protocol: "context.indexer.overlay-question-proposal-input/v1",
    trusted_validation_input: trusted.validationInput,
    trusted_validation_result: trusted.validationResult,
    registry: indexerRegistrySchema.parse(raw.registry),
    requirement_id: raw.requirement_id,
    input_digest: typeof raw.input_digest === "string" ? raw.input_digest : "",
  };
  const payload = { ...input, input_digest: undefined };
  Reflect.deleteProperty(payload, "input_digest");
  input.input_digest = validateDigest(raw.input_digest, payload, "overlay question proposal input");
  return input;
}

export function buildIndexerOverlayQuestionProposalInput(input: Omit<
  IndexerOverlayQuestionProposalInput,
  "protocol" | "input_digest"
>): IndexerOverlayQuestionProposalInput {
  const payload = {
    protocol: "context.indexer.overlay-question-proposal-input/v1" as const,
    ...input,
  };
  return validateIndexerOverlayQuestionProposalInput({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function proposeProjectIndexerOverlayQuestionAmendment(
  value: unknown,
): IndexerOverlayQuestionAmendment {
  const input = validateIndexerOverlayQuestionProposalInput(value);
  const validation = input.trusted_validation_result;
  return buildIndexerOverlayQuestionAmendment({
    project_ref: input.trusted_validation_input.project_ref,
    registry: input.registry,
    requirement_id: input.requirement_id,
    overlay_validation: {
      overlay: validation.overlay,
      effectiveProfile: validation.effective_profile,
      report: validation.conformance_report,
    },
    base_contract: input.trusted_validation_input.base_contract,
    operator_contract: input.trusted_validation_input.operator_contract,
    provider_integrity: input.trusted_validation_input.provider_integrity,
    trust_receipt: validation.trust_receipt!,
  });
}

export function confirmProjectIndexerOverlayQuestionAmendment(input: {
  amendment: unknown;
  authority: "managed" | "human";
  confirmed_by: string;
  confirmed_at: string;
}): IndexerRequirementAmendmentConfirmation {
  return confirmIndexerRequirementAmendment({
    amendment: validateIndexerOverlayQuestionAmendment(input.amendment),
    authority: input.authority,
    confirmed_by: input.confirmed_by,
    confirmed_at: input.confirmed_at,
  });
}

export function validateIndexerOverlayQuestionRebindInput(
  value: unknown,
): IndexerOverlayQuestionRebindInput {
  const raw = exactObject(value, "context.indexer.overlay-question-rebind-input/v1", [
    "protocol",
    "trusted_validation_input",
    "trusted_validation_result",
    "base_registry",
    "amendment",
    "confirmation",
    "base_static_report",
    "base_final_report",
    "resolved",
    "customizations",
    "input_digest",
  ]);
  const trusted = trustedOverlay({
    validation_input: raw.trusted_validation_input,
    validation_result: raw.trusted_validation_result,
  });
  if (!Array.isArray(raw.resolved) || !Array.isArray(raw.customizations)) {
    throw new TypeError("overlay question rebind Provider inputs are invalid");
  }
  const input: IndexerOverlayQuestionRebindInput = {
    protocol: "context.indexer.overlay-question-rebind-input/v1",
    trusted_validation_input: trusted.validationInput,
    trusted_validation_result: trusted.validationResult,
    base_registry: indexerRegistrySchema.parse(raw.base_registry),
    amendment: validateIndexerOverlayQuestionAmendment(raw.amendment),
    confirmation: raw.confirmation as IndexerRequirementAmendmentConfirmation,
    base_static_report: raw.base_static_report as IndexerSelectionStaticReport,
    base_final_report: raw.base_final_report as IndexerSelectionFinalReport,
    resolved: raw.resolved as IndexerResolvedSelectionInput[],
    customizations: raw.customizations as IndexerCustomizationView[],
    input_digest: typeof raw.input_digest === "string" ? raw.input_digest : "",
  };
  const payload = { ...input, input_digest: undefined };
  Reflect.deleteProperty(payload, "input_digest");
  input.input_digest = validateDigest(raw.input_digest, payload, "overlay question rebind input");
  return input;
}

export function buildIndexerOverlayQuestionRebindInput(input: Omit<
  IndexerOverlayQuestionRebindInput,
  "protocol" | "input_digest"
>): IndexerOverlayQuestionRebindInput {
  const payload = {
    protocol: "context.indexer.overlay-question-rebind-input/v1" as const,
    ...input,
  };
  return validateIndexerOverlayQuestionRebindInput({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export async function rebindProjectIndexerSelectionToOverlayRequirement(input: {
  projectRoot: string;
  value: unknown;
}): Promise<
  IndexerOverlayQuestionRebindResult | IndexerOverlayQuestionProviderRequiredResult
> {
  const value = validateIndexerOverlayQuestionRebindInput(input.value);
  const baseContent = await readFile(join(input.projectRoot, "src", "indexers.yaml"), "utf8");
  const currentRegistry = parseIndexerRegistry(baseContent);
  if (
    canonicalIndexerJson(currentRegistry) !==
      canonicalIndexerJson(value.base_registry)
  ) {
    const payload = {
      protocol: "context.indexer.overlay-question-provider-required/v1" as const,
      outcome: "indexer-provider-required" as const,
      reason: "base-registry-authority-changed" as const,
      base_registry_digest: indexerRegistryDigests(value.base_registry).registryDigest,
      current_registry_digest: indexerRegistryDigests(currentRegistry).registryDigest,
    };
    return { ...payload, result_digest: indexerProtocolDigest(payload) };
  }
  const validation = value.trusted_validation_result;
  const rebind = await rebindIndexerSelectionToOverlayRequirement({
    base_registry: value.base_registry,
    amendment: value.amendment,
    confirmation: value.confirmation,
    base_static_report: value.base_static_report,
    base_final_report: value.base_final_report,
    resolved: value.resolved,
    customizations: value.customizations,
    operator_contract: value.trusted_validation_input.operator_contract,
    profile_contract: value.trusted_validation_input.base_contract,
    provider_integrity: value.trusted_validation_input.provider_integrity,
    overlay_validation: {
      overlay: validation.overlay,
      effectiveProfile: validation.effective_profile,
      report: validation.conformance_report,
    },
    trust_receipt: validation.trust_receipt!,
  });
  const targetContent = YAML.stringify(value.amendment.target_registry);
  const proposal = buildIndexerOverlayQuestionRegistryApplyProposal({
    project_ref: value.trusted_validation_input.project_ref,
    base_registry: value.base_registry,
    base_document_content: baseContent,
    target_document_content: targetContent,
    amendment: value.amendment,
    confirmation: value.confirmation,
    rebind_receipt_digest: rebind.receipt_digest,
    rebound_selection_digest: rebind.target_final_report.report_digest,
    subject_key_schema_set_digest: rebind.target_final_report.subject_key_schema_set_digest,
    finalized_validation_report_digests: [
      value.amendment.conformance_report_digest,
      rebind.target_final_report.report_digest,
      rebind.receipt_digest,
    ],
  });
  const payload = {
    protocol: "context.indexer.overlay-question-rebind-result/v1" as const,
    rebind_receipt: rebind,
    proposal,
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}
