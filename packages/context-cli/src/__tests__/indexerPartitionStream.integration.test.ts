import { placeApprovedReadingFixture } from "./knowledgeMapReview.fixture.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { prepareIndexerAuthorMaterial } from "../project/indexerAuthorMaterial.js";
import { applyIndexerAuthorMaterials } from "../project/indexerAuthorMaterialStore.js";
import { configureDeliveryCadence, readDeliveryCadence } from "../project/indexerDeliveryCadence.js";
import { currentIndexerProgress } from "../project/indexerCurrentProgress.js";
import { expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { acceptedCachePath, currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import { PARTITION_STREAM_PATH, partitionStreamRecord, readPartitionStream, resumePartitionStream } from "../project/indexerPartitionStream.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readKnowledgeStructure } from "../project/packageBuildInventory.js";
import YAML from "yaml";
import { hasChangedIndexerWorksetAuthority } from "../project/indexerCurrentRegistryFreshness.js";

async function declarePackage(root: string) {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "streaming", template: { path: "src/package-templates/kb", vars: {} } })]'));
}

test("ready themes deliver through structure/content review and build before remaining Partition tasks, then resume without replay", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 12 });
  try {
    await declarePackage(root);
    await completePartitionStage(root, false, true);
    const checkpoint = (await readPartitionStream(root))!;
    expect(checkpoint.phase).toBe("author");
    const accepted = checkpoint.partition_ledger.entries.filter(entry => entry.state === "accepted");
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.length).toBeLessThanOrEqual(checkpoint.partition_ledger.entries.length);
    const structure = (await currentIndexerStructureReview(root))!;
    expect(structure.preview.topics.length).toBeGreaterThan(0);
    expect(structure.preview.topics.length).toBeLessThanOrEqual(3);
    expect(structure.approved).toBe(false);
    expect((await currentLedger(root))!.entries.every(entry => entry.state === "pending")).toBe(true);
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    // Normal source expansion changes execution digests after the wave snapshot.
    await resolveCurrentIndexerAgentContext(root);
    const running = (await currentLedger(root))!.entries.find(entry => entry.state === "running")!;
    const beforeExpansion = await currentSpec({ projectRoot: root, request_digest: running.execution_request_digest });
    if (beforeExpansion.request.workset.stage !== "author") throw new Error("Expected Author");
    const material = await prepareIndexerAuthorMaterial({ projectRoot: root, spec: beforeExpansion,
      group_key: beforeExpansion.request.workset.group_key, source_hints: ["src"] });
    expect(material.spec.request.execution_request_digest).not.toBe(running.execution_request_digest);
    await applyIndexerAuthorMaterials({ projectRoot: root, materials: [material] });
    await completeAuthorStage(root);
    expect((await readCandidateRecords(root)).length).toBeGreaterThan(0);
    expect((await readPartitionStream(root))!.phase).toBe("author");
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await placeApprovedReadingFixture(root);
    // Closing does not erase planning or mark the wave delivered before build.
    expect((await readPartitionStream(root))!.phase).toBe("author");
    await acceptStarterPackageTemplates({ projectRoot: root });
    const config = await readFile(join(root, "src/index.ts"), "utf8");
    await writeFile(join(root, "src/index.ts"), config.replace('name: "streaming"', 'name: 123'));
    await expect(buildProjectPackages(root)).rejects.toThrow();
    expect((await readPartitionStream(root))!.phase).toBe("author");
    await writeFile(join(root, "src/index.ts"), config);
    await buildProjectPackages(root);
    expect((await readPartitionStream(root))!.phase).toBe("planning");
    expect((await currentIndexerProgress({ projectRoot: root }))!.workflow_progress.authored).toBe(structure.preview.topics.length);
    expect((await currentLedger(root))!.entries.filter(entry => entry.state === "accepted")).toEqual(accepted);
    expect((await readDeliveryCadence(root)).step).toBe(0); // failed build held this step
    const seen = new Set(structure.preview.topics.map(topic => topic.key));
    const sizes: number[] = [];
    for (let cycle = 0; cycle < 10 && await currentLedger(root); cycle++) {
      await completePartitionStage(root, false, true);
      const next = await currentIndexerStructureReview(root);
      if (!next) break;
      sizes.push(next.preview.topics.length);
      for (const topic of next.preview.topics) { expect(seen.has(topic.key)).toBe(false); seen.add(topic.key); }
      if (!next.approved) await completeCurrentIndexerStructureReview({ projectRoot: root, revision: next.revision, decision: "approved" });
      if (!next.preview.topics.length) { await advanceCurrentIndexerLifecycle(root); break; }
      await completeAuthorStage(root);
      await approveCandidates(root, await readCandidateRecords(root));
      await closeProjectWorkspace(root);
      await placeApprovedReadingFixture(root);
      await buildProjectPackages(root);
    }
    expect(sizes[0]).toBe(3);
    expect(seen.size).toBe(12);
    expect(await currentLedger(root)).toBeUndefined();
    expect((await readKnowledgeStructure(root)).parsed?.views).toHaveLength(12);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("a catalog-only ready wave resumes planning without waiting for nonexistent pages", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 40 });
  try {
    await configureDeliveryCadence(root, "1");
    await completePartitionStage(root, false, true, "catalog-subject");
    const first = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: first.revision, decision: "approved" });
    const result = await completeAuthorStage(root, { catalogOnlyFirst: true });
    expect(result.catalogOnlyCount).toBe(1);
    expect(await readCandidateRecords(root)).toHaveLength(0);
    expect((await readPartitionStream(root))!.phase).toBe("planning");
    expect((await currentLedger(root))!.entries.some(entry => entry.stage === "partition" && entry.state !== "accepted")).toBe(true);
    for (let wave = 0; wave < 40 && await currentLedger(root); wave++) {
      await completePartitionStage(root, false, true, "catalog-subject");
      const next = await currentIndexerStructureReview(root);
      if (!next) break;
      if (!next.approved) await completeCurrentIndexerStructureReview({ projectRoot: root, revision: next.revision, decision: "approved" });
      expect((await completeAuthorStage(root, { catalogOnlyFirst: true })).catalogOnlyCount).toBe(1);
    }
    expect(await readCandidateRecords(root)).toHaveLength(0);
    expect(await currentLedger(root)).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("larger streaming work amortizes later delivery waves while planning still has a remainder", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 80 });
  try {
    await declarePackage(root);
    await completePartitionStage(root, false, true);
    const waves: number[] = [];
    let intermediateDelivery = false;
    for (let cycle = 0; cycle < 20 && await currentLedger(root); cycle++) {
      const structure = await currentIndexerStructureReview(root);
      if (structure && !structure.approved) {
        waves.push(structure.preview.topics.length);
        await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
      }
      await completeAuthorStage(root);
      const candidates = await readCandidateRecords(root);
      if (candidates.length) {
        await approveCandidates(root, candidates);
        await closeProjectWorkspace(root);
        await placeApprovedReadingFixture(root);
        await acceptStarterPackageTemplates({ projectRoot: root });
        await buildProjectPackages(root);
      }
      const stream = await readPartitionStream(root);
      if (stream?.phase === "planning" && stream.completed_bindings.length > 3 &&
          stream.partition_ledger.entries.some(entry => entry.state !== "accepted")) intermediateDelivery = true;
      const ledger = await currentLedger(root);
      if (!ledger) break;
      if (ledger.entries[0]?.stage === "partition") await completePartitionStage(root, false, true);
      else await advanceCurrentIndexerLifecycle(root);
    }
    expect(waves[0]).toBeLessThanOrEqual(3);
    expect(waves.slice(1).some(count => count >= 30 && count <= 50)).toBe(true);
    expect(intermediateDelivery).toBe(true);
    expect((await readKnowledgeStructure(root)).parsed?.views).toHaveLength(80);
    expect(await currentLedger(root)).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 240000);

