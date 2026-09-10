import { placeApprovedReadingFixture } from "./knowledgeMapReview.fixture.js";
import { test, expect } from "bun:test";
import { cp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { configureDeliveryCadence } from "../project/indexerDeliveryCadence.js";
import { readPartitionStream } from "../project/indexerPartitionStream.js";
import { readCurrentIndexerFinalization } from "../project/indexerCurrentFinalization.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { collectProjectStatus } from "../project/status.js";

test("all planned Indexers can deliver an early Author wave before global responsibility reconciliation", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    const registryPath = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(registryPath, "utf8"));
    const originalRequirement = registry.requirements[0];
    const originalIndexer = registry.indexers[0];
    registry.requirements = []; registry.indexers = [];
    for (const id of ["adoption", "maintenance", "contracts", "architecture"]) {
      registry.requirements.push({ ...structuredClone(originalRequirement), id });
      registry.indexers.push({ ...structuredClone(originalIndexer), id,
        requirement_bindings: [{ ...originalIndexer.requirement_bindings[0], requirement_ref: id,
          owned_scope: { ref: `requirement:${id}#target_scope` } }],
        read_scope: { refs: [`requirement:${id}#target_scope`] } });
    }
    await writeFile(registryPath, YAML.stringify(registry));
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "entries", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await configureDeliveryCadence(root, "2");
    await completePartitionStage(root);
    const stream = (await readPartitionStream(root))!;
    expect(stream.partition_ledger.entries.every(item => item.state === "accepted")).toBe(true);
    expect(stream.final_wave).toBe(false);
    let sawEarlyDelivery = false;
    for (let wave = 0; wave < 6; wave++) {
      const review = await currentIndexerStructureReview(root);
      if (review && !review.approved) await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
      await completeAuthorStage(root);
      expect((await readCurrentIndexerFinalization(root))?.state).not.toBe("blocked");
      const candidates = await readCandidateRecords(root);
      expect(candidates.length).toBeGreaterThan(0);
      if ((await readPartitionStream(root))?.final_wave === false) sawEarlyDelivery = true;
      await approveCandidates(root, candidates);
      await closeProjectWorkspace(root);
    await placeApprovedReadingFixture(root);
      await acceptStarterPackageTemplates({ projectRoot: root });
      await (await import("./workspaceVersionDelivery.fixture.js")).recordFixtureVersionIfRequired(root);
      await buildProjectPackages(root);
      if ((await collectProjectStatus(root, { managed: true })).workflow.status === "complete") break;
      await advanceCurrentIndexerLifecycle(root);
    }
    expect(sawEarlyDelivery).toBe(true);
    expect((await collectProjectStatus(root, { managed: true })).workflow.status).toBe("complete");
    const { readWorkspaceChangelog } = await import("../project/workspaceChangelog.js");
    expect(await readWorkspaceChangelog(root)).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 90000);
