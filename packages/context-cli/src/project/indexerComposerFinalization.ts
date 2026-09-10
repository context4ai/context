import { join } from "node:path";

export const INDEXER_CURRENT_FINALIZATION_PATH = join(
  ".tmp", "context-runtime", "indexer", "finalization", "current.json",
);

export interface ComposerBatchFinalization {
  batch_digest: string;
  task_count: number;
}

export function composerFinalizationState(batch: ComposerBatchFinalization) {
  return {
    state: "composer-required" as const,
    revision: batch.batch_digest,
    diagnostic: `${batch.task_count} Composer task(s) are ready.`,
  };
}
