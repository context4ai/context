import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { prepareApprovedRevision, readApprovedRevision, completeApprovedRevision } from "../project/approvedRevision.js";
import { applyKnowledgeMapUpdate, readKnowledgeMap } from "../project/knowledgeMap.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { writeReviewHtml } from "../project/reviewHtml.js";
import { CANDIDATE_LEDGER_FILE, readCandidateRecords } from "../project/candidateLedger.js";

test("navigation binds a local revision's new draft before approval and rejects stale candidate content", async () => {
  const roots: string[] = [];
  try {
    const root = await initialRevisionKnowledge(roots);
    const path = "architecture/new-task.md";
    await prepareApprovedRevision({ projectRoot: root, selector: path, instruction: "Explain another reader task.",
      create: { path, title: "New task", source_refs: [DOCUMENT_REVISION_SOURCE_REF], instruction: "Explain another reader task." } });
    const request = (await readApprovedRevision(root))!;
    await completeApprovedRevision({ projectRoot: root, revision: request.revision,
      markdown: request.target.markdown + '\n<!-- context:section id="usage" -->\nUse the exported constant.\n<!-- /context:section -->\n' });
    const candidates = await readCandidateRecords(root);
    const candidate = candidates.find(item => item.path === path)!;
    const beforeReport = await writeReviewHtml({ projectRoot: root, all: true });
    expect(beforeReport.navigation.unplaced.map(page => page.article_id)).toContain(candidate.article_id);
    expect(beforeReport.navigation.ready).toBe(false);
    expect(beforeReport.next_action?.command).toContain("context task adjust");
    const current = (await readKnowledgeMap(root))!;
    const update = { expected_revision: current.revision, remove: [], upsert: [
      { key: "new-task", parent: null, title: "New task", order: 10, target: { artifact_ref: candidate.article_id, section_key: "usage" } },
    ] };
    const ledger = join(root, CANDIDATE_LEDGER_FILE);
    const bytes = await readFile(ledger, "utf8");
    await writeFile(ledger, bytes.replace("Use the exported constant.", "Changed outside the writer."));
    await expect(applyKnowledgeMapUpdate(root, update)).rejects.toThrow();
    expect(await readKnowledgeMap(root)).toEqual(current);
    await writeFile(ledger, bytes);
    expect((await applyKnowledgeMapUpdate(root, update)).outcome).toBe("knowledge-map-updated");
    expect((await readKnowledgeMap(root))!.entries.find(entry => entry.key === "new-task")!.target)
      .toEqual({ artifact_ref: candidate.article_id, section_key: "usage" });
    const afterReport = await writeReviewHtml({ projectRoot: root, all: true });
    expect(afterReport.navigation).toMatchObject({ ready: true, unplaced_count: 0, unplaced: [] });
    expect(afterReport.next_action).toBeUndefined();
    expect(await readCandidateRecords(root)).toEqual(candidates);
    await expect(readFile(join(root, "knowledge", path))).rejects.toThrow();
    await applyReviewDecisions({ projectRoot: root, payload: {
      collection: candidate.collection, scope: { kind: "all", count: candidates.length, visible_candidate_ids: candidates.map(row => row.candidate_id).sort(),
        ids_sha256: candidateIdsHash(candidates.map(row => row.candidate_id).sort()), candidates_sha256: candidateSetHash(candidates) },
      decisions: [{ candidate_id: candidate.candidate_id, status: "rejected" }],
    } });
    const rejectedMap = (await readKnowledgeMap(root))!;
    await expect(applyKnowledgeMapUpdate(root, { ...update, expected_revision: rejectedMap.revision })).rejects.toMatchObject({
      detail: { invalid_targets: [{ reason: "unknown-article" }] },
    });
    await applyKnowledgeMapUpdate(root, { expected_revision: rejectedMap.revision, upsert: [], remove: ["new-task"] });
    expect((await readKnowledgeMap(root))!.entries.some(entry => entry.key === "new-task")).toBe(false);
    await expect(readFile(join(root, "knowledge", path))).rejects.toThrow();
  } finally { for (const root of roots) await rm(root, { recursive: true, force: true }); }
}, 60_000);
