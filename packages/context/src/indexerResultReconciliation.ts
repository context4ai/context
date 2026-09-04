import { z } from "zod";
import {
  indexerArtifactResultDigest,
  indexerArtifactResultSchema,
  type IndexerArtifactResult,
} from "./indexerArtifactResult.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  indexerMaterialGapLedgerSchema,
  type IndexerUnresolvedMaterialGap,
} from "./indexerMaterialGapLedger.js";
import {
  indexerMaterialQuestionKey,
  indexerQuestionRevisionDigest,
  indexerQuestionTargetItemDigest,
  validateIndexerResolvedMaterialQuestion,
  type IndexerQuestionTargetInventory,
  type IndexerQuestionTargetInventoryItem,
  type IndexerResolvedMaterialQuestion,
} from "./indexerQuestionAuthority.js";
import {
  INDEXER_EVIDENCE_KINDS,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  canonicalOwnerCellRef,
  type IndexRequirement,
  type IndexerRegistry,
  type IndexerRegistryEntry,
  type IndexerScopeTarget,
} from "./indexerRegistry.js";
import { evaluateIndexerRestrictedSelector } from "./indexerRestrictedSelector.js";

const registeredMaterialSourceSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  source_input_digest: indexerDigestSchema,
  evidence_kinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)).min(1),
}).strict();

export const capabilityGapSchema = z.object({
  gap_ref: indexerCanonicalRefSchema,
  owner_cell_ref: indexerCanonicalRefSchema,
  requirement_ref: indexerCanonicalRefSchema,
  coverage_domain: indexerIdSchema,
  reason_code: z.enum([
    "missing-primary-owner",
    "ambiguous-primary-owner",
    "missing-author-result",
    "required-question-authority-unavailable",
    "required-question-target-empty",
    "target-resolution-unsupported",
    "target-resolution-material-required",
    "inventory-member-unsupported",
    "inventory-material-gap-missing",
  ]),
  indexer_ids: z.array(indexerIdSchema),
}).strict();

export const materialGapDetailSchema = z.object({
  question_key: indexerCanonicalRefSchema,
  owner_cell_ref: indexerCanonicalRefSchema,
  requirement_ref: indexerCanonicalRefSchema,
  coverage_domain: indexerIdSchema,
  severity: z.enum(["blocking", "recommended"]),
  reason_code: z.enum([
    "provider-requested-material",
    "provider-omitted-required-question",
    "main-evidence-contract-not-met",
  ]),
  registered_material_source_refs: z.array(indexerCanonicalRefSchema),
  suggested_source_refs: z.array(indexerCanonicalRefSchema),
  entry: indexerMaterialGapLedgerSchema.shape.entries.element,
}).strict();

export const coverageDomainCompletionSchema = z.object({
  requirement_ref: indexerCanonicalRefSchema,
  coverage_domain: indexerIdSchema,
  obligation: z.enum(["required", "optional", "out-of-scope"]),
  state: z.enum(["completed", "partial", "capability-gap", "out-of-scope"]),
  owner_cell_count: z.number().int().nonnegative(),
  completed_owner_cell_count: z.number().int().nonnegative(),
  answered_question_count: z.number().int().nonnegative(),
  material_gap_count: z.number().int().nonnegative(),
  capability_gap_count: z.number().int().nonnegative(),
  domain_digest: indexerDigestSchema,
}).strict();

export const coverageCompletionReportPayloadSchema = z.object({
  protocol: z.literal("context.indexer.coverage-completion-report/v1"),
  requirement_set_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
  registered_material_source_set_digest: indexerDigestSchema,
  domains: z.array(coverageDomainCompletionSchema),
  capability_gaps: z.array(capabilityGapSchema),
  material_gaps: z.array(materialGapDetailSchema),
  blocking_count: z.number().int().nonnegative(),
  partial_domain_count: z.number().int().nonnegative(),
  outcome: z.enum([
    "complete",
    "index-material-required",
    "indexer-capability-gap",
  ]),
  graph_outcome: z.enum(["completed", "partial", "blocked"]),
  can_report_complete: z.boolean(),
}).strict();

