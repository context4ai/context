import {
  buildIndexerMainTransportBatch,
  indexerProtocolDigest,
  type IndexerMainTransportBatch,
  type IndexerMainWorkset,
} from "@c4a/context";

export const INDEXER_BATCH_POLICY_VERSION = "context-indexer-batch-policy-2026-09";

export interface IndexerBatchStagePolicy {
  max_input_bytes: number;
  max_output_reserve_bytes: number;
  max_view_items: number;
  max_tasks: number;
}

type IndexerBatchStage = "partition" | "author" | "post-author";

const STAGE_POLICIES: Record<IndexerBatchStage, IndexerBatchStagePolicy> = {
  partition: {
    max_input_bytes: 6 * 1024 * 1024,
    max_output_reserve_bytes: 2 * 1024 * 1024,
    max_view_items: 1_200,
    max_tasks: 32,
  },
  author: {
    max_input_bytes: 5 * 1024 * 1024,
    max_output_reserve_bytes: 5 * 1024 * 1024,
    max_view_items: 800,
    max_tasks: 4,
  },
  "post-author": {
    max_input_bytes: 4 * 1024 * 1024,
    max_output_reserve_bytes: 4 * 1024 * 1024,
    max_view_items: 600,
    max_tasks: 4,
  },
};

export interface IndexerCurrentBatchCandidate {
  workset: IndexerMainWorkset;
  instruction_identity: string;
  input_bytes: number;
  output_reserve_bytes: number;
  view_item_count: number;
}

export interface PlannedIndexerCurrentBatch {
  stage: "partition" | "author";
  policy_version: typeof INDEXER_BATCH_POLICY_VERSION;
  policy_digest: string;
  transport: IndexerMainTransportBatch;
  candidates: readonly IndexerCurrentBatchCandidate[];
  input_bytes: number;
  output_reserve_bytes: number;
  view_item_count: number;
  oversized_single_task: boolean;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

export function indexerBatchPolicyDigest(stage: IndexerBatchStage): string {
  return indexerProtocolDigest({
    version: INDEXER_BATCH_POLICY_VERSION,
    stage,
    ...STAGE_POLICIES[stage],
  });
}

export function indexerBatchStagePolicy(
  stage: IndexerBatchStage,
): Readonly<IndexerBatchStagePolicy> {
  return STAGE_POLICIES[stage];
}

/**
 * Deterministically packs the current stage's already-authorized worksets.
 * A workset is never split or truncated here. An oversized first task remains
 * a one-item batch so the caller can surface or further partition it using the
 * Provider's declared semantic boundary.
 */
export function planIndexerCurrentBatch(input: {
  candidates: readonly IndexerCurrentBatchCandidate[];
  shared_instruction_bytes: number;
}): PlannedIndexerCurrentBatch {
  assertNonNegativeInteger(input.shared_instruction_bytes, "shared instruction bytes");
  if (input.candidates.length === 0) {
    throw new TypeError("current Indexer batch requires at least one candidate");
  }
  for (const candidate of input.candidates) {
    assertNonNegativeInteger(candidate.input_bytes, "batch candidate input bytes");
    assertNonNegativeInteger(
      candidate.output_reserve_bytes,
      "batch candidate output reserve bytes",
    );
    assertNonNegativeInteger(candidate.view_item_count, "batch candidate View item count");
  }
  const first = input.candidates[0]!;
  const stage = first.workset.stage;
  const policy = STAGE_POLICIES[stage];
  const eligible = input.candidates.filter((candidate) =>
    candidate.workset.stage === stage &&
    candidate.workset.indexer_id === first.workset.indexer_id &&
    candidate.workset.source_ref === first.workset.source_ref &&
    candidate.instruction_identity === first.instruction_identity
  );
  const selected: IndexerCurrentBatchCandidate[] = [];
  let inputBytes = input.shared_instruction_bytes;
  let outputReserveBytes = 0;
  let viewItemCount = 0;
  for (const candidate of eligible) {
    const nextInputBytes = inputBytes + candidate.input_bytes;
    const nextOutputReserveBytes = outputReserveBytes + candidate.output_reserve_bytes;
    const nextViewItemCount = viewItemCount + candidate.view_item_count;
    const fits = selected.length < policy.max_tasks &&
      nextInputBytes <= policy.max_input_bytes &&
      nextOutputReserveBytes <= policy.max_output_reserve_bytes &&
      nextViewItemCount <= policy.max_view_items;
    if (selected.length > 0 && !fits) break;
    selected.push(candidate);
    inputBytes = nextInputBytes;
    outputReserveBytes = nextOutputReserveBytes;
    viewItemCount = nextViewItemCount;
    if (!fits) break;
  }
  const oversizedSingleTask = selected.length === 1 && (
    inputBytes > policy.max_input_bytes ||
    outputReserveBytes > policy.max_output_reserve_bytes ||
    viewItemCount > policy.max_view_items
  );
  return {
    stage,
    policy_version: INDEXER_BATCH_POLICY_VERSION,
    policy_digest: indexerBatchPolicyDigest(stage),
    transport: buildIndexerMainTransportBatch(selected.map((candidate) => candidate.workset)),
    candidates: selected,
    input_bytes: inputBytes,
    output_reserve_bytes: outputReserveBytes,
    view_item_count: viewItemCount,
    oversized_single_task: oversizedSingleTask,
  };
}
