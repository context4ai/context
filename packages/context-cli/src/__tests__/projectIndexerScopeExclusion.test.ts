import YAML from "yaml";
import { buildProjectIndexerMainAuthorWorksets } from "../project/indexerMainLifecycleActions.js";
import { resolveCurrentIndexerWorkflowRoute } from "../project/indexerCurrentWorkflowRoute.js";
import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadIndexerRegistry, validateIndexerPartitionInputs } from "@c4a/context";
import { project } from "./projectIndexerMainLifecycleV070.fixture.js";
import { preparePartitionStage } from "../project/indexerPartitionStage.js";
import { currentLedger, currentSpec, acceptedCachePath } from "../project/indexerMainRunStoreRecords.js";
import { startIndexerMainRunStore, acceptIndexerMainRunStore } from "../project/indexerMainRunStore.js";
import { prepareProjectIndexerWorksetViewMaterialization } from "../project/indexerWorksetViewMaterialization.js";
import { buildIndexerPartitionRunResultFromSemantic } from "../project/indexerSemanticPartitionResult.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "../project/indexerCurrentPrimaryAuthority.js";
import { persistIndexerSemanticResult } from "../project/indexerCurrentActionShared.js";
import { completeCurrentIndexerStructureReview, prepareCurrentIndexerStructurePlan,
  prepareCurrentIndexerAuthorStage } from "../project/indexerStructureReview.js";
