import { z } from "zod";
import {
  indexerPartitionPlanCanonicalHash,
  indexerPartitionPlanSchema,
  validateIndexerPartitionPlan,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
} from "./indexerPartitionPlan.js";
import {
  validateIndexerPartitionConvergenceRecord,
  type IndexerPartitionConvergenceRecord,
} from "./indexerPartitionConvergence.js";
import {
  INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
} from "./indexerPartitionStrategyResolution.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  canonicalIndexerInventoryMembers,
  type IndexerInventoryMember,
} from "./indexerInventoryDisposition.js";
import type { IndexerMainPartitionWorkset } from "./indexerMainWorkset.js";
import { canonicalIndexerNodeRef } from "./indexerSubjectIdentity.js";

const catalogBlockSchema = z.object({
  renderer: z.literal("context.indexer.deterministic-catalog/v1"),
  logical_unit_ref: z.string().min(1),
  member_ids: z.array(z.string().min(1)).min(1),
  member_ids_digest: indexerDigestSchema,
}).strict();

const continuationPolicySchema = z.object({
  advisory_line_threshold: z.literal(1500),
  oversized_behavior: z.literal("advisory-only"),
  split_mode: z.literal("physical-continuation"),
  split_of: z.string().min(1),
  navigation_identity: z.string().min(1),
  review_identity: z.string().min(1),
}).strict();

export const indexerCatalogFallbackRecordSchema = z.object({
  protocol: z.literal("context.indexer.catalog-fallback/v1"),
  partition_workset_digest: indexerDigestSchema,
  strategy_set_digest: indexerDigestSchema,
  convergence_digest: indexerDigestSchema,
  partition_plan: indexerPartitionPlanSchema,
  catalog_block: catalogBlockSchema,
  continuation_policy: continuationPolicySchema,
  user_gate_required: z.literal(false),
  profile_revision_ledger_consumed: z.literal(false),
  fallback_digest: indexerDigestSchema,
}).strict();

export type IndexerCatalogFallbackRecord = z.infer<
  typeof indexerCatalogFallbackRecordSchema
>;

type FallbackPayload = Omit<IndexerCatalogFallbackRecord, "fallback_digest">;

function fallbackInventory(
  values: readonly IndexerInventoryMember[],
): IndexerInventoryMember[] {
  const members = canonicalIndexerInventoryMembers(values);
  if (members.length === 0) {
    throw new TypeError("catalog fallback requires at least one inventory member");
  }
  return members;
}

function fallbackStrategy(input: {
  convergence: IndexerPartitionConvergenceRecord;
  authorized_strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
}) {
  const attempt = input.convergence.next_strategy_attempt;
  const expected = input.authorized_strategies[attempt?.strategy_order ?? -1];
  if (
    input.convergence.decision !== "catalog-fallback-required" ||
    attempt === null ||
    attempt.strategy_ref.kind !== "cli-builtin" ||
    attempt.strategy_ref.strategy_id !== INDEXER_CATALOG_FALLBACK_STRATEGY_ID ||
    expected === undefined ||
    expected.strategy_digest !== attempt.strategy_digest ||
    canonicalIndexerJson(expected.strategy_ref) !== canonicalIndexerJson(attempt.strategy_ref)
  ) {
    throw new TypeError("catalog fallback is not the authorized convergence successor");
  }
  return attempt;
}

