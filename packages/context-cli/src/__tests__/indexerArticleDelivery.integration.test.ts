import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates, completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { readIndexerDelivery } from "../project/indexerDelivery.js";
import { readPartitionStream } from "../project/indexerPartitionStream.js";
import { readDeliveryCadence } from "../project/indexerDeliveryCadence.js";

test("one accepted topic spanning page batches settles only after its complete article set is built", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "article-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await completePartitionStage(root, false, false, undefined, (intents, targets) =>
      Array.from({ length: 51 }, (_, index) => ({ key: `article-${index}`, title: `Reader task ${index}`,
        reader_task: `Locate capability ${index}`, artifact_intent: intents.find(intent => intent.endsWith("/content"))!,
        required: true, sections: [{ key: "entry", heading: "Entry", required: true }], question_targets: index ? [] : targets })));
    const review = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    expect(current.descriptor.tasks).toHaveLength(1);
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: current.descriptor.tasks[0]!.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author");
    const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    const fact = task.view.items.find(item => item.category === "fact")!;
    const semantic = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key,
      outcome: "publish", policy: "standard", articles: validation.page_plan!.articles!.map(article => ({
        key: article.key, title: article.title, summary: "A source-backed entry.",
        sections: [{ key: "entry", heading: "Entry", markdown: `Locate ${article.key} in the public source.`, facts: [fact.ref], answers: article.question_targets }],
      })), member_dispositions: validation.canonical_inventory_members.map(member => ({
        item: member.member_id, state: "covered", article: "article-0", section: "entry",
      })) });
    const result = buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation, semantic });
    expect((await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: workset.workset_digest, result }] })).outcomes[0]?.outcome).toBe("accepted");
    const cadence = await readDeliveryCadence(root);
    await advanceCurrentIndexerLifecycle(root);
    const first = await readCandidateRecords(root);
    expect(first).toHaveLength(50);
    await approveCandidates(root, first);
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    expect((await readIndexerDelivery(root))?.delivered).toBeDefined();
    expect(await readPartitionStream(root)).toBeDefined();
    expect(await readDeliveryCadence(root)).toEqual(cadence);
    await advanceCurrentIndexerLifecycle(root);
    const remaining = (await readCandidateRecords(root)).filter(candidate => candidate.status === "draft");
    expect(remaining).toHaveLength(1);
    expect(first.some(candidate => candidate.path === remaining[0]!.path)).toBe(false);
    await approveCandidates(root, remaining);
    await closeProjectWorkspace(root);
    await buildProjectPackages(root);
    for (const candidate of [...first, ...remaining]) {
      expect(await readFile(join(root, "dist/article-kb/wikis", candidate.path), "utf8")).toContain("in the public source");
    }
    expect(await readPartitionStream(root)).toBeUndefined();
    const settled = await readDeliveryCadence(root);
    // Final lifecycle cleanup removes the task's cadence journal as well as
    // its stream; a later build must not recreate or advance either journal.
    expect(settled).toEqual({ step: 0, interrupted: false, settled: [] });
    expect((await buildProjectPackages(root)).packages[0]!.state).toBe("unchanged");
    expect(await readDeliveryCadence(root)).toEqual(settled);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
