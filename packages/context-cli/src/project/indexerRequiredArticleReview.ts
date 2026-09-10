import { indexerArtifactResultSchema, indexerLayoutArtifactRef, type IndexerArticlePlan } from "@c4a/context";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import type { CandidateRecord } from "./candidateLedger.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

/** Review may reject prose, but rejection alone does not cancel a required
 * article in the accepted plan. Keep the Author available for repair. */
export async function assertRequiredArticlesReviewed(root: string, candidates: readonly CandidateRecord[]): Promise<void> {
  const rejected = candidates.filter(candidate => candidate.status === "rejected" && candidate.indexer_candidate);
  if (!rejected.length) return;
  const ledger = await currentLedger(root);
  // Legacy approved-page revision does not carry an Indexer article plan.
  if (!ledger || ledger.entries.some(entry => entry.stage !== "author")) return;
  const records = await readAcceptedIndexerMainAuthorResultRecords(root);
  const required = new Set<string>();
  for (const record of records) {
    const plan = record.validation.page_plan as { articles?: IndexerArticlePlan[] } | undefined;
    if (!plan?.articles) continue;
    const ids = new Set(plan.articles.filter(article => article.required).map(article => article.key));
    const result = indexerArtifactResultSchema.parse(record.artifact_result);
    for (const artifact of result.artifacts) {
      if (ids.has(artifact.artifact_id)) required.add(indexerLayoutArtifactRef(result.logical_unit.logical_unit_ref, artifact));
    }
  }
  const missing = rejected.filter(candidate => required.has(candidate.indexer_candidate!.artifact_ref));
  if (!missing.length) return;
  const path = missing[0]!.path;
  const quoted = `'${path.replaceAll("'", "'\\''")}'`;
  throw new ContextError(ExitCode.WorkspaceStateError, "Required articles remain rejected; their accepted responsibilities are still pending.", {
    category: ErrorCategory.WorkspaceStateInvalid,
    reason_code: "required-articles-need-repair",
    paths: missing.map(candidate => candidate.path),
    next: "Revise the rejected article using Review feedback, or explicitly revise the accepted article plan before removing its responsibility. Previously approved knowledge remains available.",
    next_action: { command: `context revise ${quoted} --instruction 'Address the Review feedback for this required article.'` },
  });
}