export const indexerCoverageCompletionReportSchema =
  coverageCompletionReportPayloadSchema.extend({
    report_digest: indexerDigestSchema,
  }).strict();

export type IndexerCoverageCompletionReport = z.infer<
  typeof indexerCoverageCompletionReportSchema
>;
export type IndexerRegisteredMaterialSource = z.infer<
  typeof registeredMaterialSourceSchema
>;

export interface OwnerCell {
  owner_cell_ref: string;
  requirement_ref: string;
  requirement_id: string;
  coverage_domain: string;
  obligation: "required" | "optional" | "out-of-scope";
  source_ref: string;
  module_ref: string | null;
  owner_indexer_ids: string[];
}

export interface ResolvedQuestionEntry {
  requirement_ref: string;
  question: IndexerResolvedMaterialQuestion;
}

export interface QuestionPair {
  question_key: string;
  question: IndexerResolvedMaterialQuestion;
  target: IndexerQuestionTargetInventoryItem;
  owner: OwnerCell;
}

export function requirementRef(requirementId: string): string {
  return `requirement:${requirementId}`;
}

function bindingTargets(
  requirement: IndexRequirement,
  binding: IndexerRegistryEntry["requirement_bindings"][number],
): readonly IndexerScopeTarget[] {
  return "ref" in binding.owned_scope
    ? requirement.target_scope.targets
    : binding.owned_scope.targets;
}

function ownerIndexers(registry: IndexerRegistry): Map<string, string[]> {
  const requirements = new Map(
    registry.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const owners = new Map<string, string[]>();
  for (const indexer of registry.indexers) {
    for (const binding of indexer.requirement_bindings) {
      if (binding.role !== "primary") continue;
      const requirement = requirements.get(binding.requirement_ref);
      if (requirement === undefined) continue;
      for (const domain of binding.coverage_domains) {
        for (const target of bindingTargets(requirement, binding)) {
          const modules = target.module_refs.length === 0 ? [null] : target.module_refs;
          for (const moduleRef of modules) {
            const ownerCellRef = canonicalOwnerCellRef({
              requirementRef: requirement.id,
              coverageDomain: domain,
              sourceRef: target.source_ref,
              moduleRef,
            });
            owners.set(ownerCellRef, [...(owners.get(ownerCellRef) ?? []), indexer.id]);
          }
        }
      }
    }
  }
  return owners;
}

export function ownerCells(registry: IndexerRegistry): OwnerCell[] {
  const owners = ownerIndexers(registry);
  return registry.requirements.flatMap((requirement) =>
    Object.entries(requirement.coverage_domains).flatMap(([domain, obligation]) =>
      requirement.target_scope.targets.flatMap((target) => {
        const modules = target.module_refs.length === 0 ? [null] : target.module_refs;
        return modules.map((moduleRef) => {
          const ownerCellRef = canonicalOwnerCellRef({
            requirementRef: requirement.id,
            coverageDomain: domain,
            sourceRef: target.source_ref,
            moduleRef,
          });
          return {
            owner_cell_ref: ownerCellRef,
            requirement_ref: requirementRef(requirement.id),
            requirement_id: requirement.id,
            coverage_domain: domain,
            obligation,
            source_ref: target.source_ref,
            module_ref: moduleRef,
            owner_indexer_ids: [...new Set(owners.get(ownerCellRef) ?? [])]
              .sort(compareIndexerCanonicalText),
          };
        });
      })
    )
  ).sort((left, right) =>
    compareIndexerCanonicalText(left.owner_cell_ref, right.owner_cell_ref)
  );
}

export function canonicalSources(values: readonly unknown[]): IndexerRegisteredMaterialSource[] {
  const sources = values.map((value) => registeredMaterialSourceSchema.parse(value))
    .map((source) => ({
      ...source,
      evidence_kinds: [...new Set(source.evidence_kinds)].sort(compareIndexerCanonicalText),
    }))
    .sort((left, right) => compareIndexerCanonicalText(left.source_ref, right.source_ref));
  if (new Set(sources.map((source) => source.source_ref)).size !== sources.length) {
    throw new TypeError("registered material sources must be unique by source_ref");
  }
  return sources;
}

export function validateArtifactResults(values: readonly unknown[]): IndexerArtifactResult[] {
  const results = values.map((value) => indexerArtifactResultSchema.parse(value));
  for (const result of results) {
    const payload = Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== "output_digest"),
    ) as Omit<IndexerArtifactResult, "output_digest">;
    if (indexerArtifactResultDigest(payload) !== result.output_digest) {
      throw new TypeError("reconciliation received an ArtifactResult with an invalid digest");
    }
  }
  if (new Set(results.map((result) => result.author_workset_digest)).size !== results.length) {
    throw new TypeError("reconciliation ArtifactResults must have unique author worksets");
  }
  return results;
}

