import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewCandidateView } from "./reviewShared.js";

export interface PendingReviewFeedback { candidate_id: string; path: string; instruction: string; command: string }

/** Recover only feedback still bound to the unchanged pending candidate. */
export async function readPendingReviewFeedback(root: string, candidates: readonly ReviewCandidateView[]): Promise<PendingReviewFeedback[]> {
  const directory = join(root, ".tmp/context-runtime/review-feedback");
  let files: string[];
  try { files = await readdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const pending = new Map(candidates.map(c => [c.record.candidate_id, c.record.fingerprint]));
  const results = new Map<string, PendingReviewFeedback>();
  const receipts = [];
  for (const file of files.filter(f => /^[a-f0-9]+\.json$/u.test(f)).sort()) {
    const receipt = JSON.parse(await readFile(join(directory, file), "utf8")) as {
      created_at: string; repairs: Array<{ candidate_id: string; fingerprint: string; path: string; instruction: string; command: string }> };
    receipts.push(receipt);
  }
  for (const receipt of receipts.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    for (const repair of receipt.repairs) if (pending.get(repair.candidate_id) === repair.fingerprint)
      results.set(repair.candidate_id, { candidate_id: repair.candidate_id, path: repair.path, instruction: repair.instruction, command: repair.command });
  }
  return [...results.values()];
}
