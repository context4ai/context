import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  INDEXER_EVIDENCE_KINDS,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  indexerRestrictedSelectorSchema,
  validateIndexerRestrictedSelector,
} from "./indexerRestrictedSelector.js";
import { canonicalIndexerNodeRef, indexerSubjectKeySchema } from "./indexerSubjectIdentity.js";

const questionAuthoritySchema = z.object({
  kind: z.enum(["cli-base-contract", "verified-contract-overlay"]),
  ref: indexerCanonicalRefSchema,
  digest: indexerDigestSchema,
}).strict();

export const indexerRequirementQuestionBindingSchema = z.object({
  ref: indexerCanonicalRefSchema,
  authority: questionAuthoritySchema,
  contract_version: z.number().int().positive(),
  contract_digest: indexerDigestSchema,
}).strict();

export const indexerQuestionEvidenceContractSchema = z.object({
  accepted_kinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)).min(1),
  minimum_items: z.number().int().positive(),
  minimum_distinct_sources: z.number().int().positive(),
  provenance_constraints: indexerRestrictedSelectorSchema.optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.accepted_kinds).size !== value.accepted_kinds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "accepted_kinds must not contain duplicates",
      path: ["accepted_kinds"],
    });
  }
  if (value.minimum_distinct_sources > value.minimum_items) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "minimum_distinct_sources must not exceed minimum_items",
      path: ["minimum_distinct_sources"],
    });
  }
});

export const indexerResolvedMaterialQuestionSchema = z.object({
  ref: indexerCanonicalRefSchema,
  authority: questionAuthoritySchema,
  contract_version: z.number().int().positive(),
  contract_digest: indexerDigestSchema,
  semantic: z.string().min(1).refine(
    (value) => value.normalize("NFC") === value,
    "semantic must use Unicode NFC normalization",
  ),
  coverage_domain: indexerIdSchema,
  target_domain_ref: indexerIdSchema,
  target_selector: indexerRestrictedSelectorSchema,
  evidence_contract: indexerQuestionEvidenceContractSchema,
  allowed_exclusion_reason_codes: z.array(indexerIdSchema).optional(),
}).strict();

export type IndexerRequirementQuestionBinding = z.infer<
  typeof indexerRequirementQuestionBindingSchema
>;
export type IndexerResolvedMaterialQuestion = z.infer<
  typeof indexerResolvedMaterialQuestionSchema
>;
export type IndexerQuestionEvidenceContract = z.infer<
  typeof indexerQuestionEvidenceContractSchema
>;

function resolvedQuestionDigestPayload(question: Omit<
  IndexerResolvedMaterialQuestion,
  "contract_digest"
>) {
  return {
    ref: question.ref,
    contract_version: question.contract_version,
    semantic: question.semantic,
    coverage_domain: question.coverage_domain,
    target_domain_ref: question.target_domain_ref,
    target_selector: question.target_selector,
    evidence_contract: question.evidence_contract,
    allowed_exclusion_reason_codes: question.allowed_exclusion_reason_codes ?? [],
  };
}

export function indexerResolvedMaterialQuestionDigest(
  question: Omit<IndexerResolvedMaterialQuestion, "contract_digest">,
): string {
  return indexerProtocolDigest(resolvedQuestionDigestPayload(question));
}

export function validateIndexerResolvedMaterialQuestion(input: {
  binding: unknown;
  resolved_question: unknown;
  allowed_selector_fact_paths: ReadonlySet<string>;
  coverage_domain_state: "required" | "optional" | "out-of-scope";
}): IndexerResolvedMaterialQuestion {
  const binding = indexerRequirementQuestionBindingSchema.parse(input.binding);
  const question = indexerResolvedMaterialQuestionSchema.parse(input.resolved_question);
  if (
    question.ref !== binding.ref ||
    question.authority.kind !== binding.authority.kind ||
    question.authority.ref !== binding.authority.ref ||
    question.authority.digest !== binding.authority.digest ||
    question.contract_version !== binding.contract_version ||
    question.contract_digest !== binding.contract_digest
  ) {
    throw new TypeError("resolved question does not match its requirement authority binding");
  }
  const payload = Object.fromEntries(
    Object.entries(question).filter(([key]) => key !== "contract_digest"),
  ) as Omit<IndexerResolvedMaterialQuestion, "contract_digest">;
  if (indexerResolvedMaterialQuestionDigest(payload) !== question.contract_digest) {
    throw new TypeError("resolved material question contract digest is invalid");
  }
  if (input.coverage_domain_state === "out-of-scope") {
    throw new TypeError("material question coverage domain cannot be out-of-scope");
  }
  validateIndexerRestrictedSelector(
    question.target_selector,
    input.allowed_selector_fact_paths,
  );
  if (question.evidence_contract.provenance_constraints !== undefined) {
    validateIndexerRestrictedSelector(
      question.evidence_contract.provenance_constraints,
      input.allowed_selector_fact_paths,
    );
  }
  return question;
}

