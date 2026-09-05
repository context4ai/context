import {
  buildIndexerMainWorkset,
  canonicalIndexerInventoryMembers,
  canonicalIndexerJson,
  indexerPartitionGroupRef,
  indexerPartitionPlanCanonicalHash,
  indexerProtocolDigest,
  validateIndexerPartitionInputs,
  type IndexerInventoryMember,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerPartitionValidationInput,
} from "@c4a/context";

type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;

export interface IndexerPartitionGroupOrigin {
  partition_workset_digest: string;
  group_key: string;
}

export type ConvergedIndexerPartitionInput = Omit<
  IndexerPartitionValidationInput,
  "plan"
> & { plan: IndexerPartitionPlan };

export interface ConvergedIndexerPartitionInputs {
  partitions: ConvergedIndexerPartitionInput[];
  /** The selected primary owner is first; remaining material origins are stably ordered. */
  origins_by_group_ref: ReadonlyMap<string, readonly IndexerPartitionGroupOrigin[]>;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function subjectIdentity(value: unknown): string {
  return canonicalIndexerJson(value);
}

function canonicalInventory(
  values: readonly IndexerInventoryMember[],
): IndexerInventoryMember[] {
  const byId = new Map<string, IndexerInventoryMember>();
  for (const member of values) {
    const previous = byId.get(member.member_id);
    if (previous !== undefined && previous.member_kind !== member.member_kind) {
      throw new TypeError(`partition member ${member.member_id} has conflicting kinds`);
    }
    byId.set(member.member_id, member);
  }
  return canonicalIndexerInventoryMembers([...byId.values()]);
}

function buildConvergedWorkset(input: {
  partitions: readonly IndexerPartitionValidationInput[];
  inventory: readonly IndexerInventoryMember[];
  reader_question_refs: readonly string[];
  allowed_question_target_refs: readonly string[];
}): IndexerMainPartitionWorkset {
  const first = input.partitions[0]!.workset;
  const built = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: first.indexer_id,
    requirement_ref: first.requirement_ref,
    owner_cell_refs: uniqueSorted(input.partitions.flatMap((item) =>
      item.workset.owner_cell_refs
    )),
    source_ref: first.source_ref,
    module_ref: first.module_ref,
    primary_registry_projection_digest: first.primary_registry_projection_digest,
    requirement_set_digest: first.requirement_set_digest,
    primary_execution_fingerprint: first.primary_execution_fingerprint,
    profile_contract_digest: first.profile_contract_digest,
    subject_key_schema_digest: first.subject_key_schema_digest,
    source_scope_digest: first.source_scope_digest,
    source_binding_digest: first.source_binding_digest,
    primary_resource_binding_digest: first.primary_resource_binding_digest,
    question_target_inventory_digest: first.question_target_inventory_digest,
    ...(first.repair_intent === undefined ? {} : { repair_intent: first.repair_intent }),
    partition_subject_key: first.partition_subject_key,
    strategy_set_digest: first.strategy_set_digest,
    reader_question_refs: uniqueSorted(input.reader_question_refs),
    partition_input_digests: uniqueSorted(input.partitions.flatMap((item) =>
      item.workset.partition_input_digests
    )),
    partition_inventory_digest: indexerProtocolDigest({
      members: canonicalIndexerInventoryMembers(input.inventory),
    }),
    allowed_question_target_refs: uniqueSorted(input.allowed_question_target_refs),
  });
  if (built.stage !== "partition") throw new TypeError("expected converged partition workset");
  return built;
}

interface SubjectGroupEntry {
  input: IndexerPartitionValidationInput;
  workset: IndexerMainPartitionWorkset;
  plan: CompletePartitionPlan;
  group: CompletePartitionPlan["groups"][number];
}

function groupMembers(entry: SubjectGroupEntry): IndexerInventoryMember[] {
  const wanted = new Set(entry.group.member_ids);
  const members = entry.input.canonical_inventory_members.filter((member) =>
    wanted.has(member.member_id)
  );
  if (members.length !== wanted.size) {
    throw new TypeError("partition Subject group references unavailable inventory members");
  }
  return members;
}

