import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readProductionStage } from "./productionStageStore.js";
import { dispatchProductionStage, productionCapabilitiesSchema } from "./productionStage.js";
import { assertRequiredArticlesReviewed } from "./indexerRequiredArticleReview.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readProjectCloseStatus } from "./close.js";
import { clearCompletedProduction } from "./productionCleanup.js";
import { APPROVED_REVISION_PATH } from "./maintenanceStorage.js";
import {
  CANDIDATE_SNAPSHOT_ROOT,
  INDEXER_RUNTIME_ROOT,
  LIFECYCLE_ROOT,
  REVIEW_ACTION_ROOT,
  REVIEW_RUNTIME_ROOT,
  STRUCTURE_REPORT_ROOT,
} from "./lifecyclePaths.js";

const COMPLETED_RUNTIME_PATHS = [
  LIFECYCLE_ROOT,
  REVIEW_RUNTIME_ROOT,
  REVIEW_ACTION_ROOT,
  STRUCTURE_REPORT_ROOT,
  CANDIDATE_SNAPSHOT_ROOT,
  INDEXER_RUNTIME_ROOT,
] as const;

export async function clearCompletedLifecycle(projectRoot: string): Promise<void> {
  const production = await readProductionStage(projectRoot);
  if (production) {
    if (production.delivery) throw new TypeError("Partial delivery must retain the production stage and its unfinished tasks; finish the build or explicitly resume writing.");
    // Review of an interrupting revision does not authorize deleting production.
    // Enforce this at the deletion boundary, regardless of the caller's owner.
    if (dispatchProductionStage(production, productionCapabilitiesSchema.parse({})).state !== "ended") {
      throw new TypeError("Production still has unfinished work; keep its files and follow context status --format json.");
    }
    const candidates = await readCandidateRecords(projectRoot);
    await assertRequiredArticlesReviewed(projectRoot, candidates);
    if (candidates.some(candidate => candidate.status === "draft") || (await readProjectCloseStatus(projectRoot)).state !== "ready") {
      throw new TypeError("Review and close must complete before production cleanup; run context status --format json");
    }
  }
  // Keep the current compile/revision/rollback pointer until every other task
  // artifact has been removed. A failed cleanup must still block a new task.
  for (const path of COMPLETED_RUNTIME_PATHS) {
    if (path !== INDEXER_RUNTIME_ROOT) await rm(join(projectRoot, path), { recursive: true, force: true });
  }
  const indexer = join(projectRoot, INDEXER_RUNTIME_ROOT);
  const entries = await readdir(indexer).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of entries) if (name !== "candidate-compile") {
    await rm(join(indexer, name), { recursive: true, force: true });
  }
  const compile = join(indexer, "candidate-compile");
  const compiled = await readdir(compile).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of compiled) if (name !== "current.json") {
    await rm(join(compile, name), { recursive: true, force: true });
  }
  await rm(join(compile, "current.json"), { force: true });
  // Empty directory removal is cosmetic; no task state remains at this point.
  await rm(indexer, { recursive: true, force: true });
  await rm(join(projectRoot, APPROVED_REVISION_PATH), { force: true });
  if (production) await clearCompletedProduction(projectRoot, production);
}
