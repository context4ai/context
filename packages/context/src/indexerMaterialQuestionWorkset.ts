import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  INDEXER_EVIDENCE_KINDS,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  evaluateIndexerRestrictedSelector,
} from "./indexerRestrictedSelector.js";
import {
  indexerMaterialQuestionKey,
  indexerQuestionRevisionDigest,
  indexerQuestionEvidenceContractSchema,
  indexerQuestionSetDigest,
  indexerQuestionTargetItemDigest,
  indexerQuestionTargetSetDigest,
  indexerResolvedMaterialQuestionSchema,
  validateIndexerQuestionTargetInventory,
  type IndexerQuestionTargetInventory,
  type IndexerResolvedMaterialQuestion,
} from "./indexerQuestionAuthority.js";

const materialQuestionSchema = z.object({
  owner_cell_ref: indexerCanonicalRefSchema,
  question_ref: indexerCanonicalRefSchema,
  question_contract_digest: indexerDigestSchema,
  question_subject_target_ref: indexerCanonicalRefSchema,
  question_target_item_digest: indexerDigestSchema,
  answer_landing_ref: indexerCanonicalRefSchema.optional(),
  evidence_contract: indexerQuestionEvidenceContractSchema,
  source_refs: z.array(indexerCanonicalRefSchema).optional(),
}).strict();

