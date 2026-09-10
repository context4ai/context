import { expect } from "bun:test";
import { indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { completeCurrentIndexerStructureReview, currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";

export async function createArticleReviewWorkspace() {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  await completePartitionStage(root, false, false, undefined, (intents, targets) =>
    ["overview", "integration", "examples"].map((key, index) => ({
      key, title: key, reader_task: "Locate the public source entry",
      artifact_intent: intents.find(intent => intent.endsWith("/content"))!,
      required: index < 2, sections: [{ key: "entry", heading: "Entry", required: true }],
      question_targets: index === 0 ? targets : [],
    })));
  const structure = (await currentIndexerStructureReview(root))!;
  await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
  await authorReviewArticles(root);
  return root;
}

export async function authorReviewArticles(root: string, suffix = "") {
  const current = (await resolveCurrentIndexerAgentContext(root))!;
  for (const descriptor of current.descriptor.tasks) {
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: descriptor.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author");
    const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    const fact = task.view.items.find(item => item.category === "fact")!;
    const semantic = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key,
      outcome: "publish", policy: "standard",
      target_resolutions: (workset.target_resolution_view?.entries ?? []).map(entry => ({
        target: entry.query_ref, disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent",
      })),
      articles: validation.page_plan!.articles!.map(article => ({ key: article.key, title: article.title,
        summary: "Source entry for a public capability.", sections: [{ key: "entry", heading: "Entry",
          markdown: `Read src/index.ts for the exported constant. ${suffix}`, facts: [fact.ref], answers: article.question_targets }],
      })), member_dispositions: validation.canonical_inventory_members.map(member => ({
        item: member.member_id, state: "covered", article: "overview", section: "entry",
      })),
    });
    const result = buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation, semantic });
    expect((await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: workset.workset_digest, result }] })).outcomes[0]?.outcome).toBe("accepted");
  }
  await advanceCurrentIndexerLifecycle(root);
  return readCandidateRecords(root);
}
