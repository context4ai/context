import { z } from "zod";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { compareIndexRequirementContraction } from "./indexerRequirementComparison.js";
import {
  indexRequirementSchema,
  indexerRegistryDigests,
  indexerRegistrySchema,
  validateFinalizedIndexerRegistry,
  type IndexRequirement,
  type IndexerRegistry,
} from "./indexerRegistry.js";
import {
  indexerReaderQuestionContractSchema,
  validateIndexerProfileContract,
  type IndexerReaderQuestionContract,
} from "./indexerProfileContract.js";
import {
  indexerRequirementQuestionBindingSchema,
  indexerResolvedMaterialQuestionDigest,
  type IndexerRequirementQuestionBinding,
  type IndexerResolvedMaterialQuestion,
} from "./indexerQuestionAuthority.js";
import {
  indexerRequirementAmendmentConfirmationSchema,
  indexerRequirementAmendmentConfirmationDigest,
  type IndexerRequirementAmendmentConfirmation,
} from "./indexerOverlayQuestionAmendment.js";

const baseQuestionSchema = z.object({
  binding: z.object({
    ref: z.string(),
    authority: z.object({
      kind: z.literal("cli-base-contract"),
      ref: z.string(),
      digest: indexerDigestSchema,
    }).strict(),
    contract_version: z.number().int().positive(),
    contract_digest: indexerDigestSchema,
  }).strict(),
  contract: indexerReaderQuestionContractSchema,
  contract_digest: indexerDigestSchema,
}).strict();

export const indexerBaseQuestionAmendmentSchema = z.object({
  protocol: z.literal("context.indexer.base-question-amendment/v1"),
  project_ref: z.string().min(1),
  requirement_id: indexerIdSchema,
  profile: indexerIdSchema,
  base_requirement_digest: indexerDigestSchema,
  target_requirement: indexRequirementSchema,
  target_requirement_digest: indexerDigestSchema,
  base_requirement_set_digest: indexerDigestSchema,
  target_requirement_set_digest: indexerDigestSchema,
  target_registry: indexerRegistrySchema,
  target_registry_digest: indexerDigestSchema,
  added_questions: z.array(baseQuestionSchema).min(1),
  comparison_digest: indexerDigestSchema,
  amendment_digest: indexerDigestSchema,
}).strict();

export type IndexerBaseQuestionAmendment = z.infer<
  typeof indexerBaseQuestionAmendmentSchema
>;

