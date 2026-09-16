import { execFileSync } from "node:child_process";
import { updateKnowledgeMap } from "@c4a/context";
import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { readCandidateRecords, writeCandidateRecords } from "../project/candidateLedger.js";
import { writeReviewHtml, collectAllReviewCandidates } from "../project/reviewHtml.js";
import { readReviewPayloadFile } from "../project/review.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { readPendingReviewFeedback } from "../project/reviewFeedback.js";

function openReport(html: string, language = "en-US") {
  const elements = new Map<string, ReturnType<typeof element>>();
  function element() {
    const classes = new Set<string>();
    return { innerHTML: "", textContent: "", value: "", disabled: false, checked: false, hidden: false, open: false,
      classList: { toggle: (n: string, on?: boolean) => (on ?? !classes.has(n)) ? classes.add(n) : classes.delete(n), contains: (n: string) => classes.has(n) },
      querySelectorAll: () => [], querySelector: () => null, focus() {},
      showModal() { this.open = true; }, close() { this.open = false; },
    };
  }
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id)!; };
  let copied = "", now = 0, timerId = 0;
  const timers = new Map<number, () => void>();
  const runtime = createContext({ TextEncoder, TextDecoder, Date: { now: () => now },
    setInterval: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearInterval: (id: number) => timers.delete(id),
    document: { getElementById: get, querySelectorAll: () => [], body: get("body"), addEventListener() {} },
    window: { scrollTo() {} }, navigator: { language, clipboard: { writeText: async (s: string) => { copied = s; } } },
  });
  runInContext(html.match(/<script>([\s\S]*?)<\/script>/u)![1]!, runtime);
  return { runtime, get, copied: () => copied, advance(ms: number) { now += ms; for (const fn of [...timers.values()]) fn(); } };
}

