import { afterEach, expect, test } from "bun:test";
import { rm, readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
import { join } from "node:path";
import { loadSourcesRegistry, loadIndexerRegistry, buildIndexerPrimaryRegistryProjection, buildIndexerRequirementInspection, buildIndexerRequirementWorksetReport, type IndexerRegistry } from "@c4a/context";
import { scopedIndexerSourceBoundaryDigest, currentIndexerSourceBoundaryDigest } from "../project/indexerSourceBoundary.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { selectedIndexerExclusions } from "../project/indexerScopeExclusions.js";
import { targetRegistry } from "../project/indexerRequirementProject.js";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("parser identity ignores unrelated sources but binds the selected source version and module scope", async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const before = await currentIndexerSourceBoundaryDigest(root, "revision-fixture");
  await importManagedDocument(root, { type: "note", name: "20260907/unrelated.md", markdown: "# Saved for another task" });
  expect(await currentIndexerSourceBoundaryDigest(root, "revision-fixture")).toBe(before);
  const sources = await loadSourcesRegistry({ rootDir: root });
  const exclusions = selectedIndexerExclusions((await loadIndexerRegistry(root)).registry, "revision-fixture");
  const target = { source_ref: DOCUMENT_REVISION_SOURCE_REF, module_refs: ["module:app"] };
  expect(scopedIndexerSourceBoundaryDigest(sources, [target], exclusions)).toBe(before);
  expect(scopedIndexerSourceBoundaryDigest({ ...sources, repos: sources.repos.map((source) => ({ ...source, ref: "b".repeat(40) })) }, [target], exclusions)).not.toBe(before);
  expect(scopedIndexerSourceBoundaryDigest(sources, [{ ...target, module_refs: ["module:other"] }], exclusions)).not.toBe(before);
});

test("changing a requirement retains independently bound Indexers and their customization", async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const current: IndexerRegistry = YAML.parse(await readFile(join(root, "src/indexers.yaml"), "utf8"));
  const original = current.requirements[0]!;
  current.requirements.push({ ...original, id: "other" });
  const indexer = current.indexers[0]!;
  current.indexers.push({ ...indexer, id: "other-indexer",
    requirement_bindings: indexer.requirement_bindings.map((binding) => ({ ...binding, requirement_ref: "other", owned_scope: { ref: "requirement:other#target_scope" } })),
    read_scope: { refs: ["requirement:other#target_scope"] } });
  const inspection = buildIndexerRequirementInspection({ source_boundary_digest: `sha256:${"a".repeat(64)}`,
    value: { protocol: "context.indexer.requirement-inspection-input/v1", project_ref: "project:scoped",
      requirements: [original, { ...original, id: "other", purpose: "Explain operation instead of integration." }] } });
  const report = buildIndexerRequirementWorksetReport({ inspection,
    base_requirement_set: { protocol: "context.indexer.requirement-set/v1", requirements: current.requirements } });
  const result = targetRegistry({ current, report });
  expect(result.invalidatedCount).toBe(1);
  expect(result.registry.indexers).toEqual([indexer]);
});


test("workset authority binds actual requirement meaning without depending on unrelated requirements", async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const { registry } = await loadIndexerRegistry(root);
  const projection = () => buildIndexerPrimaryRegistryProjection({ registry, indexer_id: "revision-fixture" }).projection_digest;
  const before = projection();
  registry.requirements.push({ ...registry.requirements[0]!, id: "unrelated", coverage_domains: { architecture: "optional" }, purpose: "A separate reader task." });
  expect(projection()).toBe(before);
  registry.requirements[0]!.purpose = "Explain a different reader task.";
  expect(projection()).not.toBe(before);
});

