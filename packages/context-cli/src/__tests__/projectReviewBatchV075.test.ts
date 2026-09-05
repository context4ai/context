import { describe, expect, test } from "bun:test";
import type { CandidateRecord } from "../project/candidateLedger.js";
import { buildCurrentReviewBatchDocuments } from
  "../project/reviewCurrentResource.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

function candidate(index: number): CandidateRecord {
  const key = String(index).padStart(2, "0");
  return {
    candidate_id: `indexer/${key}${"a".repeat(62)}`,
    node_ref: `node:subject:${DIGEST}`,
    view_ref: `view:artifact:${DIGEST}`,
    collection: "architecture",
    status: "draft",
    candidate_type: "indexer-artifact",
    kind: "content",
    visibility: "public",
    module: `module-${key}`,
    path: `architecture/module-${key}.md`,
    structure_digest: DIGEST,
    source_refs: [`repo:module-${key}`],
    body: `# Module ${key}\n\nReader-facing content ${key}.\n`,
    indexer_candidate: {
      compile_digest: DIGEST,
      file_digest: DIGEST,
      artifact_ref: `artifact:subject:${DIGEST}`,
      section_refs: [`section:subject:${DIGEST}`],
      source_ref: `repo:module-${key}`,
      evidence_bindings: [],
      sections: [{
        section_ref: `section:subject:${DIGEST}`,
        section_key: "overview",
        evidence_refs: [],
        markdown: `Reader-facing content ${key}.`,
        markdown_digest: DIGEST,
      }],
    },
    fingerprint: DIGEST,
    review: {
      title: `Module ${key}`,
      summary: `Reader-facing summary ${key}.`,
      signals: ["current"],
      reason: "Current Indexer output.",
    },
    updated: "2026-09-04T00:00:00.000Z",
  };
}

describe("managed Review batching", () => {
  test("assigns every Candidate to exactly one bounded reader-facing batch", () => {
    const candidates = Array.from({ length: 13 }, (_, index) => ({
      record: candidate(index + 1),
      snapshot: undefined,
    })).reverse();

    const batches = buildCurrentReviewBatchDocuments(candidates);

    expect(batches.map((batch) => batch.candidate_count)).toEqual([6, 6, 1]);
    expect(batches.map((batch) => batch.task_key)).toEqual([
      "review-001",
      "review-002",
      "review-003",
    ]);
    for (let index = 1; index <= 13; index++) {
      const title = `## ${index}. Module ${String(index).padStart(2, "0")}`;
      expect(batches.filter((batch) => batch.content.includes(title))).toHaveLength(1);
    }
    expect(batches.every((batch) => !batch.content.includes("sha256:"))).toBe(true);
    expect(batches.every((batch) => !batch.content.includes("evidence_ref"))).toBe(true);
    expect(batches.every((batch) =>
      batch.content.includes("external consumer") &&
      batch.content.includes("important constraints") &&
      batch.content.includes("actually implements or guarantees") &&
      batch.content.includes("unexpanded template instructions")
    )).toBe(true);
  });
});
