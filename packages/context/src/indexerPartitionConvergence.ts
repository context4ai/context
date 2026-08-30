import { z } from "zod";
import {
  indexerPartitionStrategySchema,
  indexerPartitionStrategySetDigest,
  validateIndexerPartitionPlan,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
} from "./indexerPartitionPlan.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerMainPartitionWorkset } from "./indexerMainWorkset.js";
import type { IndexerInventoryMember } from "./indexerInventoryDisposition.js";
import { INDEXER_CATALOG_FALLBACK_STRATEGY_ID } from "./indexerPartitionStrategyResolution.js";

export const indexerPartitionStrategyAttemptSchema = z.object({
  strategy_order: z.number().int().nonnegative(),
  strategy_ref: indexerPartitionStrategySchema,
  strategy_digest: indexerDigestSchema,
  previous_attempt_digest: indexerDigestSchema.nullable(),
}).strict();

export type IndexerPartitionStrategyAttempt = z.infer<
  typeof indexerPartitionStrategyAttemptSchema
>;

const relationshipSchema = z.object({
  group_count: z.number().int().nonnegative(),
  owned_member_count: z.number().int().nonnegative(),
  group_sizes: z.array(z.number().int().positive()),
  uniform_nonfinal_group_size: z.boolean(),
  lexical_windows: z.boolean(),
  ordinal_identity_sequence: z.boolean(),
}).strict();

const attemptRecordSchema = z.object({
  strategy_order: z.number().int().nonnegative(),
  strategy_ref: indexerPartitionStrategySchema,
  strategy_digest: indexerDigestSchema,
  previous_attempt_digest: indexerDigestSchema.nullable(),
  partition_plan_hash: indexerDigestSchema,
  plan_status: z.enum(["complete", "failed"]),
  classification: z.enum([
    "semantic",
    "fixed-count",
    "ordinal",
    "alphabetical",
    "retryable-strategy-failure",
    "blocking-input-damage",
  ]),
  reason_code: z.enum([
    "semantic-partition",
    "fixed-count-partition",
    "ordinal-partition",
    "alphabetical-partition",
    "partition-strategy-failed",
    "partition-input-damaged",
  ]),
  relationship: relationshipSchema,
  attempt_digest: indexerDigestSchema,
}).strict();

export type IndexerPartitionAttemptRecord = z.infer<typeof attemptRecordSchema>;

export const indexerPartitionConvergenceRecordSchema = z.object({
  protocol: z.literal("context.indexer.partition-convergence/v1"),
  partition_workset_digest: indexerDigestSchema,
  strategy_set_digest: indexerDigestSchema,
  attempts: z.array(attemptRecordSchema).min(1),
  decision: z.enum([
    "accepted",
    "retry-required",
    "catalog-fallback-required",
    "blocked-invalid-input",
  ]),
  accepted_plan_hash: indexerDigestSchema.nullable(),
  next_strategy_attempt: indexerPartitionStrategyAttemptSchema.nullable(),
  outcome: z.enum(["completed", "partial", "failed"]),
  user_gate_required: z.literal(false),
  profile_revision_ledger_consumed: z.literal(false),
  convergence_digest: indexerDigestSchema,
}).strict();

export type IndexerPartitionConvergenceRecord = z.infer<
  typeof indexerPartitionConvergenceRecordSchema
>;

type ConvergencePayload = Omit<IndexerPartitionConvergenceRecord, "convergence_digest">;
type AttemptPayload = Omit<IndexerPartitionAttemptRecord, "attempt_digest">;

const FIXED_COUNT_AXES = /^(?:fixed-count|fixed-size|chunk-size|page-size)(?:-|$)/u;
const ORDINAL_AXES = /^(?:ordinal|input-order|source-order|sequence|sequential)(?:-|$)/u;
const ALPHABETICAL_AXES = /^(?:alphabetic|alphabetical|lexicographic|letter-range)(?:-|$)/u;
const ORDINAL_IDENTITY = /(?:^|[-_:/])(?:batch|part|group|chunk)?[-_ ]?(\d+)$/iu;

