import {
  indexerPartitionPlanCanonicalHash,
  type IndexerPartitionPlan,
  type IndexerPartitionValidationInput,
} from "@c4a/context";

/** Apply an explicit scope decision to accepted plans, without asking the Agent
 * to regenerate unchanged groups. Supporting source material is not removed.
 */
export function excludeIndexerPartitionMembers(
  partitions: readonly IndexerPartitionValidationInput[],
  excluded: ReadonlySet<string>,
): IndexerPartitionValidationInput[] {
  return partitions.map((partition) => {
    const plan = partition.plan as IndexerPartitionPlan;
    if (plan.status !== "complete" || !plan.groups.some((group) =>
      group.member_ids.some((id) => excluded.has(id))
    )) return partition;
    const groups = plan.groups.map((group) => {
      const removed = group.member_ids.filter((id) => excluded.has(id));
      if (removed.length === 0) return group;
      // Keep identity and accepted receipts, but the old document form no longer
      // constrains the remaining content. Author must reassess the residual group.
      const retained = { ...group };
      delete retained.artifact_intent;
      delete retained.template_id;
      return {
        ...retained,
        member_ids: group.member_ids.filter((id) => !excluded.has(id)),
        scope_change: { removed_member_ids: [...new Set([
          ...(group.scope_change?.removed_member_ids ?? []), ...removed,
        ])].sort() },
      };
    }).filter((group) => group.member_ids.length > 0);
    const payload = {
      ...plan,
      groups,
      member_dispositions: plan.member_dispositions.map((item) =>
        item.inventory_disposition === "owned" && excluded.has(item.member_id)
          ? { member_id: item.member_id, member_kind: item.member_kind,
              inventory_disposition: "excluded-with-reason" as const,
              reason_code: "user-excluded-obsolete" }
          : item
      ),
    };
    const hashPayload = Object.fromEntries(Object.entries(payload).filter(([key]) =>
      key !== "canonical_hash"
    )) as Omit<Extract<IndexerPartitionPlan, { status: "complete" }>, "canonical_hash">;
    const retainedTargets = new Set(groups.flatMap((group) =>
      group.question_target_bindings.map((binding) => binding.target_ref)
    ));
    return {
      ...partition,
      plan: { ...hashPayload, canonical_hash: indexerPartitionPlanCanonicalHash(hashPayload) },
      ...(partition.required_question_target_refs === undefined ? {} : {
        required_question_target_refs: partition.required_question_target_refs.filter((ref) => retainedTargets.has(ref)),
      }),
    };
  });
}
