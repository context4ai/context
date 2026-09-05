import {
  INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
  loadIndexerRegistry,
} from "@c4a/context";
import {
  buildProjectIndexerMainPartitionWorksets,
  buildProjectIndexerQuestionTargetInventory,
} from "./indexerMainLifecycleActions.js";
import {
  prepareIndexerMainRunStore,
  retryFailedIndexerMainRunStore,
  startIndexerMainRunStore,
} from "./indexerMainRunStore.js";
import { prepareAndStartNextIndexerBatch } from "./indexerCurrentBatch.js";
import {
  currentLedger,
  currentSpec,
  partitionConvergencePath,
  readJsonMaybe,
} from "./indexerMainRunStoreRecords.js";
import {
  advanceCurrentIndexerFinalization,
  readCurrentIndexerFinalization,
} from "./indexerCurrentFinalization.js";
import { buildProjectIndexerCatalogFallback } from "./indexerCatalogFallbackActions.js";
import {
  currentIndexerStructureReview,
  prepareCurrentIndexerAuthorStage,
  prepareCurrentIndexerStructurePlan,
} from "./indexerStructureReview.js";
import { measureContextDebugOperation } from "./debugTrace.js";
import { hasChangedIndexerWorksetAuthority } from "./indexerCurrentRegistryFreshness.js";

async function applyCatalogFallbackIfRequired(projectRoot: string): Promise<boolean> {
  const ledger = await currentLedger(projectRoot);
  if (ledger === undefined || ledger.entries.some((entry) => entry.state === "running")) {
    return false;
  }
  const next = ledger.entries.find((entry) =>
    entry.state === "pending" || entry.state === "stale"
  );
  if (next === undefined || next.stage !== "partition") return false;
  const spec = await currentSpec({
    projectRoot,
    request_digest: next.execution_request_digest,
  });
  const attempt = spec.request.partition_strategy_attempt;
  if (attempt?.strategy_ref.strategy_id !== INDEXER_CATALOG_FALLBACK_STRATEGY_ID) {
    return false;
  }
  if (typeof attempt.previous_attempt_digest !== "string") {
    throw new TypeError("catalog fallback is missing its predecessor convergence digest");
  }
  const convergence = await readJsonMaybe(
    projectRoot,
    partitionConvergencePath(attempt.previous_attempt_digest),
  );
  if (convergence === undefined) {
    throw new TypeError("catalog fallback predecessor convergence is missing");
  }
  const started = await startIndexerMainRunStore({
    projectRoot,
    workset_digest: next.workset_digest,
  });
  await buildProjectIndexerCatalogFallback({
    projectRoot,
    value: {
      protocol: "context.indexer.catalog-fallback-build-input/v1",
      requirement_set_digest: started.request.workset.requirement_set_digest,
      request: started.request,
      convergence,
      validation: spec.validation,
    },
  });
  return true;
}

async function preparePartitionStage(projectRoot: string) {
  const loaded = await loadIndexerRegistry(projectRoot);
  const questionTargets = await buildProjectIndexerQuestionTargetInventory({
    projectRoot,
    value: {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: loaded.requirementSetDigest,
    },
  });
  const partition = await buildProjectIndexerMainPartitionWorksets({
    projectRoot,
    value: {
      protocol: "context.indexer.main-partition-workset-build-input/v1",
      question_target_inventory: questionTargets,
    },
  });
  await prepareIndexerMainRunStore({
    projectRoot,
    workset_set: partition.workset_set,
    run_specs: partition.run_specs,
  });
  return currentLedger(projectRoot);
}

