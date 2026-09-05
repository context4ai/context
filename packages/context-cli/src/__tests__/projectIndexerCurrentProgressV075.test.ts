import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { indexerProtocolDigest } from "@c4a/context";
import { estimateCurrentIndexerStageEta } from "../project/indexerBatchTiming.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentIndexerProgress } from "../project/indexerCurrentProgress.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { resolveCurrentIndexerAgentContext } from
  "../project/indexerCurrentWorkflowRoute.js";
import { createDocumentRevisionWorkspace } from
  "./projectDocumentRevisionV074.fixture.js";

const TIMING_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "batch-timing.json",
);

describe("0.7.5 current Indexer progress", () => {
  test("uses ledger counts and never reuses ETA samples after conditions change", async () => {
    const root = await createDocumentRevisionWorkspace();
    await advanceCurrentIndexerLifecycle(root);
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined) throw new Error("missing current Indexer batch");
    const ledger = await currentLedger(root);
    if (ledger === undefined) throw new Error("missing current Indexer ledger");

    const progress = await currentIndexerProgress({ projectRoot: root });
    expect(progress).toMatchObject({
      stage: ledger.entries[0]!.stage,
      total: ledger.entries.length,
      accepted: ledger.entries.filter((entry) => entry.state === "accepted").length,
      running: ledger.entries.filter((entry) => entry.state === "running").length,
      pending: ledger.entries.filter((entry) => entry.state === "pending").length,
      failed: ledger.entries.filter((entry) => entry.state === "failed").length,
      stale: ledger.entries.filter((entry) => entry.state === "stale").length,
      stop: "waiting-agent",
      eta: null,
    });

    const first = current.descriptor.tasks[0]!;
    const samples = [1_000, 1_200].map((duration, index) => ({
      stage: current.descriptor.stage,
      indexer_id: first.indexer_id,
      source_ref: first.source_ref,
      policy_digest: current.descriptor.policy_digest,
      task_count: 1,
      duration_ms: duration,
      completed_at_ms: index + 1,
    }));
    const path = join(root, TIMING_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify({
      cache_format: 1,
      active: null,
      samples,
    })}\n`, "utf8");

    expect(await estimateCurrentIndexerStageEta({
      projectRoot: root,
      descriptor: current.descriptor,
      remainingTasks: 2,
    })).toEqual({
      lower_ms: 1_800,
      upper_ms: 3_600,
      confidence: "low",
      sample_count: 2,
    });

    expect(await estimateCurrentIndexerStageEta({
      projectRoot: root,
      descriptor: {
        ...current.descriptor,
        policy_digest: indexerProtocolDigest({ policy: "changed" }),
      },
      remainingTasks: 2,
    })).toBeNull();
  }, 20_000);
});
