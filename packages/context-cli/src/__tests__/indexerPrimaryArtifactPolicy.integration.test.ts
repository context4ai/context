import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";
import { primaryIntentKey } from "../project/indexerPrimaryArtifactPolicy.js";

test("an accepted contract page plan and its content retry both produce one valid primary bundle", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    await advanceCurrentIndexerLifecycle(root);
    const planning = (await resolveCurrentIndexerAgentContext(root))!;
    const first = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: planning.descriptor, taskKey: planning.descriptor.tasks[0]!.task_key });
    const choices = first.spec.validation.available_artifact_intents as string[];
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.every(choice => choice.endsWith("/content"))).toBe(true);
    await completePartitionStage(root);
    const review = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: current.descriptor.tasks[0]!.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author");
    type Validation = Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    const validation = task.spec.validation as Validation;
    const contract = validation.allowed_artifact_intents.find(intent => intent.artifact_kind === "contract" &&
      validation.allowed_artifact_intents.some(other => other.artifact_kind === "content" && other.document_kind === intent.document_kind && other.reader_goal === intent.reader_goal))!;
    expect(contract).toBeDefined();
    const planned = { ...validation, page_plan: { artifact_intent: primaryIntentKey(contract) } };
    const fact = task.view.items.find(item => item.category === "fact")!;
    expect(fact).toBeDefined();
    const input = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key, outcome: "publish", artifact_intent: primaryIntentKey(contract), policy: "standard", title: "Public interface", summary: "Reference for the public entry.", target_resolutions: [], sections: [{ key: "overview", heading: "Overview", markdown: "Use the exported entry.", facts: [fact.ref], answers: validation.allowed_question_targets.map(target => target.question_target_key) }], member_dispositions: validation.canonical_inventory_members.map(member => ({item: member.member_id, state: "covered", section: "overview"})), material_gaps: [], diagnostics: [] });
    const build = (artifact_intent: string) => buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation: planned, semantic: { ...input, artifact_intent } });
    expect(input.sections[0]!.source_items).toEqual([]);
    for (const refs of [[], ["fact:unavailable"]]) {
      expect(() => buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view,
        validation: planned, semantic: { ...input, sections: [{ ...input.sections[0]!, facts: refs }] } })).toThrow();
    }
    const result = build(primaryIntentKey(contract));
    const retry = build(primaryIntentKey({ ...contract, artifact_kind: "content" }));
    expect(retry).toEqual(result);
    const output = result.result.result;
    if (output.protocol !== "context.indexer.artifact-result/v1") throw new Error("expected artifact result");
    expect(output.artifacts.map(artifact => artifact.artifact_kind)).toEqual(["content"]);
    expect(output.diagnostics.some(item => item.code === "primary-artifact-policy-normalized")).toBe(true);
    const other = validation.allowed_artifact_intents.find(intent => intent.document_kind !== contract.document_kind)!;
    expect(() => build(primaryIntentKey(other))).toThrow(`planned=${primaryIntentKey(contract)}`);
    expect(() => build(primaryIntentKey(other))).toThrow(`received=${primaryIntentKey(other)}`);
    expect(buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view,
      validation: planned, semantic: { ...input, artifact_intent: undefined } })).toEqual(result);
    const accepted = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{workset_digest: workset.workset_digest, result}] });
    expect(accepted.outcomes.map(outcome => outcome.outcome)).toEqual(["accepted"]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