function omitField<T extends object, K extends keyof T>(value: T, field: K): Omit<T, K> {
  const payload: Partial<T> = { ...value };
  Reflect.deleteProperty(payload, field);
  return payload as Omit<T, K>;
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

export function resolveIndexerBaseQuestionBindingAuthority(input: {
  registry: IndexerRegistry;
  requirement_id: string;
  binding: unknown;
  profile_contract: unknown;
  operator_contract: unknown;
}): IndexerResolvedMaterialQuestion {
  validateFinalizedIndexerRegistry(input.registry);
  const binding = indexerRequirementQuestionBindingSchema.parse(input.binding);
  if (binding.authority.kind !== "cli-base-contract") {
    throw new TypeError("base question authority requires a CLI base binding");
  }
  const contract = validateIndexerProfileContract(
    input.profile_contract,
    input.operator_contract,
  );
  const requirement = input.registry.requirements.find((item) =>
    item.id === input.requirement_id
  );
  if (requirement === undefined) throw new TypeError("base question requirement is absent");
  const candidates = contract.profiles.flatMap((profile) => {
    const authorityRef = `profile:${profile.id}/${contract.version}`;
    if (
      binding.authority.ref !== authorityRef ||
      binding.authority.digest !== contract.contract_digest
    ) return [];
    const question = profile.reader_question_contracts.find((item) => item.ref === binding.ref);
    return question === undefined ? [] : [{ profile: profile.id, question }];
  });
  if (candidates.length !== 1) {
    throw new TypeError("base question binding has no unique canonical contract authority");
  }
  const { profile, question } = candidates[0]!;
  if (
    requirement.coverage_domains[question.coverage_domain] === undefined ||
    requirement.coverage_domains[question.coverage_domain] === "out-of-scope"
  ) {
    throw new TypeError("base question binding targets an unavailable coverage domain");
  }
  const applicableOwner = input.registry.indexers.some((indexer) => {
    const ownsDomain = indexer.requirement_bindings.some((owner) =>
      owner.requirement_ref === requirement.id &&
      owner.role === "primary" &&
      owner.coverage_domains.includes(question.coverage_domain)
    );
    const selectedProfiles = [
      indexer.profile.primary.id,
      ...(indexer.profile.additional ?? []).map((item) => item.id),
    ];
    return ownsDomain && selectedProfiles.includes(profile);
  });
  if (!applicableOwner) {
    throw new TypeError("base question profile has no applicable primary owner");
  }
  const authority: IndexerRequirementQuestionBinding["authority"] = {
    kind: "cli-base-contract",
    ref: `profile:${profile}/${contract.version}`,
    digest: contract.contract_digest,
  };
  const payload = resolvedQuestionPayload({ contract: question, authority });
  const contractDigest = indexerResolvedMaterialQuestionDigest(payload);
  if (
    binding.contract_version !== question.version ||
    binding.contract_digest !== contractDigest
  ) {
    throw new TypeError("base question binding does not match its canonical contract");
  }
  return { ...payload, contract_digest: contractDigest };
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

export function buildIndexerBaseQuestionAmendment(input: {
  project_ref: string;
  registry: IndexerRegistry;
  requirement_id: string;
  profile: string;
  question_refs: readonly string[];
  profile_contract: unknown;
  operator_contract: unknown;
}): IndexerBaseQuestionAmendment {
  const contract = validateIndexerProfileContract(
    input.profile_contract,
    input.operator_contract,
  );
  const profile = contract.profiles.find((item) => item.id === input.profile);
  if (profile === undefined) throw new TypeError("base question amendment profile is unknown");
  const requirement = input.registry.requirements.find((item) =>
    item.id === input.requirement_id
  );
  if (requirement === undefined) throw new TypeError("base question amendment requirement is absent");
  const refs = [...new Set(input.question_refs)].sort(compareIndexerCanonicalText);
  if (refs.length === 0 || refs.length !== input.question_refs.length) {
    throw new TypeError("base question amendment requires unique question refs");
  }
  const existing = new Set((requirement.questions ?? []).map((question) => question.ref));
  const authority = {
    kind: "cli-base-contract" as const,
    ref: `profile:${profile.id}/${contract.version}`,
    digest: contract.contract_digest,
  };
  const addedQuestions = refs.map((ref) => {
    const question = profile.reader_question_contracts.find((item) => item.ref === ref);
    if (question === undefined) {
      throw new TypeError(`base profile ${profile.id} has no canonical question ${ref}`);
    }
    if (existing.has(ref)) throw new TypeError(`requirement already binds question ${ref}`);
    if (
      requirement.coverage_domains[question.coverage_domain] === undefined ||
      requirement.coverage_domains[question.coverage_domain] === "out-of-scope"
    ) {
      throw new TypeError("base question cannot introduce or revive a coverage domain");
    }
    const digest = indexerResolvedMaterialQuestionDigest(resolvedQuestionPayload({
      contract: question,
      authority,
    }));
    return {
      binding: {
        ref: question.ref,
        authority,
        contract_version: question.version,
        contract_digest: digest,
      },
      contract: question,
      contract_digest: digest,
    };
  });
  const targetRequirement = indexRequirementSchema.parse({
    ...requirement,
    questions: [
      ...(requirement.questions ?? []),
      ...addedQuestions.map((question) => question.binding),
    ].sort((left, right) => compareIndexerCanonicalText(left.ref, right.ref)),
  });
  const targetRegistry = replaceRequirement(input.registry, targetRequirement);
  const baseDigests = indexerRegistryDigests(input.registry);
  const targetDigests = indexerRegistryDigests(targetRegistry);
  const comparison = compareIndexRequirementContraction(requirement, targetRequirement);
  if (comparison.relation !== "strengthening" || comparison.requiresHumanConfirmation) {
    throw new TypeError("base question amendment must be a pure strengthening");
  }
  const payload: Omit<IndexerBaseQuestionAmendment, "amendment_digest"> = {
    protocol: "context.indexer.base-question-amendment/v1",
    project_ref: input.project_ref,
    requirement_id: requirement.id,
    profile: profile.id,
    base_requirement_digest: indexerProtocolDigest(requirement),
    target_requirement: targetRequirement,
    target_requirement_digest: indexerProtocolDigest(targetRequirement),
    base_requirement_set_digest: baseDigests.requirementSetDigest,
    target_requirement_set_digest: targetDigests.requirementSetDigest,
    target_registry: targetRegistry,
    target_registry_digest: targetDigests.registryDigest,
    added_questions: addedQuestions,
    comparison_digest: indexerProtocolDigest(comparison),
  };
  return validateIndexerBaseQuestionAmendment({
    ...payload,
    amendment_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerBaseQuestionAmendment(
  value: unknown,
): IndexerBaseQuestionAmendment {
  const amendment = indexerBaseQuestionAmendmentSchema.parse(value);
  const target = amendment.target_registry.requirements.find((item) =>
    item.id === amendment.requirement_id
  );
  if (
    target === undefined ||
    canonicalIndexerJson(target) !== canonicalIndexerJson(amendment.target_requirement) ||
    indexerProtocolDigest(target) !== amendment.target_requirement_digest
  ) {
    throw new TypeError("base question amendment target requirement is inconsistent");
  }
  const targetDigests = indexerRegistryDigests(amendment.target_registry);
  if (
    targetDigests.requirementSetDigest !== amendment.target_requirement_set_digest ||
    targetDigests.registryDigest !== amendment.target_registry_digest
  ) {
    throw new TypeError("base question amendment target registry digest is invalid");
  }
  for (const question of amendment.added_questions) {
    const payload = resolvedQuestionPayload({
      contract: question.contract,
      authority: question.binding.authority,
    });
    if (
      question.binding.authority.kind !== "cli-base-contract" ||
      question.binding.ref !== question.contract.ref ||
      question.binding.contract_version !== question.contract.version ||
      indexerResolvedMaterialQuestionDigest(payload) !== question.contract_digest ||
      question.binding.contract_digest !== question.contract_digest
    ) {
      throw new TypeError("base question amendment binding is not canonical");
    }
  }
  if (indexerProtocolDigest(omitField(amendment, "amendment_digest")) !== amendment.amendment_digest) {
    throw new TypeError("base question amendment digest is invalid");
  }
  return amendment;
}

export function confirmIndexerBaseQuestionAmendment(input: {
  amendment: unknown;
  authority: "managed" | "human";
  confirmed_by: string;
  confirmed_at: string;
}): IndexerRequirementAmendmentConfirmation {
  const amendment = validateIndexerBaseQuestionAmendment(input.amendment);
  const payload: Omit<IndexerRequirementAmendmentConfirmation, "confirmation_digest"> = {
    protocol: "context.indexer.requirement-amendment-confirmation/v1",
    project_ref: amendment.project_ref,
    amendment_digest: amendment.amendment_digest,
    base_requirement_set_digest: amendment.base_requirement_set_digest,
    target_requirement_set_digest: amendment.target_requirement_set_digest,
    comparison_digest: amendment.comparison_digest,
    authority: input.authority,
    non_delegable: false,
    confirmed_by: input.confirmed_by,
    confirmed_at: input.confirmed_at,
  };
  return indexerRequirementAmendmentConfirmationSchema.parse({
    ...payload,
    confirmation_digest: indexerRequirementAmendmentConfirmationDigest(payload),
  });
}

export function validateIndexerBaseQuestionAmendmentConfirmation(input: {
  amendment: unknown;
  confirmation: unknown;
}): IndexerRequirementAmendmentConfirmation {
  const amendment = validateIndexerBaseQuestionAmendment(input.amendment);
  const confirmation = indexerRequirementAmendmentConfirmationSchema.parse(input.confirmation);
  const payload = omitField(confirmation, "confirmation_digest");
  if (
    confirmation.project_ref !== amendment.project_ref ||
    confirmation.amendment_digest !== amendment.amendment_digest ||
    confirmation.base_requirement_set_digest !== amendment.base_requirement_set_digest ||
    confirmation.target_requirement_set_digest !== amendment.target_requirement_set_digest ||
    confirmation.comparison_digest !== amendment.comparison_digest ||
    confirmation.non_delegable ||
    indexerRequirementAmendmentConfirmationDigest(payload) !== confirmation.confirmation_digest
  ) {
    throw new TypeError("base question amendment confirmation is stale or invalid");
  }
  return confirmation;
}
