import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CANDIDATE_SNAPSHOT_ROOT,
  INDEXER_WORKSET_VIEW_RUNTIME_ROOT,
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
  INDEXER_WORKSET_VIEW_RUNTIME_ROOT,
] as const;

export async function clearCompletedLifecycle(projectRoot: string): Promise<void> {
  await Promise.all(COMPLETED_RUNTIME_PATHS.map((path) =>
    rm(join(projectRoot, path), { recursive: true, force: true })
  ));
}
