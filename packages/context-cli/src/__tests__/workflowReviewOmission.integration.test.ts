import { afterEach, expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { completeAuthorStage, completePartitionStage } from "./projectDocumentRevisionStages.fixture.js";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { readRejectedDecisions } from "../project/reviewDecisions.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { collectProjectStatus } from "../project/status.js";
import { readIndexerDelivery } from "../project/indexerDelivery.js";
import { currentLedger } from "../project/indexerMainRunStoreRecords.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
for (const allOmitted of [false, true]) test(`Review omission reaches the next route (all omitted=${allOmitted})`, async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  if (!allOmitted) {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
      join(root, "src/package-templates/kb"), { recursive: true });
    const path = join(root, "src/index.ts");
    await writeFile(path, (await readFile(path, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "knowledge", template: { path: "src/package-templates/kb" } })]'));
    await acceptStarterPackageTemplates({ projectRoot: root });
  }
  await completePartitionStage(root);
  const structure = (await currentIndexerStructureReview(root))!;
  const authorities = contextWorkflowAuthorities({ managed: true });
  await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true, authorities,
    value: { stage: "structure-review", decision: "approved" } });
  await completeAuthorStage(root, allOmitted ? { relatedPage: "./unpublished.md" } : {});
  const candidates = await readCandidateRecords(root);
  expect(candidates).toHaveLength(2);
  const collection = candidates[0]!.collection;
  await applyReviewDecisions({ projectRoot: root, payload: { collection,
    scope: { kind: "collection", collection, count: candidates.length,
      ids_sha256: candidateIdsHash(candidates.map((row) => row.candidate_id).sort()), candidates_sha256: candidateSetHash(candidates) },
    decisions: candidates.map((row, index) => ({ candidate_id: row.candidate_id,
      status: allOmitted || index === 0 ? "rejected" : "approved" })),
  } });
  const status = () => collectProjectStatus(root, { managed: true, authorities });
  expect((await status()).workflow.current?.node).toBe("close-approved-knowledge");
  await closeProjectWorkspace(root);
  if (!allOmitted) {
    expect((await status()).workflow.current?.node).toBe("build-next");
    await buildProjectPackages(root);
  }
  expect((await status()).workflow.status).toBe("complete");
  expect(await currentLedger(root)).toBeUndefined();
  expect(await readIndexerDelivery(root)).toBeUndefined();
  expect((await readRejectedDecisions(root)).size).toBe(0);
  expect(await Bun.file(join(root, "knowledge/decisions.json")).exists()).toBe(false);
}, 45_000);
