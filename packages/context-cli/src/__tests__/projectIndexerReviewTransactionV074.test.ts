import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CandidateRecord } from "../project/candidateLedger.js";
import {
  CANDIDATE_LEDGER_FILE,
  readCandidateRecords,
  writeCandidateRecords,
} from "../project/candidateLedger.js";
import { recoverDurableMultiFileTransactions } from
  "../project/durableMultiFileTransaction.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { renderApprovedIndexerMarkdown } from "../project/reviewApplyIndexer.js";
import { readRejectedDecisions, REVIEW_DECISIONS_FILE } from
  "../project/reviewDecisions.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import {
  compactApprovedKnowledgeMarkdown,
  ensureApprovedKnowledgePresentation,
} from "../project/approvedKnowledgeMetadata.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const CANDIDATE_ID = `indexer/${"a".repeat(64)}`;

function candidate(): CandidateRecord {
  return {
    candidate_id: CANDIDATE_ID,
    node_ref: `node:subject:${DIGEST}`,
    view_ref: `view:artifact:${DIGEST}`,
    collection: "architecture",
    status: "draft",
    candidate_type: "indexer-artifact",
    kind: "content",
    visibility: "public",
    module: "sample",
    path: "architecture/sample.md",
    structure_digest: DIGEST,
    source_refs: ["repo:sample"],
    body: "# Sample\n\nCurrent knowledge.\n",
    indexer_candidate: {
      compile_digest: DIGEST,
      file_digest: DIGEST,
      artifact_ref: `artifact:subject:${DIGEST}`,
      section_refs: [`section:subject:${DIGEST}`],
      source_ref: "repo:sample",
      evidence_bindings: [],
      sections: [{
        section_ref: `section:subject:${DIGEST}`,
        section_key: "overview",
        evidence_refs: [],
        markdown: "# Sample\n\nCurrent knowledge.",
        markdown_digest: DIGEST,
      }],
    },
    fingerprint: DIGEST,
    review: {
      title: "Sample",
      summary: "Current knowledge.",
      signals: ["current"],
      reason: "Current Indexer output.",
    },
    updated: "2026-09-03T00:00:00.000Z",
  };
}

describe("Indexer Review durable transaction", () => {
  test("renders one visible page title even when Indexer sections omit it", () => {
    const withoutTitle = candidate();
    withoutTitle.indexer_candidate!.sections[0]!.markdown = "Current knowledge.";
    const rendered = renderApprovedIndexerMarkdown({
      record: withoutTitle,
      timestamp: "2026-09-03T00:00:00.000Z",
    });

    expect(rendered).toContain("\n---\n\n# Sample\n\n<!-- context:section");
    expect(rendered.match(/^# Sample$/gmu)).toHaveLength(1);

    const alreadyTitled = renderApprovedIndexerMarkdown({
      record: candidate(),
      timestamp: "2026-09-03T00:00:00.000Z",
    });
    expect(alreadyTitled.match(/^# Sample$/gmu)).toHaveLength(1);
  });

  test("replaces generated Artifact descriptions with reader-facing body text", () => {
    const row = candidate();
    row.review.summary = "content Artifact from sample-indexer.";
    const rendered = renderApprovedIndexerMarkdown({
      record: row,
      timestamp: "2026-09-03T00:00:00.000Z",
    });
    expect(rendered).toContain("description: Current knowledge.");

    const legacy = rendered.replace(
      "description: Current knowledge.",
      "description: content Artifact from sample-indexer.",
    );
    expect(compactApprovedKnowledgeMarkdown(legacy))
      .toContain("description: Current knowledge.");

    const untitled = legacy.replace(/^# Sample\n\n/mu, "");
    expect(ensureApprovedKnowledgePresentation(untitled).match(/^# Sample$/gmu))
      .toHaveLength(1);
  });

  test("recovers rejection ledger and durable decision together after interruption", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-indexer-review-transaction-"));
    try {
      const row = candidate();
      await writeCandidateRecords(projectRoot, [row]);
      await expect(applyReviewDecisions({
        projectRoot,
        payload: {
          collection: row.collection,
          scope: {
            kind: "collection",
            collection: row.collection,
            count: 1,
            ids_sha256: candidateIdsHash([row.candidate_id]),
            candidates_sha256: candidateSetHash([row]),
          },
          decisions: [{ candidate_id: row.candidate_id, status: "rejected" }],
        },
        inject_failure: (point) => {
          if (point === `after-target-rename:${CANDIDATE_LEDGER_FILE}`) {
            throw new Error("interrupted review apply");
          }
        },
      })).rejects.toThrow("interrupted review apply");

      await recoverDurableMultiFileTransactions(projectRoot);

      expect(await readCandidateRecords(projectRoot)).toMatchObject([{
        candidate_id: row.candidate_id,
        status: "rejected",
      }]);
      expect((await readRejectedDecisions(projectRoot)).get(row.candidate_id)).toBe(
        row.fingerprint,
      );
      expect(await readFile(join(projectRoot, REVIEW_DECISIONS_FILE), "utf8"))
        .toContain(row.candidate_id);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
