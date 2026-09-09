import { interruptDeliveryCadence } from "./indexerDeliveryCadence.js";
import { withCommandReadCache } from "./commandReadCache.js";
import { readPartitionStream, resumePartitionStream } from "./indexerPartitionStream.js";
import { prepareIndexerDelivery, previewIndexerDelivery, resetIndexerDeliveryProjection } from "./indexerDelivery.js";
import { resolveCurrentIndexerComposerBatch } from "./indexerCurrentComposer.js";
import {
  INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
} from "@c4a/context";
import { preparePartitionStage } from "./indexerPartitionStage.js";
import {
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
import { IndexerInputScopeError, recordIndexerInputScopeRecovery } from "./indexerInputScopeRecovery.js";

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

/** Advance deterministic setup only and stop before Agent semantics or Gates. */
async function advanceCurrentIndexerLifecycleInternal(projectRoot: string): Promise<{
  advanced: boolean;
  state: "agent-required" | "gate-required" | "complete" | "failed";
}> {
  const { readTaskRollback } = await import("./taskRollback.js");
  if (await readTaskRollback(projectRoot)) return { advanced: false, state: "complete" };
  const { readKnowledgeUpdate } = await import("./knowledgeUpdate.js");
  if (await readKnowledgeUpdate(projectRoot)) return { advanced: false, state: "agent-required" };
  const { readApprovedRevision } = await import("./approvedRevision.js");
  const revision = await readApprovedRevision(projectRoot);
  if (revision !== undefined) {
    return { advanced: false, state: revision.candidate === undefined ? "agent-required" : "complete" };
  }
  const { prepareManagedSourceKnowledgeUpdate } = await import("./managedSourceKnowledgeUpdate.js");
  if (await prepareManagedSourceKnowledgeUpdate(projectRoot)) return { advanced: true, state: "agent-required" };
  if ((await readPartitionStream(projectRoot))?.phase === "resuming") await resumePartitionStream(projectRoot);
  let ledger = await currentLedger(projectRoot);
  let advanced = false;
  if (ledger === undefined || ledger.entries.length === 0 || ledger.entries.some((entry) => entry.state === "stale") || await hasChangedIndexerWorksetAuthority(projectRoot, ledger)) {
    await resetIndexerDeliveryProjection(projectRoot);
    ledger = await preparePartitionStage(projectRoot);
    advanced = true;
  }
  if (ledger === undefined) throw new TypeError("Indexer lifecycle did not prepare a main run ledger");
  if (ledger.entries.some((entry) => entry.state === "failed")) {
    await interruptDeliveryCadence(projectRoot);
    await retryFailedIndexerMainRunStore(projectRoot);
    ledger = await currentLedger(projectRoot);
    if (ledger === undefined) throw new TypeError("Indexer retry lost the main run ledger");
    advanced = true;
  }
  if (ledger.entries.some((entry) => entry.state === "running")) {
    return { advanced, state: "agent-required" };
  }
  if (ledger.entries.some((entry) => entry.stage === "author" && entry.state === "accepted")) {
    const delivery = await previewIndexerDelivery(projectRoot);
    if (delivery !== undefined && await resolveCurrentIndexerComposerBatch(projectRoot,
      new Set(delivery.current.map((page) => page.workset_digest)))) {
      return { advanced: true, state: "agent-required" };
    }
    if (await prepareIndexerDelivery(projectRoot)) {
      const finalization = await advanceCurrentIndexerFinalization(projectRoot,
        delivery === undefined ? undefined : new Set(delivery.current.map(page => page.workset_digest)));
      return { advanced: true, state: finalization?.state === "ready" ? "complete"
        : finalization?.state === "composer-required" ? "agent-required" : "gate-required" };
    }
  }
  const refreshedLedger = await currentLedger(projectRoot);
  if (refreshedLedger === undefined) return { advanced: true, state: "complete" };
  if (refreshedLedger.ledger_digest !== ledger.ledger_digest) return advanceCurrentIndexerLifecycleInternal(projectRoot);
  if (ledger.entries.every(entry => entry.stage === "partition") &&
      ledger.entries.some(entry => entry.state === "accepted") && ledger.entries.some(entry => entry.state !== "accepted")) {
    // This is only a cheap scheduling hint. If it finds a ready declaration,
    // structure preparation validates the actual accepted cache before acting.
    // Do not repeatedly revalidate every accepted envelope for legacy/all-at-once
    // plans that never opted into an early wave.
    const hints = await Promise.all(ledger.entries.filter(entry => entry.state === "accepted").map(entry =>
      readJsonMaybe(projectRoot, `.tmp/context-runtime/indexer/semantic-results/${entry.execution_request_digest.slice(7)}.json`)));
    const hasReady = hints.some(value => {
      const plan = value as { outcome?: string; groups?: Array<{ ready_for_author?: boolean }> } | undefined;
      return plan?.outcome === "complete" && Array.isArray(plan.groups) && plan.groups.some(group => group?.ready_for_author === true);
    });
    if (hasReady) {
      const structure = await prepareCurrentIndexerStructurePlan(projectRoot, true);
      if (structure.preview.topics.length > 0) {
        await prepareCurrentIndexerAuthorStage(projectRoot);
        return structure.approved ? advanceCurrentIndexerLifecycleInternal(projectRoot) : { advanced: true, state: "gate-required" };
      }
    }
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
      if (structure.preview.topics.length === 0) {
        const { closeProjectWorkspace } = await import("./close.js");
        const { clearCompletedLifecycle } = await import("./lifecycleCleanup.js");
        await closeProjectWorkspace(projectRoot);
        await clearCompletedLifecycle(projectRoot);
        return { advanced: true, state: "complete" };
      }
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
        await interruptDeliveryCadence(projectRoot);
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
  return withCommandReadCache(() => measureContextDebugOperation({
    projectRoot,
    operation: "indexer.next-prepare",
    counters: { next_preparation_count: 1 },
  }, async () => {
    try { return await advanceCurrentIndexerLifecycleInternal(projectRoot); }
    catch (error) {
      if (!(error instanceof IndexerInputScopeError)) throw error;
      await recordIndexerInputScopeRecovery(projectRoot, error);
      return { advanced: true, state: "gate-required" };
    }
  }));
}