const worksetItemSchema = z.object({
  question_key: indexerCanonicalRefSchema,
  question_contract_digest: indexerDigestSchema,
  question_revision_digest: indexerDigestSchema,
  question: materialQuestionSchema,
  eligible_answer_indexer_ids: z.array(indexerIdSchema),
  authorized_source_refs: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerMaterialQuestionWorksetSchema = z.object({
  protocol: z.literal("context.indexer.material-question-workset/v1"),
  workset_digest: indexerDigestSchema,
  question_set_digest: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
  question_target_set_digest: indexerDigestSchema,
  predecessor_ledger_revision: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  source_input_digests: z.array(indexerDigestSchema),
  items: z.array(worksetItemSchema),
}).strict();

export type IndexerMaterialQuestion = z.infer<typeof materialQuestionSchema>;
export type IndexerMaterialQuestionWorksetItem = z.infer<typeof worksetItemSchema>;
export type IndexerMaterialQuestionWorkset = z.infer<
  typeof indexerMaterialQuestionWorksetSchema
>;

export function indexerMaterialQuestionWorksetDigest(
  value: Omit<IndexerMaterialQuestionWorkset, "workset_digest">,
): string {
  return indexerProtocolDigest(value);
}

interface OwnerCellAuthority {
  owner_cell_ref: string;
  owner_cell_digest: string;
  requirement_ref: string;
  coverage_domain: string;
  domain_state: "required" | "optional" | "out-of-scope";
}

interface AnswerIndexerCandidate {
  indexer_id: string;
  operations: readonly string[];
  requirement_binding_role: "primary" | "enricher";
  provider_operation_supported: boolean;
  supported_evidence_kinds: readonly typeof INDEXER_EVIDENCE_KINDS[number][];
}

interface QuestionRoute {
  requirement_ref: string;
  question_ref: string;
  target_ref: string;
  answer_landing_ref?: string;
  answer_landing_dependency_digest?: string;
  authorized_source_refs: readonly string[];
  candidates: readonly AnswerIndexerCandidate[];
}

function sortedUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicates`);
  }
  return sorted;
}

function eligibleIndexerIds(
  route: QuestionRoute,
  question: IndexerResolvedMaterialQuestion,
): string[] {
  const acceptedKinds = new Set(question.evidence_contract.accepted_kinds);
  return route.candidates.filter((candidate) =>
    candidate.operations.includes("material-answer") &&
    candidate.requirement_binding_role === "enricher" &&
    candidate.provider_operation_supported &&
    candidate.supported_evidence_kinds.some((kind) => acceptedKinds.has(kind))
  ).map((candidate) => candidate.indexer_id).sort();
}

export function buildIndexerMaterialQuestionWorkset(input: {
  question_target_inventory: IndexerQuestionTargetInventory;
  resolved_questions: readonly {
    requirement_ref: string;
    question: IndexerResolvedMaterialQuestion;
  }[];
  owner_cells: readonly OwnerCellAuthority[];
  target_facts: Readonly<Record<string, Record<string, unknown>>>;
  allowed_selector_fact_paths: ReadonlySet<string>;
  routes: readonly QuestionRoute[];
  predecessor_ledger_revision: string;
  registry_digest: string;
  requirement_set_digest: string;
  source_input_digests: readonly string[];
}): IndexerMaterialQuestionWorkset {
  const inventory = validateIndexerQuestionTargetInventory(
    input.question_target_inventory,
  );
  if (inventory.requirement_set_digest !== input.requirement_set_digest) {
    throw new TypeError("question target inventory belongs to another requirement set");
  }
  const questionEntries = input.resolved_questions.map((entry) => ({
    requirement_ref: indexerCanonicalRefSchema.parse(entry.requirement_ref),
    question: indexerResolvedMaterialQuestionSchema.parse(entry.question),
  }));
  const questionRefs = questionEntries.map((entry) =>
    `${entry.requirement_ref}\u0000${entry.question.ref}`
  );
  if (new Set(questionRefs).size !== questionRefs.length) {
    throw new TypeError("resolved material questions must be unique per requirement");
  }
  const questions = [...new Map(
    questionEntries.map((entry) => [entry.question.contract_digest, entry.question]),
  ).values()];
  const owners = new Map(input.owner_cells.map((owner) => [owner.owner_cell_ref, owner]));
  if (owners.size !== input.owner_cells.length) {
    throw new TypeError("owner cell authorities must be unique");
  }
  const routeMap = new Map(
    input.routes.map((route) => [
      `${route.requirement_ref}\u0000${route.question_ref}\u0000${route.target_ref}`,
      route,
    ]),
  );
  if (routeMap.size !== input.routes.length) {
    throw new TypeError(
      "material question routes must be unique by requirement, question, and target",
    );
  }
  const items: IndexerMaterialQuestionWorksetItem[] = [];
  for (const questionEntry of questionEntries) {
    const question = questionEntry.question;
    let matchedTargets = 0;
    for (const target of inventory.items) {
      const owner = owners.get(target.owner_cell_ref);
      if (
        owner !== undefined &&
        target.requirement_ref === questionEntry.requirement_ref &&
        target.requirement_ref === owner.requirement_ref &&
        target.target_domain_ref === question.target_domain_ref &&
        owner.coverage_domain === question.coverage_domain &&
        owner.domain_state !== "out-of-scope" &&
        evaluateIndexerRestrictedSelector({
          selector: question.target_selector,
          facts: input.target_facts[target.target_ref] ?? {},
          allowed_fact_paths: input.allowed_selector_fact_paths,
        })
      ) {
        const route = routeMap.get(
          `${questionEntry.requirement_ref}\u0000${question.ref}\u0000${target.target_ref}`,
        );
        const eligible = route === undefined ? [] : eligibleIndexerIds(route, question);
        sortedUnique(eligible, "eligible_answer_indexer_ids");
        const authorizedSources = sortedUnique(
          route?.authorized_source_refs ?? [],
          "authorized_source_refs",
        );
        const questionKey = indexerMaterialQuestionKey({
          owner_cell_ref: target.owner_cell_ref,
          question_contract_digest: question.contract_digest,
          question_subject_target_ref: target.target_ref,
        });
        const answerLandingRef = route?.answer_landing_ref ?? target.node_ref;
        const landingDependencyDigest = route?.answer_landing_dependency_digest ??
          indexerProtocolDigest({ answer_landing_ref: answerLandingRef });
        const targetItemDigest = indexerQuestionTargetItemDigest(target);
        const questionRevision = indexerQuestionRevisionDigest({
          question_contract_digest: question.contract_digest,
          question_key: questionKey,
          owner_cell_digest: owner.owner_cell_digest,
          question_target_item_digest: targetItemDigest,
          answer_landing_dependency_digest: landingDependencyDigest,
        });
        items.push(worksetItemSchema.parse({
          question_key: questionKey,
          question_contract_digest: question.contract_digest,
          question_revision_digest: questionRevision,
          question: {
            owner_cell_ref: target.owner_cell_ref,
            question_ref: question.ref,
            question_contract_digest: question.contract_digest,
            question_subject_target_ref: target.target_ref,
            question_target_item_digest: targetItemDigest,
            answer_landing_ref: answerLandingRef,
            evidence_contract: question.evidence_contract,
            source_refs: authorizedSources,
          },
          eligible_answer_indexer_ids: eligible,
          authorized_source_refs: authorizedSources,
        }));
        matchedTargets += 1;
      }
    }
    const requiredOwnerExists = input.owner_cells.some((owner) =>
      owner.requirement_ref === questionEntry.requirement_ref &&
      owner.coverage_domain === question.coverage_domain &&
      owner.domain_state === "required"
    );
    if (requiredOwnerExists && matchedTargets === 0) {
      throw new TypeError(
        `required material question ${question.ref} matched zero target inventory items`,
      );
    }
  }
  items.sort((left, right) =>
    compareIndexerCanonicalText(left.question_key, right.question_key)
  );
  if (new Set(items.map((item) => item.question_key)).size !== items.length) {
    throw new TypeError("material question pair identities must be unique");
  }
  const payload: Omit<IndexerMaterialQuestionWorkset, "workset_digest"> = {
    protocol: "context.indexer.material-question-workset/v1",
    question_set_digest: indexerQuestionSetDigest(questions),
    question_target_inventory_digest: inventory.inventory_digest,
    question_target_set_digest: indexerQuestionTargetSetDigest(
      items.map((item) => item.question_key),
    ),
    predecessor_ledger_revision: input.predecessor_ledger_revision,
    registry_digest: input.registry_digest,
    requirement_set_digest: input.requirement_set_digest,
    source_input_digests: sortedUnique(
      input.source_input_digests,
      "source_input_digests",
    ),
    items,
  };
  return indexerMaterialQuestionWorksetSchema.parse({
    ...payload,
    workset_digest: indexerMaterialQuestionWorksetDigest(payload),
  });
}

export function validateIndexerMaterialQuestionWorkset(
  value: unknown,
): IndexerMaterialQuestionWorkset {
  const workset = indexerMaterialQuestionWorksetSchema.parse(value);
  const payload = Object.fromEntries(
    Object.entries(workset).filter(([key]) => key !== "workset_digest"),
  ) as Omit<IndexerMaterialQuestionWorkset, "workset_digest">;
  if (indexerMaterialQuestionWorksetDigest(payload) !== workset.workset_digest) {
    throw new TypeError("MaterialQuestionWorkset digest is invalid");
  }
  const questionKeys = workset.items.map((item) => item.question_key);
  sortedUnique(questionKeys, "items.question_key");
  if (canonicalIndexerJson(questionKeys) !== canonicalIndexerJson([...questionKeys].sort())) {
    throw new TypeError("MaterialQuestionWorkset items must use canonical ordering");
  }
  for (const item of workset.items) {
    sortedUnique(item.eligible_answer_indexer_ids, "eligible_answer_indexer_ids");
    sortedUnique(item.authorized_source_refs, "authorized_source_refs");
    if (item.question.question_contract_digest !== item.question_contract_digest) {
      throw new TypeError("workset item question contract binding is inconsistent");
    }
  }
  if (
    indexerQuestionTargetSetDigest(questionKeys) !== workset.question_target_set_digest
  ) {
    throw new TypeError("MaterialQuestionWorkset target set digest is invalid");
  }
  return workset;
}