test("adding unrelated requirements preserves prepared Partition request identities and readable views", async () => {
  const { preparePartitionStage } = await import("../project/indexerPartitionStage.js");
  const { currentSpec } = await import("../project/indexerMainRunStoreRecords.js");
  const { prepareProjectIndexerWorksetViewMaterialization } = await import("../project/indexerWorksetViewMaterialization.js");
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const before = await preparePartitionStage(root);
  expect(before!.entries.length).toBeGreaterThan(0);
  const { registry } = await loadIndexerRegistry(root);
  registry.requirements.push({ ...registry.requirements[0]!, id: "unrelated", coverage_domains: { architecture: "optional" }, purpose: "Future independent work." });
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify(registry));
  const after = await preparePartitionStage(root);
  expect(after!.entries.map((entry) => entry.execution_request_digest)).toEqual(before!.entries.map((entry) => entry.execution_request_digest));
  const spec = await currentSpec({ projectRoot: root, request_digest: after!.entries[0]!.execution_request_digest });
  const view = await prepareProjectIndexerWorksetViewMaterialization({ projectRoot: root, run_spec: spec });
  expect(view.request.execution_request_digest).toBe(spec.request.execution_request_digest);
}, 60_000);

test("same-task source adjustment invalidates selected worksets and retains accepted independent sources", async () => {
  const { symlink } = await import("node:fs/promises");
  const { completePartitionStage, completeAuthorStage } = await import("./projectDocumentRevisionStages.fixture.js");
  const { adjustCurrentTaskSources } = await import("../project/taskSourceAdjustment.js");
  const { currentLedger, currentSpec } = await import("../project/indexerMainRunStoreRecords.js");
  const { preparePartitionStage } = await import("../project/indexerPartitionStage.js");
  const { assertSourceInputMutable } = await import("../project/sourceInputMutation.js");
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const registryPath = join(root, "src/indexers.yaml");
  const registry: IndexerRegistry = YAML.parse(await readFile(registryPath, "utf8"));
  const peerRef = "repo:20260903/peer";
  const requirement = registry.requirements[0]!;
  registry.requirements.push({ ...requirement, id: "peer",
    target_scope: { targets: [{ source_ref: peerRef, module_refs: ["module:app"] }] },
    evidence_source_scope: { targets: [{ source_ref: peerRef, module_refs: ["module:app"] }] } });
  registry.indexers.push({ ...registry.indexers[0]!, id: "peer",
    requirement_bindings: [{ ...registry.indexers[0]!.requirement_bindings[0]!, requirement_ref: "peer", owned_scope: { ref: "requirement:peer#target_scope" } }],
    read_scope: { refs: ["requirement:peer#target_scope"] } });
  await writeFile(registryPath, YAML.stringify(registry));
  const sourcePath = join(root, "sources/repo/index.yaml");
  const sources = YAML.parse(await readFile(sourcePath, "utf8"));
  sources.sources[0].modules.push({ ...sources.sources[0].modules[0], name: "peer", materializedAt: "sources/repo/20260903/peer" });
  await writeFile(sourcePath, YAML.stringify(sources));
  await symlink(join(root, "fixture-source"), join(root, "sources/repo/20260903/peer"));
  await completePartitionStage(root);
  const { currentIndexerStructureReview } = await import("../project/indexerStructureReview.js");
  const { completeCurrentIndexerAction } = await import("./knowledgeMapReview.fixture.js");
  const structure = (await currentIndexerStructureReview(root))!;
  await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
    value: { stage: "structure-review", decision: "approved" } });
  await completeAuthorStage(root);
  const before = (await currentLedger(root))!;
  const peer = [];
  for (const entry of before.entries) {
    const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    if (spec.request.workset.source_ref === peerRef) {
      if (entry.state !== "accepted") throw new Error("Expected the independent fixture workset to be accepted");
      peer.push(entry);
    }
  }
  expect(peer.length).toBeGreaterThan(0);
  await expect(assertSourceInputMutable(root, DOCUMENT_REVISION_SOURCE_REF)).rejects.toThrow("active Indexer");
  const result = await adjustCurrentTaskSources(root, { instruction: "Refresh this source within the existing task.", scopes: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF }] });
  expect("retained_worksets" in result && result.retained_worksets).toBe(peer.length);
  expect((await currentLedger(root))!.entries.filter((entry) => entry.state === "accepted")).toEqual(peer);
  await assertSourceInputMutable(root, DOCUMENT_REVISION_SOURCE_REF);
  await expect(assertSourceInputMutable(root, peerRef)).rejects.toThrow("active Indexer");
  await preparePartitionStage(root);
  await completePartitionStage(root);
  const rebuilt = (await currentLedger(root))!;
  expect(rebuilt.entries.filter((entry) => entry.state === "accepted")).toEqual(peer);
}, 60_000);
