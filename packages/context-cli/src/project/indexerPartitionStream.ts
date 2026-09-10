import { settleDeliveryCadence } from "./indexerDeliveryCadence.js";
import { withProjectWriteLock } from "./writeLock.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  indexerProtocolDigest, validateIndexerMainRunLedger,
  type IndexerMainRunLedger,
} from "@c4a/context";
import { currentLedger, persistLedger, readJsonMaybe, type MainRunSpec } from "./indexerMainRunStoreRecords.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";

export const PARTITION_STREAM_PATH = ".tmp/context-runtime/indexer/partition-stream.json";
const schema = z.object({
  protocol: z.literal("context.indexer.partition-stream/v1"),
  phase: z.enum(["planning", "author", "resuming"]),
  partition_ledger: z.unknown(),
  completed_bindings: z.array(z.string()),
  completed_receipts: z.record(z.array(z.string())).optional(),
  active_bindings: z.array(z.string()),
  final_wave: z.boolean().optional(),
  digest: z.string(),
}).strict();
export interface PartitionStream {
  protocol: "context.indexer.partition-stream/v1";
  phase: "planning" | "author" | "resuming";
  partition_ledger: IndexerMainRunLedger;
  completed_bindings: string[];
  completed_receipts?: Record<string, string[]> | undefined;
  active_bindings: string[];
  final_wave?: boolean | undefined;
  digest: string;
}

export function partitionStreamRecord(value: Omit<PartitionStream, "digest">): PartitionStream {
  return { ...value, digest: indexerProtocolDigest(value) };
}

export async function readPartitionStream(root: string): Promise<PartitionStream | undefined> {
  const value = await readJsonMaybe(root, PARTITION_STREAM_PATH);
  if (value === undefined) return undefined;
  const parsed = schema.parse(value);
  const { digest, ...payload } = parsed;
  if (indexerProtocolDigest(payload) !== digest) throw new TypeError("Partition checkpoint failed integrity validation");
  const ledger = validateIndexerMainRunLedger(parsed.partition_ledger);
  if (ledger.entries.some(entry => entry.stage !== "partition" || entry.state === "running")) {
    throw new TypeError("Partition checkpoint must contain only settled planning tasks");
  }
  return { ...parsed, partition_ledger: ledger };
}

/** Ignore the mutable create/enrich target view, but include every material and
 * instruction binding that can change the actual page. */
export function partitionAuthorBinding(spec: Pick<MainRunSpec, "request" | "validation">): string {
  const workset = spec.request.workset;
  if (workset.stage !== "author") throw new TypeError("Expected an Author plan");
  return indexerProtocolDigest({
    requirement: workset.requirement_set_digest, indexer: workset.indexer_id,
    subject: spec.validation.expected_subject_key,
    group: workset.partition_plan_binding_digest,
    dependency: workset.group_dependency_view_digest,
    source: workset.source_binding_digest,
    instructions: workset.primary_execution_fingerprint,
    supplementary: spec.validation.supplementary_sources,
  });
}

export async function authorStreamRecord(root: string, bindings: string[], finalWave?: boolean): Promise<PartitionStream | undefined> {
  const ledger = await currentLedger(root);
  if (!ledger?.entries.every(entry => entry.stage === "partition" && entry.state !== "running")) return undefined;
  const previous = await readPartitionStream(root);
  return partitionStreamRecord({ protocol: "context.indexer.partition-stream/v1", phase: "author",
    ...(finalWave === undefined ? {} : { final_wave: finalWave }),
    partition_ledger: ledger, completed_bindings: previous?.completed_bindings ?? [],
    ...(previous?.completed_receipts === undefined ? {} : { completed_receipts: previous.completed_receipts }), active_bindings: bindings });
}

/** Bind settled themes to the exact accepted executions. Repairs can keep the
 * same source binding while replacing an older immutable Author receipt. */
async function settledReceipts(root: string, state: PartitionStream, ledger: IndexerMainRunLedger) {
  const { currentSpec } = await import("./indexerMainRunStoreRecords.js");
  const receipts = { ...state.completed_receipts };
  for (const binding of state.active_bindings) receipts[binding] = [];
  for (const entry of ledger.entries) {
    const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    const binding = partitionAuthorBinding(spec);
    if (!state.active_bindings.includes(binding)) throw new TypeError("Settled Author receipt is outside the active wave");
    receipts[binding]!.push(entry.execution_request_digest);
  }
  return receipts;
}

