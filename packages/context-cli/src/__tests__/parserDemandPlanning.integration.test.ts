import { placeApprovedReadingFixture } from "./knowledgeMapReview.fixture.js";
import { expect, test } from "bun:test";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { resolveIndexerPlanningInventory } from "../project/indexerPlanningInventory.js";
import { createIndexerAuthorSourceResolver } from "../project/indexerAuthorSources.js";
import type { IndexerPartitionValidationInput } from "@c4a/context";
import type { IndexerConsumerWorksetProjection } from "../project/indexerConsumerWorksetPlanner.js";

test("application planning and Author use captured files without a mandatory deep-parser pass", async () => {
  const root = await createDocumentRevisionWorkspace({ profile: "web-application", sourceCount: 1,
    sourceFiles: { "src/feature/entry.ts": "export function calculate(value: number) { return value + 1; }\n",
      ...Object.fromEntries(Array.from({ length: 65 }, (_, index) => [
        `src/feature/helper-${index}.ts`, `export const helper${index} = ${index};\n`,
      ])) } });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "application", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await advanceCurrentIndexerLifecycle(root);
    const ledger = (await currentLedger(root))!;
    expect(ledger.entries.length).toBeGreaterThan(1);
    for (const entry of ledger.entries) {
      const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
      expect((spec.validation.partition_projection as { family_key: string }).family_key).toStartWith("source-inventory:");
    }
    const preparations = await readdir(join(root, ".tmp/context-runtime/parser-preparations")).catch(() => []);
    expect(preparations).toEqual([]);
    // Each inventory partition plans a distinct page; a shared key would
    // incorrectly claim the same article identity for unrelated file groups.
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    const current = (await resolveCurrentIndexerAgentContext(root))!;
    expect(current.descriptor.stage).toBe("author");
    const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: current.descriptor,
      taskKey: current.descriptor.tasks[0]!.task_key });
    const access = task.view.items.find(item => item.category === "source-access")!;
    expect(access).toBeDefined();
    expect(JSON.stringify(access)).toContain("src/feature/");
    expect(await readdir(join(root, ".tmp/context-runtime/parser-preparations")).catch(() => [])).toEqual([]);
    await completeAuthorStage(root);
    expect((await readCandidateRecords(root)).length).toBeGreaterThan(0);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await placeApprovedReadingFixture(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    expect((await readdir(join(root, "dist"))).length).toBeGreaterThan(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120_000);

test("Author reuses the selected Partition inventory without extracting a second fact ledger", async () => {
  const root = await createDocumentRevisionWorkspace({ profile: "web-application", sourceCount: 1,
    sourceFiles: { "src/chosen.ts": "export const chosen = 1;", "src/support.ts": "export const support = 2;" } });
  try {
    await advanceCurrentIndexerLifecycle(root);
    const ledger = (await currentLedger(root))!;
    const spec = await currentSpec({ projectRoot: root, request_digest: ledger.entries[0]!.execution_request_digest });
    const workset = spec.request.workset;
    const catalog = await resolveIndexerPlanningInventory({ projectRoot: root, indexer_id: workset.indexer_id,
      source_ref: workset.source_ref, module_ref: workset.module_ref, profile_contract_digest: workset.profile_contract_digest });
    const chosen = catalog.parser_fact_view.files.find(file => file.normalized_path === "src/chosen.ts")!;
    const resolve = createIndexerAuthorSourceResolver({ projectRoot: root,
      projections: new Map([[workset.workset_digest, spec.validation.partition_projection as IndexerConsumerWorksetProjection]]) });
    // The resolver consumes the already accepted plan's ownership; the full
    // semantic validation and delivery chain is exercised in the test above.
    const binding = await resolve({ workset,
      canonical_inventory_members: spec.validation.canonical_inventory_members,
      plan: { status: "complete", groups: [{ member_ids: [chosen.file_ref] }] },
    } as unknown as IndexerPartitionValidationInput);
    expect(binding.source_identity_inventory.files.map(file => file.normalized_path)).toContain("src/chosen.ts");
    expect(binding.adapter === "parser-facts" && binding.inventory_only).toBe(true);
    expect(binding.adapter === "parser-facts" && binding.parser_fact_view.files.some(file =>
      file.facts.some(fact => fact.kind === "code-symbol"))).toBe(false);
    expect(await readdir(join(root, ".tmp/context-runtime/parser-preparations")).catch(() => [])).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120_000);
