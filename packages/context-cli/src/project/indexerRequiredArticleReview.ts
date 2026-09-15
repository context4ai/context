import { indexerArtifactResultSchema, indexerLayoutArtifactRef, type IndexerArticlePlan } from "@c4a/context";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import type { CandidateRecord } from "./candidateLedger.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readProductionStage, productionStageDirectory } from "./productionStageStore.js";
import { dispatchProductionStage, productionCapabilitiesSchema } from "./productionStage.js";
import { productionAgentDirectory } from "./productionSubmissionFiles.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { readApprovedRevision } from "./approvedRevision.js";

/** Review may reject prose, but rejection alone does not cancel a required
 * article in the accepted plan. Keep the Author available for repair. */
export async function assertRequiredArticlesReviewed(root: string, candidates: readonly CandidateRecord[]): Promise<void> {
  // Maintenance has its own revision/Review authority; it cannot settle the
  // suspended production stage. Build completion keeps that stage intact.
  if ((await readMaintenance(root)).active || await readApprovedRevision(root)) return;
  const rejected = candidates.filter(candidate => candidate.status === "rejected" && candidate.indexer_candidate);
  const production = await readProductionStage(root);
  if (production) {
    await assertProductionPlanRequirementsCurrent(root, production);
    if (production.delivery) {
      const { assertProductionDeliveryReady } = await import("./productionDelivery.js");
      await assertProductionDeliveryReady(root);
      return;
    }
    if (dispatchProductionStage(production, productionCapabilitiesSchema.parse({})).state !== "ended") {
      throw new ContextError(ExitCode.WorkspaceStateError, "Production still has unfinished tasks, investigation or report confirmation; close cannot finish them.", {
        category: ErrorCategory.WorkspaceStateInvalid, reason_code: "production-not-complete",
        next_action: { command: "context status --format json" },
      });
    }
    if (rejected.length) throw new ContextError(ExitCode.WorkspaceStateError,
      "Planned articles remain rejected. Add revision tasks using the Review feedback before closing this production stage.", {
        category: ErrorCategory.WorkspaceStateInvalid, reason_code: "production-articles-need-repair",
        paths: rejected.map(candidate => candidate.path),
        next_action: { command: `context action complete-current --revision ${production.id} --input ${productionAgentDirectory(production.id)}/submissions/plan-amendment.yaml --format json` },
        input_schema: { path: `${productionStageDirectory(production.id)}/planning.schema.json` },
      });
    return;
  }
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
