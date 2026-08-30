import {
  canonicalIndexerJson,
  convergeIndexerPartitionPlan,
  validateIndexerPartitionConvergenceRecord,
  type IndexerInventoryMember,
  type IndexerMainRunRequest,
  type IndexerPartitionConvergenceRecord,
} from "@c4a/context";

export async function readStoredIndexerPartitionConvergence(input: {
  request: IndexerMainRunRequest;
  expected_decision: "retry-required" | "catalog-fallback-required";
  read_previous_record: (attemptDigest: string) => Promise<unknown | undefined>;
}): Promise<IndexerPartitionConvergenceRecord | undefined> {
  if (input.request.workset.stage !== "partition") return undefined;
  const previousAttemptDigest =
    input.request.partition_strategy_attempt?.previous_attempt_digest;
  if (previousAttemptDigest === null || previousAttemptDigest === undefined) {
    return undefined;
  }
  const value = await input.read_previous_record(previousAttemptDigest);
  if (value === undefined) {
    throw new TypeError("partition strategy predecessor is missing");
  }
  const record = validateIndexerPartitionConvergenceRecord(value);
  if (
    record.attempts.at(-1)?.attempt_digest !== previousAttemptDigest ||
    record.partition_workset_digest !== input.request.workset.workset_digest ||
    record.decision !== input.expected_decision ||
    canonicalIndexerJson(record.next_strategy_attempt) !==
      canonicalIndexerJson(input.request.partition_strategy_attempt)
  ) {
    throw new TypeError("partition strategy predecessor is stale");
  }
  return record;
}

export async function convergeStoredIndexerPartition(input: {
  request: IndexerMainRunRequest;
  validation: Record<string, unknown>;
  operation_result: unknown;
  read_previous_record: (attemptDigest: string) => Promise<unknown | undefined>;
}): Promise<IndexerPartitionConvergenceRecord> {
  if (input.request.workset.stage !== "partition") {
    throw new TypeError("partition convergence requires a partition run request");
  }
  const validation = input.validation as {
    stage: "partition";
    canonical_inventory_members: readonly IndexerInventoryMember[];
    authorized_source_refs: readonly string[];
    authorized_strategies: Parameters<
      typeof convergeIndexerPartitionPlan
    >[0]["authorized_strategies"];
    required_question_target_refs?: readonly string[];
  };
  const previous = await readStoredIndexerPartitionConvergence({
    request: input.request,
    expected_decision: "retry-required",
    read_previous_record: input.read_previous_record,
  });
  return convergeIndexerPartitionPlan({
    plan: input.operation_result,
    workset: input.request.workset,
    canonical_inventory_members: validation.canonical_inventory_members,
    authorized_source_refs: validation.authorized_source_refs,
    authorized_strategies: validation.authorized_strategies,
    ...(validation.required_question_target_refs === undefined
      ? {}
      : {
          required_question_target_refs:
            validation.required_question_target_refs,
        }),
    ...(previous === undefined ? {} : { previous_record: previous }),
  });
}
