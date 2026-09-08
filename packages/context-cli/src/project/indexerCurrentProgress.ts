import { indexerArtifactResultSchema } from "@c4a/context";
import { readIndexerDelivery } from "./indexerDelivery.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import type { ContextResolvedWorkflowRoute } from "./workflow/workflowTypes.js";
import { readCurrentIndexerBatchDescriptor } from "./indexerCurrentBatch.js";
import { estimateCurrentIndexerStageEta } from "./indexerBatchTiming.js";
import { currentLedger, readJsonMaybe } from "./indexerMainRunStoreRecords.js";

export interface IndexerCurrentProgress {
  stage: "partition" | "author";
  workflow_progress: {
    scope: "current-indexer-run"; partitioned: number | null; planned_topics: number | null;
    authored: number; built: number; awaiting_build: number;
    workspace_complete: false; next_milestone: string;
  };
  pages?: { unit: "page"; authored: number; delivered: number; current_batch: number; authored_not_delivered: number; preview_paths: string[] };
  task_completion?: { unit: "task"; stage: "partition" | "author"; completed: number; total: number; ratio: number;
    definition: string };
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
  if (running > 0 || route?.gate?.resolution === "session-authority" ||
    route?.commands.some((command) => command.managed_execution === "agent-required")) return "waiting-agent";
  if (pending > 0 || stale > 0 || route?.node === "advance-current-indexer-lifecycle") {
    return "mechanical";
  }
  return route === undefined ? "complete" : "mechanical";
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
  const delivery = await readIndexerDelivery(input.projectRoot);
  const authored = stage === "author" ? (await readAcceptedIndexerMainAuthorResultRecords(input.projectRoot))
    .reduce((sum, record) => sum + indexerArtifactResultSchema.parse(record.artifact_result).artifacts.length, 0) : 0;
  const delivered = Object.keys(delivery?.delivered ?? {}).length;
  const plan = await readJsonMaybe(input.projectRoot, ".tmp/context-runtime/indexer/structure-review/author-plan.json") as
    { preview?: { topics?: unknown[] } } | undefined;
  return {
    task_completion: { unit: "task", stage, completed: accepted, total: ledger.entries.length,
      ratio: accepted / ledger.entries.length,
      definition: "Accepted tasks / all tasks in the current stage. This is not Review, build or overall project completion." },
    workflow_progress: { scope: "current-indexer-run", partitioned: stage === "partition" ? accepted : null,
      planned_topics: plan?.preview?.topics?.length ?? null, authored, built: delivered,
      awaiting_build: delivery?.current.length ?? 0, workspace_complete: false,
      next_milestone: stage === "partition" ? "Finish scope planning, then review the proposed structure; no pages have been written in this stage."
        : delivered === 0 ? "Write, review and build the first readable page batch." : "Review and build the next page batch." },
    ...(stage === "author" ? { pages: { unit: "page" as const, authored, delivered, current_batch: delivery?.current.length ?? 0,
      authored_not_delivered: Math.max(0, authored - delivered), preview_paths: delivery?.paths ?? [] } } : {}),
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
