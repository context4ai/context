import { canonicalIndexerJson } from "@c4a/context";
import { readApprovedRevision } from "./approvedRevision.js";
import { observeApprovedRevisionBatch } from "./approvedRevisionBatch.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { CandidateRecord } from "./candidateLedger.js";
import { readProductionReviewCandidates, readAcceptedProductionCandidates } from "./productionReviewCandidates.js";
import { withProductionFeedback } from "./productionFeedback.js";

export type ReviewCandidateAuthority = ReadonlyMap<string, CandidateRecord>;

/** Only current accepted work can authorize Review; retired compile files cannot. */
export async function loadReviewCandidateAuthority(projectRoot: string, purpose: "review" | "navigation" = "review"): Promise<ReviewCandidateAuthority> {
  return withProductionFeedback({ operation: "review" }, async () => {
    const revision = await readApprovedRevision(projectRoot);
    // An independent revision suspends retained production, just as it does
    // for Author dispatch. Its candidates must be reviewed by that revision.
    if (!revision) {
      const production = purpose === "navigation"
        ? await readAcceptedProductionCandidates(projectRoot) : await readProductionReviewCandidates(projectRoot);
      if (production) return new Map(production.candidates.map(candidate => [candidate.candidate_id, candidate]));
      if (purpose === "navigation") return new Map();
      throw new TypeError("No current production or article revision is available for Review");
    }
    if (!revision.review_ready && !revision.candidate) {
      if (purpose === "navigation") return new Map();
      throw candidateStateError("revision-candidates-not-ready", "Complete the current article revision before Review");
    }
    const observed = await observeApprovedRevisionBatch(projectRoot, revision);
    if (observed.state !== "current") throw candidateStateError("revision-candidates-stale", "Revision batch is not current; refresh the current revision before binding or reviewing candidates");
    const candidates = purpose === "navigation" ? observed.candidates
      : [...(revision.batch_candidates ?? []), ...(revision.candidate ? [revision.candidate] : [])];
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

function candidateStateError(reason_code: string, message: string) {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    reason_code, next_action: { command: "context status --format json", message: "Follow the current revision action; do not approve content to repair navigation." },
  });
}