export function validateIndexerCatalogFallbackRecord(
  value: unknown,
): IndexerCatalogFallbackRecord {
  const record = indexerCatalogFallbackRecordSchema.parse(value);
  const payload = Object.fromEntries(Object.entries(record).filter(([key]) =>
    key !== "fallback_digest"
  )) as FallbackPayload;
  if (indexerProtocolDigest(payload) !== record.fallback_digest) {
    throw new TypeError("catalog fallback digest is invalid");
  }
  const planPayload = Object.fromEntries(Object.entries(record.partition_plan).filter(
    ([key]) => key !== "canonical_hash",
  )) as Omit<IndexerPartitionPlan, "canonical_hash">;
  const group = record.partition_plan.groups[0];
  const catalogMembers = [...record.catalog_block.member_ids].sort(
    compareIndexerCanonicalText,
  );
  const ownedMembers = record.partition_plan.member_dispositions.map((disposition) => {
    if (
      disposition.inventory_disposition !== "owned" ||
      disposition.group_key !== "catalog-root"
    ) {
      throw new TypeError("catalog fallback members must all belong to catalog-root");
    }
    return disposition.member_id;
  });
  if (
    record.partition_plan.status !== "complete" ||
    record.partition_plan.canonical_hash !== indexerPartitionPlanCanonicalHash(planPayload) ||
    record.partition_plan.partition_axis !== INDEXER_CATALOG_FALLBACK_STRATEGY_ID ||
    record.partition_plan.groups.length !== 1 ||
    group?.group_key !== "catalog-root" ||
    group.subject_intent !== "primary" ||
    group.question_target_bindings.some((binding) =>
      binding.role !== "primary-carrier"
    ) ||
    group.logical_unit_ref !== record.catalog_block.logical_unit_ref ||
    new Set(record.catalog_block.member_ids).size !==
      record.catalog_block.member_ids.length ||
    canonicalIndexerJson(record.catalog_block.member_ids) !==
      canonicalIndexerJson(catalogMembers) ||
    canonicalIndexerJson(group.member_ids) !==
      canonicalIndexerJson(record.catalog_block.member_ids) ||
    canonicalIndexerJson(ownedMembers.sort(compareIndexerCanonicalText)) !==
      canonicalIndexerJson(record.catalog_block.member_ids) ||
    record.catalog_block.member_ids_digest !== indexerProtocolDigest({
      member_ids: record.catalog_block.member_ids,
    }) ||
    record.continuation_policy.split_of !== record.catalog_block.logical_unit_ref ||
    record.continuation_policy.navigation_identity !== record.catalog_block.logical_unit_ref ||
    record.continuation_policy.review_identity !== record.catalog_block.logical_unit_ref
  ) {
    throw new TypeError("catalog fallback single-parent projection is inconsistent");
  }
  return record;
}

export function buildIndexerCatalogFallback(input: {
  workset: IndexerMainPartitionWorkset;
  convergence: unknown;
  canonical_inventory_members: readonly IndexerInventoryMember[];
  authorized_source_refs: readonly string[];
  authorized_strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
  required_question_target_refs?: readonly string[];
}): IndexerCatalogFallbackRecord {
  const convergence = validateIndexerPartitionConvergenceRecord(input.convergence);
  if (
    convergence.partition_workset_digest !== input.workset.workset_digest ||
    convergence.strategy_set_digest !== input.workset.strategy_set_digest
  ) {
    throw new TypeError("catalog fallback convergence is stale for the workset");
  }
  const strategy = fallbackStrategy({
    convergence,
    authorized_strategies: input.authorized_strategies,
  });
  const inventory = fallbackInventory(input.canonical_inventory_members);
  const memberIds = inventory.map((member) => member.member_id);
  const logicalUnitRef = canonicalIndexerNodeRef(input.workset.partition_subject_key);
  const targets = [...(
    input.required_question_target_refs ?? input.workset.allowed_question_target_refs
  )].sort(compareIndexerCanonicalText);
  if (new Set(targets).size !== targets.length) {
    throw new TypeError("catalog fallback question targets must be unique");
  }
  const planPayload: Omit<Extract<
    IndexerPartitionPlan,
    { status: "complete" }
  >, "canonical_hash"> = {
    protocol: "context.indexer.partition-plan/v1",
    status: "complete",
    binding: {
      partition_workset_digest: input.workset.workset_digest,
      indexer_id: input.workset.indexer_id,
      indexer_fingerprint: input.workset.primary_execution_fingerprint,
      requirement_digest: input.workset.requirement_set_digest,
      subject_key_schema_digest: input.workset.subject_key_schema_digest,
      source_scope_digest: input.workset.source_scope_digest,
      source_refs: [...input.authorized_source_refs].sort(compareIndexerCanonicalText),
      module_ref: input.workset.module_ref,
      partition_subject_key: input.workset.partition_subject_key,
      parent_scope_ref: input.workset.module_ref ?? input.workset.source_ref,
      inventory_digest: input.workset.partition_inventory_digest,
      question_target_inventory_digest: input.workset.question_target_inventory_digest,
    },
    strategy_ref: strategy.strategy_ref,
    strategy_digest: strategy.strategy_digest,
    unit_type: "catalog-root",
    partition_axis: INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
    reader_question_refs: [...input.workset.reader_question_refs],
    groups: [{
      group_key: "catalog-root",
      subject_key: input.workset.partition_subject_key,
      subject_intent: "primary",
      logical_unit_ref: logicalUnitRef,
      label: "Catalog",
      reader_question_refs: [...input.workset.reader_question_refs],
      question_target_bindings: targets.map((targetRef) => ({
        target_ref: targetRef,
        role: "primary-carrier" as const,
      })),
      member_ids: memberIds,
    }],
    member_dispositions: inventory.map((member) => ({
      member_id: member.member_id,
      member_kind: member.member_kind,
      inventory_disposition: "owned" as const,
      group_key: "catalog-root",
    })),
    failure: null,
  };
  const partitionPlan: IndexerPartitionPlan = {
    ...planPayload,
    canonical_hash: indexerPartitionPlanCanonicalHash(planPayload),
  };
  validateIndexerPartitionPlan({
    plan: partitionPlan,
    workset: input.workset,
    canonical_inventory_members: inventory,
    authorized_source_refs: input.authorized_source_refs,
    authorized_strategies: input.authorized_strategies,
    required_question_target_refs: targets,
  });
  const payload: FallbackPayload = {
    protocol: "context.indexer.catalog-fallback/v1",
    partition_workset_digest: input.workset.workset_digest,
    strategy_set_digest: input.workset.strategy_set_digest,
    convergence_digest: convergence.convergence_digest,
    partition_plan: partitionPlan,
    catalog_block: {
      renderer: "context.indexer.deterministic-catalog/v1",
      logical_unit_ref: logicalUnitRef,
      member_ids: memberIds,
      member_ids_digest: indexerProtocolDigest({ member_ids: memberIds }),
    },
    continuation_policy: {
      advisory_line_threshold: 1500,
      oversized_behavior: "advisory-only",
      split_mode: "physical-continuation",
      split_of: logicalUnitRef,
      navigation_identity: logicalUnitRef,
      review_identity: logicalUnitRef,
    },
    user_gate_required: false,
    profile_revision_ledger_consumed: false,
  };
  return validateIndexerCatalogFallbackRecord({
    ...payload,
    fallback_digest: indexerProtocolDigest(payload),
  });
}