/** Explicit source/structure adjustments return to the saved planning ledger
 * without crediting the interrupted wave as delivered. */
async function reopenPartitionStreamUnlocked(root: string): Promise<boolean> {
  const state = await readPartitionStream(root);
  if (!state || state.phase === "planning") return false;
  if (state.phase === "author") {
    const { digest: _digest, ...payload } = state; void _digest;
    await atomicWriteFile(join(root, PARTITION_STREAM_PATH), JSON.stringify(partitionStreamRecord({
      ...payload, phase: "resuming", active_bindings: [],
    })));
  }
  return resumePartitionStream(root);
}

/** Called only after the current wave's normal delivery has settled. The
 * resuming marker makes interrupted projection cleanup safely repeatable. */
async function resumePartitionStreamUnlocked(root: string): Promise<boolean> {
  let state = await readPartitionStream(root);
  if (!state || state.phase === "planning") return false;
  if (state.phase === "author") {
    const ledger = await currentLedger(root);
    if (!ledger?.entries.every(entry => entry.stage === "author" && entry.state === "accepted")) {
      throw new TypeError("Cannot resume planning before the active Author wave has settled");
    }
    if (state.active_bindings.length) await settleDeliveryCadence(root, indexerProtocolDigest(state.active_bindings));
    const { digest: previousDigest, ...previous } = state; void previousDigest;
    state = partitionStreamRecord({ ...previous, phase: "resuming",
      completed_bindings: [...new Set([...state.completed_bindings, ...state.active_bindings])],
      completed_receipts: await settledReceipts(root, state, ledger),
      active_bindings: [],
    });
    await atomicWriteFile(join(root, PARTITION_STREAM_PATH), JSON.stringify(state));
  }
  // Keep the revision-bound decision: preparing the same plan can reuse it.
  // A different wave's revision cannot inherit it; explicit feedback clears it.
  for (const name of ["finalization", "candidate-compile", "structure-review/author-plan.json"]) {
    await rm(join(root, ".tmp/context-runtime/indexer", name), { recursive: true, force: true });
  }
  const { digest: _digest, ...payload } = state; void _digest;
  const resumed = partitionStreamRecord({ ...payload, phase: "planning" });
  await persistLedger({ projectRoot: root, operation: "prepare", transaction_kind: "resume-partition-stream",
    ledger: state.partition_ledger, mutable_records: [{ path: PARTITION_STREAM_PATH, value: resumed }] });
  return true;
}

export function reopenPartitionStream(root: string): Promise<boolean> {
  return withProjectWriteLock(root, "reopen-partition-stream", () => reopenPartitionStreamUnlocked(root));
}

export function resumePartitionStream(root: string): Promise<boolean> {
  return withProjectWriteLock(root, "resume-partition-stream", () => resumePartitionStreamUnlocked(root));
}


/** Only a complete planning snapshot with no unselected groups can finish the
 * task. An all-accepted partition ledger alone can still have future waves. */
export function finishPartitionStream(root: string): Promise<boolean> {
  return withProjectWriteLock(root, "finish-partition-stream", async () => {
    const state = await readPartitionStream(root);
    if (!state || state.phase !== "author" || state.final_wave !== true ||
        !state.partition_ledger.entries.every(entry => entry.state === "accepted")) return false;
    const ledger = await currentLedger(root);
    if (!ledger?.entries.every(entry => entry.stage === "author" && entry.state === "accepted")) return false;
    if (state.active_bindings.length) await settleDeliveryCadence(root, indexerProtocolDigest(state.active_bindings));
    const { digest: _digest, ...payload } = state; void _digest;
    await atomicWriteFile(join(root, PARTITION_STREAM_PATH), JSON.stringify(partitionStreamRecord({
      ...payload, phase: "planning", active_bindings: [],
      completed_bindings: [...new Set([...state.completed_bindings, ...state.active_bindings])],
      completed_receipts: await settledReceipts(root, state, ledger),
    })));
    return true;
  });
}
