import { z } from "zod";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  compareIndexRequirementContraction,
  type RequirementContractionComparison,
} from "./indexerRequirementComparison.js";
import {
  indexRequirementSchema,
  indexerRegistryDigests,
  indexerRegistrySchema,
  requirementSetFromRegistry,
  validateFinalizedIndexerRegistry,
  type IndexRequirement,
  type IndexerRegistry,
} from "./indexerRegistry.js";
import {
  indexerOverlayValidationReceiptSchema,
  indexerOverlayValidationReceiptDigest,
  validateIndexerContractOverlay,
  type IndexerContractOverlay,
  type IndexerOverlayConformanceReport,
  type IndexerOverlayValidationReceipt,
} from "./indexerContractOverlay.js";
import type {
  IndexerOperatorContract,
  IndexerProfileContract,
  IndexerReaderQuestionContract,
} from "./indexerProfileContract.js";
import { indexerReaderQuestionContractSchema } from "./indexerProfileContract.js";
import {
  indexerRequirementQuestionBindingSchema,
  indexerResolvedMaterialQuestionDigest,
  type IndexerRequirementQuestionBinding,
  type IndexerResolvedMaterialQuestion,
} from "./indexerQuestionAuthority.js";

const comparisonChangeSchema = z.object({
  area: z.enum([
    "target-scope",
    "reader-goals",
    "coverage-domain",
    "exclusions",
    "question",
    "question-semantic",
    "question-selector",
    "question-domain",
    "question-evidence",
  ]),
  path: z.string().min(1),
  relation: z.enum(["strengthening", "contraction", "incomparable"]),
  detail: z.string().min(1),
}).strict();

const requirementComparisonSchema = z.object({
  protocol: z.literal("context.indexer.requirement-contraction-comparison/v1"),
  requirementRef: indexerIdSchema,
  relation: z.enum(["equivalent", "strengthening", "contraction", "incomparable"]),
  requiresHumanConfirmation: z.boolean(),
  evidenceSourceChange: z.enum(["unchanged", "expanded", "reduced", "changed"]),
  changes: z.array(comparisonChangeSchema),
}).strict();