test("site review transfers mixed decisions and revisions atomically and recovers pending feedback", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const rows = await readCandidateRecords(root);
    const report = await writeReviewHtml({ projectRoot: root, all: true });
    if (process.env.REVIEW_BUILT_CLI) execFileSync("node", [process.env.REVIEW_BUILT_CLI, "review", "html", "--all", "--format", "json"], { cwd: root, timeout: 30000, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" } });
    const html = await readFile(report.path, "utf8");
    if (process.env.REVIEW_HTML_PREVIEW) await writeFile(process.env.REVIEW_HTML_PREVIEW, html);
    for (const lang of ["zh-CN", "en-US"]) {
      const browser = openReport(html, lang);
      expect(browser.get("body").classList.contains("home")).toBe(true);
      expect(browser.get("top").innerHTML).not.toContain(' active');
      expect(browser.get("counts").textContent).toBe("2 New / 0 Modify / 0 Confirm");
      expect(browser.get("article").innerHTML).toContain("knowledge/");
      await runInContext("copyPayload()", browser.runtime);
      expect(browser.copied()).toBe("");
      expect(browser.get("copy-dialog").open).toBe(true);
      runInContext("showPage(candidates[0].id);", browser.runtime);
      expect(browser.get("footer").hidden).toBe(false);
      expect(browser.get("article").innerHTML).toContain(rows[0]!.source_refs[0]!);
      runInContext("$('revision-note').oninput({target:{value:'请补上前提\\nKeep API examples'}}); setAllDecision('approved');", browser.runtime);
      expect(browser.get("counts").textContent).toBe("0 New / 0 Modify / 2 Confirm");
      expect(browser.get("approve-btn").disabled).toBe(true);
      await runInContext("copyPayload()", browser.runtime);
      const path = join(root, ".tmp/feedback.txt");
      await writeFile(path, browser.copied());
      const payload = await readReviewPayloadFile(path);
      expect(payload.feedback_repairs).toHaveLength(1);
      expect(payload.feedback_repairs![0]!.instruction).toBe("请补上前提\nKeep API examples");
      if (lang === "en-US") {
        await writeCandidateRecords(root, rows.slice(1));
        await expect(applyReviewDecisions({ projectRoot: root, payload })).rejects.toThrow(/stale/);
        await writeCandidateRecords(root, rows);
        const result = await applyReviewDecisions({ projectRoot: root, payload });
        expect(result.repairs).toHaveLength(1);
        expect(result.repairs![0]!.command).toContain("context revise");
        const remaining = await collectAllReviewCandidates(root);
        expect(remaining).toHaveLength(1);
        expect(await readPendingReviewFeedback(root, remaining)).toHaveLength(1);
        const reopened = await writeReviewHtml({ projectRoot: root, all: true });
        const recoveredBrowser = openReport(await readFile(reopened.path, "utf8"));
        expect(recoveredBrowser.get("counts").textContent).toBe("0 New / 0 Modify / 1 Confirm");
      } else {
        runInContext("setDecision(candidates[0].candidate_id,'revised')", browser.runtime);
        expect(browser.get("revision-note").value).toBe("");
        expect(browser.get("approve-btn").disabled).toBe(false);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);


test("bulk approval requires acknowledgment and eight seconds only for genuinely new roots", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const rows = await readCandidateRecords(root);
    const map = updateKnowledgeMap(undefined, { expected_revision: null, remove: [], upsert: [
      { key: "overview", parent: null, title: "Overview", order: 10 },
      { key: "guides", parent: null, title: "Guides", order: 20 },
      ...rows.map((r, i) => ({ key: `page-${i}`, parent: i ? "guides" : "overview", title: r.review.title, order: 10, target: { artifact_ref: r.article_id } })),
    ] });
    await writeFile(join(root, "src/knowledge-map.yaml"), JSON.stringify(map));
    const report = await writeReviewHtml({ projectRoot: root, all: true });
    const html = await readFile(report.path, "utf8");
    if (process.env.REVIEW_HTML_PREVIEW) await writeFile(process.env.REVIEW_HTML_PREVIEW, html);
    const browser = openReport(html, "zh-CN");
    runInContext("openBulkConfirmation()", browser.runtime);
    expect(browser.get("bulk-roots").hidden).toBe(false);
    expect(browser.get("bulk-confirm").disabled).toBe(true);
    expect(browser.get("bulk-confirm").textContent).toContain("8s");
    browser.get("bulk-ack").checked = true;
    runInContext("updateBulkConfirmation(); $('bulk-confirm').onclick()", browser.runtime);
    expect(browser.get("counts").textContent).toContain("0 Confirm");
    browser.advance(7999);
    expect(browser.get("bulk-confirm").disabled).toBe(true);
    expect(browser.get("bulk-confirm").textContent).toContain("1s");
    browser.advance(1);
    expect(browser.get("bulk-confirm").disabled).toBe(false);
    browser.get("bulk-ack").checked = false;
    runInContext("updateBulkConfirmation()", browser.runtime);
    expect(browser.get("bulk-confirm").disabled).toBe(true);
    runInContext("$('bulk-cancel').onclick(); openBulkConfirmation()", browser.runtime);
    expect(browser.get("bulk-ack").checked).toBe(false);
    expect(browser.get("bulk-confirm").textContent).toContain("8s");
    browser.advance(8000);
    expect(browser.get("bulk-confirm").disabled).toBe(true);
    browser.get("bulk-ack").checked = true;
    runInContext("$('bulk-confirm').onclick()", browser.runtime);
    expect(browser.get("bulk-dialog").open).toBe(false);
    expect(browser.get("counts").textContent).toContain("2 Confirm");
    const existing = openReport(html.replace(";const SCOPE=", ';DATA.nodes.forEach(n=>n.change="unchanged");const SCOPE='));
    runInContext("openBulkConfirmation()", existing.runtime);
    expect(existing.get("bulk-roots").hidden).toBe(true);
    expect(existing.get("bulk-confirm").disabled).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);
