import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { withProjectWriteLock } from "./writeLock.js";
import { loadCurrentIndexerRegistry } from "./currentIndexerRegistry.js";

export const TASK_PREPARATION_PATH = ".tmp/context-runtime/task-preparation.json";
type PreparationState = "cleared" | "resume-requested";
export function taskPreparationRecord(state: PreparationState) {
  return { protocol: "context.task-preparation/v1", state };
}
export async function readTaskPreparation(root: string): Promise<PreparationState | undefined> {
  let text: string;
  try { text = await readFile(join(root, TASK_PREPARATION_PATH), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const record = JSON.parse(text);
  if (record.protocol !== "context.task-preparation/v1" || !["cleared", "resume-requested"].includes(record.state)) {
    throw new TypeError("Invalid task preparation record; preserve the workspace for recovery");
  }
  // A resumed ledger takes over scheduling; this marker never reopens completed work.
  return await currentLedger(root) === undefined ? record.state : undefined;
}

/** Explicit user intent, including workspaces cleared before preparation markers existed. */
export async function resumeWorkspaceTask(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "resume-workspace-task", async () => {
    const { assertPreparationComplete } = await import("./workspacePreparation.js");
    await assertPreparationComplete(projectRoot);
    const ledger = await currentLedger(projectRoot);
    if (ledger) return { action: "task-already-present", next: "context status --managed --format json" };
    const registry = await loadCurrentIndexerRegistry(projectRoot);
    if (!registry.registry.requirements.length) throw new TypeError("No applied Indexer requirements; configure Providers through the current Context Route first");
    await safeProjectTarget(projectRoot, TASK_PREPARATION_PATH);
    await atomicWriteFile(join(projectRoot, TASK_PREPARATION_PATH), JSON.stringify(taskPreparationRecord("resume-requested")));
    return { action: "task-resume-requested", requirement_set_digest: registry.requirementSetDigest,
      request_digest: indexerProtocolDigest({ requirement_set_digest: registry.requirementSetDigest, state: "resume-requested" }),
      preserves: ["approved pages and Subject identities", "captured sources", "configuration", "existing build"],
      progress: "Rebuild the task ledger from current registered scope. Reuse matching retained receipts; deleted receipts require replanning, not fabricated completion.",
      next: "context status --managed --format json" };
  });
}