function canonicalStrategies(strategies: readonly {
  strategy_ref: IndexerPartitionStrategy;
  strategy_digest: string;
}[]): Array<{ strategy_ref: IndexerPartitionStrategy; strategy_digest: string }> {
  const result = strategies.map((strategy) => ({
    strategy_ref: indexerPartitionStrategySchema.parse(strategy.strategy_ref),
    strategy_digest: indexerDigestSchema.parse(strategy.strategy_digest),
  }));
  if (new Set(result.map((strategy) => strategy.strategy_digest)).size !== result.length) {
    throw new TypeError("partition strategy attempts require unique strategy digests");
  }
  return result;
}

function ownedMembers(plan: IndexerPartitionPlan): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const disposition of plan.member_dispositions) {
    if (disposition.inventory_disposition !== "owned") continue;
    const group = members.get(disposition.group_key) ?? [];
    group.push(disposition.member_id);
    members.set(disposition.group_key, group);
  }
  for (const group of members.values()) group.sort(compareIndexerCanonicalText);
  return members;
}

function relationship(plan: IndexerPartitionPlan) {
  const owned = ownedMembers(plan);
  const groups = plan.groups.map((group) => ({
    group,
    members: owned.get(group.group_key) ?? [],
  }));
  const groupSizes = groups.map((entry) => entry.members.length);
  const expectedSize = groupSizes[0] ?? 0;
  const uniformNonfinal = groupSizes.length > 1 && expectedSize > 0 &&
    groupSizes.slice(0, -1).every((size) => size === expectedSize) &&
    (groupSizes.at(-1) ?? 0) <= expectedSize;
  const lexicalRanges = groups.map((entry) => ({
    first: entry.members[0] ?? "",
    last: entry.members.at(-1) ?? "",
  })).sort((left, right) => compareIndexerCanonicalText(left.first, right.first));
  const lexicalWindows = lexicalRanges.length > 1 && lexicalRanges.every((range, index) =>
    index === 0 || compareIndexerCanonicalText(lexicalRanges[index - 1]!.last, range.first) < 0
  );
  const ordinals = groups.map(({ group }) => {
    const candidates = [group.group_key, group.subject_key.local_key];
    for (const candidate of candidates) {
      const match = ORDINAL_IDENTITY.exec(candidate);
      if (match?.[1] !== undefined) return Number.parseInt(match[1], 10);
    }
    return null;
  });
  const ordinalSequence = ordinals.length > 1 && ordinals.every((ordinal, index) =>
    ordinal !== null && (index === 0 || ordinal === ordinals[index - 1]! + 1)
  );
  return relationshipSchema.parse({
    group_count: groups.length,
    owned_member_count: groupSizes.reduce((total, size) => total + size, 0),
    group_sizes: groupSizes,
    uniform_nonfinal_group_size: uniformNonfinal,
    lexical_windows: lexicalWindows,
    ordinal_identity_sequence: ordinalSequence,
  });
}

function classify(plan: IndexerPartitionPlan): Pick<
  IndexerPartitionAttemptRecord,
  "classification" | "reason_code"
> {
  if (plan.status === "failed") {
    return plan.failure.code === "invalid-input" ||
        plan.failure.code === "insufficient-identity-facts"
      ? { classification: "blocking-input-damage", reason_code: "partition-input-damaged" }
      : {
          classification: "retryable-strategy-failure",
          reason_code: "partition-strategy-failed",
        };
  }
  const axis = plan.partition_axis.trim().toLowerCase();
  if (FIXED_COUNT_AXES.test(axis)) {
    return { classification: "fixed-count", reason_code: "fixed-count-partition" };
  }
  if (ORDINAL_AXES.test(axis)) {
    return { classification: "ordinal", reason_code: "ordinal-partition" };
  }
  if (ALPHABETICAL_AXES.test(axis)) {
    return { classification: "alphabetical", reason_code: "alphabetical-partition" };
  }
  return { classification: "semantic", reason_code: "semantic-partition" };
}

function validateAttemptDigest(attempt: IndexerPartitionAttemptRecord): void {
  const payload = Object.fromEntries(Object.entries(attempt).filter(([key]) =>
    key !== "attempt_digest"
  )) as AttemptPayload;
  if (indexerProtocolDigest(payload) !== attempt.attempt_digest) {
    throw new TypeError("partition convergence attempt digest is invalid");
  }
}