export function resolvedQuestions(input: {
  registry: IndexerRegistry;
  values: readonly ResolvedQuestionEntry[];
  allowed_selector_fact_paths: ReadonlySet<string>;
}): ResolvedQuestionEntry[] {
  const requirements = new Map(input.registry.requirements.map((item) => [
    requirementRef(item.id),
    item,
  ]));
  const entries = input.values.map((entry) => {
    const requirement = requirements.get(entry.requirement_ref);
    const binding = requirement?.questions?.find((item) => item.ref === entry.question.ref);
    if (requirement === undefined || binding === undefined) {
      throw new TypeError("resolved question is outside the current requirement authority");
    }
    return {
      requirement_ref: entry.requirement_ref,
      question: validateIndexerResolvedMaterialQuestion({
        binding,
        resolved_question: entry.question,
        allowed_selector_fact_paths: input.allowed_selector_fact_paths,
        coverage_domain_state:
          requirement.coverage_domains[entry.question.coverage_domain] ?? "out-of-scope",
      }),
    };
  }).sort((left, right) => compareIndexerCanonicalText(
    `${left.requirement_ref}\u0000${left.question.ref}`,
    `${right.requirement_ref}\u0000${right.question.ref}`,
  ));
  if (new Set(entries.map((entry) =>
    `${entry.requirement_ref}\u0000${entry.question.ref}`
  )).size !== entries.length) {
    throw new TypeError("resolved questions must be unique per requirement");
  }
  return entries;
}

export function questionPairs(input: {
  inventory: IndexerQuestionTargetInventory;
  questions: readonly ResolvedQuestionEntry[];
  owners: readonly OwnerCell[];
  target_facts: Readonly<Record<string, Record<string, unknown>>>;
  allowed_selector_fact_paths: ReadonlySet<string>;
}): { pairs: QuestionPair[]; empty_required: ResolvedQuestionEntry[] } {
  const ownerByRef = new Map(input.owners.map((owner) => [owner.owner_cell_ref, owner]));
  const pairs: QuestionPair[] = [];
  const emptyRequired: ResolvedQuestionEntry[] = [];
  for (const entry of input.questions) {
    const selected = input.inventory.items.filter((target) => {
      const owner = ownerByRef.get(target.owner_cell_ref);
      return owner !== undefined &&
        owner.requirement_ref === entry.requirement_ref &&
        owner.coverage_domain === entry.question.coverage_domain &&
        target.requirement_ref === entry.requirement_ref &&
        target.target_domain_ref === entry.question.target_domain_ref &&
        evaluateIndexerRestrictedSelector({
          selector: entry.question.target_selector,
          facts: input.target_facts[target.target_ref] ?? {},
          allowed_fact_paths: input.allowed_selector_fact_paths,
        });
    });
    if (selected.length === 0) {
      const owner = input.owners.find((candidate) =>
        candidate.requirement_ref === entry.requirement_ref &&
        candidate.coverage_domain === entry.question.coverage_domain
      );
      if (owner?.obligation === "required") emptyRequired.push(entry);
    }
    for (const target of selected) {
      const owner = ownerByRef.get(target.owner_cell_ref)!;
      pairs.push({
        question_key: indexerMaterialQuestionKey({
          owner_cell_ref: target.owner_cell_ref,
          question_contract_digest: entry.question.contract_digest,
          question_subject_target_ref: target.target_ref,
        }),
        question: entry.question,
        target,
        owner,
      });
    }
  }
  pairs.sort((left, right) =>
    compareIndexerCanonicalText(left.question_key, right.question_key)
  );
  if (new Set(pairs.map((pair) => pair.question_key)).size !== pairs.length) {
    throw new TypeError("question-target pair identities must be unique");
  }
  return { pairs, empty_required: emptyRequired };
}

