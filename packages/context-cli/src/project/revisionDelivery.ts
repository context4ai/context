import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { LIFECYCLE_ROOT } from "./lifecyclePaths.js";
import { withProjectWriteLock } from "./writeLock.js";
import { selectPartialDelivery } from "./partialDelivery.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { readCandidateRecords } from "./candidateLedger.js";

const FILE = join(LIFECYCLE_ROOT, "revision-delivery.json");
const stateSchema = z.object({
  partial: z.object({ kind: z.literal("revision"),
    paths: z.array(z.string().startsWith("knowledge/")).min(1), refs: z.array(z.string()).min(1) }).strict(),
  closed: z.boolean(),
}).strict();
type RevisionDelivery = z.infer<typeof stateSchema>;

/** A current revision checkpoint, never an old Indexer delivery ledger. */
export async function readRevisionDelivery(root: string): Promise<RevisionDelivery | undefined> {
  try { return stateSchema.parse(JSON.parse(await readFile(join(root, FILE), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export function requestRevisionDelivery(root: string) {
  return withProjectWriteLock(root, "request-revision-delivery", async () => {
    const partial = await selectPartialDelivery(root);
    if (partial) {
      await atomicWriteFile(join(root, FILE), JSON.stringify(stateSchema.parse({ partial, closed: false })) + "\n");
      return;
    }
    if (await readApprovedRevision(root) || (await readCandidateRecords(root)).some(candidate => candidate.status === "draft")) return;
    throw new ContextError(ExitCode.WorkspaceStateError, "No active production or revision is available for delivery.", {
      category: ErrorCategory.WorkspaceStateInvalid, reason_code: "no-active-delivery",
      next_action: { command: "context status --format json" },
    });
  });
}

export function closeRevisionDelivery(root: string) {
  return withProjectWriteLock(root, "close-revision-delivery", async () => {
    const state = await readRevisionDelivery(root);
    if (!state) return false;
    await atomicWriteFile(join(root, FILE), JSON.stringify({ ...state, closed: true }) + "\n");
    return true;
  });
}

/** Only successful package builds settle the checkpoint. Pending revisions
 * and candidates remain intact, and failed builds retain this temporary file. */
export function completeRevisionDelivery(root: string) {
  return withProjectWriteLock(root, "complete-revision-delivery", async () => {
    if ((await readRevisionDelivery(root))?.closed) await rm(join(root, FILE), { force: true });
  });
}
