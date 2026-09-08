import { afterEach, expect, spyOn, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { indexerAgentStepInputSchema, type IndexerInventoryMember } from "@c4a/context";
import * as reading from "../project/indexerAgentReading.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { readCurrentIndexerComposerBatch } from "../project/indexerCurrentComposer.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { projectCurrentIndexerWorkflowRoute, resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { readIndexerDelivery } from "../project/indexerDelivery.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { createDocumentRevisionWorkspace, documentRevisionOuterIndexerRoute } from "./projectDocumentRevisionV074.fixture.js";
import { readingItems, readingObjects } from "./indexerReading.fixture.js";
import { buildIndexerPostAuthorResultFromSemantic } from "../project/indexerSemanticPostAuthorResult.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

test("each successful Composer batch advances; an early delivery reaches Candidates before remaining Authors", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 2 }); roots.push(root);
  const registryPath = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(registryPath, "utf8"));
  registry.indexers[0].profile.composers = ["examples-and-documentation", "public-contract"]
    .map((id) => ({ id, provider: "community" }));
  await writeFile(registryPath, YAML.stringify(registry));
  const authorities = contextWorkflowAuthorities({ managed: true });
  const route = async () => {
    const current = await projectCurrentIndexerWorkflowRoute({ projectRoot: root,
      route: documentRevisionOuterIndexerRoute(), managed: true, authorities });
    if (!current) throw new Error("expected Indexer Route");
    return current;
  };
  const complete = async (value: unknown) => {
    const current = await route();
    return completeCurrentIndexerAction({ cwd: root, revision: current.revision,
      managed: true, authorities, value });
  };
  await advanceCurrentIndexerLifecycle(root);
  const partition = await route();
  const input = indexerAgentStepInputSchema.parse(partition.action?.input);
  if (input.stage !== "partition") throw new Error("expected Partition");
  const results = [];
  for (const task of input.tasks) {
    const resource = partition.resources.required.find((item) => item.id === task.workset_view_resource_id)!;
    const text = await readFile(resource.path!, "utf8");
    const workset = input.transport.worksets.find((item) => item.workset_digest === task.workset_digest)!;
    if (workset.stage !== "partition") throw new Error("expected Partition workset");
    results.push({ task_key: task.task_key, result: { stage: "partition", outcome: "complete",
      groups: [{ key: task.task_key, title: "Public constants", subject: task.task_key,
        subject_intent: "primary", reader_task: "Read exported constants.",
        members: readingItems(text, "consumer-anchor", task.task_key).map((item) => item.ref),
        questions: workset.reader_question_refs,
        question_targets: workset.allowed_question_target_refs.map((target) => ({ target, role: "primary-carrier" })),
        outline: ["Exports"] }], excluded: [], unsupported: [] } });
  }
  await complete({ stage: "partition", results });
  // Force separate Author transport batches, with real work still pending at delivery.
  const build = reading.buildIndexerTaskReading;
  const spy = spyOn(reading, "buildIndexerTaskReading").mockImplementation((...args) => {
    const task = build(...args);
    return { ...task, introduction: task.introduction + "\n" + "reading ".repeat(33_000) };
  });
  try {
    await complete({ stage: "structure-review", decision: "approved" });
    await advanceCurrentIndexerLifecycle(root);
    const author = await resolveCurrentIndexerAgentContext(root);
    expect(author?.descriptor.tasks).toHaveLength(1);
    const descriptor = author!.descriptor.tasks[0]!;
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: author!.descriptor, taskKey: descriptor.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author");
    const validation = task.spec.validation as unknown as {
      artifact_policy_eligibility: { eligible_variants: Array<{ id: string }> };
      allowed_artifact_intents: Array<{ source_role: string; document_kind: string; reader_goal: string; artifact_kind: string }>;
      canonical_inventory_members: IndexerInventoryMember[];
      allowed_question_targets: Array<{ question_target_key: string }>;
    };
    const current = await route();
    const resource = current.resources.required.find((item) => item.id === `authorized-indexer-workset-view/${descriptor.task_key}`)!;
    const source = readingObjects(await readFile(resource.path!, "utf8")).find((item) => Array.isArray(item.source_items))!;
    const intent = validation.allowed_artifact_intents[0]!;
    const authored = await complete({ stage: "author", results: [{ task_key: descriptor.task_key, result: {
      stage: "author", group_key: workset.group_key, outcome: "publish",
      artifact_intent: [intent.source_role, intent.document_kind, intent.reader_goal, intent.artifact_kind].join("/"),
      policy: validation.artifact_policy_eligibility.eligible_variants[0]!.id,
      title: "Public constants", summary: "Find the exported constant and its value.",
      target_resolutions: (workset.target_resolution_view?.entries ?? []).map((entry) => ({
        target: entry.query_ref, disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent",
      })),
      sections: [{ key: "exports", heading: "Public exports", markdown: "# Public exports\n\nThe source declares the exported constant at the public entry point.",
        source_items: source.source_items, facts: task.view.items.filter((item) => item.category === "fact").map((item) => item.ref),
        answers: validation.allowed_question_targets.map((item) => item.question_target_key) }],
      member_dispositions: validation.canonical_inventory_members.map((member) => ({ item: member.member_id, state: "covered", section: "exports" })),
      material_gaps: [], diagnostics: [],
    } }] });
    expect(authored).toMatchObject({ outcomes: [{ outcome: "accepted", committed: true }] });
    expect((await currentLedger(root))?.entries.some((entry) => entry.state === "pending")).toBe(true);
    expect(await readIndexerDelivery(root)).toBeUndefined();
    // The example prerequisite is absent: its empty result is settled by the
    // runtime. The actual code-symbol facts still delegate public-contract.
    for (const composer of ["public-contract"]) {
      const batch = (await readCurrentIndexerComposerBatch(root))!;
      expect(batch.tasks.map((item) => item.context.composer.id)).toEqual([composer]);
      const context = batch.tasks[0]!.context;
      expect(context.ledger.entries.find((entry) => entry.composer_ref.endsWith("#composer:examples-and-documentation"))?.state).toBe("accepted");
      const buildProposal = (source: string) => buildIndexerPostAuthorResultFromSemantic({
        request: context.request, primary_artifact_result: context.record.artifact_result,
        allowed_artifact_kinds: ["contract"], artifact_policy_variant: "standard",
        semantic: { stage: "post-author", outcome: "complete", diagnostics: [], proposals: [{
          target: "target:1", artifact_kind: "contract", title: "Public API", summary: "Read the public definition.",
          sections: [{ key: "api", heading: "API", markdown: "The exported declaration defines this API.", source_refs: [source] }],
        }] },
      });
      expect(buildProposal("fact:1")).toEqual(buildProposal(context.request.primary_result_view.facts[0]!.fact_ref));
      const completed = await complete({ stage: "post-author", results: batch.tasks.map((item) => ({
        task_key: item.task_key, result: { stage: "post-author", outcome: "complete", proposals: [], diagnostics: [] },
      })) });
      expect(completed).toMatchObject({ outcomes: [{ outcome: "accepted", committed: true }],
        composer_result: { accepted_tasks: 1, proposals: 0 } });
      if ("next" in completed) expect(completed.next?.node).not.toBe("resolve-current-indexer-block");
    }
    expect(await readCurrentIndexerComposerBatch(root)).toBeUndefined();
    expect((await readIndexerDelivery(root))?.current).toHaveLength(1);
    expect(await readCandidateRecords(root)).toHaveLength(1);
    expect((await currentLedger(root))?.entries.some((entry) => entry.state === "pending")).toBe(true);
  } finally { spy.mockRestore(); }
}, 45_000);
