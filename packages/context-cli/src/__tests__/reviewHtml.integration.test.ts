import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { reviewSiteBaselineHash } from "../project/reviewSiteModel.js";
import { execFileSync } from "node:child_process";
import { updateKnowledgeMap } from "@c4a/context";
import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInContext } from "node:vm";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { readCandidateRecords, writeCandidateRecords } from "../project/candidateLedger.js";
import { writeReviewHtml, collectAllReviewCandidates } from "../project/reviewHtml.js";
import { readReviewPayloadFile } from "../project/review.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { readPendingReviewFeedback } from "../project/reviewFeedback.js";

import { openReport } from "./reviewBrowser.fixture.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { readConfirmedReviewScope } from "../project/reviewReportScope.js";

test("reader retains notes, copies plain feedback and dismisses successful copy after five seconds", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const report = await writeReviewHtml({ projectRoot: root, all: true });
    const html = await readFile(report.path, "utf8");
    if (process.env.REVIEW_HTML_PREVIEW) await writeFile(process.env.REVIEW_HTML_PREVIEW, html);
    expect(html).not.toContain('id="all-approved"');
    expect(html).not.toContain('id="approve-btn"');
    const browser = openReport(html);
    const evaluate = (code: string) => runInContext(code, browser.runtime);
    expect(evaluate('read.size')).toBe(0);
    evaluate('showPage(candidates[0].id); showPage(candidates[0].id)');
    expect(evaluate('read.size')).toBe(1);
    browser.input("revision-note", "Please preserve the API example\n<script>literal feedback</script>");
    expect(evaluate('revisedPages().length')).toBe(1);
    expect(browser.get("clear-note").disabled).toBe(false);
    await evaluate('copyNotes()');
    expect(browser.copied()).toContain("Article ID");
    expect(browser.copied()).toContain("<script>literal feedback</script>");
    expect(browser.get("copy-dialog").open).toBe(true);
    expect(browser.get("copy-title").classList.contains("copy-success")).toBe(true);
    expect(browser.get("copy-title").textContent).toContain("✓");
    browser.advance(4999);
    expect(browser.get("copy-dialog").open).toBe(true);
    browser.advance(1);
    expect(browser.get("copy-dialog").open).toBe(false);
    evaluate('view="revisions"; render()');
    expect(browser.get("article").innerHTML).toContain("&lt;script&gt;");
    const restored = openReport(html, browser.storage);
    expect(runInContext('read.size', restored.runtime)).toBe(1);
    expect(runInContext('revisedPages().length', restored.runtime)).toBe(1);
    evaluate("showPage(candidates[0].id); $('clear-note').onclick()");
    expect(evaluate('read.size')).toBe(1);
    expect(evaluate('revisedPages().length')).toBe(0);
    expect(browser.get("clear-note").disabled).toBe(true);
    await evaluate('copyNotes()');
    expect(browser.get("toast").hidden).toBe(false);
    const changed = html.replace(/"readVersion":"[^"]+"/gu, '"readVersion":"changed"');
    expect(runInContext('read.size', openReport(changed, browser.storage).runtime)).toBe(0);
    const manual = openReport(html);
    runInContext('showPage(candidates[0].id); navigator.clipboard = undefined', manual.runtime);
    manual.input("revision-note", "Manual copy");
    await runInContext('copyNotes()', manual.runtime);
    manual.advance(10000);
    expect(manual.get("copy-dialog").open).toBe(true);
    expect(manual.get("copied-notes").hidden).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);

