import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { withCommandReadCache } from "../project/commandReadCache.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completeAuthorStage, completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";

test("task View reuse still checks file replacement and descriptor bindings", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    await advanceCurrentIndexerLifecycle(root);
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    const descriptor = current.descriptor;
    const first = descriptor.tasks[0]!;
    const bytes = await readFile(first.view_path, "utf8");
    const load = () => loadCurrentIndexerBatchTask({ projectRoot: root, descriptor, taskKey: first.task_key });
    await withCommandReadCache(async () => {
      const initial = await load();
      expect((await load()).view).toBe(initial.view);
      await writeFile(first.view_path, bytes + "\n");
      const replaced = await load();
      expect(replaced.view).toEqual(initial.view);
      expect(replaced.view).not.toBe(initial.view);
      const original = first.source_ref;
      first.source_ref = "repo:unrelated/source";
      await expect(load()).rejects.toThrow("stale");
      first.source_ref = original;
      await writeFile(first.view_path, "{}");
      await expect(load()).rejects.toThrow();
      await writeFile(first.view_path, bytes);
      expect((await load()).view).toEqual(initial.view);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);

test("a second pending Candidate stays a Candidate while a peer repair rebuilds Review", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 3 });
  try {
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision,
      value: { stage: "structure-review", decision: "approved" }, managed: true });
    await completeAuthorStage(root);
    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    const [first, second, peer] = candidates;
    await beginDocumentRevision({ projectRoot: root, selector: first!.candidate_id,
      instruction: "Clarify the first public entry point." });
    const ledger = await currentLedger(root);
    const pending = await readCandidateRecords(root);
    await expect(beginDocumentRevision({ projectRoot: root, selector: second!.candidate_id,
      instruction: "Clarify the second public entry point." })).rejects.toMatchObject({
      detail: { reason_code: "candidate-review-not-current", request_registered: false,
        candidate_id: second!.candidate_id, next_action: { command: "context status --format json" } },
    });
    expect(await currentLedger(root)).toEqual(ledger);
    expect(await readCandidateRecords(root)).toEqual(pending);
    await completeAuthorStage(root, { revisionSuffix: "First clarification." });
    const refreshed = (await readCandidateRecords(root)).find(item => item.path === second!.path)!;
    expect(await beginDocumentRevision({ projectRoot: root, selector: refreshed.candidate_id,
      instruction: "Clarify the second public entry point." })).toMatchObject({ status: "author-reopened" });
    await completeAuthorStage(root, { revisionSuffix: "Second clarification." });
    const final = await readCandidateRecords(root);
    expect(final.find(item => item.path === first!.path)?.body).toContain("First clarification.");
    expect(final.find(item => item.path === second!.path)?.body).toContain("Second clarification.");
    expect(final.find(item => item.path === peer!.path)?.body).toBe(peer!.body);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
