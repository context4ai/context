import {
  canonicalIndexerNodeRef,
  compareIndexerCanonicalText,
  indexerPartitionPlanCanonicalHash,
  validateIndexerSubjectKeyForContract,
  type IndexerAuthorizedWorksetView,
  type IndexerInventoryMember,
  type IndexerMainRunRequest,
  type IndexerMainRunResult,
  type IndexerPartitionPlan,
  type IndexerPartitionSemanticInput,
  type IndexerSubjectKey,
} from "@c4a/context";

function uniqueSorted(values: readonly string[], label: string): string[] {
  const sorted = [...new Set(values)].sort(compareIndexerCanonicalText);
  if (sorted.length !== values.length) {
    throw new TypeError(`${label} contains duplicate entries`);
  }
  return sorted;
}

function suffixAlias(value: string): string {
  const separator = value.lastIndexOf(":");
  return separator < 0 ? value : value.slice(separator + 1);
}

function exactAliasMap(values: readonly string[], label: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of values) {
    result.set(value, value);
    const alias = suffixAlias(value);
    const existing = result.get(alias);
    if (existing === undefined) result.set(alias, value);
    else if (existing !== value) result.delete(alias);
  }
  if (result.size === 0 && values.length > 0) {
    throw new TypeError(`${label} aliases are unavailable`);
  }
  return result;
}

function resolveAlias(
  aliases: ReadonlyMap<string, string>,
  value: string,
  label: string,
): string {
  const resolved = aliases.get(value);
  if (resolved === undefined) throw new TypeError(`${label} is not authorized: ${value}`);
  return resolved;
}

function inventoryAliases(input: {
  view: IndexerAuthorizedWorksetView;
  inventory: readonly IndexerInventoryMember[];
}): Map<string, string> {
  const aliases = exactAliasMap(input.inventory.map((item) => item.member_id), "inventory");
  const known = new Set(input.inventory.map((item) => item.member_id));
  for (const item of input.view.items) {
    if (item.category !== "inventory-member" || item.value === null ||
        Array.isArray(item.value) || typeof item.value !== "object") continue;
    const memberId = item.value.member_id;
    if (typeof memberId === "string" && known.has(memberId)) aliases.set(item.ref, memberId);
  }
  return aliases;
}

function subjectKey(
  value: IndexerPartitionSemanticInput["groups"][number]["subject"],
  base: IndexerSubjectKey,
): IndexerSubjectKey {
  if (typeof value !== "string") {
    return { protocol: "context.subject-key/v1", ...value };
  }
  const localKey = value.startsWith("subject-choice:")
    ? value.slice("subject-choice:".length)
    : value;
  if (localKey.length === 0) throw new TypeError("partition subject choice is empty");
  return {
    protocol: "context.subject-key/v1",
    namespace: base.namespace,
    kind: base.kind,
    local_key: localKey,
  };
}