const continuationInputSchema = z.object({
  boundary_ref: z.string().min(1).nullable(),
  member_ids: z.array(z.string().min(1)).min(1),
}).strict();

const continuationFragmentSchema = continuationInputSchema.extend({
  fragment_ref: z.string().min(1),
  member_ids_digest: indexerDigestSchema,
  split_of: z.string().min(1),
  reader_title: z.null(),
  navigation_entry: z.literal(false),
  review_entry: z.literal(false),
}).strict();

export const indexerCatalogContinuationPlanSchema = z.object({
  protocol: z.literal("context.indexer.catalog-continuation-plan/v1"),
  fallback_digest: indexerDigestSchema,
  logical_unit_ref: z.string().min(1),
  parent_member_ids_digest: indexerDigestSchema,
  estimated_line_count: z.number().int().nonnegative(),
  readability_advisory: z.boolean(),
  blocking: z.literal(false),
  user_gate_required: z.literal(false),
  profile_revision_ledger_consumed: z.literal(false),
  fragments: z.array(continuationFragmentSchema).min(2),
  continuation_digest: indexerDigestSchema,
}).strict();

export type IndexerCatalogContinuationPlan = z.infer<
  typeof indexerCatalogContinuationPlanSchema
>;

type ContinuationPayload = Omit<
  IndexerCatalogContinuationPlan,
  "continuation_digest"
>;

export function validateIndexerCatalogContinuationPlan(
  value: unknown,
): IndexerCatalogContinuationPlan {
  const plan = indexerCatalogContinuationPlanSchema.parse(value);
  const payload = Object.fromEntries(Object.entries(plan).filter(([key]) =>
    key !== "continuation_digest"
  )) as ContinuationPayload;
  if (indexerProtocolDigest(payload) !== plan.continuation_digest) {
    throw new TypeError("catalog continuation digest is invalid");
  }
  if (new Set(plan.fragments.map((fragment) => fragment.fragment_ref)).size !==
      plan.fragments.length) {
    throw new TypeError("catalog continuation fragment identities must be unique");
  }
  const projectedMembers = plan.fragments.flatMap((fragment) => fragment.member_ids)
    .sort(compareIndexerCanonicalText);
  const boundaryRefs = plan.fragments.flatMap((fragment) =>
    fragment.boundary_ref === null ? [] : [fragment.boundary_ref]
  );
  if (
    new Set(projectedMembers).size !== projectedMembers.length ||
    new Set(boundaryRefs).size !== boundaryRefs.length ||
    plan.parent_member_ids_digest !== indexerProtocolDigest({
      member_ids: projectedMembers,
    }) ||
    plan.readability_advisory !== (plan.estimated_line_count > 1500)
  ) {
    throw new TypeError("catalog continuation parent projection is inconsistent");
  }
  const canonicalFragmentRefs = plan.fragments.map((fragment) => fragment.fragment_ref)
    .sort(compareIndexerCanonicalText);
  if (plan.fragments.some((fragment, index) =>
    fragment.fragment_ref !== canonicalFragmentRefs[index]
  )) {
    throw new TypeError("catalog continuation fragments must use canonical ordering");
  }
  for (const fragment of plan.fragments) {
    const canonicalFragmentMembers = [...fragment.member_ids].sort(
      compareIndexerCanonicalText,
    );
    const expectedMemberIdsDigest = indexerProtocolDigest({
      member_ids: canonicalFragmentMembers,
    });
    const expectedFragmentRef = `artifact-fragment:${indexerProtocolDigest({
      protocol: "context.indexer.catalog-continuation-fragment/v1",
      logical_unit_ref: plan.logical_unit_ref,
      boundary_ref: fragment.boundary_ref,
      member_ids_digest: expectedMemberIdsDigest,
    })}`;
    if (
      fragment.split_of !== plan.logical_unit_ref ||
      canonicalIndexerJson(fragment.member_ids) !==
        canonicalIndexerJson(canonicalFragmentMembers) ||
      fragment.member_ids_digest !== expectedMemberIdsDigest ||
      fragment.fragment_ref !== expectedFragmentRef
    ) {
      throw new TypeError("catalog continuation fragment is not folded into its parent");
    }
  }
  return plan;
}

