import { afterEach, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createArticleReviewWorkspace, authorReviewArticles } from "./indexerArticleReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { closeProjectWorkspace } from "../project/close.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function rejectArticle(root: string, title: string) {
  const candidates = await readCandidateRecords(root);
  const target = candidates.find(candidate => candidate.body.startsWith(`# ${title}\n`));
  if (!target) throw new Error(`missing fixture article ${title}`);
  await applyReviewDecisions({ projectRoot: root, payload: {
    scope: { kind: "all", count: candidates.length,
      visible_candidate_ids: candidates.map(candidate => candidate.candidate_id).sort(),
      ids_sha256: candidateIdsHash(candidates.map(candidate => candidate.candidate_id).sort()),
      candidates_sha256: candidateSetHash(candidates) },
    decisions: candidates.map(candidate => ({ candidate_id: candidate.candidate_id,
      status: candidate.candidate_id === target.candidate_id ? "rejected" : "approved" })),
  } });
  return { target, approved: candidates.filter(candidate => candidate.candidate_id !== target.candidate_id) };
}

test("rejected required article stays repairable and cannot silently settle its theme", async () => {
  const root = await createArticleReviewWorkspace(); roots.push(root);
  const { target, approved } = await rejectArticle(root, "integration");
  const bodies = await Promise.all(approved.map(candidate => readFile(join(root, "knowledge", candidate.path), "utf8")));
  const ledger = await currentLedger(root);
  await expect(closeProjectWorkspace(root)).rejects.toMatchObject({ detail: {
    reason_code: "required-articles-need-repair", paths: [target.path],
    next_action: { command: expect.stringContaining("context revise") },
  } });
  expect(await currentLedger(root)).toEqual(ledger);
  expect(await Promise.all(approved.map(candidate => readFile(join(root, "knowledge", candidate.path), "utf8")))).toEqual(bodies);
  expect(await beginDocumentRevision({ projectRoot: root, selector: target.path,
    instruction: "Clarify the source entry for the required integration article." })).toMatchObject({ status: "author-reopened" });
  await authorReviewArticles(root, "The source declaration is the next investigation step.");
  const repaired = await readCandidateRecords(root);
  expect(repaired.some(candidate => candidate.path === target.path && candidate.status === "draft")).toBe(true);
  await approveCandidates(root, repaired);
  await closeProjectWorkspace(root);
  expect(await readFile(join(root, "knowledge", target.path), "utf8")).toContain("next investigation step");
}, 60000);

test("explicit rejection of an optional article can close the remaining approved collection", async () => {
  const root = await createArticleReviewWorkspace(); roots.push(root);
  const { approved } = await rejectArticle(root, "examples");
  await closeProjectWorkspace(root);
  for (const candidate of approved) expect(await readFile(join(root, "knowledge", candidate.path), "utf8")).toContain("src/index.ts");
}, 60000);