const questionTargetInventoryItemSchema = z.object({
  target_ref: indexerCanonicalRefSchema,
  target_domain_ref: indexerIdSchema,
  requirement_ref: indexerCanonicalRefSchema,
  owner_cell_ref: indexerCanonicalRefSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  subject_key: indexerSubjectKeySchema,
  node_ref: indexerCanonicalRefSchema,
  canonical_fact_slice_digest: indexerDigestSchema,
}).strict();

export const indexerQuestionTargetInventorySchema = z.object({
  protocol: z.literal("context.indexer.question-target-inventory/v1"),
  inventory_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  profile_contract_digests: z.array(indexerDigestSchema).min(1),
  source_inventory_digests: z.array(indexerDigestSchema).min(1),
  items: z.array(questionTargetInventoryItemSchema),
}).strict();

export type IndexerQuestionTargetInventoryItem = z.infer<
  typeof questionTargetInventoryItemSchema
>;
export type IndexerQuestionTargetInventory = z.infer<
  typeof indexerQuestionTargetInventorySchema
>;

export function indexerQuestionSubjectTargetRef(input: {
  target_domain_ref: string;
  owner_cell_ref: string;
  subject_key: unknown;
}): string {
  return `question-target:${indexerProtocolDigest({
    target_domain_ref: input.target_domain_ref,
    owner_cell_ref: input.owner_cell_ref,
    subject_key: input.subject_key,
  })}`;
}

export function indexerQuestionTargetItemDigest(
  item: IndexerQuestionTargetInventoryItem,
): string {
  return indexerProtocolDigest(item);
}

export function indexerQuestionTargetInventoryDigest(
  value: Omit<IndexerQuestionTargetInventory, "inventory_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerQuestionTargetInventory(input: {
  requirement_set_digest: string;
  profile_contract_digests: readonly string[];
  source_inventory_digests: readonly string[];
  items: readonly Omit<
    IndexerQuestionTargetInventoryItem,
    "target_ref" | "node_ref"
  >[];
}): IndexerQuestionTargetInventory {
  const items = input.items.map((item) => ({
    ...item,
    target_ref: indexerQuestionSubjectTargetRef(item),
    node_ref: canonicalIndexerNodeRef(item.subject_key),
  })).sort((left, right) =>
    compareIndexerCanonicalText(left.target_ref, right.target_ref)
  );
  if (new Set(items.map((item) => item.target_ref)).size !== items.length) {
    throw new TypeError("QuestionTargetInventory target identities must be unique");
  }
  const payload: Omit<IndexerQuestionTargetInventory, "inventory_digest"> = {
    protocol: "context.indexer.question-target-inventory/v1",
    requirement_set_digest: input.requirement_set_digest,
    profile_contract_digests: [...new Set(input.profile_contract_digests)].sort(),
    source_inventory_digests: [...new Set(input.source_inventory_digests)].sort(),
    items,
  };
  return indexerQuestionTargetInventorySchema.parse({
    ...payload,
    inventory_digest: indexerQuestionTargetInventoryDigest(payload),
  });
}

export function validateIndexerQuestionTargetInventory(
  value: unknown,
): IndexerQuestionTargetInventory {
  const inventory = indexerQuestionTargetInventorySchema.parse(value);
  const payload = Object.fromEntries(
    Object.entries(inventory).filter(([key]) => key !== "inventory_digest"),
  ) as Omit<IndexerQuestionTargetInventory, "inventory_digest">;
  if (indexerQuestionTargetInventoryDigest(payload) !== inventory.inventory_digest) {
    throw new TypeError("QuestionTargetInventory digest is invalid");
  }
  const rebuilt = buildIndexerQuestionTargetInventory({
    requirement_set_digest: inventory.requirement_set_digest,
    profile_contract_digests: inventory.profile_contract_digests,
    source_inventory_digests: inventory.source_inventory_digests,
    items: inventory.items.map((item) => Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== "target_ref" && key !== "node_ref"),
    ) as Omit<IndexerQuestionTargetInventoryItem, "target_ref" | "node_ref">),
  });
  if (rebuilt.inventory_digest !== inventory.inventory_digest) {
    throw new TypeError("QuestionTargetInventory is not canonical or contains forged target refs");
  }
  return inventory;
}

export function indexerMaterialQuestionKey(input: {
  owner_cell_ref: string;
  question_contract_digest: string;
  question_subject_target_ref: string;
}): string {
  return `question-key:${indexerProtocolDigest({
    owner_cell_ref: input.owner_cell_ref,
    question_contract_digest: input.question_contract_digest,
    question_subject_target_ref: input.question_subject_target_ref,
  })}`;
}

export function indexerQuestionTargetSetDigest(questionKeys: readonly string[]): string {
  return indexerProtocolDigest({ question_keys: [...new Set(questionKeys)].sort() });
}

export function indexerQuestionSetDigest(
  questions: readonly IndexerResolvedMaterialQuestion[],
): string {
  return indexerProtocolDigest({
    questions: [...questions].sort((left, right) =>
      compareIndexerCanonicalText(left.ref, right.ref)
    ),
  });
}

export function indexerQuestionRevisionDigest(input: {
  question_contract_digest: string;
  question_key: string;
  owner_cell_digest: string;
  question_target_item_digest: string;
  answer_landing_dependency_digest?: string;
}): string {
  return indexerProtocolDigest(input);
}
