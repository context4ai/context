import { join } from "node:path";

export const LIFECYCLE_ROOT = join(".tmp", "context-runtime", "lifecycle");
export const CANDIDATE_LEDGER_FILE = join(LIFECYCLE_ROOT, "candidates.jsonl");
export const LIFECYCLE_STRUCTURE_FILE = join(LIFECYCLE_ROOT, "structure.yaml");
export const STRUCTURE_SLOT_FILE = join(LIFECYCLE_ROOT, "structure-slots.yaml");
export const STRUCTURE_SNAPSHOT_ROOT = join(LIFECYCLE_ROOT, "structures");
export const REVIEW_RUNTIME_ROOT = join(".tmp", "context-runtime", "review");
export const REVIEW_ACTION_ROOT = join(".tmp", "context-runtime", "review-actions");
export const STRUCTURE_REPORT_ROOT = join(".tmp", "context-runtime", "reports");
export const CANDIDATE_SNAPSHOT_ROOT = join(".tmp", "context-runtime", "extract", "candidates");
