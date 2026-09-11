import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { canonicalIndexerNodeRef, indexerArtifactRef } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { readCandidateRecords } from "../project/candidateLedger.js";

for (const [cyclic, required] of [[false, true], [true, true], [false, false]]) test(`${cyclic ? "cyclic" : required ? "same-group" : "optional sibling"} supporting article plan retains a usable adjustment action`, async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await completePartitionStage(root, false, false, undefined, (intents, targets, subject) => {
      const ref = (key: string) => indexerArtifactRef(canonicalIndexerNodeRef(subject), { artifact_id: key, artifact_kind: "content" });
      return ["overview", "detail"].map((key, index) => ({ key, title: key, reader_task: "Locate the supported entry",
        artifact_intent: intents.find(intent => intent.endsWith("/content"))!, required: true,
        sections: [{ key: "entry", heading: "Entry", required: true }], question_targets: index ? [] : targets,
        knowledge_dependencies: index === 0 || cyclic ? [{ artifact_ref: ref(index ? "overview" : "detail"), section_refs: [], required: required! }] : [],
      }));
    });
    const review = (await currentIndexerStructureReview(root))!;
    expect(review.preview.topics).toHaveLength(1);
    if (!required) {
      expect(review.preview.pending_knowledge).toBeUndefined();
      await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
      const current = (await resolveCurrentIndexerAgentContext(root))!;
      expect(current.descriptor.stage).toBe("author");
      const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: current.descriptor.tasks[0]!.task_key });
      expect(task.spec.validation.knowledge_input).toMatchObject({ status: "ready", versions: [], facts: [],
        pending: [{ required: false, reason: "same-group-dependency" }] });
      return;
    }
    expect(review.preview.pending_knowledge?.[0]?.dependencies.some(dependency => dependency.reason === (cyclic ? "dependency-cycle" : "same-group-dependency"))).toBe(true);
    await expect(completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" })).rejects.toThrow("request-adjustment");
    expect(await readCandidateRecords(root)).toHaveLength(0);
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "request-adjustment",
      feedback: "Use direct authorized source evidence within this group; plan an independent upstream group only where a separate approved interpretation is needed." });
    await advanceCurrentIndexerLifecycle(root);
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    expect(current.descriptor.stage).toBe("partition");
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: current.descriptor.tasks[0]!.task_key });
    expect(task.view.items.some(item => item.category === "revision-feedback")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
