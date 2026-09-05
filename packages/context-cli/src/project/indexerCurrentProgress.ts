import type { ContextResolvedWorkflowRoute } from "./workflow/workflowTypes.js";
import { readCurrentIndexerBatchDescriptor } from "./indexerCurrentBatch.js";
import { estimateCurrentIndexerStageEta } from "./indexerBatchTiming.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";

export interface IndexerCurrentProgress {
  stage: "partition" | "author";
  total: number;
  accepted: number;
  running: number;
  pending: number;
  failed: number;
  stale: number;
  current_batch: {
    task_count: number;
    source_refs: string[];
  } | null;
  stop: "waiting-agent" | "waiting-user" | "external-blocker" | "mechanical" | "complete";
  eta: {
    lower_ms: number;
    upper_ms: number;
    confidence: "low" | "medium";
    sample_count: number;
  } | null;
}

function stopType(
  route: ContextResolvedWorkflowRoute | undefined,
  running: number,
  pending: number,
  stale: number,
): IndexerCurrentProgress["stop"] {
  if (route?.availability === "blocked") return "external-blocker";
  if (route?.availability === "requires-user") return "waiting-user";
  if (running > 0) return "waiting-agent";
  if (pending > 0 || stale > 0 || route?.node === "advance-current-indexer-lifecycle") {
    return "mechanical";
  }
  return "complete";
}

export async function currentIndexerProgress(input: {
  projectRoot: string;
  route?: ContextResolvedWorkflowRoute;
}): Promise<IndexerCurrentProgress | undefined> {
  const ledger = await currentLedger(input.projectRoot);
  if (ledger === undefined || ledger.entries.length === 0) return undefined;
  const stage = ledger.entries[0]!.stage;
  if (ledger.entries.some((entry) => entry.stage !== stage)) {
    throw new TypeError("current Indexer progress requires a single-stage ledger");
  }
  const count = (state: "accepted" | "running" | "pending" | "failed" | "stale") =>
    ledger.entries.filter((entry) => entry.state === state).length;
  const accepted = count("accepted");
  const running = count("running");
  const pending = count("pending");
  const failed = count("failed");
  const stale = count("stale");
  const descriptor = running === 0
    ? undefined
    : await readCurrentIndexerBatchDescriptor(input.projectRoot);
  const remaining = running + pending + failed + stale;
  const eta = descriptor === undefined
    ? null
    : await estimateCurrentIndexerStageEta({
        projectRoot: input.projectRoot,
        descriptor,
        remainingTasks: remaining,
      });
  return {
    stage,
    total: ledger.entries.length,
    accepted,
    running,
    pending,
    failed,
    stale,
    current_batch: descriptor === undefined
      ? null
      : {
          task_count: descriptor.tasks.length,
          source_refs: [...new Set(descriptor.tasks.map((task) => task.source_ref))].sort(),
        },
    stop: stopType(input.route, running, pending, stale),
    eta,
  };
}
