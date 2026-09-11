import { configureDeliveryCadence } from "../project/indexerDeliveryCadence.js";
import { indexerBatchStagePolicy } from "../project/indexerCurrentBatchPlanner.js";
import { test, expect } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { collectProjectStatus } from "../project/status.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { readIndexerDelivery } from "../project/indexerDelivery.js";

test("an explicit build request delivers an unfinished Author batch, keeps Review and resumes production", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: indexerBatchStagePolicy("author").max_tasks * 3 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "early-delivery", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true, value: { stage: "structure-review", decision: "approved" } });
    await completeAuthorStage(root);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    const { workspaceVersion } = await import("../project/workspaceChangelog.js");
    expect(await workspaceVersion(root)).toBe("0.0.0");
    const first = await readIndexerDelivery(root);
    expect(Object.keys(first!.delivered)).toHaveLength(3);
    await configureDeliveryCadence(root, "20");
    await completePartitionStage(root);
    const nextStructure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerAction({ cwd: root, revision: nextStructure.revision, managed: true, value: { stage: "structure-review", decision: "approved" } });
    await advanceCurrentIndexerLifecycle(root);
    const before = (await currentLedger(root))!;
    expect(before.entries.some(entry => entry.state === "running")).toBe(true);
    const status = await collectProjectStatus(root);
    expect(status.workflow.current?.delivery?.request.command).toBe("context run --deliver --format json");
    expect(status.workflow.current?.delivery?.waiting_for).toBe("current-author-batch");
    await runCurrentIndexerLifecycle({ projectRoot: root, managed: false, authorities: [], deliver: true, dryRun: true });
    expect((await readIndexerDelivery(root))?.early_requested).not.toBe(true);
    const requested = await runCurrentIndexerLifecycle({ projectRoot: root, managed: false, authorities: [], deliver: true });
    expect(requested.delivery?.early_requested).toBe(true);
    expect(requested.delivery?.waiting_for).toBe("current-author-batch");
    expect(await currentLedger(root)).toEqual(before);
    // The existing current batch settles; another pending Author batch must not start.
    await completeAuthorStage(root);
    const checkpoint = (await currentLedger(root))!;
    expect(checkpoint.entries.some(entry => entry.state === "pending")).toBe(true);
    expect(checkpoint.entries.some(entry => entry.state === "running")).toBe(false);
    const delivery = (await readIndexerDelivery(root))!;
    expect(delivery.current.length).toBeGreaterThan(0);
    expect(delivery.current.length).toBeLessThan(30);
    expect((await collectProjectStatus(root)).workflow.current).toMatchObject({ node: "review-current-batch", availability: "requires-user" });
    // A repeated request at Review is already satisfied, not a request for another checkpoint.
    await runCurrentIndexerLifecycle({ projectRoot: root, managed: false, authorities: [], deliver: true });
    expect((await readIndexerDelivery(root))?.early_requested).not.toBe(true);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await buildProjectPackages(root);
    expect(await workspaceVersion(root)).toBe("0.0.0");
    expect(Object.keys((await readIndexerDelivery(root))!.delivered).length).toBeGreaterThan(3);
    expect(await currentLedger(root)).toEqual(checkpoint);
    await advanceCurrentIndexerLifecycle(root);
    const resumed = (await currentLedger(root))!;
    expect(resumed.entries.some(entry => entry.state === "running")).toBe(true);
    expect(resumed.entries.filter(entry => entry.state === "accepted")).toEqual(checkpoint.entries.filter(entry => entry.state === "accepted"));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 90000);