export function buildIndexerPartitionRunResultFromSemantic(input: {
  request: IndexerMainRunRequest;
  view: IndexerAuthorizedWorksetView;
  semantic: IndexerPartitionSemanticInput;
  validation: {
    canonical_inventory_members: readonly IndexerInventoryMember[];
    authorized_source_refs: readonly string[];
    subject_key_contract: unknown;
    partition_unit_type: string;
    required_question_target_refs?: readonly string[];
  };
}): IndexerMainRunResult {
  if (input.request.workset.stage !== "partition") {
    throw new TypeError("partition semantic input requires the current partition workset");
  }
  const workset = input.request.workset;
  if (
    input.view.stage !== "partition" ||
    input.view.workset_digest !== input.request.workset.workset_digest ||
    input.view.execution_request_digest !== input.request.execution_request_digest
  ) {
    throw new TypeError("partition semantic input uses a stale authorized workset View");
  }
  const attempt = input.request.partition_strategy_attempt;
  if (attempt === null) throw new TypeError("partition workset has no current strategy attempt");
  const members = inventoryAliases({
    view: input.view,
    inventory: input.validation.canonical_inventory_members,
  });
  const memberKinds = new Map(input.validation.canonical_inventory_members.map((item) => [
    item.member_id,
    item.member_kind,
  ]));
  const questions = exactAliasMap(
    workset.reader_question_refs,
    "reader questions",
  );
  const targets = exactAliasMap(
    input.validation.required_question_target_refs ??
      workset.allowed_question_target_refs,
    "question targets",
  );
  const groups = input.semantic.groups.map((group) => {
    const resolvedMembers = uniqueSorted(group.members.map((member) =>
      resolveAlias(members, member, "partition member")
    ), `${group.key}.members`);
    const resolvedQuestions = uniqueSorted(group.questions.map((question) =>
      resolveAlias(questions, question, "reader question")
    ), `${group.key}.questions`);
    const resolvedTargets = group.question_targets.map((target) => ({
      target_ref: resolveAlias(targets, target.target, "question target"),
      role: target.role,
    })).sort((left, right) => compareIndexerCanonicalText(
      left.target_ref,
      right.target_ref,
    ));
    const subject = subjectKey(group.subject, workset.partition_subject_key);
    validateIndexerSubjectKeyForContract(
      subject,
      input.validation.subject_key_contract,
      workset.indexer_id,
    );
    return {
      group_key: group.key,
      subject_key: subject,
      subject_intent: group.subject_intent,
      logical_unit_ref: canonicalIndexerNodeRef(subject),
      label: group.title,
      reader_question_refs: resolvedQuestions,
      question_target_bindings: resolvedTargets,
      member_ids: resolvedMembers,
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.group_key, right.group_key));
  const dispositions = [
    ...groups.flatMap((group) => group.member_ids.map((memberId) => ({
      member_id: memberId,
      member_kind: memberKinds.get(memberId)!,
      inventory_disposition: "owned" as const,
      group_key: group.group_key,
    }))),
    ...input.semantic.excluded.map((entry) => {
      const memberId = resolveAlias(members, entry.item, "excluded partition member");
      return {
        member_id: memberId,
        member_kind: memberKinds.get(memberId)!,
        inventory_disposition: "excluded-with-reason" as const,
        reason_code: entry.reason_code,
      };
    }),
    ...input.semantic.unsupported.map((entry) => {
      const memberId = resolveAlias(members, entry.item, "unsupported partition member");
      return {
        member_id: memberId,
        member_kind: memberKinds.get(memberId)!,
        inventory_disposition: "unsupported" as const,
        missing_capabilities: uniqueSorted(
          entry.missing_capabilities,
          `${entry.item}.missing_capabilities`,
        ),
      };
    }),
  ].sort((left, right) => compareIndexerCanonicalText(left.member_id, right.member_id));
  const common = {
    protocol: "context.indexer.partition-plan/v1" as const,
    binding: {
      partition_workset_digest: workset.workset_digest,
      indexer_id: workset.indexer_id,
      indexer_fingerprint: workset.primary_execution_fingerprint,
      requirement_digest: workset.requirement_set_digest,
      subject_key_schema_digest: workset.subject_key_schema_digest,
      source_scope_digest: workset.source_scope_digest,
      source_refs: uniqueSorted(input.validation.authorized_source_refs, "authorized sources"),
      module_ref: workset.module_ref,
      partition_subject_key: workset.partition_subject_key,
      parent_scope_ref: workset.module_ref ?? workset.source_ref,
      inventory_digest: workset.partition_inventory_digest,
      question_target_inventory_digest:
        workset.question_target_inventory_digest,
    },
    strategy_ref: attempt.strategy_ref,
    strategy_digest: attempt.strategy_digest,
    unit_type: input.validation.partition_unit_type,
    partition_axis: attempt.strategy_ref.strategy_id,
    reader_question_refs: [...workset.reader_question_refs],
    groups,
    member_dispositions: dispositions,
  };
  let plan: IndexerPartitionPlan;
  if (input.semantic.outcome === "complete") {
    const planWithoutHash: Omit<
      Extract<IndexerPartitionPlan, { status: "complete" }>,
      "canonical_hash"
    > = { ...common, status: "complete", failure: null };
    plan = {
      ...planWithoutHash,
      canonical_hash: indexerPartitionPlanCanonicalHash(planWithoutHash),
    };
  } else {
    const planWithoutHash: Omit<
      Extract<IndexerPartitionPlan, { status: "failed" }>,
      "canonical_hash"
    > = {
      ...common,
      status: "failed",
      failure: {
        code: input.semantic.failure.code,
        message: input.semantic.failure.message,
        unassigned_member_ids: uniqueSorted(input.semantic.failure.unassigned.map((member) =>
          resolveAlias(members, member, "unassigned partition member")
        ), "failure.unassigned"),
        ...(input.semantic.failure.missing_capabilities === undefined
          ? {}
          : { missing_capabilities: uniqueSorted(
              input.semantic.failure.missing_capabilities,
              "failure.missing_capabilities",
            ) }),
        ...(input.semantic.failure.missing_sources === undefined
          ? {}
          : { missing_source_refs: uniqueSorted(
              input.semantic.failure.missing_sources,
              "failure.missing_sources",
            ) }),
      },
    };
    plan = {
      ...planWithoutHash,
      canonical_hash: indexerPartitionPlanCanonicalHash(planWithoutHash),
    };
  }
  return {
    protocol: "context.indexer.run-result/v1",
    operation: "main-index",
    consumed_input_view_digest: input.request.composition_input.view_digest,
    result: {
      protocol: "context.indexer.main-result/v1",
      stage: "partition",
      workset_digest: workset.workset_digest,
      execution_request_digest: input.request.execution_request_digest,
      result: plan,
    },
  };
}
