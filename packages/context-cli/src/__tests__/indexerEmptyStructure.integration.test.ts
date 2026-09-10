import { afterEach, expect, spyOn, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { type IndexerInventoryMember, type IndexerRegistry } from "@c4a/context";
import { createDocumentRevisionWorkspace, documentRevisionOuterIndexerRoute, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { projectCurrentIndexerWorkflowRoute, resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { prepareIndexerMainRunStore } from "../project/indexerMainRunStore.js";
import { prepareCurrentIndexerAuthorStage } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerStructureReview, currentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { hasChangedIndexerWorksetAuthority } from "../project/indexerCurrentRegistryFreshness.js";
import { readProjectIndexerCandidateCompileStatus } from "../project/indexerCandidateCompileActions.js";
import { readProjectCloseStatus } from "../project/close.js";
import * as close from "../project/close.js";
import * as cleanup from "../project/lifecycleCleanup.js";
import { collectProjectStatus } from "../project/status.js";
import { beginKnowledgeUpdate } from "../project/knowledgeUpdate.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const route = (projectRoot: string) => projectCurrentIndexerWorkflowRoute({ projectRoot, route: documentRevisionOuterIndexerRoute(), managed: true, authorities: [] });
async function workspace(twoIndexers = false) {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  if (twoIndexers) {
    const path = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(path, "utf8")) as IndexerRegistry;
    const requirement = structuredClone(registry.requirements[0]!);
    requirement.id = "excluded-knowledge";
    const indexer = structuredClone(registry.indexers[0]!);
    indexer.id = "excluded-indexer";
    indexer.requirement_bindings[0]!.requirement_ref = requirement.id;
    indexer.requirement_bindings[0]!.owned_scope = { ref: `requirement:${requirement.id}#target_scope` };
    indexer.read_scope.refs = [`requirement:${requirement.id}#target_scope`];
    registry.requirements.push(requirement); registry.indexers.push(indexer);
    await writeFile(path, YAML.stringify(registry));
  }
  return root;
}
async function finishPlanning(root: string, preserveFirstIndexer = false) {
  await advanceCurrentIndexerLifecycle(root);
  for (;;) {
    const current = await resolveCurrentIndexerAgentContext(root);
    if (!current || current.descriptor.stage !== "partition") break;
    const results = [];
    for (const item of current.descriptor.tasks) {
      const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor, taskKey: item.task_key });
      const workset = task.spec.request.workset;
      if (workset.stage !== "partition") throw new Error("expected Partition");
      const validation = task.spec.validation as { canonical_inventory_members: IndexerInventoryMember[]; required_question_target_refs?: string[] };
      const include = preserveFirstIndexer && workset.indexer_id === "revision-fixture";
      results.push({ task_key: item.task_key, result: { stage: "partition", outcome: "complete",
        groups: include ? [{ key: workset.workset_digest, title: "Public API", reader_task: "Use this capability",
          subject: { namespace: workset.partition_subject_key.namespace, kind: workset.partition_subject_key.kind, local_key: workset.workset_digest },
          subject_intent: "primary", members: validation.canonical_inventory_members.map((member) => member.member_id),
          questions: workset.reader_question_refs, question_targets: (validation.required_question_target_refs ?? []).map((target) => ({ target, role: "primary-carrier" })), outline: ["API"] }] : [],
        excluded: include ? [] : validation.canonical_inventory_members.map((member) => ({ item: member.member_id, reason_code: "outside-reader-scope" })), unsupported: [] } });
    }
    const currentRoute = (await route(root))!;
    const receipt = await completeCurrentIndexerAction({ cwd: root, revision: currentRoute.revision, managed: true, value: { stage: "partition", results } });
    expect(receipt).toMatchObject({ outcomes: results.map((item) => ({ task_key: item.task_key, outcome: "accepted", committed: true })) });
  }
  return (await currentIndexerStructureReview(root))!;
}

test("an entirely excluded scope remains reviewable and completes without fake Author pages or a lingering task", async () => {
  const root = await workspace();
  const review = await finishPlanning(root);
  expect(review.preview.topics).toHaveLength(0);
  expect(review.preview.excluded.length).toBeGreaterThan(0);
  expect((await currentLedger(root))!.entries.every((entry) => entry.stage === "partition" && entry.state === "accepted")).toBe(true);
  expect((await route(root))!.node).toBe("review-current-indexer-structure");
  // Restore the prior CLI's empty Author ledger without discarding accepted
  // Partition receipts; lifecycle must recover the same unapproved preview.
  const plan = JSON.parse(await readFile(join(root, ".tmp/context-runtime/indexer/structure-review/author-plan.json"), "utf8"));
  await prepareIndexerMainRunStore({ projectRoot: root, workset_set: plan.workset_set, run_specs: plan.run_specs });
  expect((await currentLedger(root))!.entries).toHaveLength(0);
  await advanceCurrentIndexerLifecycle(root);
  expect((await currentIndexerStructureReview(root))?.revision).toBe(review.revision);
  await completeCurrentIndexerAction({ cwd: root, revision: review.revision, managed: true, value: { stage: "structure-review", decision: "approved", knowledge_map: { expected_revision: null, upsert: [], remove: [] } } });
  expect(await currentLedger(root)).toBeUndefined();
  expect((await readProjectCloseStatus(root)).state).toBe("ready");
  expect((await readProjectIndexerCandidateCompileStatus(root)).candidates).toHaveLength(0);
  expect(await beginKnowledgeUpdate(root, { scopes: [{ requirement_ref: "workspace-knowledge", source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] }] })).toMatchObject({ outcome: "update-prepared" });
}, 30_000);