function ownerEntry(entries: readonly SubjectGroupEntry[]): SubjectGroupEntry {
  if (entries.length === 1) return entries[0]!;
  const primaries = entries.filter((entry) => entry.group.subject_intent === "primary");
  const primaryOwners = new Set(primaries.map((entry) => [
    entry.workset.indexer_id,
    entry.workset.source_ref,
    entry.workset.module_ref ?? "",
    entry.workset.primary_execution_fingerprint,
  ].join("\u0000")));
  if (primaries.length === 0 || primaryOwners.size !== 1) {
    throw new TypeError(
      `Subject ${entries[0]!.group.logical_unit_ref} requires exactly one primary author; ` +
        `received ${primaryOwners.size}`,
    );
  }
  return [...primaries].sort((left, right) =>
    left.workset.workset_digest.localeCompare(right.workset.workset_digest)
  )[0]!;
}

function convergeSubjectGroup(
  entries: readonly SubjectGroupEntry[],
): {
  partition: ConvergedIndexerPartitionInput;
  origins: Map<string, IndexerPartitionGroupOrigin[]>;
} {
  const owner = ownerEntry(entries);
  if (entries.some((entry) =>
    entry.workset.requirement_ref !== owner.workset.requirement_ref ||
    subjectIdentity(entry.group.subject_key) !== subjectIdentity(owner.group.subject_key) ||
    entry.group.logical_unit_ref !== owner.group.logical_unit_ref
  )) {
    throw new TypeError("one logical Subject cannot cross requirement or SubjectKey identity");
  }
  const inventory = canonicalInventory(entries.flatMap(groupMembers));
  const questionTargets = new Map<string, "primary-carrier" | "enricher">();
  for (const binding of entries.flatMap((entry) => entry.group.question_target_bindings)) {
    const previous = questionTargets.get(binding.target_ref);
    questionTargets.set(
      binding.target_ref,
      previous === "primary-carrier" || binding.role === "primary-carrier"
        ? "primary-carrier"
        : "enricher",
    );
  }
  // The primary author owns the reader contract. Supplementary Providers add
  // source material to that Subject; they do not silently expand the primary
  // Provider's question authority with contracts it may not define.
  const readerQuestionRefs = uniqueSorted(owner.group.reader_question_refs);
  questionTargets.clear();
  for (const binding of owner.group.question_target_bindings) {
    questionTargets.set(binding.target_ref, binding.role);
  }
  const inputs = entries.map((entry) => entry.input);
  const workset = buildConvergedWorkset({
    partitions: [owner.input, ...inputs.filter((input) => input !== owner.input)],
    inventory,
    reader_question_refs: readerQuestionRefs,
    allowed_question_target_refs: [...questionTargets.keys()],
  });
  const groupKey = `subject:${indexerProtocolDigest({ subject_key: owner.group.subject_key })}`;
  const groups = [{
    group_key: groupKey,
    subject_key: owner.group.subject_key,
    subject_intent: owner.group.subject_intent,
    logical_unit_ref: owner.group.logical_unit_ref,
    label: owner.group.label,
    reader_question_refs: readerQuestionRefs,
    question_target_bindings: [...questionTargets.entries()]
      .map(([target_ref, role]) => ({ target_ref, role }))
      .sort((left, right) => left.target_ref.localeCompare(right.target_ref)),
    member_ids: inventory.map((member) => member.member_id),
  }];
  const memberDispositions = entries.flatMap((entry) => {
    const memberIds = new Set(entry.group.member_ids);
    return entry.plan.member_dispositions.flatMap((disposition) =>
      disposition.inventory_disposition === "owned" && memberIds.has(disposition.member_id)
        ? [{ ...disposition, group_key: groupKey }]
        : []
    );
  }).sort((left, right) => left.member_id.localeCompare(right.member_id));
  if (new Set(memberDispositions.map((item) => item.member_id)).size !==
      memberDispositions.length) {
    throw new TypeError("Subject convergence found duplicate partition members");
  }
  const firstPlan = owner.plan;
  const planPayload: Omit<CompletePartitionPlan, "canonical_hash"> = {
    protocol: "context.indexer.partition-plan/v1",
    status: "complete",
    binding: {
      partition_workset_digest: workset.workset_digest,
      indexer_id: workset.indexer_id,
      indexer_fingerprint: workset.primary_execution_fingerprint,
      requirement_digest: workset.requirement_set_digest,
      subject_key_schema_digest: workset.subject_key_schema_digest,
      source_scope_digest: workset.source_scope_digest,
      source_refs: uniqueSorted(inputs.flatMap((item) => [...item.authorized_source_refs])),
      module_ref: workset.module_ref,
      partition_subject_key: workset.partition_subject_key,
      parent_scope_ref: workset.module_ref ?? workset.source_ref,
      inventory_digest: workset.partition_inventory_digest,
      question_target_inventory_digest: workset.question_target_inventory_digest,
    },
    strategy_ref: firstPlan.strategy_ref,
    strategy_digest: firstPlan.strategy_digest,
    unit_type: firstPlan.unit_type,
    partition_axis: firstPlan.partition_axis,
    reader_question_refs: workset.reader_question_refs,
    groups,
    member_dispositions: memberDispositions,
    failure: null,
  };
  const plan: CompletePartitionPlan = {
    ...planPayload,
    canonical_hash: indexerPartitionPlanCanonicalHash(planPayload),
  };
  const partition: ConvergedIndexerPartitionInput = {
    plan,
    workset,
    canonical_inventory_members: inventory,
    authorized_source_refs: uniqueSorted(inputs.flatMap((item) =>
      [...item.authorized_source_refs]
    )),
    authorized_strategies: inputs[0]!.authorized_strategies,
    required_question_target_refs: uniqueSorted(inputs.flatMap((item) =>
      [...(item.required_question_target_refs ?? [])]
    ).filter((ref) => questionTargets.has(ref))),
  };
  validateIndexerPartitionInputs([partition]);
  const origins = new Map<string, IndexerPartitionGroupOrigin[]>();
  origins.set(indexerPartitionGroupRef({
    partition_workset_digest: workset.workset_digest,
    group_key: groupKey,
  }), [owner, ...entries.filter((entry) => entry !== owner).sort((left, right) =>
    `${left.workset.workset_digest}\u0000${left.group.group_key}`.localeCompare(
      `${right.workset.workset_digest}\u0000${right.group.group_key}`,
    )
  )].map((entry) => ({
    partition_workset_digest: entry.workset.workset_digest,
    group_key: entry.group.group_key,
  })));
  return { partition, origins };
}

