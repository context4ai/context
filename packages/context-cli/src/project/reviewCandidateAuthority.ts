import { canonicalIndexerJson } from "@c4a/context";
import { readApprovedRevision } from "./approvedRevision.js";
import { observeApprovedRevisionBatch } from "./approvedRevisionBatch.js";
import type { CandidateRecord } from "./candidateLedger.js";
import { readProductionReviewCandidates } from "./productionReviewCandidates.js";
import { withProductionFeedback } from "./productionFeedback.js";

export type ReviewCandidateAuthority = ReadonlyMap<string, CandidateRecord>;

/** Only current accepted work can authorize Review; retired compile files cannot. */
export async function loadReviewCandidateAuthority(projectRoot: string): Promise<ReviewCandidateAuthority> {
  return withProductionFeedback({ operation: "review" }, async () => {
    const production = await readProductionReviewCandidates(projectRoot);
    if (production) return new Map(production.candidates.map(candidate => [candidate.candidate_id, candidate]));
    const revision = await readApprovedRevision(projectRoot);
    if (!revision) throw new TypeError("No current production or article revision is available for Review");
    if (!revision.review_ready && !revision.candidate) throw new TypeError("Complete the current article revision before Review");
    const observed = await observeApprovedRevisionBatch(projectRoot, revision);
    if (observed.state !== "current") throw new TypeError("Revision batch is not current for Review");
    const candidates = [...(revision.batch_candidates ?? []), ...(revision.candidate ? [revision.candidate] : [])];
    return new Map(candidates.map(candidate => [candidate.candidate_id, candidate]));
  });
}

export function assertReviewCandidateCurrent(input: {
  index: ReviewCandidateAuthority;
  record: CandidateRecord;
}): void {
  const expected = input.index.get(input.record.candidate_id);
  if (!expected || canonicalIndexerJson({ ...input.record, status: "draft", updated: expected.updated }) !== canonicalIndexerJson(expected)) {
    throw new TypeError("Candidate is not part of the current accepted work; refresh Review before approving it");
  }
}