function gapRef(input: {
  owner_cell_ref: string;
  reason_code: string;
  indexer_ids: readonly string[];
}): string {
  return `coverage-gap:${indexerProtocolDigest(input)}`;
}

export function capabilityGap(
  owner: OwnerCell,
  reasonCode: z.infer<typeof capabilityGapSchema>["reason_code"],
  indexerIds: readonly string[],
): z.infer<typeof capabilityGapSchema> {
  const indexer_ids = [...new Set(indexerIds)].sort(compareIndexerCanonicalText);
  return capabilityGapSchema.parse({
    gap_ref: gapRef({
      owner_cell_ref: owner.owner_cell_ref,
      reason_code: reasonCode,
      indexer_ids,
    }),
    owner_cell_ref: owner.owner_cell_ref,
    requirement_ref: owner.requirement_ref,
    coverage_domain: owner.coverage_domain,
    reason_code: reasonCode,
    indexer_ids,
  });
}

export function relevantResults(owner: OwnerCell, results: readonly IndexerArtifactResult[]) {
  return results.filter((result) =>
    result.requirement_ref === owner.requirement_ref &&
    result.source_ref === owner.source_ref &&
    result.module_ref === owner.module_ref &&
    owner.owner_indexer_ids.includes(result.indexer_id)
  );
}

export function dispositionMap(input: {
  pairs: readonly QuestionPair[];
  results: readonly IndexerArtifactResult[];
}): Map<string, { result: IndexerArtifactResult; disposition: IndexerArtifactResult["question_target_dispositions"][number] }> {
  const known = new Set(input.pairs.map((pair) => pair.question_key));
  const result = new Map<string, {
    result: IndexerArtifactResult;
    disposition: IndexerArtifactResult["question_target_dispositions"][number];
  }>();
  for (const artifactResult of input.results) {
    for (const disposition of artifactResult.question_target_dispositions) {
      if (!known.has(disposition.question_target_key)) {
        throw new TypeError("ArtifactResult disposition is outside the CLI question-target set");
      }
      if (result.has(disposition.question_target_key)) {
        throw new TypeError("question-target pair has more than one primary disposition");
      }
      result.set(disposition.question_target_key, {
        result: artifactResult,
        disposition,
      });
    }
  }
  return result;
}

function requirementForOwner(registry: IndexerRegistry, owner: OwnerCell): IndexRequirement {
  const requirement = registry.requirements.find((item) => item.id === owner.requirement_id);
  if (requirement === undefined) throw new TypeError("owner references an unknown requirement");
  return requirement;
}

function materialSources(input: {
  registry: IndexerRegistry;
  owner: OwnerCell;
  sources: readonly IndexerRegisteredMaterialSource[];
}): IndexerRegisteredMaterialSource[] {
  const requirement = requirementForOwner(input.registry, input.owner);
  const authorized = new Set(requirement.evidence_source_scope.targets.map((item) =>
    item.source_ref
  ));
  return input.sources.filter((source) => authorized.has(source.source_ref));
}

