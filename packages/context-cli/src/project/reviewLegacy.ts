import { readCandidateRecords } from "./candidateLedger.js";
import { createReviewCodeCodec } from "./reviewCode.js";
import { createReviewFeedbackCodec } from "./reviewFeedbackCode.js";
import { assertCollection, type ReviewPayload } from "./reviewShared.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

export function warnLegacyReview(entry: string): void {
  process.stderr.write(`[context] ${entry} is accepted for compatibility. 新版审核页无需审核码；直接回复确认或修订意见。Agent 在用户确认后使用 context review approve-all [collection] --confirmed（跨集合加 --all）；修订意见通过当前范围 JSON 提交。\n`);
}

/** Translate legacy input, preserving its decisions and fingerprints for atomic validation. */
export async function readLegacyReviewPayload(raw: string, projectRoot: string): Promise<ReviewPayload> {
  warnLegacyReview("Legacy review input");
  try {
    const feedback = raw.trim().startsWith("CR2.") ? createReviewFeedbackCodec().decode(raw) : undefined;
    const decoded = feedback ?? createReviewCodeCodec().decode(raw);
    const collection = decoded.scope === "all" ? undefined : assertCollection(decoded.scope);
    const rows = (await readCandidateRecords(projectRoot))
      .filter(row => row.status === "draft" && (collection === undefined || row.collection === collection))
      .sort((a, b) => a.candidate_id < b.candidate_id ? -1 : a.candidate_id > b.candidate_id ? 1 : 0);
    return {
      ...(collection === undefined ? {} : { collection }),
      ...(feedback === undefined ? {} : { baseline_hash: feedback.baselineHash }),
      scope: {
        kind: collection === undefined ? "all" : "collection",
        ...(collection === undefined ? {} : { collection }),
        count: decoded.statuses.length, ids_sha256: decoded.idsHash, candidates_sha256: decoded.contentHash,
        visible_candidate_ids: rows.map(row => row.candidate_id),
      },
      decisions: rows.flatMap((row, index) => {
        const status = decoded.statuses[index];
        return status === "approved" || status === "rejected" ? [{ candidate_id: row.candidate_id, status }] : [];
      }),
      repairs: (feedback?.repairs ?? []).map(repair => ({
        candidate_id: rows[repair.index]?.candidate_id ?? "legacy-stale-candidate", instruction: repair.instruction,
      })),
    };
  } catch (error) {
    throw new ContextError(ExitCode.UserError, error instanceof Error ? error.message : String(error), {
      category: ErrorCategory.UserInputInvalid,
      next: "No new code is needed. Return confirmation or revision notes in the conversation; use the current report scope.",
    });
  }
}
