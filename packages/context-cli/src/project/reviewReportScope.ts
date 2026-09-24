import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeCollection } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { candidateIdsHash, candidateSetHash, type ReviewCandidateView, type ReviewPayloadScope } from "./reviewShared.js";

interface ReportScope { scope: ReviewPayloadScope; baseline_hash: string }

const scopePath = (root: string, scope: KnowledgeCollection | "all") =>
  join(root, ".tmp/context-runtime/review", `${scope}.scope.json`);

/** Generated alongside the report; it is a scope snapshot, never a read receipt. */
export async function saveReviewReportScope(
  root: string, scope: KnowledgeCollection | "all", candidates: readonly ReviewCandidateView[], baselineHash: string,
): Promise<void> {
  const ids = candidates.map(candidate => candidate.record.candidate_id).sort();
  const value: ReportScope = {
    baseline_hash: baselineHash,
    scope: {
      kind: scope === "all" ? "all" : "collection",
      ...(scope === "all" ? {} : { collection: scope }),
      count: ids.length,
      ids_sha256: candidateIdsHash(ids),
      candidates_sha256: candidateSetHash(candidates.map(candidate => candidate.record)),
      visible_candidate_ids: ids,
    },
  };
  await atomicWriteFile(scopePath(root, scope), JSON.stringify(value, null, 2) + "\n");
}

export async function readConfirmedReviewScope(root: string, scope: KnowledgeCollection | "all"): Promise<ReportScope> {
  try {
    const value: unknown = JSON.parse(await readFile(scopePath(root, scope), "utf8"));
    if (!value || typeof value !== "object" || !("scope" in value) || !("baseline_hash" in value)) throw new Error("Missing report scope");
    const parsed = value as ReportScope;
    if (typeof parsed.baseline_hash !== "string" || !/^[a-f0-9]{64}$/u.test(parsed.baseline_hash) ||
      !parsed.scope || !Number.isInteger(parsed.scope.count) || parsed.scope.count < 0 ||
      typeof parsed.scope.ids_sha256 !== "string" || typeof parsed.scope.candidates_sha256 !== "string" ||
      !Array.isArray(parsed.scope.visible_candidate_ids) ||
      parsed.scope.visible_candidate_ids.some(id => typeof id !== "string") ||
      (scope === "all" ? parsed.scope.kind !== "all" : parsed.scope.kind !== "collection" || parsed.scope.collection !== scope)) {
      throw new Error("Invalid report scope");
    }
    return parsed;
  } catch (error) {
    throw new ContextError(ExitCode.UserError, "A current report scope is required for user confirmation", {
      category: ErrorCategory.UserInputInvalid,
      reason: error instanceof Error ? error.message : String(error),
      next: `context review html ${scope === "all" ? "--all" : scope} --format json`,
    });
  }
}