export function mainEvidenceMeetsContract(input: {
  pair: QuestionPair;
  result: IndexerArtifactResult;
  evidence_binding_digest: string;
  evidence_facts: Readonly<Record<string, unknown>>;
  allowed_selector_fact_paths: ReadonlySet<string>;
}): boolean {
  const binding = input.result.evidence_bindings.find((item) =>
    item.binding_digest === input.evidence_binding_digest
  );
  const contract = input.pair.question.evidence_contract;
  return binding !== undefined &&
    contract.accepted_kinds.includes(binding.kind) &&
    contract.minimum_items <= 1 &&
    contract.minimum_distinct_sources <= 1 &&
    (contract.provenance_constraints === undefined ||
      evaluateIndexerRestrictedSelector({
        selector: contract.provenance_constraints,
        facts: input.evidence_facts,
        allowed_fact_paths: input.allowed_selector_fact_paths,
      }));
}

export function materialGap(input: {
  registry: IndexerRegistry;
  pair: QuestionPair;
  sources: readonly IndexerRegisteredMaterialSource[];
  disposition?: ReturnType<typeof dispositionMap> extends Map<string, infer V> ? V : never;
  reason_code: z.infer<typeof materialGapDetailSchema>["reason_code"];
}): z.infer<typeof materialGapDetailSchema> {
  const materialDisposition = input.disposition?.disposition.state === "material-gap"
    ? input.disposition.disposition
    : undefined;
  const proposal = materialDisposition === undefined
    ? undefined
    : input.disposition!.result.material_question_proposals.find((item) =>
        item.proposal_ref === materialDisposition.material_question_proposal_ref
      );
  const registered = materialSources({
    registry: input.registry,
    owner: input.pair.owner,
    sources: input.sources,
  });
  const ownerCellDigest = indexerProtocolDigest({
    owner_cell_ref: input.pair.owner.owner_cell_ref,
    owner_indexer_ids: input.pair.owner.owner_indexer_ids,
  });
  const questionTargetItemDigest = indexerQuestionTargetItemDigest(input.pair.target);
  const questionRevision = indexerQuestionRevisionDigest({
    question_contract_digest: input.pair.question.contract_digest,
    question_key: input.pair.question_key,
    owner_cell_digest: ownerCellDigest,
    question_target_item_digest: questionTargetItemDigest,
  });
  const sourceInputSetDigest = indexerProtocolDigest({
    source_input_digests: registered.map((source) => source.source_input_digest)
      .sort(compareIndexerCanonicalText),
  });
  const emittedQuestionDigest = proposal === undefined
    ? indexerProtocolDigest({
        protocol: "context.indexer.automatic-material-question/v1",
        question_key: input.pair.question_key,
        reason_code: input.reason_code,
      })
    : indexerProtocolDigest(proposal);
  const candidate: IndexerUnresolvedMaterialGap = {
    owner_cell_ref: input.pair.owner.owner_cell_ref,
    question_ref: input.pair.question.ref,
    question_contract_digest: input.pair.question.contract_digest,
    question_subject_target_ref: input.pair.target.target_ref,
    question_target_item_digest: questionTargetItemDigest,
    question_revision_digest: questionRevision,
    state: "unresolved",
    dependencies: {
      requirement_digest: indexerProtocolDigest(
        requirementForOwner(input.registry, input.pair.owner),
      ),
      owner_cell_digest: ownerCellDigest,
      emitted_question_digest: emittedQuestionDigest,
      source_input_set_digest: sourceInputSetDigest,
    },
  };
  return materialGapDetailSchema.parse({
    question_key: input.pair.question_key,
    owner_cell_ref: input.pair.owner.owner_cell_ref,
    requirement_ref: input.pair.owner.requirement_ref,
    coverage_domain: input.pair.owner.coverage_domain,
    severity: input.pair.owner.obligation === "required" ? "blocking" : "recommended",
    reason_code: input.reason_code,
    registered_material_source_refs: registered.map((source) => source.source_ref),
    suggested_source_refs: [...new Set(proposal?.source_hints ?? [])]
      .sort(compareIndexerCanonicalText),
    entry: candidate,
  });
}

export {
  reconcileIndexerResults,
  validateIndexerCoverageCompletionReport,
} from "./indexerResultReconciliationRun.js";