import { excludeIndexerPartitionMembers } from "../project/indexerPartitionScope.js";
import type { IndexerConsumerWorksetProjection } from "../project/indexerConsumerWorksetPlanner.js";
import type { IndexerPartitionValidationInput } from "@c4a/context";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("explicit obsolete exclusion keeps accepted partitions and starts only current Author work", async () => {
  const { root } = await project({ rankedCodeInventory: true, deprecatedEntry: true });
  roots.push(root);
  const oldPath = join(root, "sources/repo/20260902/sample/src/deprecated/index.ts");
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
    projectRoot: root, registry: (await loadIndexerRegistry(root)).registry, indexer_id: "component-library",
  });
  const unit = authority.manifest.provides.logical_units!.find((item) => item.artifacts !== undefined)!;
  const ledger = await preparePartitionStage(root);
  const cached = new Map<string, string>();
  const partitions: IndexerPartitionValidationInput[] = [];
  const projections = new Map<string, IndexerConsumerWorksetProjection>();
  for (const entry of ledger!.entries) {
    const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    const workset = spec.request.workset;
    if (workset.stage !== "partition") throw new Error("expected Partition");
    const projection = spec.validation.partition_projection as IndexerConsumerWorksetProjection;
    projections.set(workset.workset_digest, projection);
    const validation = spec.validation as Parameters<typeof buildIndexerPartitionRunResultFromSemantic>[0]["validation"];
    const prepared = await prepareProjectIndexerWorksetViewMaterialization({ projectRoot: root, run_spec: spec });
    const semantic: Parameters<typeof buildIndexerPartitionRunResultFromSemantic>[0]["semantic"] = {
      stage: "partition", outcome: "complete", groups: projection.unresolved ? [] : [{
        key: workset.workset_digest, title: "Public entry", reader_task: "Locate the public API.",
        subject: { namespace: workset.partition_subject_key.namespace, kind: workset.partition_subject_key.kind,
          local_key: workset.workset_digest }, subject_intent: "primary",
        members: validation.canonical_inventory_members.map((member) => member.member_id),
        questions: [...workset.reader_question_refs],
        question_targets: (validation.required_question_target_refs ?? []).map((target) => ({ target, role: "primary-carrier" })),
        outline: ["Exports"],
      }], excluded: projection.unresolved ? validation.canonical_inventory_members.map((member) => ({
        item: member.member_id, reason_code: "no-public-api",
      })) : [], unsupported: [],
    };
    const result = buildIndexerPartitionRunResultFromSemantic({ request: spec.request, view: prepared.projection.view,
      validation: { ...validation, partition_unit_type: unit.id }, semantic });
    await startIndexerMainRunStore({ projectRoot: root, workset_digest: workset.workset_digest });
    await acceptIndexerMainRunStore({ projectRoot: root, workset_digest: workset.workset_digest, result });
    await persistIndexerSemanticResult({ projectRoot: root, requestDigest: spec.request.execution_request_digest, semantic });
    const path = join(root, acceptedCachePath(spec.request.execution_request_digest));
    cached.set(path, await readFile(path, "utf8"));
    partitions.push({ ...spec.validation, plan: result.result.result, workset } as unknown as IndexerPartitionValidationInput);
  }
  const review = await prepareCurrentIndexerStructurePlan(root);
  expect(review.preview.obsolete_scope?.affected_page_count).toBe(1);
  const managed = await resolveCurrentIndexerWorkflowRoute({ projectRoot: root, authorities: [], managed: true });
  expect(managed?.availability).toBe("immediate");
  expect(managed?.gate?.resolution).toBe("session-authority");
  const ordinary = await resolveCurrentIndexerWorkflowRoute({ projectRoot: root, authorities: [], managed: false });
  expect(ordinary?.availability).toBe("requires-user");
  const storedPlan = JSON.parse(await readFile(join(root, ".tmp/context-runtime/indexer/structure-review/author-plan.json"), "utf8"));
  const excluded = new Set<string>(storedPlan.obsolete_member_ids);
  expect(JSON.stringify(review.preview.obsolete_scope)).not.toContain("member_ids");
  const scoped = excludeIndexerPartitionMembers(partitions, excluded);
  expect(() => validateIndexerPartitionInputs(scoped)).not.toThrow();
  expect(scoped.flatMap((item) => (item.plan as { groups: unknown[] }).groups)).toHaveLength(review.preview.topics.length - 1);
  // Also exercise a partial (mixed-page) scope change, retaining its siblings.
  const mixed = partitions.find((item) => (item.plan as { groups: { member_ids: string[] }[] }).groups.some((group) => group.member_ids.length > 1))!;
  const members = (mixed.plan as { groups: { member_ids: string[] }[] }).groups[0]!.member_ids;
  const narrowed = excludeIndexerPartitionMembers([mixed], new Set([members[0]!]));
  expect(() => validateIndexerPartitionInputs(narrowed)).not.toThrow();
  expect((narrowed[0]!.plan as { groups: { member_ids: string[] }[] }).groups[0]!.member_ids).toEqual(members.slice(1));
  const scopedAuthor = await buildProjectIndexerMainAuthorWorksets({ projectRoot: root, source_projections: projections, value: {
    protocol: "context.indexer.main-author-workset-build-input/v1",
    partitions: excludeIndexerPartitionMembers(partitions, new Set([members[0]!])),
    target_resolution_views: [],
  } });
  if (!("run_specs" in scopedAuthor)) throw new Error("expected scoped Author runs");
  const changedSpec = scopedAuthor.run_specs.find((spec) => (spec.validation.page_plan as {
    scope_change?: unknown } | undefined)?.scope_change !== undefined)!;
  expect(changedSpec).toBeDefined();
  expect(changedSpec.validation.page_plan).toMatchObject({ scope_change: { removed_member_ids: [members[0]!] } });
  expect(changedSpec.validation.page_plan).not.toHaveProperty("artifact_intent");
  expect(changedSpec.validation.page_plan).not.toHaveProperty("template_id");
  const changedView = await prepareProjectIndexerWorksetViewMaterialization({ projectRoot: root, run_spec: changedSpec });
  const authorityItem = changedView.projection.view.items.find((item) => item.category === "author-authority");
  expect(authorityItem?.value).toMatchObject({ page_plan: { scope_change: { removed_member_ids: [members[0]!] } } });
  expect(excludeIndexerPartitionMembers(narrowed, new Set([members[0]!]))).toEqual(narrowed);
  await prepareCurrentIndexerAuthorStage(root);
  expect(await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision,
    decision: "exclude-obsolete" })).toBe("author");
  const after = await currentLedger(root);
  expect(after!.entries).toHaveLength(review.preview.topics.length - 1);
  expect(after!.entries.every((entry) => entry.stage === "author")).toBe(true);
  for (const [path, content] of cached) expect(await readFile(path, "utf8")).toBe(content);
  expect(await readFile(oldPath, "utf8")).toContain("@deprecated");
  // Repreparation must not reintroduce the explicitly excluded targets.
  const restored = await preparePartitionStage(root);
  expect(restored!.entries.every((entry) => entry.state === "accepted")).toBe(true);
  const repeated = await prepareCurrentIndexerStructurePlan(root);
  expect(repeated.preview.topics).toHaveLength(after!.entries.length);
  expect(repeated.preview.obsolete_scope?.affected_page_count).toBe(0);
  expect(repeated.approved).toBe(true);
  const acceptedDigests = restored!.entries.map((entry) => entry.execution_request_digest);
  expect(await completeCurrentIndexerStructureReview({ projectRoot: root,
    revision: repeated.revision, decision: "exclude-obsolete" })).toBe("author");
  expect((await currentLedger(root))!.entries.every((entry) => entry.stage === "author")).toBe(true);
  for (const request of acceptedDigests) expect(await readFile(join(root, acceptedCachePath(request)), "utf8")).toBeTruthy();
}, 60_000);


test("settled path exclusions remove inventory before Partition without removing captured sources", async () => {
  const { root } = await project({ rankedCodeInventory: true, deprecatedEntry: true });
  roots.push(root);
  const path = join(root, "src/indexers.yaml");
  const registry = YAML.parse(await readFile(path, "utf8"));
  for (const requirement of registry.requirements) requirement.exclusions = [{
    id: "exclude-retired", reason: "User selected current APIs", scope: requirement.target_scope,
    paths: ["src/deprecated"],
  }];
  await writeFile(path, YAML.stringify(registry));
  const ledger = await preparePartitionStage(root);
  expect(ledger!.entries.length).toBeGreaterThan(0);
  for (const entry of ledger!.entries) {
    const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    const view = await prepareProjectIndexerWorksetViewMaterialization({ projectRoot: root, run_spec: spec });
    expect(JSON.stringify(view.projection.view)).not.toContain("src/deprecated/index.ts");
  }
  expect(await readFile(join(root, "sources/repo/20260902/sample/src/deprecated/index.ts"), "utf8")).toContain("@deprecated");
});
