import { execFileSync } from "node:child_process";
import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { completeAuthorStage, completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { readCandidateRecords, writeCandidateRecords } from "../project/candidateLedger.js";
import { writeReviewHtml } from "../project/reviewHtml.js";
import { readReviewPayloadFile } from "../project/review.js";
import { applyReviewDecisions } from "../project/reviewApply.js";

// Execute the generated browser script with a minimal DOM and clipboard surface.
function openReport(html: string, languages: string[] = ["en-US"]) {
  const elements = new Map<string, ReturnType<typeof element>>();
  function element() {
    const classes = new Set<string>();
    return {
      innerHTML: "", textContent: "", value: "", checked: true, disabled: false, hidden: false,
      classList: {
        toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
        add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name),
      },
      setAttribute() {}, addEventListener() {}, focus() {}, select() {},
    };
  }
  function get(id: string) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id)!;
  }
  let copied = "";
  const runtime = createContext({
    document: { getElementById: get, querySelectorAll: () => [],
      documentElement: { dataset: { theme: "light" } }, addEventListener() {} },
    window: { confirm: () => true },
    navigator: { languages, language: languages[0], clipboard: { writeText: async (text: string) => { copied = text; } } },
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  expect(script).toBeDefined();
  runInContext(script!, runtime);
  return { runtime, get, copied: () => copied };
}

test("HTML review preserves complete sections, sources and an applicable copied decision payload", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
      value: { stage: "structure-review", decision: "approved" } });
    await completeAuthorStage(root);
    const candidates = await readCandidateRecords(root);
    expect(candidates).toHaveLength(2);
    for (const all of [false, true]) {
      const report = await writeReviewHtml({ projectRoot: root,
        ...(all ? { all: true } : { collection: candidates[0]!.collection }) });
      if (process.env.REVIEW_BUILT_CLI) {
        execFileSync("node", [process.env.REVIEW_BUILT_CLI, "review", "html",
          ...(all ? ["--all"] : [candidates[0]!.collection]), "--format", "json"], {
          cwd: root, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, timeout: 30000,
        });
      }
      const reportHtml = await readFile(report.path, "utf8");
      if (process.env.REVIEW_HTML_PREVIEW) await writeFile(process.env.REVIEW_HTML_PREVIEW, reportHtml);
      for (const languages of [["zh-CN"], ["zh-TW", "en-US"], ["en-US", "zh-CN"], ["fr-FR"]]) {
        const localized = openReport(reportHtml, languages);
        const chinese = languages[0]!.startsWith("zh");
        expect(localized.get("language").textContent).toBe(chinese ? "English" : "中文");
        expect(localized.get("payload-copy").textContent).toBe(chinese ? "复制" : "Copy");
        expect(localized.get("count-state").textContent).not.toContain("{count}");
        if (chinese) expect(localized.get("count-state").textContent).toContain("待审核");
        runInContext('setAllDecision("approved"); setDecision(candidates[0].candidate_id, "rejected");', localized.runtime);
        await runInContext("copyPayload()", localized.runtime);
        const codeBefore = localized.copied();
        const beforeBody = localized.get("detail").innerHTML.match(/<article[\s\S]*?<\/article>/u)?.[0];
        runInContext("toggleLanguage()", localized.runtime);
        expect(localized.get("language").textContent).toBe(chinese ? "中文" : "English");
        expect(localized.get("payload-copy").textContent).toBe(chinese ? "Copy" : "复制");
        expect(localized.get("detail").innerHTML.match(/<article[\s\S]*?<\/article>/u)?.[0]).toBe(beforeBody);
        await runInContext("copyPayload()", localized.runtime);
        expect(localized.copied()).toBe(codeBefore);
      }
      const browser = openReport(reportHtml);
      expect(browser.get("payload-copy").disabled).toBe(true);
      await runInContext("copyPayload()", browser.runtime);
      expect(browser.copied()).toBe("");
      browser.get("search").value = "not-a-matching-page";
      runInContext("render()", browser.runtime);
      expect(browser.get("list").innerHTML).toContain("No candidates match");
      browser.get("search").value = "";
      runInContext("render(); navigatePage(1);", browser.runtime);
      expect(browser.get("detail").innerHTML).toContain(candidates[1]!.review.title);
      runInContext("navigatePage(-1);", browser.runtime);
      expect(browser.get("detail").innerHTML).toContain(candidates[0]!.review.title);
      for (const row of candidates) {
        runInContext(`selected = ${JSON.stringify(row.candidate_id)}; render();`, browser.runtime);
        const displayed = browser.get("detail").innerHTML;
        for (const section of row.indexer_candidate.sections) {
          const escaped = section.markdown.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
            .replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
          expect(displayed).toContain(escaped);
        }
        expect(displayed).toContain(row.source_refs[0]!);
      }
      runInContext('setAllDecision("approved"); setDecision(candidates[0].candidate_id, "rejected");', browser.runtime);
      expect(browser.get("payload-copy").disabled).toBe(false);
      await runInContext("copyPayload()", browser.runtime);
      const payloadPath = join(root, ".tmp/review-payload.jsonl");
      await writeFile(payloadPath, browser.copied());
      const payload = await readReviewPayloadFile(payloadPath);
      expect(browser.copied().length).toBeLessThanOrEqual(980);
      expect(browser.get("code-navigation").hidden).toBe(true);
      runInContext('const originalEncode = reviewCode.encode; reviewCode.encode = () => ["part-one", "part-two"]; updatePayloadBox();', browser.runtime);
      expect(browser.get("code-navigation").hidden).toBe(false);
      runInContext('reviewCode.encode = originalEncode; updatePayloadBox();', browser.runtime);
      expect(browser.get("code-navigation").hidden).toBe(true);
      const ordered = [...candidates].sort((a, b) => a.candidate_id < b.candidate_id ? -1 : 1);
      expect(payload.encoded_statuses).toEqual(ordered.map((row) => row.candidate_id === candidates[0]!.candidate_id ? "rejected" : "approved"));
      expect(payload.decisions).toEqual([]);
      if (all) {
        for (const changed of [candidates.slice(1), candidates.map((row, i) => i === 0
          ? { ...row, candidate_id: `indexer/${"f".repeat(64)}`, fingerprint: `sha256:${"f".repeat(64)}`, indexer_candidate: { ...row.indexer_candidate, file_digest: `sha256:${"f".repeat(64)}` } } : row)]) {
          await writeCandidateRecords(root, changed);
          await expect(applyReviewDecisions({ projectRoot: root, payload })).rejects.toThrow(/stale/);
          expect(await readCandidateRecords(root)).toEqual(changed);
        }
        await writeCandidateRecords(root, candidates);
        await applyReviewDecisions({ projectRoot: root, payload });
      }
    }
    expect((await readCandidateRecords(root)).map((row) => row.status)).toEqual(["rejected"]);
    expect(await readFile(join(root, "knowledge", candidates[1]!.path), "utf8"))
      .toContain(candidates[1]!.review.title);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
