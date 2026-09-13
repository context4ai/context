import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { projectCurrentIndexerWorkflowRoute, resolveCurrentIndexerWorkflowRoute } from "../project/indexerCurrentWorkflowRoute.js";
import { collectProjectStatus } from "../project/status.js";
import { runCurrentIndexerLifecycle } from "../project/indexerLifecycleRun.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { assertReviewCandidateCurrent, loadReviewCandidateAuthority } from "../project/reviewCandidateAuthority.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import type { ContextResolvedWorkflowRoute } from "../project/workflow/workflowTypes.js";

test("an ended production stage hands off to Review without reading retired registration or run state", async () => {
  const parent = resolve(".tmp/production-routing-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-"));
  try {
    const { projectRoot } = await initContextProject({ cwd: outer, projectDir: "workspace", dev: true });
    const note = await importManagedDocument(projectRoot, { type: "note", name: "20260913/decision.md",
      markdown: "# Decision\nThe service remains independent.\n" });
    const requirements = YAML.stringify({ requirements: [{ id: "decisions", purpose: "Explain the service boundary",
      target_scope: { targets: [{ source_ref: note.source_ref }] } }] });
    await writeFile(join(projectRoot, "src/indexers.yaml"), requirements);
    await produceFixtureArticles(projectRoot, [{ path: "decision/service.md", question: "What is the service boundary?",
      sources: [note.source_ref],
      markdown: '---\ntitle: Service boundary\ndescription: The recorded independence decision.\n---\n\n<!-- context:section id="boundary" -->\nThe service remains independent.\n<!-- /context:section -->\n',
      references: { sections: [{ id: "boundary", references: [{ source_ref: note.source_ref,
        locator: { path: "decision.md", start_line: 2, end_line: 2 } }] }] },
    }]);
    for (const name of ["main-index", "candidate-compile"]) {
      const directory = join(projectRoot, ".tmp/context-runtime/indexer", name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "current.json"), "invalid retired state");
    }
    const route: ContextResolvedWorkflowRoute = { protocol: "context.workflow.route.v1", id: "run-indexer-lifecycle",
      node: "run-indexer-lifecycle", revision: "completed-production", reason_code: "route.indexer.lifecycle",
      availability: "immediate", commands: [], resources: { required: [], recommended: [] }, after_action: { evaluate: true } };
    const input = { projectRoot, authorities: [], managed: false };
    expect(await projectCurrentIndexerWorkflowRoute({ ...input, route })).toBeUndefined();
    expect(await resolveCurrentIndexerWorkflowRoute(input)).toBeUndefined();
    expect((await collectProjectStatus(projectRoot)).workflow.current?.node).toBe("review-current-batch");
    const stage = await readProductionStage(projectRoot);
    const candidates = await readCandidateRecords(projectRoot);
    const authority = await loadReviewCandidateAuthority(projectRoot);
    expect(() => assertReviewCandidateCurrent({ index: authority, record: candidates[0]! })).not.toThrow();
    expect(() => assertReviewCandidateCurrent({ index: authority,
      record: { ...candidates[0]!, body: "Unaccepted replacement" } })).toThrow();
    for (const options of [{}, { dryRun: true }, { managed: true }]) {
      const result = await runCurrentIndexerLifecycle({ ...input, ...options });
      expect(result.workflow.current?.node).toBe("review-current-batch");
      expect(result).not.toHaveProperty("advanced");
      expect(result).not.toHaveProperty("protocol");
      expect(await readProductionStage(projectRoot)).toEqual(stage);
      expect(await readCandidateRecords(projectRoot)).toEqual(candidates);
    }
    expect(await readCandidateRecords(projectRoot)).toHaveLength(1);
    expect(await readFile(join(projectRoot, "src/indexers.yaml"), "utf8")).toBe(requirements);
    await rm(join(projectRoot, ".tmp"), { recursive: true, force: true });
    const fresh = await projectCurrentIndexerWorkflowRoute({ ...input, route });
    expect(fresh?.node).toBe("prepare-production-planning");
    expect((await runCurrentIndexerLifecycle(input)).workflow.current?.node).toBe("prepare-production-planning");
    const retiredDirectory = join(projectRoot, ".tmp/context-runtime/indexer/main-index");
    await mkdir(retiredDirectory, { recursive: true });
    await writeFile(join(retiredDirectory, "current.json"), "invalid retired state");
    const preview = await runCurrentIndexerLifecycle({ ...input, deliver: true, dryRun: true });
    expect(preview.workflow.current?.node).toBe("prepare-production-planning");
    expect(preview).not.toHaveProperty("delivery");
    await expect(runCurrentIndexerLifecycle({ ...input, deliver: true })).rejects.toMatchObject({
      detail: { reason_code: "no-active-delivery", next_action: { command: "context status --format json" } },
    });
    await expect(readFile(join(projectRoot, ".tmp/context-runtime/indexer/delivery.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readProductionStage(projectRoot)).toBeUndefined();
    expect(await readCandidateRecords(projectRoot)).toEqual([]);
    const oldCompile = join(projectRoot, ".tmp/context-runtime/indexer/candidate-compile");
    await mkdir(oldCompile, { recursive: true });
    await writeFile(join(oldCompile, "current.json"), "invalid retired state");
    await expect(loadReviewCandidateAuthority(projectRoot)).rejects.toMatchObject({
      detail: { next_action: { command: expect.any(String) } },
    });
    expect(await readFile(join(projectRoot, "src/indexers.yaml"), "utf8")).toBe(requirements);
  } finally { await rm(outer, { recursive: true, force: true }); }
});
