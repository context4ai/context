import { expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";
import * as transactions from "../project/durableMultiFileTransaction.js";
import { completeProductionSubmission } from "../project/productionSubmission.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";

test.each(["success", "before-journal", "after-journal", "after-target"])("one batch transaction preserves independent receipts and retry: %s", async mode => {
  const root = await createDocumentRevisionWorkspace();
  const actual = transactions.runDurableMultiFileTransaction;
  try {
    await produceFixtureArticles(root, [0, 1, 2].map(i => ({
      path: `architecture/page-${i}.md`, question: `Explain entry ${i}`, sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: `---\ntitle: Entry ${i}\ndescription: Public entry.\n---\n\n<!-- context:section id="entry" -->\nThe answer is 42.\n<!-- /context:section -->\n`,
      references: { sections: [{ id: "entry", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
        locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
    })), { submit: async input => {
      let commits = 0;
      const spy = spyOn(transactions, "runDurableMultiFileTransaction").mockImplementation(async transaction => {
        commits++;
        if (mode === "before-journal") throw new Error("storage unavailable before journal");
        return actual({ ...transaction, ...(["after-journal", "after-target"].includes(mode) ? { inject_failure: async phase => {
          if (mode === "after-journal" ? phase === "after-initial-journal-dir-fsync" : phase.startsWith("after-target-dir-fsync:")) {
            throw new Error("interrupted durable batch");
          }
        } } : {}) });
      });
      let result;
      try { result = await completeProductionSubmission(input); } finally { spy.mockRestore(); }
      expect(commits).toBe(1);
      if (mode === "before-journal") {
        expect(result.accepted).toEqual([]);
        expect(result.failed).toHaveLength(3);
        expect(await readCandidateRecords(root)).toEqual([]);
        expect((await readProductionStage(root))!.tasks.every(task => task.status === "issued")).toBe(true);
        result = await completeProductionSubmission(input);
      }
      expect(result.accepted).toHaveLength(3);
      expect(result.failed).toEqual([]);
      const saved = await readCandidateRecords(root);
      expect(saved).toHaveLength(3);
      const replay = spyOn(transactions, "runDurableMultiFileTransaction");
      try {
        expect((await completeProductionSubmission(input)).accepted).toEqual(result.accepted);
        expect(replay).not.toHaveBeenCalled();
      } finally { replay.mockRestore(); }
      expect(await readCandidateRecords(root)).toEqual(saved);
      return result;
    } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