test("a ready wave delivers without requiring results from Indexers whose planning has not run yet", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 8 });
  try {
    await declarePackage(root);
    const path = join(root, "src/indexers.yaml");
    const config = YAML.parse(await readFile(path, "utf8"));
    config.requirements.push({ ...structuredClone(config.requirements[0]), id: "second-purpose" });
    config.indexers.push({ ...structuredClone(config.indexers[0]), id: "second-indexer",
      requirement_bindings: [{ ...config.indexers[0].requirement_bindings[0], requirement_ref: "second-purpose",
        owned_scope: { ref: "requirement:second-purpose#target_scope" } }],
      read_scope: { refs: ["requirement:second-purpose#target_scope"] } });
    await writeFile(path, YAML.stringify(config));
    await completePartitionStage(root, false, true);
    const ledger = (await currentLedger(root))!;
    expect(ledger.entries.every(entry => entry.stage === "author")).toBe(true);
    expect(new Set(ledger.entries.map(entry => entry.indexer_id)).size).toBe(1);
    expect(await hasChangedIndexerWorksetAuthority(root, ledger)).toBe(false);
    expect((await advanceCurrentIndexerLifecycle(root)).state).toBe("gate-required");
    expect(await currentLedger(root)).toEqual(ledger);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    await completeAuthorStage(root);
    let candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(0);
    expect((await readPartitionStream(root))!.phase).toBe("author");
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    await placeApprovedReadingFixture(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    expect((await readPartitionStream(root))!.phase).toBe("planning");
    await completePartitionStage(root, false, true);
    const remainder = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: remainder.revision, decision: "approved" });
    await completeAuthorStage(root);
    candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(0);
    expect((await readPartitionStream(root))!.partition_ledger.entries.every(entry => entry.state === "accepted")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("later material for an already delivered subject receives its approved prose and stable identity", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 40 });
  try {
    await configureDeliveryCadence(root, "1");
    await declarePackage(root);
    await completePartitionStage(root, false, true, "shared-capability");
    const first = (await currentIndexerStructureReview(root))!;
    expect(first.preview.topics).toHaveLength(1);
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: first.revision, decision: "approved" });
    await completeAuthorStage(root, { revisionSuffix: "Preserve this approved explanation." });
    const candidate = (await readCandidateRecords(root))[0]!;
    await approveCandidates(root, [candidate]);
    await closeProjectWorkspace(root);
    await placeApprovedReadingFixture(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    await completePartitionStage(root, false, true, "shared-capability");
    const next = (await currentIndexerStructureReview(root))!;
    expect(next.preview.topics).toHaveLength(1);
    expect(next.preview.topics[0]!.target.mode).toBe("enrich");
    expect(next.preview.topics[0]!.subject_key).toEqual(first.preview.topics[0]!.subject_key);
    const ledger = (await currentLedger(root))!;
    const spec = await currentSpec({ projectRoot: root, request_digest: ledger.entries[0]!.execution_request_digest });
    expect(spec.request.workset.repair_intent?.current_markdown).toContain("Preserve this approved explanation.");
    expect(spec.request.workset.repair_intent?.current_markdown).toContain(candidate.path);
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: next.revision, decision: "approved" });
    await completeAuthorStage(root);
    expect((await readCandidateRecords(root))[0]!.path).toBe(candidate.path);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("structure feedback invalidates only the wave's planning inputs and interrupted resume is repeatable", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 24 });
  try {
    await completePartitionStage(root, false, true);
    const first = (await currentIndexerStructureReview(root))!;
    const checkpoint = (await readPartitionStream(root))!;
    const members = new Set(first.preview.topics.flatMap(topic => topic.members));
    const peers = [];
    for (const entry of checkpoint.partition_ledger.entries.filter(entry => entry.state === "accepted")) {
      const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
      if (!(spec.validation.canonical_inventory_members as Array<{ member_id: string }>).some(member => members.has(member.member_id))) peers.push(entry);
    }
    expect(peers.length).toBeGreaterThan(0);
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: first.revision,
      decision: "request-adjustment", feedback: "Reconsider the selected reader task using the same source boundary." });
    const revised = (await currentLedger(root))!;
    for (const peer of peers) {
      expect(revised.entries.find(entry => entry.workset_digest === peer.workset_digest)).toEqual(peer);
      expect(await readFile(join(root, acceptedCachePath(peer.execution_request_digest)), "utf8")).toContain(peer.execution_request_digest);
    }
    expect(revised.entries.some(entry => entry.state === "stale")).toBe(true);
    const { digest: _digest, ...payload } = (await readPartitionStream(root))!; void _digest;
    await writeFile(join(root, PARTITION_STREAM_PATH), JSON.stringify(partitionStreamRecord({ ...payload, phase: "resuming" })));
    const attempts = await Promise.allSettled([resumePartitionStream(root), resumePartitionStream(root)]);
    expect(attempts.filter(result => result.status === "fulfilled" && result.value === true)).toHaveLength(1);
    for (const result of attempts) if (result.status === "rejected") expect(String(result.reason)).toContain("write lock is already held");
    expect(await resumePartitionStream(root)).toBe(false);
    expect(await currentLedger(root)).toEqual(revised);
    const next = await advanceCurrentIndexerLifecycle(root);
    expect(next.state).not.toBe("complete");
    // An unaffected ready theme can legitimately reach structure Review first.
    expect((await currentLedger(root))!.entries.some(entry => entry.state === "running") ||
      (await currentIndexerStructureReview(root)) !== undefined).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("a confirmed scope below ten themes stays in one delivery and closes without another planning gate", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 8 });
  try {
    await declarePackage(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await completePartitionStage(root, false, true);
    const review = (await currentIndexerStructureReview(root))!;
    expect(review.preview.topics).toHaveLength(8);
    expect((await readPartitionStream(root))?.final_wave).toBe(true);
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    await completeAuthorStage(root);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await placeApprovedReadingFixture(root);
    await buildProjectPackages(root);
    expect(await currentLedger(root)).toBeUndefined();
    expect((await readKnowledgeStructure(root)).parsed?.views).toHaveLength(8);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
