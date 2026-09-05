import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { CurrentIndexerBatchDescriptor } from "./indexerCurrentBatch.js";

const TIMING_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "batch-timing.json",
);

interface ActiveBatchTiming {
  descriptor_digest: string;
  stage: "partition" | "author";
  indexer_id: string;
  source_ref: string;
  policy_digest: string;
  task_count: number;
  started_at_ms: number;
}

interface CompletedBatchTiming extends Omit<ActiveBatchTiming, "descriptor_digest" | "started_at_ms"> {
  duration_ms: number;
  completed_at_ms: number;
}

interface BatchTimingState {
  cache_format: 1;
  active: ActiveBatchTiming | null;
  samples: CompletedBatchTiming[];
}

function emptyState(): BatchTimingState {
  return { cache_format: 1, active: null, samples: [] };
}

async function readState(projectRoot: string): Promise<BatchTimingState> {
  try {
    const value = JSON.parse(await readFile(join(projectRoot, TIMING_PATH), "utf8")) as
      Partial<BatchTimingState>;
    if (value.cache_format !== 1 || !Array.isArray(value.samples)) return emptyState();
    return {
      cache_format: 1,
      active: value.active ?? null,
      samples: value.samples.filter((sample) =>
        sample !== null && typeof sample === "object" &&
        Number.isFinite(sample.duration_ms) && sample.duration_ms >= 0
      ).slice(-64),
    };
  } catch {
    return emptyState();
  }
}

function activeTiming(
  descriptor: CurrentIndexerBatchDescriptor,
  startedAtMs: number,
): ActiveBatchTiming {
  const first = descriptor.tasks[0]!;
  return {
    descriptor_digest: descriptor.descriptor_digest,
    stage: descriptor.stage,
    indexer_id: first.indexer_id,
    source_ref: first.source_ref,
    policy_digest: descriptor.policy_digest,
    task_count: descriptor.tasks.length,
    started_at_ms: startedAtMs,
  };
}

export async function observeIndexerBatchStarted(input: {
  projectRoot: string;
  descriptor: CurrentIndexerBatchDescriptor;
}): Promise<void> {
  const state = await readState(input.projectRoot);
  if (state.active?.descriptor_digest === input.descriptor.descriptor_digest) return;
  await atomicWriteFile(join(input.projectRoot, TIMING_PATH), `${JSON.stringify({
    ...state,
    active: activeTiming(input.descriptor, Date.now()),
  }, null, 2)}\n`);
}

export async function observeIndexerBatchCompleted(input: {
  projectRoot: string;
  descriptor: CurrentIndexerBatchDescriptor;
  completedTaskCount: number;
}): Promise<void> {
  if (!Number.isSafeInteger(input.completedTaskCount) || input.completedTaskCount <= 0) return;
  const state = await readState(input.projectRoot);
  const active = state.active;
  if (active?.descriptor_digest !== input.descriptor.descriptor_digest) return;
  const now = Date.now();
  const { descriptor_digest: _descriptor, started_at_ms: startedAt, ...identity } = active;
  void _descriptor;
  const sample: CompletedBatchTiming = {
    ...identity,
    task_count: input.completedTaskCount,
    duration_ms: Math.max(0, now - startedAt),
    completed_at_ms: now,
  };
  await atomicWriteFile(join(input.projectRoot, TIMING_PATH), `${JSON.stringify({
    cache_format: 1,
    active: null,
    samples: [...state.samples, sample].slice(-64),
  }, null, 2)}\n`);
}

export async function estimateCurrentIndexerStageEta(input: {
  projectRoot: string;
  descriptor: CurrentIndexerBatchDescriptor;
  remainingTasks: number;
}): Promise<{
  lower_ms: number;
  upper_ms: number;
  confidence: "low" | "medium";
  sample_count: number;
} | null> {
  const state = await readState(input.projectRoot);
  const first = input.descriptor.tasks[0]!;
  const samples = state.samples.filter((sample) =>
    sample.stage === input.descriptor.stage &&
    sample.indexer_id === first.indexer_id &&
    sample.source_ref === first.source_ref &&
    sample.policy_digest === input.descriptor.policy_digest &&
    sample.task_count > 0
  );
  if (samples.length < 2 || input.remainingTasks <= 0) return null;
  const perTask = samples.map((sample) => sample.duration_ms / sample.task_count)
    .sort((left, right) => left - right);
  const median = perTask[Math.floor(perTask.length / 2)]!;
  return {
    lower_ms: Math.round(median * input.remainingTasks * 0.75),
    upper_ms: Math.round(median * input.remainingTasks * 1.5),
    confidence: samples.length >= 5 ? "medium" : "low",
    sample_count: samples.length,
  };
}
