import { dirname } from "node:path";
import type { ReviewCandidateView } from "./reviewShared.js";

export function candidatePreview(candidate: ReviewCandidateView): string {
  if (candidate.snapshot === undefined) {
    return "Evidence unavailable. Restore the committed snapshot before approving this candidate.";
  }
  const markdown = candidate.snapshot.markdown ?? candidate.record.review.summary;
  return markdown.trim().slice(0, 1200);
}

export function candidateGroupKey(candidate: ReviewCandidateView): string {
  const path = candidate.record.indexer_candidate.evidence_bindings[0]?.locator.path;
  const group = path === undefined ? candidate.record.kind : dirname(path).split("\\").join("/");
  return `${candidate.record.module} / ${group === "." ? candidate.record.kind : group}`;
}

export function candidateGroupLabel(candidate: ReviewCandidateView): string {
  const path = candidate.record.indexer_candidate.evidence_bindings[0]?.locator.path;
  const group = path === undefined ? candidate.record.kind : dirname(path).split("\\").join("/");
  return group === "."
    ? candidate.record.module
    : `${candidate.record.module} · ${group}`;
}
