import { expect, test, spyOn } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { createReviewCodeCodec } from "../project/reviewCode.js";
import { createReviewFeedbackCodec } from "../project/reviewFeedbackCode.js";
import { reviewSiteBaselineHash } from "../project/reviewSiteModel.js";
import { applyReviewDecisions, readReviewPayloadFile, runReviewApproveAllCommand } from "../project/review.js";
import { readPendingReviewFeedback } from "../project/reviewFeedback.js";
import { collectAllReviewCandidates } from "../project/reviewHtml.js";

test("legacy force approves without requiring a newly generated report and keeps JSON output clean", async () => {
  const root = await prepareRevisionKnowledge([]);
  let stdout = "", stderr = "";
  const out = spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
  const err = spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr += String(chunk); return true; });
  try {
    await runReviewApproveAllCommand({ cwd: root, all: true, force: true, format: "json" });
    expect(JSON.parse(stdout).approved).toBeGreaterThan(0);
    expect(stderr).toContain("--confirmed");
    expect(await collectAllReviewCandidates(root)).toHaveLength(0);
  } finally { out.mockRestore(); err.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 45000);

test("legacy decisions retain exact scope and reject stale or corrupt input", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const rows = (await readCandidateRecords(root)).sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
    const idsHash = candidateIdsHash(rows.map(row => row.candidate_id));
    const contentHash = candidateSetHash(rows);
    const code = createReviewCodeCodec().encode("all", idsHash, contentHash, rows.map(() => "approved")).join("\n");
    const path = join(root, ".tmp/legacy.txt");
    await writeFile(path, code);
    const payload = await readReviewPayloadFile(path, root);
    await expect(applyReviewDecisions({ projectRoot: root, payload: {
      ...payload, scope: { ...payload.scope!, candidates_sha256: "0".repeat(64) },
    } })).rejects.toThrow(/stale/);
    const result = await applyReviewDecisions({ projectRoot: root, payload });
    expect(result.approved).toBe(rows.length);
    await writeFile(path, code + "corrupt");
    await expect(readReviewPayloadFile(path, root)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);

test("legacy feedback preserves revisions instead of silently approving them", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const rows = (await readCandidateRecords(root)).sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
    const code = createReviewFeedbackCodec().encode({ scope: "all", idsHash: candidateIdsHash(rows.map(row => row.candidate_id)),
      contentHash: candidateSetHash(rows), baselineHash: await reviewSiteBaselineHash(root, rows.map(row => row.path)),
      statuses: rows.map((_, i) => i === 0 ? "revised" : "approved"), repairs: [{ index: 0, instruction: "Keep the example" }] });
    const path = join(root, ".tmp/legacy-feedback.txt");
    await writeFile(path, code);
    const result = await applyReviewDecisions({ projectRoot: root, payload: await readReviewPayloadFile(path, root) });
    expect(result.approved).toBe(rows.length - 1);
    expect(result.repairs?.[0]?.instruction).toBe("Keep the example");
    expect(await readPendingReviewFeedback(root, await collectAllReviewCandidates(root))).toHaveLength(1);
    await expect(runReviewApproveAllCommand({ cwd: root, all: true, force: true })).rejects.toThrow(/Pending revision/);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);
