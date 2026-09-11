import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { prepareWorkspace } from "../project/workspacePreparation.js";
import { readTaskPreparation, resumeWorkspaceTask, TASK_PREPARATION_PATH } from "../project/taskResumption.js";
import { collectProjectStatus } from "../project/status.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";

for (const legacy of [false, true]) test(`cleared production reopens through Route and retains approved knowledge (legacy=${legacy})`, async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: legacy ? 1 : 2 });
  try {
    await completePartitionStage(root);
    const review = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    await completeAuthorStage(root, { includeFacts: true });
    const candidates = await readCandidateRecords(root);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    const paths = ["knowledge/structure.yaml", "sources/repo/index.yaml", ...candidates.map(c => `knowledge/${c.path}`)];
    const before = await Promise.all(paths.map(path => readFile(join(root, path), "utf8")));
    const plan = await prepareWorkspace({ projectRoot: root });
    await prepareWorkspace({ projectRoot: root, apply: true, plan_digest: plan.revision });
    expect(await currentLedger(root)).toBeUndefined();
    const cleared = await collectProjectStatus(root);
    expect(cleared.workflow.status).not.toBe("complete");
    expect(cleared.workflow.current?.node).toBe("reopen-cleared-task");
    if (legacy) await rm(join(root, TASK_PREPARATION_PATH));
    await resumeWorkspaceTask(root);
    expect(await readTaskPreparation(root)).toBe("resume-requested");
    const status = await collectProjectStatus(root);
    expect(status.workflow.current?.node).toBe("advance-current-indexer-lifecycle");
    expect((await advanceCurrentIndexerLifecycle(root)).state).toBe("agent-required");
    const ledger = (await currentLedger(root))!;
    expect(ledger.entries.length).toBeGreaterThan(0);
    const resumedStatus = await collectProjectStatus(root);
    expect(resumedStatus.workflow.status).not.toBe("complete");
    expect(resumedStatus.workflow.current?.node).toBe("run-indexer-agent-step");
    const summary = resumedStatus.indexerProgress!.planning_summary!;
    expect(summary.groups.reduce((sum, group) => sum + group.total, 0)).toBe(ledger.entries.length);
    expect(summary.groups.every(group => group.accepted === 0)).toBe(true);
    expect(new Set(summary.groups.map(group => group.source_ref)).size).toBe(1);
    expect(summary.by_indexer.reduce((sum, group) => sum + group.total, 0)).toBe(ledger.entries.length);
    const { indexerPlanningSummary } = await import("../project/indexerPlanningSummary.js");
    const acceptedCopy = structuredClone(ledger);
    acceptedCopy.entries[0]!.state = "accepted";
    expect((await indexerPlanningSummary(root, acceptedCopy)).groups.reduce((sum, group) => sum + group.accepted, 0)).toBe(1);
    expect(ledger.entries.every(e => e.state !== "accepted")).toBe(true);
    const context = (await resolveCurrentIndexerAgentContext(root))!;
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: context.descriptor, taskKey: context.descriptor.tasks[0]!.task_key });
    expect(JSON.stringify(task.view)).toContain(candidates[0]!.path);
    expect(await resumeWorkspaceTask(root)).toMatchObject({ action: "task-already-present" });
    expect((await currentLedger(root))!.ledger_digest).toBe(ledger.ledger_digest);
    expect(await readTaskPreparation(root)).toBeUndefined();
    expect(await Promise.all(paths.map(path => readFile(join(root, path), "utf8")))).toEqual(before);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("resumed multi-layer Provider routes to selection before preparing a ledger", async () => {
  const { default: YAML } = await import("yaml");
  const { loadCurrentIndexerRegistry } = await import("../project/currentIndexerRegistry.js");
  const { currentIndexerProviderSelectionNeedsRefresh } = await import("../project/indexerCurrentProviderSelection.js");
  const { writeFile } = await import("node:fs/promises");
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    const { registry } = await loadCurrentIndexerRegistry(root);
    expect(await currentIndexerProviderSelectionNeedsRefresh({ projectRoot: root, registry })).toBe(false);
    const indexer = registry.indexers[0]!;
    indexer.providers.push({ ...indexer.providers[0]!, id: "extra", role: "extension" });
    await writeFile(join(root, "src/indexers.yaml"), YAML.stringify(registry));
    const plan = await prepareWorkspace({ projectRoot: root });
    await prepareWorkspace({ projectRoot: root, apply: true, plan_digest: plan.revision });
    await resumeWorkspaceTask(root);
    expect(await currentIndexerProviderSelectionNeedsRefresh({ projectRoot: root, registry })).toBe(true);
    const status = await collectProjectStatus(root, { managed: true });
    expect(status.workflow.current?.node).toBe("configure-indexer-providers");
    expect(status.workflow.current?.action?.input).toMatchObject({ stage: "provider-selection", existing_indexers: registry.indexers });
    expect(await currentLedger(root)).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
