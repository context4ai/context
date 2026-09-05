import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { digestText } from "@c4a/agent-graph";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { ReviewCandidateView } from "./reviewShared.js";

const REVIEW_BATCH_MAX_CANDIDATES = 6;
const REVIEW_BATCH_MAX_BYTES = 512 * 1024;

export interface CurrentReviewBatchDocument {
  task_key: string;
  candidate_count: number;
  content: string;
  digest: string;
}

function renderReviewCandidate(candidate: ReviewCandidateView, index: number): string {
  const record = candidate.record;
  return [
    `## ${index + 1}. ${record.review.title}`,
    "",
    `Collection: ${record.collection}`,
    `Module: ${record.module}`,
    "",
    record.review.behavior_summary ?? record.review.summary,
    "",
    ...record.indexer_candidate.sections.flatMap((section) => [
      `### ${section.section_key}`,
      "",
      section.markdown,
      "",
    ]),
  ].join("\n").trimEnd();
}

const SEMANTIC_REVIEW_CHECKLIST = [
  "For code knowledge, verify an external consumer can find the responsibility, public entry or interface, important constraints, and the next owning module without reading an internal symbol dump.",
  "Verify behavior and ownership claims are attributed to the module that actually implements or guarantees them; supporting tests, styles, examples, and helpers must not be presented as independent public contracts.",
  "For document knowledge, preserve the useful rules, conditions, examples, compatibility notes, and uncertainty needed by the stated reader task.",
  "Reject placeholder prose, unexpanded template instructions, generic directory summaries, and pages that only point the reader back to source material.",
] as const;

function candidateOrder(
  left: ReviewCandidateView,
  right: ReviewCandidateView,
): number {
  return left.record.collection.localeCompare(right.record.collection) ||
    left.record.path.localeCompare(right.record.path) ||
    left.record.candidate_id.localeCompare(right.record.candidate_id);
}

export function buildCurrentReviewBatchDocuments(
  candidates: readonly ReviewCandidateView[],
): CurrentReviewBatchDocument[] {
  const ordered = [...candidates].sort(candidateOrder);
  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const [index, candidate] of ordered.entries()) {
    const rendered = renderReviewCandidate(candidate, index);
    const renderedBytes = Buffer.byteLength(rendered, "utf8");
    if (
      current.length > 0 &&
      (current.length >= REVIEW_BATCH_MAX_CANDIDATES ||
        currentBytes + renderedBytes > REVIEW_BATCH_MAX_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(rendered);
    currentBytes += renderedBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches.map((items, index) => {
    const content = [
      `# Current knowledge candidates — batch ${index + 1} of ${batches.length}`,
      "",
      "Read every candidate below as reader-facing knowledge.",
      "Judge content usefulness, correctness, scope, and readability; technical evidence identifiers are intentionally omitted.",
      "Do not approve the overall Review until every listed batch has been read.",
      "",
      "## Semantic Review checklist",
      "",
      ...SEMANTIC_REVIEW_CHECKLIST.map((item) => `- ${item}`),
      "",
      ...items,
      "",
    ].join("\n");
    return {
      task_key: `review-${String(index + 1).padStart(3, "0")}`,
      candidate_count: items.length,
      content,
      digest: digestText(content),
    };
  });
}

export async function materializeCurrentReviewBatchSet(input: {
  projectRoot: string;
  candidates: readonly ReviewCandidateView[];
}): Promise<{
  content: string;
  digest: string;
  path: string;
  batch_count: number;
}> {
  const batches = buildCurrentReviewBatchDocuments(input.candidates);
  const setDigest = digestText(batches.map((batch) =>
    `${batch.task_key}:${batch.digest}`
  ).join("\n"));
  const root = join(
    input.projectRoot,
    ".tmp",
    "context-runtime",
    "review",
    `current-${setDigest.slice("sha256:".length)}`,
  );
  await mkdir(root, { recursive: true });
  const entries = [];
  for (const batch of batches) {
    const path = join(root, `${batch.task_key}.md`);
    await atomicWriteFile(path, batch.content);
    entries.push({ ...batch, path });
  }
  const content = [
    "# Current knowledge Review",
    "",
    `Candidates: ${input.candidates.length}`,
    `Reader-facing batches: ${entries.length}`,
    "",
    "Read every batch file below. Keep decisions in the current Agent context.",
    "Only after every batch is acceptable, run the single approval command returned by the Route.",
    "If any Candidate needs repair, do not approve any batch; reopen its owning Author or Composer.",
    "",
    ...entries.flatMap((entry) => [
      `## ${entry.task_key}`,
      "",
      `- Candidates: ${entry.candidate_count}`,
      `- File: ${entry.path}`,
      "",
    ]),
  ].join("\n");
  const digest = digestText(content);
  const path = join(root, "index.md");
  await atomicWriteFile(path, `${content}\n`);
  return {
    content,
    digest,
    path,
    batch_count: entries.length,
  };
}
