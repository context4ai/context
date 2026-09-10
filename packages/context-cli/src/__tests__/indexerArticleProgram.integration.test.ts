import { prepareIndexerAuthorSubmission } from "../project/indexerAuthorSubmission.js";
import { renderIndexerWorksetReading } from "../project/indexerAgentReading.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates, completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";

test("selected article program binds semantic slots through Author and produces a titled knowledge page", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await completePartitionStage(root, false, false, undefined, (intents, targets) => [{
      key: "component-guide", title: "Component guide", reader_task: "Integrate the component.",
      artifact_intent: intents.find(intent => intent.includes("/integrate-capability/"))!,
      template_id: "component-library-l02-page", required: true,
      sections: [{ key: "purpose", heading: "Purpose", required: true }], question_targets: targets,
    }]);
    const review = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: current.descriptor.tasks[0]!.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author");
    const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    expect(validation.article_templates?.["component-guide"]?.contract.template_id).toBe("component-library-l02-page");
    const guidance = task.spec.validation.article_guidance as Record<string, { content: string }>;
    const reading = renderIndexerWorksetReading({ view: task.view, workset, task_key: current.descriptor.tasks[0]!.task_key });
    expect(reading).toContain(guidance["component-guide"]!.content.trim());
    expect(reading).not.toContain("minimum_evidence_items");
    expect(reading).toContain('"template_id": "component-library-l02-page"');
    const facts = task.view.items.filter(item => item.category === "fact").map(item => item.ref);
    const semantic = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key,
      outcome: "publish", policy: "standard", articles: [{
        key: "component-guide", title: "Component guide", summary: "Public component entry.",
        sections: [{ key: "purpose", heading: "Purpose", markdown: "Original supported entry.", facts, source_items: ["src/index.ts"], answers: validation.page_plan!.articles![0]!.question_targets }],
        template_variables: {
          purpose: { value: "Use the exported component entry.", facts, source_items: ["src/index.ts"] },
          setup: { value: "Inspect the source export before choosing integration options.", source_items: ["package.json"] },
        },
      }], member_dispositions: validation.canonical_inventory_members.map(member => ({
        item: member.member_id, state: "covered", article: "component-guide", section: "purpose",
      })) });
    const { result, task: prepared } = await prepareIndexerAuthorSubmission({ projectRoot: root, task, semantic });
    const accepted = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: prepared.spec.request.workset.workset_digest, result }] });
    expect(accepted.outcomes.map(item => [item.outcome, item.message])).toEqual([["accepted", undefined]]);
    await advanceCurrentIndexerLifecycle(root);
    const candidates = await readCandidateRecords(root);
    expect(candidates).toHaveLength(1);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    const markdown = await readFile(join(root, "knowledge", candidates[0]!.path), "utf8");
    expect(markdown).toContain("# Component guide");
    expect(markdown).toContain("Use the exported component entry.");
    expect(markdown).toContain("Inspect the source export before choosing integration options.");
    expect(markdown).not.toContain("Original supported entry.");
    expect(markdown).not.toContain("{{variable:");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