export function validateIndexerPartitionConvergenceRecord(
  value: unknown,
): IndexerPartitionConvergenceRecord {
  const record = indexerPartitionConvergenceRecordSchema.parse(value);
  record.attempts.forEach((attempt, index) => {
    validateAttemptDigest(attempt);
    if (attempt.strategy_order !== index) {
      throw new TypeError("partition convergence attempts must use contiguous strategy order");
    }
    const expectedPrevious = index === 0 ? null : record.attempts[index - 1]!.attempt_digest;
    if (attempt.previous_attempt_digest !== expectedPrevious) {
      throw new TypeError("partition convergence attempt lineage is invalid");
    }
  });
  const last = record.attempts.at(-1)!;
  const validDecision = record.decision === "accepted"
    ? last.classification === "semantic" && record.accepted_plan_hash === last.partition_plan_hash &&
      record.next_strategy_attempt === null && record.outcome === "completed"
    : record.decision === "retry-required"
    ? last.classification !== "semantic" && last.classification !== "blocking-input-damage" &&
      record.accepted_plan_hash === null && record.next_strategy_attempt !== null &&
      record.next_strategy_attempt.previous_attempt_digest === last.attempt_digest &&
      record.outcome === "partial"
    : record.decision === "catalog-fallback-required"
    ? last.classification !== "semantic" && last.classification !== "blocking-input-damage" &&
      record.accepted_plan_hash === null && record.next_strategy_attempt !== null &&
      record.next_strategy_attempt.strategy_ref.kind === "cli-builtin" &&
      record.next_strategy_attempt.strategy_ref.strategy_id ===
        INDEXER_CATALOG_FALLBACK_STRATEGY_ID &&
      record.next_strategy_attempt.previous_attempt_digest === last.attempt_digest &&
      record.outcome === "partial"
    : last.classification === "blocking-input-damage" &&
      record.accepted_plan_hash === null && record.next_strategy_attempt === null &&
      record.outcome === "failed";
  if (!validDecision) throw new TypeError("partition convergence decision is inconsistent");
  const payload = Object.fromEntries(Object.entries(record).filter(([key]) =>
    key !== "convergence_digest"
  )) as ConvergencePayload;
  if (indexerProtocolDigest(payload) !== record.convergence_digest) {
    throw new TypeError("partition convergence digest is invalid");
  }
  return record;
}