export function convergeIndexerPartitionSubjects(
  values: readonly IndexerPartitionValidationInput[],
): ConvergedIndexerPartitionInputs {
  const validated = validateIndexerPartitionInputs(values);
  const normalized = values.map((value, index) => ({
    ...value,
    workset: validated[index]!.workset,
    plan: validated[index]!.plan,
  }));
  const bySubject = new Map<string, SubjectGroupEntry[]>();
  for (const input of normalized) {
    if (input.plan.status !== "complete") {
      throw new TypeError("failed PartitionPlan cannot enter Subject convergence");
    }
    for (const group of input.plan.groups) {
      const key = group.logical_unit_ref;
      const entries = bySubject.get(key) ?? [];
      entries.push({ input, workset: input.workset, plan: input.plan, group });
      bySubject.set(key, entries);
    }
  }
  const partitions: ConvergedIndexerPartitionInput[] = [];
  const origins = new Map<string, readonly IndexerPartitionGroupOrigin[]>();
  for (const entries of bySubject.values()) {
    const converged = convergeSubjectGroup(entries);
    partitions.push(converged.partition);
    for (const [groupRef, groupOrigins] of converged.origins) {
      origins.set(groupRef, groupOrigins);
    }
  }
  return {
    partitions: partitions.sort((left, right) =>
      left.workset.workset_digest.localeCompare(right.workset.workset_digest)
    ),
    origins_by_group_ref: origins,
  };
}
