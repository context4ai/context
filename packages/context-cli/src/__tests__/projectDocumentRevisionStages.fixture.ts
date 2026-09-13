import type { readCandidateRecords } from "../project/candidateLedger.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";

/** Explicit fixture feedback through the actual current Review transaction. */
export async function approveCandidates(root: string, candidates: Awaited<ReturnType<typeof readCandidateRecords>>): Promise<void> {
  for (const collection of new Set(candidates.map(candidate => candidate.collection))) {
    const selected = candidates.filter(candidate => candidate.collection === collection);
    await applyReviewDecisions({ projectRoot: root, payload: {
      collection, scope: { kind: "collection", collection, count: selected.length,
        ids_sha256: candidateIdsHash(selected.map(candidate => candidate.candidate_id).sort()),
        candidates_sha256: candidateSetHash(selected) },
      decisions: selected.map(candidate => ({ candidate_id: candidate.candidate_id, status: "approved" as const })),
    } });
  }
}