test("an empty plan can be adjusted, and an approved plan remains recoverable until close and cleanup finish", async () => {
  const root = await workspace();
  const review = await finishPlanning(root);
  await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "request-adjustment", feedback: "Include the public API after all." });
  expect(await currentIndexerStructureReview(root)).toBeUndefined();
  const updated = await finishPlanning(root);
  await completeCurrentIndexerStructureReview({ projectRoot: root, revision: updated.revision, decision: "approved" });
  expect(await readProjectIndexerCandidateCompileStatus(root)).toMatchObject({ state: "missing", revision_pending: true });
  expect((await route(root))?.node).toBe("advance-current-indexer-lifecycle");
  const closeSpy = spyOn(close, "closeProjectWorkspace").mockRejectedValueOnce(new Error("injected close failure"));
  try { await expect(advanceCurrentIndexerLifecycle(root)).rejects.toThrow("injected close failure"); }
  finally { closeSpy.mockRestore(); }
  expect(await readProjectIndexerCandidateCompileStatus(root)).toMatchObject({ revision_pending: true });
  expect((await route(root))?.node).toBe("advance-current-indexer-lifecycle");
  const cleanupSpy = spyOn(cleanup, "clearCompletedLifecycle").mockRejectedValueOnce(new Error("injected cleanup failure"));
  try { await expect(advanceCurrentIndexerLifecycle(root)).rejects.toThrow("injected cleanup failure"); }
  finally { cleanupSpy.mockRestore(); }
  expect((await readProjectCloseStatus(root)).state).toBe("ready");
  expect((await collectProjectStatus(root, { managed: true })).workflow.current?.node).toBe("advance-current-indexer-lifecycle");
  expect(await advanceCurrentIndexerLifecycle(root)).toMatchObject({ state: "complete" });
  expect(await currentLedger(root)).toBeUndefined();
}, 30_000);

test("an Indexer with no planned pages does not invalidate its sibling Author tasks, but changed requirements do", async () => {
  const root = await workspace(true);
  const review = await finishPlanning(root, true);
  expect(review.preview.topics.length).toBeGreaterThan(0);
  await prepareCurrentIndexerAuthorStage(root);
  const before = (await currentLedger(root))!;
  expect(new Set(before.entries.map((entry) => entry.indexer_id))).toEqual(new Set(["revision-fixture"]));
  expect(await hasChangedIndexerWorksetAuthority(root, before)).toBe(false);
  await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
  expect((await route(root))?.node).toBe("run-indexer-agent-step");
  const path = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(path, "utf8")) as IndexerRegistry;
  registry.requirements[1]!.purpose = "Include the previously excluded material in a new reader task.";
  await writeFile(path, YAML.stringify(registry));
  expect(await hasChangedIndexerWorksetAuthority(root, await currentLedger(root))).toBe(true);
  expect((await route(root))?.node).toBe("advance-current-indexer-lifecycle");
}, 30_000);

test("an exclusion that removes every parser input returns a scope configuration Route and resumes after correction", async () => {
  const root = await workspace();
  const path = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(path, "utf8")) as IndexerRegistry;
  registry.requirements[0]!.exclusions = [{ id: "unused-source", reason: "These files do not serve the reader task",
    scope: registry.requirements[0]!.target_scope, paths: ["src", "package.json"] }];
  await writeFile(path, YAML.stringify(registry));
  expect(await advanceCurrentIndexerLifecycle(root)).toMatchObject({ state: "gate-required" });
  const blocked = (await route(root))!;
  expect(blocked.node).toBe("resolve-current-indexer-block");
  expect(blocked.configuration?.file).toBe("src/indexers.yaml");
  expect(blocked.configuration?.action).toContain("unused-source");
  expect(blocked.configuration?.action).toContain(DOCUMENT_REVISION_SOURCE_REF);
  expect(await currentLedger(root)).toBeUndefined();
  // The CLI does not restore any explicitly excluded file on its own.
  expect(YAML.parse(await readFile(path, "utf8")).requirements[0].exclusions).toEqual(registry.requirements[0]!.exclusions);
  registry.requirements[0]!.exclusions[0]!.paths = ["src/secondary.ts"];
  await writeFile(path, YAML.stringify(registry));
  expect((await route(root))?.node).toBe("advance-current-indexer-lifecycle");
  expect(await advanceCurrentIndexerLifecycle(root)).toMatchObject({ state: "agent-required" });
  expect((await route(root))?.node).toBe("run-indexer-agent-step");
}, 30_000);
