import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { digestText } from "@c4a/agent-graph";
import { atomicWriteFile } from "../lib/atomicWrite.js";

import { REVIEW_PAYLOAD_SCHEMA, candidateIdsHash, candidateSetHash, type ReviewCandidateView } from "./reviewShared.js";

const REVIEW_BATCH_MAX_CANDIDATES = 6;
const REVIEW_BATCH_MAX_BYTES = 512 * 1024;

export interface CurrentReviewBatchDocument {
  task_key: string;
  candidate_count: number;
  content: string;
  digest: string;
}

async function readerPurposes(projectRoot: string, owners: ReadonlySet<string>): Promise<string[]> {
  try {
    const loaded = await loadIndexerRegistry(projectRoot);
    const required = new Set(loaded.registry.indexers.filter((indexer) => owners.has(indexer.id))
      .flatMap((indexer) => indexer.requirement_bindings.map((binding) => binding.requirement_ref)));
    return loaded.registry.requirements.filter((requirement) => required.has(requirement.id)).map((requirement) =>
      `- ${requirement.id}: ${requirement.purpose ?? requirement.reader_goals.join(", ")}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function renderReviewCandidate(candidate: ReviewCandidateView, index: number): string {
  const record = candidate.record;
  return [
    `## ${index + 1}. ${record.review.title}`,
    "",
    `Collection: ${record.collection}`,
    `Module: ${record.module}`,
    `Page: ${record.path}`,
    `Candidate: ${record.candidate_id}`,
    `Repair: context revise '${record.candidate_id.replace(/'/gu, "'\\''")}' --instruction '<describe the correction>' --format json`,
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
  "Use the bound reader purpose: integration pages explain imports, usage and contracts; maintenance pages explain relevant state, failure and change boundaries. Public interface tables are useful reference material. Do not turn all knowledge into implementation audits or omit behavior needed by maintainers.",
  "Verify behavior and ownership claims are attributed to the module that actually implements or guarantees them; supporting tests, styles, examples, and helpers must not be presented as independent public contracts.",
  "For document knowledge, preserve the useful rules, conditions, examples, compatibility notes, and uncertainty needed by the stated reader task.",
  "Check that page paths and directory names identify the reader subject, not opaque capture IDs or repeated directory/basename tokens. A readable title alone does not make a path readable. Naming is a review judgement, not a content hard gate.",
  "Consider unfilled authoring placeholders and missing explanations as review hints, not automatic rejection reasons. Judge the reader's actual need; placeholder features, TODO documentation, JSX, template syntax and comments can be legitimate knowledge. Context does not scan prose to determine content quality.",
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
    // Unchanged reading retains its file address across preview revisions.
    // File existence means previously delivered material, not reviewed content.
    const path = join(input.projectRoot, ".tmp", "context-runtime", "review",
      `${batch.task_key}-${batch.digest.slice("sha256:".length)}.md`);
    const existing = await readFile(path, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    const unchanged = existing === batch.content;
    if (!unchanged) await atomicWriteFile(path, batch.content);
    entries.push({ ...batch, path, unchanged });
  }
  const content = [
    "# Current knowledge Review",
    "",
    "## Reader purposes",
    "",
    ...await readerPurposes(input.projectRoot, new Set(input.candidates.map((candidate) => candidate.record.module))),
    "",
    `Candidates: ${input.candidates.length}`,
    `Reader-facing batches: ${entries.length}`,
    "",
    "Review every candidate for usefulness, correctness, scope, and readability. Keep decisions in the current Agent context.",
    "On the first review, read all batch files below. After a revision, recheck changed pages and any conclusions affected by them; reuse the review of unchanged pages when it is still available in this conversation. If that review context was lost, read those pages again.",
    "Batch files are reading material, not separate CLI steps. They need no per-batch read receipts or approval commands.",
    "The material note below only compares delivered previews, not approval or reading history. Reuse an unchanged batch only if its content review is still in this conversation; a new reviewer must read it.",
    "Apply only decisions for pages actually reviewed. Keep undecided or repair pages out of decisions; do not set default unless every page has that decision. Omit remains a durable exclusion, never a request to repair.",
    "Save the following current scope in a temporary JSON input file and add decisions as {candidate_id, status: approved|rejected}; use that file in the Route command. Applied pages survive later repairs of other pages.",
    "```json", JSON.stringify({ schema: REVIEW_PAYLOAD_SCHEMA, scope: { kind: "all", count: input.candidates.length,
      ids_sha256: candidateIdsHash(input.candidates.map(item => item.record.candidate_id).sort()),
      candidates_sha256: candidateSetHash(input.candidates.map(item => item.record)),
      visible_candidate_ids: input.candidates.map(item => item.record.candidate_id).sort() }, decisions: [] }, null, 2), "```",
    "For a page needing changes use its Repair command. Approval alone does not request one build per page; ask for early delivery only when the user wants the independently publishable approved pages now.",
    "",
    "## Semantic Review checklist",
    "",
    ...SEMANTIC_REVIEW_CHECKLIST.map((item) => `- ${item}`),
    "",
    ...entries.flatMap((entry) => [
      `## ${entry.task_key}`,
      "",
      `- Candidates: ${entry.candidate_count}`,
      `- File: ${entry.path}`,
      `- Material: ${entry.unchanged ? "unchanged from an earlier preview" : "new or changed preview"}`,
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
