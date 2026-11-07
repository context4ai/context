import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { prepareApprovedRevisionSubmission } from "../project/approvedRevisionSubmission.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { withCommandReadCache } from "../project/commandReadCache.js";

test("a long prewritten queue remains bounded by the existing 50-page Review boundary", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const paths = Array.from({ length: 51 }, (_, i) => `architecture/page-${i}.md`);
    await produceFixtureArticles(root, paths.map(path => ({ path, question: `Explain ${path}`, sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: '---\ntitle: Public constant\ndescription: Use the exported constant.\n---\n\n<!-- context:section id="usage" -->\nThe answer is 42.\n<!-- /context:section -->\n',
      references: { sections: [{ id: "usage", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
        locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] } })));
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    const request = await prepareApprovedRevision({ projectRoot: root, selector: paths[0]!, instruction: "Clarify usage",
      pending_targets: paths.slice(1).map(path => ({ path, instruction: "Clarify usage" })) });
    const prepared = await withCommandReadCache(() => prepareApprovedRevisionSubmission({ projectRoot: root, revision: request.revision, managed: true }));
    expect(prepared.tasks).toHaveLength(50);
    for (const task of prepared.tasks) {
      const issued = JSON.parse(await readFile(join(root, task.task_input), "utf8"));
      await writeFile(join(root, prepared.agent_directory, `${task.task}.edits.json`), JSON.stringify({ stage: "approved-revision",
        markdown: issued.target.markdown.replace("is 42.", "is 42. Read the exported constant directly.") }));
    }
    const started = performance.now();
    const result = await withCommandReadCache(() => completeCurrentIndexerAction({ cwd: root, revision: request.revision,
      value: prepared.submission, managed: true }));
    expect(result).toMatchObject({ outcome: "accepted", progress: { accepted: 50, pending: 0 }, workflow: { current: { node: "review-current-batch" } } });
    expect(await readCandidateRecords(root)).toHaveLength(50);
    expect((await readApprovedRevision(root))!.pending_targets).toHaveLength(1);
    console.log(JSON.stringify({ pages: 50, seconds: (performance.now() - started) / 1000, rss_mib: process.memoryUsage().rss / (1024 * 1024) }));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
