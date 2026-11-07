import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { indexerProtocolDigest, validateArticleStructureEntries } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readApprovedRevision, type ApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

export const mechanicalFixInputSchema = z.object({
  path: z.string().min(1),
  reason: z.string().trim().min(1),
}).strict();
const recordSchema = z.object({ batch: z.string(),
  fixes: z.array(z.object({ path: z.string(), reason: z.string(), digest: z.string(), recorded_at: z.string() }).strict()) }).strict();
/** Kept beside the Review report; the next batch replaces it. */
export const MECHANICAL_FIXES_FILE = ".tmp/context-runtime/review/mechanical-fixes.json";

/** Stable for a batch once Review approved it: its accepted Candidates. */
function batchId(request: ApprovedRevision): string {
  return indexerProtocolDigest([...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])]
    .map(candidate => candidate.candidate_id).sort());
}

async function readRecord(root: string) {
  try { return recordSchema.parse(JSON.parse(await readFile(join(root, MECHANICAL_FIXES_FILE), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** After approval and before delivery finishes, the Agent may apply a
 * mechanical correction the revision caused (links, anchors, labels, format)
 * without another Review. The Agent judges that; the CLI records its reason. */
export async function recordMechanicalFix(root: string, value: unknown) {
  const input = mechanicalFixInputSchema.parse(value);
  const path = input.path.replace(/^\.\//u, "").replace(/^knowledge\//u, "");
  return withProjectWriteLock(root, "record-mechanical-fix", async () => {
    const request = await readApprovedRevision(root);
    const { joinableRevisionBatch } = await import("./revisionBatchJoin.js");
    const batch = request ? await joinableRevisionBatch(root) : undefined;
    if (!request || !batch || batch.joinable || batch.reason !== "batch-approved") {
      throw new ContextError(ExitCode.WorkspaceStateError, batch?.joinable
        ? "The batch is not approved yet. Revise the page through the batch so Review covers it."
        : "No approved batch is waiting for delivery. Changes now start a new batch.", {
        category: ErrorCategory.WorkspaceStateInvalid, reason_code: batch?.joinable ? "mechanical-fix-before-approval" : "mechanical-fix-no-open-delivery",
        next_action: { command: batch?.joinable ? `context revise '${path.replace(/'/gu, "'\\''")}' --instruction <fix> --format json` : "context task maintain --input <request.yaml> --format json" },
      });
    }
    const articles = validateArticleStructureEntries((await readKnowledgeStructure(root)).parsed?.articles ?? []);
    if (!articles.some(article => article.path === path)) throw new ContextError(ExitCode.UserError,
      `Mechanical fixes apply to approved pages: ${input.path}`, { category: ErrorCategory.UserInputInvalid });
    // A page drafted in this batch must have its own draft approved; a fix
    // never stands in for a rejected or unreviewed draft.
    const drafted = [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])].find(candidate => candidate.path === path);
    if (drafted && (await readCandidateRecords(root)).some(row => row.candidate_id === drafted.candidate_id)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "This page's draft in the batch is not approved; revise the draft through Review instead.", {
        category: ErrorCategory.WorkspaceStateInvalid, reason_code: "mechanical-fix-draft-not-approved",
        next_action: { command: `context revise '${path.replace(/'/gu, "'\\''")}' --instruction <fix> --format json` } });
    }
    const bytes = await readFile(join(root, "knowledge", path), "utf8");
    const id = batchId(request);
    const previous = await readRecord(root);
    const fixes = previous?.batch === id ? previous.fixes.filter(fix => fix.path !== path) : [];
    fixes.push({ path, reason: input.reason, digest: durableContentDigest(bytes), recorded_at: new Date().toISOString() });
    await atomicWriteFile(join(root, MECHANICAL_FIXES_FILE), `${JSON.stringify({ batch: id, fixes }, null, 2)}\n`);
    return { outcome: "recorded", path, record: MECHANICAL_FIXES_FILE, fixes: fixes.length,
      message: "Recorded with this batch. The fix stays outside Review; report it to the user with the batch result.",
      next_action: { command: "context status --format json" } };
  });
}

/** A batch page edited after approval still counts as delivered when the
 * recorded fix matches its current bytes. */
export async function recordedMechanicalFix(root: string, request: ApprovedRevision, path: string, bytes: string): Promise<boolean> {
  // Only after the page's own draft left the ledger by approval.
  const drafted = [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])].find(candidate => candidate.path === path);
  if (drafted && (await readCandidateRecords(root)).some(row => row.candidate_id === drafted.candidate_id)) return false;
  const record = await readRecord(root);
  return record?.batch === batchId(request) && record.fixes.some(fix => fix.path === path && fix.digest === durableContentDigest(bytes));
}
