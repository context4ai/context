import { expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readIndexerDelivery, requestIndexerEarlyDelivery } from "../project/indexerDelivery.js";
import { collectProjectStatus } from "../project/status.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";

test("104-page production keeps formal batches, partial delivery, repair and failed build recoverable", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 104 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    const entry = (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "scale-kb", template: { path: "src/package-templates/kb", vars: {} } })]');
    await writeFile(entryPath, entry);
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
      value: { stage: "structure-review", decision: "approved" } });
    const formalBatches: number[] = [];
    let repaired = false;
    for (let cycle = 0; cycle < 20; cycle++) {
      await completePartitionStage(root);
      const nextStructure = await currentIndexerStructureReview(root);
      if (nextStructure && !nextStructure.approved) {
        await completeCurrentIndexerAction({ cwd: root, revision: nextStructure.revision, managed: true,
          value: { stage: "structure-review", decision: "approved" } });
      }
      await completeAuthorStage(root);
      const candidates = await readCandidateRecords(root);
      if (!candidates.length) break;
      const delivery = (await readIndexerDelivery(root))!;
      formalBatches.push(delivery.current.length);
      if (!repaired && delivery.current.length >= 30) {
        const pending = candidates.at(-1)!;
        await applyReviewDecisions({ projectRoot: root, payload: { scope: { kind: "all", count: candidates.length,
          visible_candidate_ids: candidates.map(item => item.candidate_id).sort(),
          ids_sha256: candidateIdsHash(candidates.map(item => item.candidate_id).sort()), candidates_sha256: candidateSetHash(candidates) },
          decisions: candidates.slice(0, -1).map(item => ({ candidate_id: item.candidate_id, status: "approved" })) } });
        await requestIndexerEarlyDelivery(root);
        expect((await collectProjectStatus(root, { managed: true })).workflow.current?.node).toBe("close-approved-knowledge");
        await closeProjectWorkspace(root);
        await writeFile(entryPath, "throw new Error('controlled build failure');\n");
        await expect(buildProjectPackages(root)).rejects.toThrow();
        expect((await readIndexerDelivery(root))!.partial).toBeDefined();
        expect(await readCandidateRecords(root)).toHaveLength(1);
        await writeFile(entryPath, entry);
        await buildProjectPackages(root);
        if ((await collectProjectStatus(root, { managed: true })).workflow.current?.node === "advance-current-indexer-lifecycle") {
          await advanceCurrentIndexerLifecycle(root);
        }
        expect((await collectProjectStatus(root, { managed: true })).workflow.current?.node).toBe("review-current-batch");
        const deliveredBeforeRepair = { ...(await readIndexerDelivery(root))!.delivered };
        await beginDocumentRevision({ projectRoot: root, selector: pending.path, instruction: "Clarify that this is a public exported constant." });
        await completeAuthorStage(root, { revisionSuffix: "The source declares this constant as a public export." });
        expect((await readCandidateRecords(root)).map(item => item.path)).toContain(pending.path);
        expect((await readIndexerDelivery(root))!.current.every(page => deliveredBeforeRepair[page.ref] === undefined)).toBe(true);
        expect((await readIndexerDelivery(root))!.delivered).toEqual(deliveredBeforeRepair);
        repaired = true;
      }
      await approveCandidates(root, await readCandidateRecords(root));
      await closeProjectWorkspace(root);
      await acceptStarterPackageTemplates({ projectRoot: root });
      await buildProjectPackages(root);
      const status = await collectProjectStatus(root, { managed: true });
      if (status.workflow.current === undefined) break;
      await advanceCurrentIndexerLifecycle(root);
    }
    const status = await collectProjectStatus(root, { managed: true });
    expect(repaired).toBe(true);
    expect(formalBatches.filter(size => size >= 20).length).toBeGreaterThanOrEqual(2);
    expect(status.approvedPages).toBe(104);
    expect(status.draftCandidates).toBe(0);
    expect(status.verifyErrors).toBe(0);
    expect(status.workflow.current).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 600_000);
