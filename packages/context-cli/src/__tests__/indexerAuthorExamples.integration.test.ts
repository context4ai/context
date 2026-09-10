import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { indexerAuthorSemanticInputSchema } from "@c4a/context";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { acceptIndexerMainAuthorRunsStore } from "../project/indexerMainRunStore.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCurrentIndexerComposerBatch } from "../project/indexerCurrentComposer.js";

test("Agent-selected source examples retain full paths and versions through actual Author and Composer input", async () => {
  const paths = ["examples/basic/demo.tsx", "examples/advanced/demo.tsx"];
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1, sourceFiles: {
    "src/index.ts": "export const answer = 42;\n",
    [paths[0]!]: 'import {answer} from "../../src/index";\nexport const Basic = () => String(answer);\n',
    [paths[1]!]: 'import {answer} from "../../src/index";\nexport const Advanced = () => String(answer * 2);\n',
  } });
  try {
    const registryPath = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(registryPath, "utf8"));
    registry.indexers[0].profile.composers = [{ id: "examples-and-documentation", provider: "community" }];
    await writeFile(registryPath, YAML.stringify(registry));
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor,
      taskKey: current.descriptor.tasks[0]!.task_key });
    const workset = task.spec.request.workset;
    if (workset.stage !== "author") throw new Error("expected Author");
    const validation = task.spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
    const intent = validation.allowed_artifact_intents.find(item => item.artifact_kind === "content")!;
    const semantic = indexerAuthorSemanticInputSchema.parse({ stage: "author", group_key: workset.group_key,
      outcome: "publish", policy: "standard", artifact_intent: [intent.source_role, intent.document_kind, intent.reader_goal, intent.artifact_kind].join("/"),
      title: "Public constant examples", summary: "Find usage examples and their source entry.",
      target_resolutions: (workset.target_resolution_view?.entries ?? []).map(entry => ({
        target: entry.query_ref, disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent",
      })),
      example_candidates: paths.map(source_item => ({ source_item, scenario_key: "display-value" })),
      sections: [{ key: "entry", heading: "Usage entry", markdown: "Read src/index.ts and the supplied examples to inspect the displayed value.",
        source_items: ["src/index.ts", ...paths], answers: validation.allowed_question_targets.map(item => item.question_target_key) }],
      member_dispositions: validation.canonical_inventory_members.map(member => ({ item: member.member_id, state: "covered", section: "entry" })),
    });
    const build = (value = semantic) => buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request, view: task.view, validation, semantic: value });
    expect(() => build({ ...semantic, example_candidates: [{ source_item: "private/unread.tsx", scenario_key: "unavailable" }] })).toThrow("not authorized");
    const result = build();
    if (result.result.result.protocol !== "context.indexer.artifact-result/v1") throw new Error("expected ArtifactResult");
    const examples = result.result.result.facts.filter(fact => fact.fact_kind === "example-candidate");
    expect(examples).toHaveLength(2);
    expect(examples.map(fact => (fact.value as { full_relative_path: string }).full_relative_path).sort()).toEqual([...paths].sort());
    expect(new Set(examples.map(fact => (fact.value as { example_ref: string }).example_ref)).size).toBe(2);
    expect(examples.every(fact => fact.evidence_refs.length > 0)).toBe(true);
    const accepted = await acceptIndexerMainAuthorRunsStore({ projectRoot: root, runs: [{ workset_digest: workset.workset_digest, result }] });
    expect(accepted.outcomes).toMatchObject([{ outcome: "accepted" }]);
    await advanceCurrentIndexerLifecycle(root);
    const batch = (await readCurrentIndexerComposerBatch(root))!;
    expect(batch.tasks[0]!.context.composer.id).toBe("examples-and-documentation");
    const delivered = batch.tasks[0]!.context.request.primary_result_view.facts;
    expect(examples.every(fact => delivered.some(item => item.fact_ref === fact.fact_ref))).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