/** Advance deterministic setup only and stop before Agent semantics or Gates. */
async function advanceCurrentIndexerLifecycleInternal(projectRoot: string): Promise<{
  advanced: boolean;
  state: "agent-required" | "gate-required" | "complete" | "failed";
}> {
  let ledger = await currentLedger(projectRoot);
  let advanced = false;
  if (ledger === undefined || await hasChangedIndexerWorksetAuthority(projectRoot, ledger)) {
    ledger = await preparePartitionStage(projectRoot);
    advanced = true;
  }
  if (ledger === undefined) throw new TypeError("Indexer lifecycle did not prepare a main run ledger");
  if (ledger.entries.some((entry) => entry.state === "failed")) {
    await retryFailedIndexerMainRunStore(projectRoot);
    ledger = await currentLedger(projectRoot);
    if (ledger === undefined) throw new TypeError("Indexer retry lost the main run ledger");
    advanced = true;
  }
  if (ledger.entries.some((entry) => entry.state === "running")) {
    return { advanced, state: "agent-required" };
  }
  const next = ledger.entries.find((entry) =>
    entry.state === "pending" || entry.state === "stale"
  );
  if (next !== undefined) {
    if (await applyCatalogFallbackIfRequired(projectRoot)) {
      return advanceCurrentIndexerLifecycleInternal(projectRoot);
    }
    const structure = await currentIndexerStructureReview(projectRoot);
    if (next.stage === "author" && structure?.approved !== true) {
      return { advanced, state: "gate-required" };
    }
    await prepareAndStartNextIndexerBatch(projectRoot);
    return { advanced: true, state: "agent-required" };
  }
  if (
    ledger.entries.length > 0 &&
    ledger.entries.every((entry) => entry.stage === "partition" && entry.state === "accepted")
  ) {
    // Reconcile the accepted Partition ledger against the current parser/source
    // identities before deriving Author worksets. Unchanged shards retain their
    // accepted cache; changed shards become stale through the normal ledger CAS.
    ledger = await preparePartitionStage(projectRoot);
    if (ledger === undefined) {
      throw new TypeError("Indexer lifecycle lost its reconciled Partition ledger");
    }
    if (ledger.entries.some((entry) => entry.state !== "accepted")) {
      return advanceCurrentIndexerLifecycleInternal(projectRoot);
    }
    const structure = await prepareCurrentIndexerStructurePlan(projectRoot);
    await prepareCurrentIndexerAuthorStage(projectRoot);
    if (structure.approved) {
      return advanceCurrentIndexerLifecycleInternal(projectRoot);
    }
    return { advanced: true, state: "gate-required" };
  }
  if (
    ledger.entries.length > 0 &&
    ledger.entries.every((entry) => entry.stage === "author" && entry.state === "accepted")
  ) {
    const previousFinalization = await readCurrentIndexerFinalization(projectRoot);
    if (previousFinalization?.state === "blocked") {
      ledger = await preparePartitionStage(projectRoot);
      if (ledger === undefined) throw new TypeError("Indexer recovery lost the Partition ledger");
      const next = ledger.entries.find((entry) =>
        entry.state === "pending" || entry.state === "stale" || entry.state === "failed"
      );
      if (next === undefined) {
        return { advanced: true, state: "gate-required" };
      }
      if (next.state === "failed") {
        await retryFailedIndexerMainRunStore(projectRoot);
      }
      return advanceCurrentIndexerLifecycleInternal(projectRoot);
    }
    const finalization = await advanceCurrentIndexerFinalization(projectRoot);
    return {
      advanced: finalization !== undefined,
      state: finalization?.state === "ready"
        ? "complete"
        : finalization?.state === "composer-required"
        ? "agent-required"
        : "gate-required",
    };
  }
  return { advanced, state: "gate-required" };
}

export async function advanceCurrentIndexerLifecycle(projectRoot: string): Promise<{
  advanced: boolean;
  state: "agent-required" | "gate-required" | "complete" | "failed";
}> {
  return measureContextDebugOperation({
    projectRoot,
    operation: "indexer.next-prepare",
    counters: { next_preparation_count: 1 },
  }, () => advanceCurrentIndexerLifecycleInternal(projectRoot));
}
