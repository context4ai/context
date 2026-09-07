import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateRecord } from "../project/candidateLedger.js";
import { buildCurrentReviewBatchDocuments, materializeCurrentReviewBatchSet } from
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
    expect(batches.every((batch) => !batch.content.includes("## Semantic Review checklist"))).toBe(true);
    expect(batches[0]!.content).toContain("Page: architecture/module-01.md");
    const revised = candidates.map((view) => view.record.module === "module-01"
      ? { ...view, record: { ...view.record, indexer_candidate: { ...view.record.indexer_candidate,
          sections: view.record.indexer_candidate.sections.map((section) => ({ ...section, markdown: "Revised guidance." })),
        } } }
      : view);
    const afterRevision = buildCurrentReviewBatchDocuments(revised);
    expect(afterRevision[0]!.digest).not.toBe(batches[0]!.digest);
    expect(afterRevision.slice(1)).toEqual(batches.slice(1));
  });

  test("materializes shared review guidance once and keeps every page readable", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-review-reading-"));
    try {
      const candidates = Array.from({ length: 7 }, (_, index) => ({ record: candidate(index + 1), snapshot: undefined }));
      const result = await materializeCurrentReviewBatchSet({ projectRoot: root, candidates });
      expect(result.batch_count).toBe(2);
      const index = await readFile(result.path, "utf8");
      expect(index).toContain("bound reader purpose");
      expect(index).toContain("actually implements or guarantees");
      expect(index).toContain("reuse the review of unchanged pages");
      expect(index).toContain("no per-batch read receipts");
      const paths = [...index.matchAll(/^- File: (.+)$/gmu)].map((match) => match[1]!);
      expect(paths).toHaveLength(2);
      const contents = await Promise.all(paths.map((path) => readFile(path, "utf8")));
      expect(contents.join("\n")).not.toContain("## Semantic Review checklist");
      for (const view of candidates) expect(contents.join("\n")).toContain(view.record.path);
      candidates[0]!.record.indexer_candidate.sections[0]!.markdown = "Revised reader guidance.";
      const revised = await materializeCurrentReviewBatchSet({ projectRoot: root, candidates });
      const newPaths = [...revised.content.matchAll(/^- File: (.+)$/gmu)].map((match) => match[1]!);
      expect(newPaths[0]).not.toBe(paths[0]);
      expect(newPaths[1]).toBe(paths[1]);
      expect(revised.content).toContain("Material: unchanged from an earlier preview");
      expect(revised.content).toContain("Material: new or changed preview");
      expect(revised.content).toContain("not approval or reading history");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
