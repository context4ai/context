import { z } from "zod";
import {
  indexerCanonicalRefSchema,
} from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  canonicalIndexerInventoryMembers,
  indexerInventoryMembersDigest,
  indexerInventoryMemberSchema,
  type IndexerInventoryMember,
} from "./indexerInventoryDisposition.js";
import type { IndexerMainPartitionWorkset } from "./indexerMainWorkset.js";
import { canonicalIndexerNodeRef, indexerSubjectKeySchema } from "./indexerSubjectIdentity.js";

const partitionBindingSchema = z.object({
  partition_workset_digest: indexerDigestSchema,
  indexer_id: indexerIdSchema,
  indexer_fingerprint: indexerDigestSchema,
  requirement_digest: indexerDigestSchema,
  subject_key_schema_digest: indexerDigestSchema,
  source_scope_digest: indexerDigestSchema,
  source_refs: z.array(indexerCanonicalRefSchema).min(1),
  module_ref: indexerCanonicalRefSchema.nullable(),
  partition_subject_key: indexerSubjectKeySchema,
  parent_scope_ref: indexerCanonicalRefSchema,
  inventory_digest: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
}).strict();

export const indexerPartitionStrategySchema = z.union([
  z.object({
    kind: z.literal("project-indexer"),
    indexer_id: indexerIdSchema,
    strategy_id: indexerIdSchema,
    implementation_digest: indexerDigestSchema,
  }).strict(),
  z.object({
    kind: z.literal("cli-builtin"),
    strategy_id: indexerIdSchema,
    implementation_digest: indexerDigestSchema,
  }).strict(),
]);

export type IndexerPartitionStrategy = z.infer<typeof indexerPartitionStrategySchema>;

export function indexerPartitionStrategySetDigest(
  strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[],
): string {
  return indexerProtocolDigest({
    strategies,
  });
}

const questionTargetBindingSchema = z.object({
  target_ref: indexerCanonicalRefSchema,
  role: z.enum(["primary-carrier", "enricher"]),
}).strict();

const partitionGroupSchema = z.object({
  group_key: z.string().min(1),
  subject_key: indexerSubjectKeySchema,
  subject_intent: z.enum(["primary", "enrich-or-independent"]),
  logical_unit_ref: indexerCanonicalRefSchema,
  label: z.string().min(1),
  reader_question_refs: z.array(indexerCanonicalRefSchema).min(1),
  question_target_bindings: z.array(questionTargetBindingSchema),
  member_ids: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const memberDispositionSchema = z.union([
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: indexerInventoryMemberSchema.shape.member_kind,
    inventory_disposition: z.literal("owned"),
    group_key: z.string().min(1),
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: indexerInventoryMemberSchema.shape.member_kind,
    inventory_disposition: z.literal("excluded-with-reason"),
    reason_code: indexerIdSchema,
  }).strict(),
  z.object({
    member_id: indexerCanonicalRefSchema,
    member_kind: indexerInventoryMemberSchema.shape.member_kind,
    inventory_disposition: z.literal("unsupported"),
    missing_capabilities: z.array(indexerIdSchema).min(1),
  }).strict(),
]);

const partitionFailureSchema = z.object({
  code: z.enum([
    "unsupported-domain",
    "no-stable-axis",
    "insufficient-identity-facts",
    "invalid-input",
    "strategy-failed",
  ]),
  message: z.string().min(1),
  unassigned_member_ids: z.array(indexerCanonicalRefSchema),
  missing_capabilities: z.array(indexerIdSchema).optional(),
  missing_source_refs: z.array(indexerCanonicalRefSchema).optional(),
}).strict();

const partitionPlanFields = {
  protocol: z.literal("context.indexer.partition-plan/v1"),
  binding: partitionBindingSchema,
  strategy_ref: indexerPartitionStrategySchema,
  strategy_digest: indexerDigestSchema,
  unit_type: indexerIdSchema,
  partition_axis: indexerIdSchema,
  reader_question_refs: z.array(indexerCanonicalRefSchema),
  groups: z.array(partitionGroupSchema),
  member_dispositions: z.array(memberDispositionSchema),
  canonical_hash: indexerDigestSchema,
};