test("scoped JSON feedback is atomic, rejects stale content and recovers pending instructions", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const rows = await readCandidateRecords(root);
    await writeReviewHtml({ projectRoot: root, all: true });
    const snapshot = await readConfirmedReviewScope(root, "all");
    const input = { schema: "context.review.decisions.v1", ...snapshot,
      repairs: [{ candidate_id: rows[0]!.candidate_id, instruction: "Preserve examples\nAdd prerequisites" }],
      decisions: [{ candidate_id: rows[1]!.candidate_id, status: "approved" }] };
    const path = join(root, ".tmp/feedback.json");
    await writeFile(path, JSON.stringify(input));
    const payload = await readReviewPayloadFile(path);
    await writeCandidateRecords(root, rows.slice(1));
    await expect(applyReviewDecisions({ projectRoot: root, payload })).rejects.toThrow(/stale/);
    await writeCandidateRecords(root, rows);
    await expect(applyReviewDecisions({ projectRoot: root, payload: { ...payload, repairs: [...payload.repairs!, ...payload.repairs!] } })).rejects.toThrow(/unique/);
    await expect(applyReviewDecisions({ projectRoot: root, payload: { ...payload, default: "approved" } })).rejects.toThrow(/separate/);
    const result = await applyReviewDecisions({ projectRoot: root, payload });
    expect(result.approved).toBe(1);
    expect(result.repairs).toHaveLength(1);
    const remaining = await collectAllReviewCandidates(root);
    expect(await readPendingReviewFeedback(root, remaining)).toHaveLength(1);
    const reopened = await writeReviewHtml({ projectRoot: root, all: true });
    const browser = openReport(await readFile(reopened.path, "utf8"));
    expect(runInContext('revisedPages().length', browser.runtime)).toBe(1);
    const current = await readConfirmedReviewScope(root, "all");
    await expect(applyReviewDecisions({ projectRoot: root, payload: {
      ...current, default: "approved", decisions: [],
    } })).rejects.toThrow(/Pending revision instructions/);
    expect(current.scope.ids_sha256).toBe(candidateIdsHash(remaining.map(c => c.record.candidate_id).sort()));
    expect(current.scope.candidates_sha256).toBe(candidateSetHash(remaining.map(c => c.record)));
    await writeFile(path, "CR2.retired");
    await expect(readReviewPayloadFile(path, root)).rejects.toThrow(/damaged|incomplete/);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);

test("approved pages in changed navigation remain readable without review controls", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const candidates = await collectAllReviewCandidates(root);
    await approveCandidates(root, candidates.map(c => c.record));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" } }).trim();
    git("init", "--quiet");
    const oldMap = updateKnowledgeMap(undefined, { expected_revision: null, remove: [], upsert: [] });
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: JSON.stringify(oldMap), encoding: "utf8" }).trim();
    const tree = (input: string) => execFileSync("git", ["mktree"], { cwd: root, input, encoding: "utf8" }).trim();
    const sourceTree = tree(`100644 blob ${blob}\tknowledge-map.yaml\n`);
    const rootTree = tree(`040000 tree ${sourceTree}\tsrc\n`);
    git("update-ref", "HEAD", git("commit-tree", rootTree, "-m", "Fixture navigation baseline"));
    const row = candidates[0]!.record;
    const map = updateKnowledgeMap(oldMap, { expected_revision: oldMap.revision, remove: [], upsert: [
      { key: "new-page", parent: null, title: row.review.title, order: 10, target: { artifact_ref: row.article_id } },
    ] });
    await writeFile(join(root, "src/knowledge-map.yaml"), JSON.stringify(map));
    const report = await writeReviewHtml({ projectRoot: root, all: true });
    const browser = openReport(await readFile(report.path, "utf8"));
    runInContext('showPage(DATA.pages.find(p=>p.html).id)', browser.runtime);
    expect(browser.get("article").innerHTML).toContain("value 42");
    expect(browser.get("footer").hidden).toBe(true);
    expect(runInContext('candidates.length', browser.runtime)).toBe(0);
    expect(runInContext('DATA.nodes.find(n=>n.key==="new-page").change', browser.runtime)).toBe("new");
    const baseline = await reviewSiteBaselineHash(root, []);
    const path = join(root, "knowledge", row.path);
    await writeFile(path, (await readFile(path, "utf8")).replace("value 42", "value 45"));
    expect(await reviewSiteBaselineHash(root, [])).not.toBe(baseline);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);