export function convergeIndexerPartitionPlan(input: {
  plan: unknown;
  workset: IndexerMainPartitionWorkset;
  canonical_inventory_members: readonly IndexerInventoryMember[];
  authorized_source_refs: readonly string[];
  authorized_strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
  required_question_target_refs?: readonly string[];
  previous_record?: unknown;
}): IndexerPartitionConvergenceRecord {
  const strategies = canonicalStrategies(input.authorized_strategies);
  const fallback = strategies.at(-1);
  if (
    fallback?.strategy_ref.kind !== "cli-builtin" ||
    fallback.strategy_ref.strategy_id !== INDEXER_CATALOG_FALLBACK_STRATEGY_ID ||
    strategies.some((strategy, index) =>
      index !== strategies.length - 1 &&
      strategy.strategy_ref.strategy_id === INDEXER_CATALOG_FALLBACK_STRATEGY_ID
    )
  ) {
    throw new TypeError("partition convergence requires a final CLI catalog-fallback");
  }
  const attemptStrategies = strategies.slice(0, -1);
  if (attemptStrategies.length === 0) {
    throw new TypeError("partition convergence needs a semantic strategy before fallback");
  }
  if (indexerPartitionStrategySetDigest(strategies) !== input.workset.strategy_set_digest) {
    throw new TypeError("partition convergence strategy set is stale");
  }
  const previous = input.previous_record === undefined
    ? undefined
    : validateIndexerPartitionConvergenceRecord(input.previous_record);
  if (previous !== undefined && (
    previous.partition_workset_digest !== input.workset.workset_digest ||
    previous.strategy_set_digest !== input.workset.strategy_set_digest ||
    previous.decision !== "retry-required"
  )) {
    throw new TypeError("partition convergence predecessor cannot accept another attempt");
  }
  const strategyOrder = previous?.attempts.length ?? 0;
  const expected = attemptStrategies[strategyOrder];
  if (expected === undefined) {
    throw new TypeError("partition convergence has already exhausted its strategy set");
  }
  const plan = validateIndexerPartitionPlan({
    plan: input.plan,
    workset: input.workset,
    canonical_inventory_members: input.canonical_inventory_members,
    authorized_source_refs: input.authorized_source_refs,
    authorized_strategies: strategies,
    ...(input.required_question_target_refs === undefined
      ? {}
      : { required_question_target_refs: input.required_question_target_refs }),
  });
  if (
    plan.strategy_digest !== expected.strategy_digest ||
    canonicalIndexerJson(plan.strategy_ref) !== canonicalIndexerJson(expected.strategy_ref)
  ) {
    throw new TypeError("PartitionPlan does not use the next authorized strategy");
  }
  const classification = classify(plan);
  const attemptPayload: AttemptPayload = {
    strategy_order: strategyOrder,
    strategy_ref: plan.strategy_ref,
    strategy_digest: plan.strategy_digest,
    previous_attempt_digest: previous?.attempts.at(-1)?.attempt_digest ?? null,
    partition_plan_hash: plan.canonical_hash,
    plan_status: plan.status,
    ...classification,
    relationship: relationship(plan),
  };
  const attempt = attemptRecordSchema.parse({
    ...attemptPayload,
    attempt_digest: indexerProtocolDigest(attemptPayload),
  });
  const attempts = [...(previous?.attempts ?? []), attempt];
  const next = attemptStrategies[strategyOrder + 1];
  const decisionFields = classification.classification === "semantic"
    ? {
        decision: "accepted" as const,
        accepted_plan_hash: plan.canonical_hash,
        next_strategy_attempt: null,
        outcome: "completed" as const,
      }
    : classification.classification === "blocking-input-damage"
    ? {
        decision: "blocked-invalid-input" as const,
        accepted_plan_hash: null,
        next_strategy_attempt: null,
        outcome: "failed" as const,
      }
    : next === undefined
    ? {
        decision: "catalog-fallback-required" as const,
        accepted_plan_hash: null,
        next_strategy_attempt: {
          strategy_order: strategies.length - 1,
          strategy_ref: fallback.strategy_ref,
          strategy_digest: fallback.strategy_digest,
          previous_attempt_digest: attempt.attempt_digest,
        },
        outcome: "partial" as const,
      }
    : {
        decision: "retry-required" as const,
        accepted_plan_hash: null,
        next_strategy_attempt: {
          strategy_order: strategyOrder + 1,
          strategy_ref: next.strategy_ref,
          strategy_digest: next.strategy_digest,
          previous_attempt_digest: attempt.attempt_digest,
        },
        outcome: "partial" as const,
      };
  const payload: ConvergencePayload = {
    protocol: "context.indexer.partition-convergence/v1",
    partition_workset_digest: input.workset.workset_digest,
    strategy_set_digest: input.workset.strategy_set_digest,
    attempts,
    ...decisionFields,
    user_gate_required: false,
    profile_revision_ledger_consumed: false,
  };
  return validateIndexerPartitionConvergenceRecord({
    ...payload,
    convergence_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerPartitionStrategyAttempt(input: {
  attempt: unknown;
  workset: IndexerMainPartitionWorkset;
  authorized_strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
}): IndexerPartitionStrategyAttempt {
  const attempt = indexerPartitionStrategyAttemptSchema.parse(input.attempt);
  const strategies = canonicalStrategies(input.authorized_strategies);
  const expected = strategies[attempt.strategy_order];
  if (
    indexerPartitionStrategySetDigest(strategies) !== input.workset.strategy_set_digest ||
    expected === undefined ||
    expected.strategy_digest !== attempt.strategy_digest ||
    canonicalIndexerJson(expected.strategy_ref) !== canonicalIndexerJson(attempt.strategy_ref) ||
    (attempt.strategy_order === 0) !== (attempt.previous_attempt_digest === null)
  ) {
    throw new TypeError("partition strategy attempt is not authorized for the current workset");
  }
  return attempt;
}