const completePartitionPlanSchema = z.object({
  ...partitionPlanFields,
  status: z.literal("complete"),
  failure: z.null(),
}).strict();

const failedPartitionPlanSchema = z.object({
  ...partitionPlanFields,
  status: z.literal("failed"),
  failure: partitionFailureSchema,
}).strict();

export const indexerPartitionPlanSchema = z.union([
  completePartitionPlanSchema,
  failedPartitionPlanSchema,
]);

export type IndexerPartitionPlan = z.infer<typeof indexerPartitionPlanSchema>;
export type IndexerPartitionGroup = z.infer<typeof partitionGroupSchema>;
export type IndexerMemberDisposition = z.infer<typeof memberDispositionSchema>;

function normalizedPlanHashPayload(plan: Omit<IndexerPartitionPlan, "canonical_hash">) {
  return {
    ...plan,
    groups: plan.groups.map((group) => Object.fromEntries(
      Object.entries(group).filter(([key]) => key !== "label"),
    )),
  };
}

export function indexerPartitionPlanCanonicalHash(
  plan: Omit<IndexerPartitionPlan, "canonical_hash">,
): string {
  return indexerProtocolDigest(normalizedPlanHashPayload(plan));
}

export function indexerPartitionPlanBindingDigest(plan: IndexerPartitionPlan): string {
  return indexerProtocolDigest({
    binding: plan.binding,
    strategy_ref: plan.strategy_ref,
    strategy_digest: plan.strategy_digest,
    unit_type: plan.unit_type,
    partition_axis: plan.partition_axis,
  });
}

export function indexerPartitionGroupProjectionDigest(
  plan: IndexerPartitionPlan,
  groupKey: string,
): string {
  const group = plan.groups.find((item) => item.group_key === groupKey);
  if (group === undefined) throw new TypeError(`unknown partition group ${groupKey}`);
  const dispositions = plan.member_dispositions.filter((item) =>
    item.inventory_disposition === "owned" && item.group_key === groupKey
  );
  return indexerProtocolDigest({
    group: { ...group, label: undefined },
    member_dispositions: dispositions,
  });
}

function assertCanonicalUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must not contain duplicate values`);
  }
  const sorted = [...values].sort();
  if (values.some((value, index) => value !== sorted[index])) {
    throw new TypeError(`${field} must use canonical ordering`);
  }
}

function validateBinding(
  plan: IndexerPartitionPlan,
  workset: IndexerMainPartitionWorkset,
  sourceRefs: readonly string[],
): void {
  const binding = plan.binding;
  const expectedSourceRefs = [...sourceRefs].sort();
  assertCanonicalUnique(binding.source_refs, "binding.source_refs");
  if (
    binding.partition_workset_digest !== workset.workset_digest ||
    binding.indexer_id !== workset.indexer_id ||
    binding.indexer_fingerprint !== workset.primary_execution_fingerprint ||
    binding.requirement_digest !== workset.requirement_set_digest ||
    binding.subject_key_schema_digest !== workset.subject_key_schema_digest ||
    binding.source_scope_digest !== workset.source_scope_digest ||
    binding.module_ref !== workset.module_ref ||
    binding.inventory_digest !== workset.partition_inventory_digest ||
    binding.question_target_inventory_digest !==
      workset.question_target_inventory_digest ||
    canonicalIndexerJson(binding.partition_subject_key) !==
      canonicalIndexerJson(workset.partition_subject_key) ||
    canonicalIndexerJson(binding.source_refs) !== canonicalIndexerJson(expectedSourceRefs) ||
    binding.parent_scope_ref !== (workset.module_ref ?? workset.source_ref)
  ) {
    throw new TypeError("PartitionPlan binding does not match its current workset");
  }
  if (plan.strategy_ref.kind === "project-indexer" &&
      plan.strategy_ref.indexer_id !== workset.indexer_id) {
    throw new TypeError("project partition strategy belongs to another Indexer");
  }
}

function validateGroups(
  plan: IndexerPartitionPlan,
  allowedQuestions: ReadonlySet<string>,
  allowedTargets: ReadonlySet<string>,
): Map<string, IndexerPartitionGroup> {
  assertCanonicalUnique(plan.reader_question_refs, "reader_question_refs");
  if (
    canonicalIndexerJson(plan.reader_question_refs) !==
    canonicalIndexerJson([...allowedQuestions].sort())
  ) {
    throw new TypeError("PartitionPlan must bind the complete workset reader question set");
  }
  const groups = new Map<string, IndexerPartitionGroup>();
  const subjectKeys = new Set<string>();
  assertCanonicalUnique(plan.groups.map((group) => group.group_key), "groups.group_key");
  for (const group of plan.groups) {
    if (groups.has(group.group_key)) {
      throw new TypeError(`duplicate partition group ${group.group_key}`);
    }
    if (canonicalIndexerNodeRef(group.subject_key) !== group.logical_unit_ref) {
      throw new TypeError(`partition group ${group.group_key} has a non-canonical logical unit ref`);
    }
    const subjectIdentity = canonicalIndexerJson(group.subject_key);
    if (subjectKeys.has(subjectIdentity)) {
      throw new TypeError("different partition groups cannot reuse one SubjectKey");
    }
    subjectKeys.add(subjectIdentity);
    assertCanonicalUnique(group.reader_question_refs, `${group.group_key}.reader_question_refs`);
    if (group.reader_question_refs.some((ref) => !allowedQuestions.has(ref))) {
      throw new TypeError(`partition group ${group.group_key} references an unauthorized question`);
    }
    assertCanonicalUnique(group.member_ids, `${group.group_key}.member_ids`);
    const targetRefs = group.question_target_bindings.map((item) => item.target_ref);
    assertCanonicalUnique(targetRefs, `${group.group_key}.question_target_bindings`);
    if (targetRefs.some((ref) => !allowedTargets.has(ref))) {
      throw new TypeError(`partition group ${group.group_key} creates an unknown question target`);
    }
    groups.set(group.group_key, group);
  }
  return groups;
}

function validateDispositions(input: {
  plan: IndexerPartitionPlan;
  groups: ReadonlyMap<string, IndexerPartitionGroup>;
  canonicalInventoryMembers: readonly IndexerInventoryMember[];
}): void {
  const canonicalInventory = canonicalIndexerInventoryMembers(
    input.canonicalInventoryMembers,
  );
  const canonicalMembers = canonicalInventory.map((member) => member.member_id);
  const expectedKinds = new Map(canonicalInventory.map((member) => [
    member.member_id,
    member.member_kind,
  ]));
  const dispositionIds = input.plan.member_dispositions.map((item) => item.member_id);
  assertCanonicalUnique(dispositionIds, "member_dispositions.member_id");
  if (dispositionIds.some((id) => !canonicalMembers.includes(id))) {
    throw new TypeError("PartitionPlan disposition references an unknown inventory member");
  }
  if (
    input.plan.status === "complete" &&
    canonicalIndexerJson(dispositionIds) !== canonicalIndexerJson(canonicalMembers)
  ) {
    throw new TypeError("complete PartitionPlan must close every inventory member");
  }
  const projection = new Map<string, string[]>();
  for (const disposition of input.plan.member_dispositions) {
    if (expectedKinds.get(disposition.member_id) !== disposition.member_kind) {
      throw new TypeError(
        `PartitionPlan member kind does not match inventory member ${disposition.member_id}`,
      );
    }
    if (disposition.inventory_disposition === "unsupported") {
      assertCanonicalUnique(
        disposition.missing_capabilities,
        `${disposition.member_id}.missing_capabilities`,
      );
    }
    if (disposition.inventory_disposition !== "owned") continue;
    if (!input.groups.has(disposition.group_key)) {
      throw new TypeError(`owned member references unknown group ${disposition.group_key}`);
    }
    const members = projection.get(disposition.group_key) ?? [];
    members.push(disposition.member_id);
    projection.set(disposition.group_key, members);
  }
  for (const [groupKey, group] of input.groups) {
    const projected = (projection.get(groupKey) ?? []).sort();
    if (canonicalIndexerJson(projected) !== canonicalIndexerJson(group.member_ids)) {
      throw new TypeError(`partition group ${groupKey} member projection is inconsistent`);
    }
  }
}

function validateQuestionTargetClosure(
  plan: IndexerPartitionPlan,
  requiredTargetRefs: readonly string[],
): void {
  const primaryCounts = new Map<string, number>();
  for (const group of plan.groups) {
    for (const binding of group.question_target_bindings) {
      if (binding.role === "primary-carrier") {
        primaryCounts.set(binding.target_ref, (primaryCounts.get(binding.target_ref) ?? 0) + 1);
      }
    }
  }
  for (const targetRef of requiredTargetRefs) {
    if (primaryCounts.get(targetRef) !== 1) {
      throw new TypeError(`required question target ${targetRef} needs exactly one primary carrier`);
    }
  }
  if ([...primaryCounts.values()].some((count) => count > 1)) {
    throw new TypeError("question target has multiple primary carriers");
  }
}

export function validateIndexerPartitionPlan(input: {
  plan: unknown;
  workset: IndexerMainPartitionWorkset;
  canonical_inventory_members: readonly IndexerInventoryMember[];
  authorized_source_refs: readonly string[];
  authorized_strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
  required_question_target_refs?: readonly string[];
}): IndexerPartitionPlan {
  const plan = indexerPartitionPlanSchema.parse(input.plan);
  const payload = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "canonical_hash"),
  ) as Omit<IndexerPartitionPlan, "canonical_hash">;
  if (indexerPartitionPlanCanonicalHash(payload) !== plan.canonical_hash) {
    throw new TypeError("PartitionPlan canonical hash is invalid");
  }
  validateBinding(plan, input.workset, input.authorized_source_refs);
  const canonicalInventory = canonicalIndexerInventoryMembers(
    input.canonical_inventory_members,
  );
  if (
    indexerInventoryMembersDigest(canonicalInventory) !==
      input.workset.partition_inventory_digest
  ) {
    throw new TypeError("PartitionPlan inventory members do not match the partition workset");
  }
  if (
    indexerPartitionStrategySetDigest(input.authorized_strategies) !==
      input.workset.strategy_set_digest ||
    !input.authorized_strategies.some((strategy) =>
      strategy.strategy_digest === plan.strategy_digest &&
      canonicalIndexerJson(strategy.strategy_ref) === canonicalIndexerJson(plan.strategy_ref)
    )
  ) {
    throw new TypeError("PartitionPlan strategy is not in the current authorized strategy set");
  }
  const allowedQuestions = new Set(input.workset.reader_question_refs);
  const allowedTargets = new Set(input.workset.allowed_question_target_refs);
  const groups = validateGroups(plan, allowedQuestions, allowedTargets);
  validateDispositions({
    plan,
    groups,
    canonicalInventoryMembers: canonicalInventory,
  });
  if (plan.status === "complete") {
    if (plan.groups.length === 0) {
      throw new TypeError("complete PartitionPlan cannot have zero groups");
    }
    validateQuestionTargetClosure(
      plan,
      input.required_question_target_refs ?? input.workset.allowed_question_target_refs,
    );
  } else {
    const closed = new Set(plan.member_dispositions.map((item) => item.member_id));
    const expectedUnassigned = canonicalInventory
      .map((member) => member.member_id)
      .filter((id) => !closed.has(id))
      .sort();
    assertCanonicalUnique(plan.failure.unassigned_member_ids, "failure.unassigned_member_ids");
    if (
      canonicalIndexerJson(expectedUnassigned) !==
      canonicalIndexerJson(plan.failure.unassigned_member_ids)
    ) {
      throw new TypeError("failed PartitionPlan must report every unassigned member");
    }
    if (
      plan.failure.code === "insufficient-identity-facts" &&
      (plan.failure.missing_capabilities?.length ?? 0) === 0 &&
      (plan.failure.missing_source_refs?.length ?? 0) === 0
    ) {
      throw new TypeError(
        "insufficient-identity-facts must name missing capability or source diagnostics",
      );
    }
  }
  return plan;
}
