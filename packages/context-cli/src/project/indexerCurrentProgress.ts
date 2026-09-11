import { indexerPlanningSummary } from "./indexerPlanningSummary.js";
import { indexerProgressScopes } from "./indexerProgressScopes.js";
import { readPartitionStream } from "./indexerPartitionStream.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readPostAuthorCurrentState } from "./indexerPostAuthorStorePersistence.js";
import { indexerBatchStagePolicy } from "./indexerCurrentBatchPlanner.js";
import { indexerArtifactResultSchema } from "@c4a/context";
import { readAcceptedIndexerDeliveryPages, readIndexerDelivery } from "./indexerDelivery.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import type { ContextResolvedWorkflowRoute } from "./workflow/workflowTypes.js";
import { readCurrentIndexerBatchDescriptor } from "./indexerCurrentBatch.js";
import { estimateCurrentIndexerStageEta } from "./indexerBatchTiming.js";
import { currentLedger, readJsonMaybe } from "./indexerMainRunStoreRecords.js";

export interface IndexerCurrentProgress {
  scopes: ReturnType<typeof indexerProgressScopes>;
  stage: "partition" | "author";
  planning_summary?: Awaited<ReturnType<typeof indexerPlanningSummary>>;
  planning?: { total: number; accepted: number; remaining: number; delivered_waves_pending_planning: boolean };
  workflow_progress: {
    scope: "current-indexer-run"; partitioned: number | null; planned_topics: number | null;
    authored: number; built: number; awaiting_build: number;
    workspace_complete: false; next_milestone: string;
  };
  pages?: { unit: "page"; authored: number; delivered: number; current_batch: number; authored_not_delivered: number; preview_paths: string[] };
  task_completion?: { unit: "task"; stage: "partition" | "author"; completed: number; total: number; ratio: number;
    definition: string };
  delivery_stages?: { composer: { scope: "current-delivery"; prepared_tasks: number; accepted: number; running: number; pending: number }; review_pending_pages: number };
  remaining_transport_batches?: { minimum: number; definition: string };
  eta_basis?: string;
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
  const stream = await readPartitionStream(input.projectRoot);
  const stage = ledger.entries[0]!.stage;
  const planningLedger = stage === "partition" ? ledger : stream?.partition_ledger;
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
  const authorWorksets = stage === "author" ? ledger.entries.map(entry => entry.workset_digest) : [];
  const wavePages = stage === "author" ? await readAcceptedIndexerDeliveryPages(input.projectRoot) : [];
  const composerStates = await Promise.all([...new Set(authorWorksets)]
    .map(workset => readPostAuthorCurrentState(input.projectRoot, workset)));
  const composerEntries = composerStates.flatMap(state => state?.ledger.entries ?? []);
  const candidates = await readCandidateRecords(input.projectRoot);
  const reviewPending = candidates.filter(item => item.status === "draft").length;
  let authored = stage === "author" ? (await readAcceptedIndexerMainAuthorResultRecords(input.projectRoot))
    .reduce((sum, record) => sum + indexerArtifactResultSchema.parse(record.artifact_result).artifacts.length, 0) : 0;
  const delivered = Object.keys(delivery?.delivered ?? {}).length;
  let authoredNotDelivered = Math.max(0, authored - delivered);
  if (stream) {
    const pages = wavePages;
    authoredNotDelivered = pages.filter(page => delivery?.delivered[page.ref] !== page.content_digest).length;
    authored = new Set([...Object.keys(delivery?.delivered ?? {}), ...pages.map(page => page.ref)]).size;
  }
  const plan = await readJsonMaybe(input.projectRoot, ".tmp/context-runtime/indexer/structure-review/author-plan.json") as
    { preview?: { topics?: unknown[] } } | undefined;
  const activeComposer = composerEntries.filter(entry => entry.state === "running");
  const mainSlice = descriptor?.tasks.map(task => ledger.entries.find(entry => entry.workset_digest === task.workset_digest));
  return {
    ...(planningLedger === undefined ? {} : { planning_summary: await indexerPlanningSummary(input.projectRoot, planningLedger) }),
    scopes: indexerProgressScopes({
      delivered,
      planning: planningLedger ? { completed: planningLedger.entries.filter(entry => entry.state === "accepted").length, total: planningLedger.entries.length, stale: planningLedger.entries.filter(entry => entry.state === "stale").length } : null,
      author: stage === "author" ? { completed: accepted, total: ledger.entries.length } : null,
      wavePages: { authored: wavePages.length, delivered: wavePages.filter(page => delivery?.delivered[page.ref] === page.content_digest).length },
      composer: { completed: composerEntries.filter(entry => entry.state === "accepted").length, prepared: composerEntries.length,
        allPrepared: authorWorksets.length > 0 && composerStates.every(state => state !== undefined) },
      review: { pending: reviewPending, requiresRepair: candidates.filter(item => item.status === "rejected").length },
      slice: activeComposer.length ? { stage: "post-author", completed: 0, total: activeComposer.length }
        : mainSlice?.length ? { stage, completed: mainSlice.filter(entry => entry?.state === "accepted").length, total: mainSlice.length } : null,
    }),
    ...(planningLedger === undefined ? {} : { planning: {
      total: planningLedger.entries.length, accepted: planningLedger.entries.filter(entry => entry.state === "accepted").length,
      remaining: planningLedger.entries.filter(entry => entry.state !== "accepted").length,
      delivered_waves_pending_planning: stream !== undefined && planningLedger.entries.some(entry => entry.state !== "accepted"),
    } }),
    delivery_stages: { composer: { scope: "current-delivery", prepared_tasks: composerEntries.length,
      accepted: composerEntries.filter(item => item.state === "accepted").length,
      running: composerEntries.filter(item => item.state === "running").length,
      pending: composerEntries.filter(item => item.state !== "accepted" && item.state !== "running").length }, review_pending_pages: reviewPending },
    remaining_transport_batches: { minimum: Math.ceil(remaining / indexerBatchStagePolicy(stage).max_tasks),
      definition: "Lower bound for this stage at the task cap; reading/output budgets and Provider boundaries can require more batches. Excludes future Composer, Review and repair." },
    eta_basis: "Observed batch elapsed time, which can include conversation pauses. An estimate for this stage only; not a completion deadline or model execution time.",
    task_completion: { unit: "task", stage, completed: accepted, total: ledger.entries.length,
      ratio: accepted / ledger.entries.length,
      definition: "Accepted tasks / all tasks in the current stage. This is not Review, build or overall project completion." },
    workflow_progress: { scope: "current-indexer-run", partitioned: stage === "partition" ? accepted : null,
      planned_topics: plan?.preview?.topics?.length ?? null, authored, built: delivered,
      awaiting_build: delivery?.current.length ?? 0, workspace_complete: false,
      next_milestone: stage === "partition" ? "Continue planning; independently ready themes can enter structure review and delivery before the remaining planning finishes."
        : delivered === 0 ? "Write, review and build the first readable page batch." : "Review and build the next page batch." },
    ...(stage === "author" ? { pages: { unit: "page" as const, authored, delivered, current_batch: delivery?.current.length ?? 0,
      authored_not_delivered: authoredNotDelivered, preview_paths: delivery?.paths ?? [] } } : {}),
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
    stop: stream && stopType(input.route, running, pending, stale) === "complete"
      ? "mechanical" : stopType(input.route, running, pending, stale),
    eta,
  };
}