const questionBindingSchema = z.object({
  ref: z.string().regex(/^question:[A-Za-z0-9][A-Za-z0-9._~:/#-]*$/u),
  authority: z.object({
    kind: z.literal("verified-contract-overlay"),
    ref: z.string().regex(/^overlay:[A-Za-z0-9][A-Za-z0-9._~:/#-]*$/u),
    digest: indexerDigestSchema,
  }).strict(),
  contract_version: z.number().int().positive(),
  contract_digest: indexerDigestSchema,
}).strict();

const amendmentQuestionSchema = z.object({
  binding: questionBindingSchema,
  contract: indexerReaderQuestionContractSchema,
  contract_digest: indexerDigestSchema,
}).strict();

const amendmentTargetDomainSchema = z.object({
  id: indexerIdSchema,
  contract_digest: indexerDigestSchema,
}).strict();

export const indexerOverlayQuestionAmendmentSchema = z.object({
  protocol: z.literal("context.indexer.overlay-question-amendment/v1"),
  project_ref: z.string().min(1),
  requirement_id: indexerIdSchema,
  base_requirement_digest: indexerDigestSchema,
  target_requirement: indexRequirementSchema,
  target_requirement_digest: indexerDigestSchema,
  base_requirement_set_digest: indexerDigestSchema,
  target_requirement_set_digest: indexerDigestSchema,
  target_registry: indexerRegistrySchema,
  target_registry_digest: indexerDigestSchema,
  overlay_digest: indexerDigestSchema,
  overlay_validation_receipt_digest: indexerDigestSchema,
  conformance_report_digest: indexerDigestSchema,
  added_target_domains: z.array(amendmentTargetDomainSchema).min(1),
  added_questions: z.array(amendmentQuestionSchema).min(1),
  comparison: requirementComparisonSchema,
  comparison_digest: indexerDigestSchema,
  amendment_digest: indexerDigestSchema,
}).strict();

export type IndexerOverlayQuestionAmendment = z.infer<
  typeof indexerOverlayQuestionAmendmentSchema
>;

function withoutDigest<T extends object, K extends keyof T>(
  value: T,
  field: K,
): Omit<T, K> {
  const payload: Partial<T> = { ...value };
  Reflect.deleteProperty(payload, field);
  return payload as Omit<T, K>;
}

function validationReceiptDigest(receipt: IndexerOverlayValidationReceipt): string {
  const payload = withoutDigest(receipt, "receipt_digest");
  if (indexerOverlayValidationReceiptDigest(payload) !== receipt.receipt_digest) {
    throw new TypeError("overlay validation receipt digest is invalid");
  }
  return receipt.receipt_digest;
}

function requirementDigest(requirement: IndexRequirement): string {
  return indexerProtocolDigest(requirement);
}

function resolvedQuestionPayload(input: {
  contract: IndexerReaderQuestionContract;
  authority: IndexerResolvedMaterialQuestion["authority"];
}): Omit<IndexerResolvedMaterialQuestion, "contract_digest"> {
  return {
    ref: input.contract.ref,
    authority: input.authority,
    contract_version: input.contract.version,
    semantic: input.contract.semantic,
    coverage_domain: input.contract.coverage_domain,
    target_domain_ref: input.contract.target_domain_ref,
    target_selector: input.contract.target_selector,
    evidence_contract: input.contract.evidence_contract,
    ...(input.contract.allowed_exclusion_reason_codes === undefined
      ? {}
      : { allowed_exclusion_reason_codes: input.contract.allowed_exclusion_reason_codes }),
  };
}

function questionContractDigest(input: {
  contract: IndexerReaderQuestionContract;
  authority: IndexerResolvedMaterialQuestion["authority"];
}): string {
  return indexerResolvedMaterialQuestionDigest(resolvedQuestionPayload(input));
}

function overlayAuthorityRef(overlay: IndexerContractOverlay): string {
  return `overlay:${overlay.id}/${overlay.version}`;
}

function assertNamespacedQuestionRef(ref: string): void {
  if (!ref.slice("question:".length).includes("/")) {
    throw new TypeError("overlay question refs must be namespaced");
  }
}

function assertNamespacedTargetDomain(id: string): void {
  if (!id.includes("/")) {
    throw new TypeError("overlay question target-domain ids must be namespaced");
  }
}

function assertValidationReceipt(input: {
  receipt: IndexerOverlayValidationReceipt;
  projectRef: string;
  providerIntegrity: string;
  overlay: IndexerContractOverlay;
  base: IndexerProfileContract;
  operators: IndexerOperatorContract;
  report: IndexerOverlayConformanceReport;
}): void {
  if (
    input.receipt.overlay_digest !== input.overlay.overlay_digest ||
    input.receipt.base_contract_digest !== input.base.contract_digest ||
    input.receipt.provider_integrity !== input.providerIntegrity ||
    input.receipt.operator_contract_digest !== input.operators.contract_digest ||
    input.receipt.conformance_report_digest !== input.report.report_digest ||
    input.receipt.project_ref !== input.projectRef
  ) {
    throw new TypeError("overlay validation receipt is stale or bound to another validation");
  }
}

function validateQuestionAdditions(input: {
  overlay: IndexerContractOverlay;
  baseRequirement: IndexRequirement;
}): {
  targetDomains: IndexerOverlayQuestionAmendment["added_target_domains"];
  questions: IndexerOverlayQuestionAmendment["added_questions"];
} {
  const targetDomains = input.overlay.additions.question_target_domains ?? [];
  const questions = input.overlay.additions.reader_question_contracts ?? [];
  if (targetDomains.length === 0 || questions.length === 0) {
    throw new TypeError("overlay question amendment requires target-domain and question additions");
  }
  const targetDomainMap = new Map(targetDomains.map((domain) => [domain.id, domain]));
  for (const domain of targetDomains) assertNamespacedTargetDomain(domain.id);
  const existingQuestions = new Set(
    (input.baseRequirement.questions ?? []).map((question) => question.ref),
  );
  const authorityRef = overlayAuthorityRef(input.overlay);
  const addedQuestions = questions.map((contract) => {
    assertNamespacedQuestionRef(contract.ref);
    if (existingQuestions.has(contract.ref)) {
      throw new TypeError("overlay amendment cannot replace an existing question binding");
    }
    if (!targetDomainMap.has(contract.target_domain_ref)) {
      throw new TypeError("overlay question must target a domain added by the same verified overlay");
    }
    if (input.baseRequirement.coverage_domains[contract.coverage_domain] === undefined ||
      input.baseRequirement.coverage_domains[contract.coverage_domain] === "out-of-scope") {
      throw new TypeError("overlay question cannot introduce or revive a coverage domain");
    }
    const authority = {
      kind: "verified-contract-overlay" as const,
      ref: authorityRef,
      digest: input.overlay.overlay_digest,
    };
    const digest = questionContractDigest({ contract, authority });
    return {
      binding: {
        ref: contract.ref,
        authority,
        contract_version: contract.version,
        contract_digest: digest,
      },
      contract,
      contract_digest: digest,
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.binding.ref, right.binding.ref));
  return {
    targetDomains: targetDomains.map((domain) => ({
      id: domain.id,
      contract_digest: indexerProtocolDigest(domain),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    questions: addedQuestions,
  };
}

function replaceRequirement(
  registry: IndexerRegistry,
  requirement: IndexRequirement,
): IndexerRegistry {
  return {
    ...registry,
    requirements: registry.requirements.map((item) =>
      item.id === requirement.id ? requirement : item
    ),
  };
}

function assertQuestionOwners(input: {
  registry: IndexerRegistry;
  requirementId: string;
  questions: IndexerOverlayQuestionAmendment["added_questions"];
}): void {
  for (const question of input.questions) {
    const domain = question.contract.coverage_domain;
    const owners = input.registry.indexers.flatMap((indexer) =>
      indexer.requirement_bindings.filter((binding) =>
        binding.requirement_ref === input.requirementId &&
        binding.role === "primary" &&
        binding.coverage_domains.includes(domain)
      ).map(() => indexer.id)
    );
    if (owners.length !== 1) {
      throw new TypeError(
        `overlay question ${question.binding.ref} requires one existing primary owner for ${domain}`,
      );
    }
  }
}

export interface IndexerOverlayQuestionAuthorityProof {
  project_ref: string;
  requirement_id: string;
  provider_integrity: string;
  overlay_validation: ReturnType<typeof validateIndexerContractOverlay>;
  validation_receipt: IndexerOverlayValidationReceipt;
}

export function resolveIndexerOverlayQuestionBindingAuthority(input: {
  registry: IndexerRegistry;
  binding: unknown;
  base_contract: IndexerProfileContract;
  operator_contract: IndexerOperatorContract;
  proof: IndexerOverlayQuestionAuthorityProof;
}): IndexerResolvedMaterialQuestion {
  validateFinalizedIndexerRegistry(input.registry);
  const binding = indexerRequirementQuestionBindingSchema.parse(input.binding);
  if (binding.authority.kind !== "verified-contract-overlay") {
    throw new TypeError("overlay question authority requires a verified overlay binding");
  }
  const requirement = input.registry.requirements.find((item) =>
    item.id === input.proof.requirement_id
  );
  if (requirement === undefined) throw new TypeError("overlay question requirement is absent");
  const validation = validateIndexerContractOverlay({
    overlay: input.proof.overlay_validation.overlay,
    baseContract: input.base_contract,
    operatorContract: input.operator_contract,
  });
  if (
    canonicalIndexerJson(validation.report) !==
      canonicalIndexerJson(input.proof.overlay_validation.report)
  ) {
    throw new TypeError("overlay question authority requires the current conformance report");
  }
  const receipt = indexerOverlayValidationReceiptSchema.parse(
    input.proof.validation_receipt,
  );
  assertValidationReceipt({
    receipt,
    projectRef: input.proof.project_ref,
    providerIntegrity: input.proof.provider_integrity,
    overlay: validation.overlay,
    base: input.base_contract,
    operators: input.operator_contract,
    report: validation.report,
  });
  validationReceiptDigest(receipt);
  const authorityRef = overlayAuthorityRef(validation.overlay);
  if (
    binding.authority.ref !== authorityRef ||
    binding.authority.digest !== validation.overlay.overlay_digest
  ) {
    throw new TypeError("overlay question binding belongs to another overlay authority");
  }
  const overlayAuthority = {
    kind: "verified-contract-overlay" as const,
    ref: binding.authority.ref,
    digest: binding.authority.digest,
  };
  const contract = (validation.overlay.additions.reader_question_contracts ?? [])
    .find((item) => item.ref === binding.ref);
  if (contract === undefined) {
    throw new TypeError("overlay question binding is absent from the verified overlay");
  }
  assertNamespacedQuestionRef(contract.ref);
  const targetDomain = (validation.overlay.additions.question_target_domains ?? [])
    .find((item) => item.id === contract.target_domain_ref);
  if (targetDomain === undefined) {
    throw new TypeError("overlay question target domain is absent from the same verified overlay");
  }
  assertNamespacedTargetDomain(targetDomain.id);
  if (
    requirement.coverage_domains[contract.coverage_domain] === undefined ||
    requirement.coverage_domains[contract.coverage_domain] === "out-of-scope"
  ) {
    throw new TypeError("overlay question binding targets an unavailable coverage domain");
  }
  const question = {
    binding: { ...binding, authority: overlayAuthority },
    contract,
    contract_digest: questionContractDigest({ contract, authority: overlayAuthority }),
  };
  assertQuestionOwners({
    registry: input.registry,
    requirementId: requirement.id,
    questions: [question],
  });
  if (
    binding.contract_version !== contract.version ||
    binding.contract_digest !== question.contract_digest
  ) {
    throw new TypeError("overlay question binding does not match its verified contract");
  }
  const authority: IndexerRequirementQuestionBinding["authority"] = overlayAuthority;
  return {
    ...resolvedQuestionPayload({ contract, authority }),
    contract_digest: question.contract_digest,
  };
}

export function buildIndexerOverlayQuestionAmendment(input: {
  project_ref: string;
  registry: IndexerRegistry;
  requirement_id: string;
  overlay_validation: ReturnType<typeof validateIndexerContractOverlay>;
  base_contract: IndexerProfileContract;
  operator_contract: IndexerOperatorContract;
  provider_integrity: string;
  validation_receipt: unknown;
}): IndexerOverlayQuestionAmendment {
  validateFinalizedIndexerRegistry(input.registry);
  const baseRequirement = input.registry.requirements.find((requirement) =>
    requirement.id === input.requirement_id
  );
  if (baseRequirement === undefined) throw new TypeError("overlay amendment requirement is absent");
  const validation = validateIndexerContractOverlay({
    overlay: input.overlay_validation.overlay,
    baseContract: input.base_contract,
    operatorContract: input.operator_contract,
  });
  if (
    canonicalIndexerJson(validation.report) !==
      canonicalIndexerJson(input.overlay_validation.report)
  ) {
    throw new TypeError("overlay question amendment requires the current conformance report");
  }
  const receipt = indexerOverlayValidationReceiptSchema.parse(
    input.validation_receipt,
  );
  assertValidationReceipt({
    receipt,
    projectRef: input.project_ref,
    providerIntegrity: input.provider_integrity,
    overlay: validation.overlay,
    base: input.base_contract,
    operators: input.operator_contract,
    report: validation.report,
  });
  const additions = validateQuestionAdditions({
    overlay: validation.overlay,
    baseRequirement,
  });
  const targetRequirement: IndexRequirement = indexRequirementSchema.parse({
    ...baseRequirement,
    questions: [
      ...(baseRequirement.questions ?? []),
      ...additions.questions.map((question) => question.binding),
    ].sort((left, right) => compareIndexerCanonicalText(left.ref, right.ref)),
  });
  const targetRegistry = replaceRequirement(input.registry, targetRequirement);
  validateFinalizedIndexerRegistry(targetRegistry);
  assertQuestionOwners({
    registry: targetRegistry,
    requirementId: targetRequirement.id,
    questions: additions.questions,
  });
  const comparison = compareIndexRequirementContraction(baseRequirement, targetRequirement);
  if (comparison.relation !== "strengthening" || comparison.requiresHumanConfirmation) {
    throw new TypeError("overlay question amendment must be a pure requirement strengthening");
  }
  const baseDigests = indexerRegistryDigests(input.registry);
  const targetDigests = indexerRegistryDigests(targetRegistry);
  const payload: Omit<IndexerOverlayQuestionAmendment, "amendment_digest"> = {
    protocol: "context.indexer.overlay-question-amendment/v1",
    project_ref: input.project_ref,
    requirement_id: targetRequirement.id,
    base_requirement_digest: requirementDigest(baseRequirement),
    target_requirement: targetRequirement,
    target_requirement_digest: requirementDigest(targetRequirement),
    base_requirement_set_digest: baseDigests.requirementSetDigest,
    target_requirement_set_digest: targetDigests.requirementSetDigest,
    target_registry: targetRegistry,
    target_registry_digest: targetDigests.registryDigest,
    overlay_digest: validation.overlay.overlay_digest,
    overlay_validation_receipt_digest: validationReceiptDigest(receipt),
    conformance_report_digest: validation.report.report_digest,
    added_target_domains: additions.targetDomains,
    added_questions: additions.questions,
    comparison,
    comparison_digest: indexerProtocolDigest(comparison),
  };
  return validateIndexerOverlayQuestionAmendment({
    ...payload,
    amendment_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerOverlayQuestionAmendment(
  value: unknown,
): IndexerOverlayQuestionAmendment {
  const amendment = indexerOverlayQuestionAmendmentSchema.parse(value);
  if (amendment.target_requirement.id !== amendment.requirement_id) {
    throw new TypeError("overlay amendment target requirement identity is inconsistent");
  }
  if (requirementDigest(amendment.target_requirement) !== amendment.target_requirement_digest) {
    throw new TypeError("overlay amendment target requirement digest is invalid");
  }
  const targetRequirement = amendment.target_registry.requirements.find((requirement) =>
    requirement.id === amendment.requirement_id
  );
  if (
    targetRequirement === undefined ||
    canonicalIndexerJson(targetRequirement) !== canonicalIndexerJson(amendment.target_requirement)
  ) {
    throw new TypeError("overlay amendment target registry has another requirement snapshot");
  }
  const targetDigests = indexerRegistryDigests(amendment.target_registry);
  if (
    targetDigests.requirementSetDigest !== amendment.target_requirement_set_digest ||
    targetDigests.registryDigest !== amendment.target_registry_digest ||
    indexerProtocolDigest(amendment.comparison) !== amendment.comparison_digest
  ) {
    throw new TypeError("overlay amendment target or comparison digest is invalid");
  }
  if (
    amendment.comparison.requirementRef !== amendment.requirement_id ||
    amendment.comparison.relation !== "strengthening" ||
    amendment.comparison.requiresHumanConfirmation
  ) {
    throw new TypeError("overlay amendment comparison is not a pure strengthening");
  }
  for (const question of amendment.added_questions) {
    if (
      question.binding.authority.digest !== amendment.overlay_digest ||
      question.contract.ref !== question.binding.ref ||
      question.contract.version !== question.binding.contract_version ||
      questionContractDigest({
        contract: question.contract,
        authority: question.binding.authority,
      }) !==
        question.contract_digest ||
      question.contract_digest !== question.binding.contract_digest
    ) {
      throw new TypeError("overlay amendment question binding is not canonical");
    }
  }
  const payload = withoutDigest(amendment, "amendment_digest");
  if (indexerProtocolDigest(payload) !== amendment.amendment_digest) {
    throw new TypeError("overlay question amendment digest is invalid");
  }
  return amendment;
}

export const indexerRequirementAmendmentConfirmationSchema = z.object({
  protocol: z.literal("context.indexer.requirement-amendment-confirmation/v1"),
  project_ref: z.string().min(1),
  amendment_digest: indexerDigestSchema,
  base_requirement_set_digest: indexerDigestSchema,
  target_requirement_set_digest: indexerDigestSchema,
  comparison_digest: indexerDigestSchema,
  authority: z.enum(["managed", "human"]),
  non_delegable: z.boolean(),
  confirmed_by: z.string().min(1),
  confirmed_at: z.string().datetime({ offset: true }),
  confirmation_digest: indexerDigestSchema,
}).strict();

export type IndexerRequirementAmendmentConfirmation = z.infer<
  typeof indexerRequirementAmendmentConfirmationSchema
>;

export function indexerRequirementAmendmentConfirmationDigest(
  value: Omit<IndexerRequirementAmendmentConfirmation, "confirmation_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function confirmIndexerRequirementAmendment(input: {
  amendment: unknown;
  authority: "managed" | "human";
  confirmed_by: string;
  confirmed_at: string;
}): IndexerRequirementAmendmentConfirmation {
  const amendment = validateIndexerOverlayQuestionAmendment(input.amendment);
  const requiresHuman = amendment.comparison.requiresHumanConfirmation;
  if (requiresHuman && input.authority !== "human") {
    throw new TypeError("requirement contraction/incomparable amendment requires human confirmation");
  }
  const payload: Omit<IndexerRequirementAmendmentConfirmation, "confirmation_digest"> = {
    protocol: "context.indexer.requirement-amendment-confirmation/v1",
    project_ref: amendment.project_ref,
    amendment_digest: amendment.amendment_digest,
    base_requirement_set_digest: amendment.base_requirement_set_digest,
    target_requirement_set_digest: amendment.target_requirement_set_digest,
    comparison_digest: amendment.comparison_digest,
    authority: input.authority,
    non_delegable: requiresHuman,
    confirmed_by: input.confirmed_by,
    confirmed_at: input.confirmed_at,
  };
  return indexerRequirementAmendmentConfirmationSchema.parse({
    ...payload,
    confirmation_digest: indexerRequirementAmendmentConfirmationDigest(payload),
  });
}

export function validateIndexerRequirementAmendmentConfirmation(input: {
  amendment: unknown;
  confirmation: unknown;
}): IndexerRequirementAmendmentConfirmation {
  const amendment = validateIndexerOverlayQuestionAmendment(input.amendment);
  const confirmation = indexerRequirementAmendmentConfirmationSchema.parse(
    input.confirmation,
  );
  const payload = withoutDigest(confirmation, "confirmation_digest");
  if (
    indexerRequirementAmendmentConfirmationDigest(payload) !==
      confirmation.confirmation_digest
  ) {
    throw new TypeError("requirement amendment confirmation digest is invalid");
  }
  if (
    confirmation.project_ref !== amendment.project_ref ||
    confirmation.amendment_digest !== amendment.amendment_digest ||
    confirmation.base_requirement_set_digest !== amendment.base_requirement_set_digest ||
    confirmation.target_requirement_set_digest !== amendment.target_requirement_set_digest ||
    confirmation.comparison_digest !== amendment.comparison_digest
  ) {
    throw new TypeError("requirement amendment confirmation is stale or belongs to another proposal");
  }
  if (
    amendment.comparison.requiresHumanConfirmation &&
    (confirmation.authority !== "human" || !confirmation.non_delegable)
  ) {
    throw new TypeError("requirement amendment human Gate cannot be delegated");
  }
  if (!amendment.comparison.requiresHumanConfirmation && confirmation.non_delegable) {
    throw new TypeError("strengthening confirmation cannot claim a non-delegable Gate");
  }
  return confirmation;
}

export function indexerRequirementSetDigest(registry: IndexerRegistry): string {
  return indexerProtocolDigest(requirementSetFromRegistry(registry));
}

export type { RequirementContractionComparison };
