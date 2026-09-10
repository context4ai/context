import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { readCandidateRecords } from "./candidateLedger.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction, safeProjectTarget } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

// Historical duplicate of Candidate status; never write new decisions here.
export const LEGACY_REVIEW_DECISIONS_FILE = join("knowledge", "decisions.json");

export async function readRejectedDecisions(projectRoot: string): Promise<Map<string, string>> {
  return new Map((await readCandidateRecords(projectRoot))
    .filter(record => record.status === "rejected")
    .map(record => [record.candidate_id, record.fingerprint]));
}

export async function removeLegacyReviewDecisions(projectRoot: string): Promise<void> {
  await withProjectWriteLock(projectRoot, "remove-legacy-review-decisions", async () => {
    await safeProjectTarget(projectRoot, LEGACY_REVIEW_DECISIONS_FILE);
    let content: string;
    try { content = await readFile(join(projectRoot, LEGACY_REVIEW_DECISIONS_FILE), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const base = durableContentDigest(content);
    await runDurableMultiFileTransaction({ projectRoot, kind: "remove-legacy-review-decisions",
      proposal_digest: indexerProtocolDigest({ base }), targets: [{
        path: LEGACY_REVIEW_DECISIONS_FILE, operation: "delete", base_digest: base, target_digest: null,
      }] });
  });
}