export function buildIndexerCatalogContinuationPlan(input: {
  fallback: unknown;
  estimated_line_count: number;
  fragments: readonly z.input<typeof continuationInputSchema>[];
}): IndexerCatalogContinuationPlan {
  const fallback = validateIndexerCatalogFallbackRecord(input.fallback);
  const fragments = input.fragments.map((fragment) =>
    continuationInputSchema.parse(fragment)
  );
  if (fragments.length < 2) {
    throw new TypeError("catalog continuation requires at least two physical fragments");
  }
  const projectedMembers = fragments.flatMap((fragment) => fragment.member_ids)
    .sort(compareIndexerCanonicalText);
  if (
    new Set(projectedMembers).size !== projectedMembers.length ||
    canonicalIndexerJson(projectedMembers) !==
      canonicalIndexerJson(fallback.catalog_block.member_ids)
  ) {
    throw new TypeError("catalog continuation must close the parent member inventory exactly once");
  }
  const boundaryRefs = fragments.flatMap((fragment) =>
    fragment.boundary_ref === null ? [] : [fragment.boundary_ref]
  );
  if (new Set(boundaryRefs).size !== boundaryRefs.length) {
    throw new TypeError("catalog continuation boundary refs must be unique");
  }
  const projected = fragments.map((fragment) => {
    const memberIds = [...fragment.member_ids].sort(compareIndexerCanonicalText);
    if (new Set(memberIds).size !== memberIds.length) {
      throw new TypeError("catalog continuation fragment members must be unique");
    }
    const memberIdsDigest = indexerProtocolDigest({ member_ids: memberIds });
    const fragmentIdentity = {
      protocol: "context.indexer.catalog-continuation-fragment/v1",
      logical_unit_ref: fallback.catalog_block.logical_unit_ref,
      boundary_ref: fragment.boundary_ref,
      member_ids_digest: memberIdsDigest,
    };
    return continuationFragmentSchema.parse({
      boundary_ref: fragment.boundary_ref,
      member_ids: memberIds,
      fragment_ref: `artifact-fragment:${indexerProtocolDigest(fragmentIdentity)}`,
      member_ids_digest: memberIdsDigest,
      split_of: fallback.catalog_block.logical_unit_ref,
      reader_title: null,
      navigation_entry: false,
      review_entry: false,
    });
  }).sort((left, right) => compareIndexerCanonicalText(
    left.fragment_ref,
    right.fragment_ref,
  ));
  const payload: ContinuationPayload = {
    protocol: "context.indexer.catalog-continuation-plan/v1",
    fallback_digest: fallback.fallback_digest,
    logical_unit_ref: fallback.catalog_block.logical_unit_ref,
    parent_member_ids_digest: fallback.catalog_block.member_ids_digest,
    estimated_line_count: input.estimated_line_count,
    readability_advisory:
      input.estimated_line_count > fallback.continuation_policy.advisory_line_threshold,
    blocking: false,
    user_gate_required: false,
    profile_revision_ledger_consumed: false,
    fragments: projected,
  };
  return validateIndexerCatalogContinuationPlan({
    ...payload,
    continuation_digest: indexerProtocolDigest(payload),
  });
}
