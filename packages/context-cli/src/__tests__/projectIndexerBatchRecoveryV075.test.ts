import { describe, expect, test } from "bun:test";
import type { IndexerInventoryMember } from "@c4a/context";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import {
  projectCurrentIndexerWorkflowRoute,
  resolveCurrentIndexerAgentContext,
} from "../project/indexerCurrentWorkflowRoute.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import {
  createDocumentRevisionWorkspace,
  documentRevisionOuterIndexerRoute,
} from "./projectDocumentRevisionV074.fixture.js";

async function currentPartitionTask(root: string) {
  await advanceCurrentIndexerLifecycle(root);
  const current = await resolveCurrentIndexerAgentContext(root);
  if (current === undefined || current.descriptor.stage !== "partition") {
    throw new Error("missing Partition batch");
  }
  const task = await loadCurrentIndexerBatchTask({
    projectRoot: root,
    descriptor: current.descriptor,
    taskKey: current.descriptor.tasks[0]!.task_key,
  });
  const workset = task.spec.request.workset;
  if (workset.stage !== "partition") throw new Error("expected Partition task");
  const validation = task.spec.validation as {
    canonical_inventory_members: IndexerInventoryMember[];
    required_question_target_refs?: string[];
  };
  const result = {
    stage: "partition" as const,
    outcome: "complete" as const,
    groups: [{
      key: "batch-recovery",
      title: "Batch recovery",
      reader_task: "Understand the public fixture capability.",
      subject: {
        namespace: workset.partition_subject_key.namespace,
        kind: workset.partition_subject_key.kind,
        local_key: "batch-recovery",
      },
      subject_intent: "primary" as const,
      members: validation.canonical_inventory_members.map((member) => member.member_id),
      questions: [...workset.reader_question_refs],
      question_targets: (validation.required_question_target_refs ?? []).map((target) => ({
        target,
        role: "primary-carrier" as const,
      })),
      outline: ["Overview"],
    }],
    excluded: [],
    unsupported: [],
  };
  return { current, task, result };
}

describe("current Indexer batch recovery", () => {
  test("resumes with only uncommitted tasks after next-batch preparation fails", async () => {
    const root = await createDocumentRevisionWorkspace();
    const { current, task, result } = await currentPartitionTask(root);
    expect(current.descriptor.tasks.length).toBeGreaterThan(1);
    const route = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root,
      route: documentRevisionOuterIndexerRoute(),
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
    });
    if (route === undefined) throw new Error("missing current Partition route");
    const completion = await completeCurrentIndexerAction({
      cwd: root,
      revision: route.revision,
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
      inject_next_preparation_failure: () => {
        throw new Error("injected next preparation failure");
      },
      value: {
        stage: "partition",
        results: [{ task_key: task.descriptor.task_key, result }],
      },
    });
    if (!("outcomes" in completion)) throw new Error("expected a batch completion");
    expect(completion).toMatchObject({
      next: null,
      next_preparation: {
        outcome: "failed",
        message: "injected next preparation failure",
      },
    });
    expect(completion.outcomes).toContainEqual(expect.objectContaining({
      task_key: task.descriptor.task_key,
      outcome: "accepted",
      committed: true,
    }));
    const ledger = await currentLedger(root);
    expect(ledger?.entries.find((entry) =>
      entry.workset_digest === task.descriptor.workset_digest
    )?.state).toBe("accepted");

    const resumed = await resolveCurrentIndexerAgentContext(root);
    expect(resumed?.descriptor.tasks.some((candidate) =>
      candidate.workset_digest === task.descriptor.workset_digest
    )).toBe(false);
    expect(resumed?.descriptor.tasks).toHaveLength(current.descriptor.tasks.length - 1);
  }, 20_000);

  test("isolates duplicate, foreign, missing, and stale batch submissions", async () => {
    const root = await createDocumentRevisionWorkspace();
    const { current, result } = await currentPartitionTask(root);
    const taskKey = current.descriptor.tasks[0]!.task_key;
    const route = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root,
      route: documentRevisionOuterIndexerRoute(),
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
    });
    if (route === undefined) throw new Error("missing current Partition route");
    const completion = await completeCurrentIndexerAction({
      cwd: root,
      revision: route.revision,
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
      value: {
        stage: "partition",
        results: [{ task_key: taskKey, result }, {
          task_key: taskKey,
          result,
        }, {
          task_key: "task-foreign",
          result,
        }],
      },
    });
    if (!("outcomes" in completion)) throw new Error("expected a batch completion");
    expect(completion.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        task_key: taskKey,
        outcome: "failed",
        message: expect.stringContaining("duplicate task key"),
      }),
      expect.objectContaining({
        task_key: "task-foreign",
        outcome: "failed",
        message: expect.stringContaining("no task-foreign"),
      }),
      expect.objectContaining({
        task_key: current.descriptor.tasks[1]!.task_key,
        outcome: "missing",
        committed: false,
      }),
    ]));
    expect(completion.outcomes.some((outcome) => outcome.committed === true)).toBe(false);
    await expect(completeCurrentIndexerAction({
      cwd: root,
      revision: `sha256:${"0".repeat(64)}`,
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
      value: {
        stage: "partition",
        results: [{ task_key: taskKey, result }],
      },
    })).rejects.toThrow(/current Indexer batch changed/u);
  }, 20_000);
});
