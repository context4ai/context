import { approvedKnowledgeMapTargets } from "../project/knowledgeMapCoverage.js";
import { placeApprovedReadingFixture } from "./knowledgeMapReview.fixture.js";
import { readPartitionStream } from "../project/indexerPartitionStream.js";
import { configureDeliveryCadence } from "../project/indexerDeliveryCadence.js";
import { indexerBatchStagePolicy } from "../project/indexerCurrentBatchPlanner.js";
import {
  approveCandidates,
  completeAuthorStage,
  completePartitionStage,
} from "./projectDocumentRevisionStages.fixture.js";
import { materializeCurrentReviewBatchSet } from "../project/reviewCurrentResource.js";
import { readIndexerDelivery } from "../project/indexerDelivery.js";
import { INDEXER_CURRENT_FINALIZATION_PATH, readCurrentIndexerFinalization } from "../project/indexerCurrentFinalization.js";
import { readCurrentIndexerComposerBatch } from "../project/indexerCurrentComposer.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { existsSync } from "node:fs";
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, test } from "bun:test";
import type { IndexerInventoryMember } from "@c4a/context";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { projectCurrentIndexerWorkflowRoute } from
  "../project/indexerCurrentWorkflowRoute.js";
import { acceptedCachePath, readAcceptedCache, readJsonMaybe, currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import { readProjectIndexerCandidateCompileStatus } from "../project/indexerCandidateCompileActions.js";
import { matchesAcceptedCompileResults } from "../project/indexerCandidateCompileFreshness.js";
import { postAuthorCurrentStatePath } from "../project/indexerPostAuthorStorePersistence.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import {
  currentIndexerStructureReview,
} from "../project/indexerStructureReview.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import {
  createDocumentRevisionWorkspace,
  documentRevisionOuterIndexerRoute as outerIndexerRoute,
} from "./projectDocumentRevisionV074.fixture.js";

async function readingInput(root: string) {
  const current = (await currentIndexerStructureReview(root))!;
  const targets = [...await approvedKnowledgeMapTargets(root), ...current.preview.topics.flatMap(topic => topic.article_targets ?? [])];
  return { expected_revision: current.knowledge_map?.revision ?? null, remove: [],
    upsert: [...new Map(targets.map(target => [target.artifact_ref, target])).values()].map(target => ({
      key: `reader:${target.artifact_ref}`, parent: null, title: target.artifact_ref, order: 0,
      target: { artifact_ref: target.artifact_ref },
    })) };
}

const DOCUMENT_REVISION_TEST_TIMEOUT_MS = 60_000;
const temporaryRoots: string[] = [];

async function workspace(options: { debug?: boolean; sourceCount?: number; purpose?: string } = {}): Promise<string> {
  const root = await createDocumentRevisionWorkspace(options);
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("current Indexer document revision", () => {
  test("a delivery Composer starts with its matching route state while later topics remain in the planning checkpoint", async () => {
    const root = await workspace({ sourceCount: indexerBatchStagePolicy("author").max_tasks + 4 });
    const path = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(path, "utf8"));
    registry.indexers[0].profile.composers = [{ id: "public-contract", provider: "community" }];
    await writeFile(path, YAML.stringify(registry));
    await configureDeliveryCadence(root, "3");
    await completePartitionStage(root, true);
    const structure = await currentIndexerStructureReview(root);
    if (structure === undefined) throw new Error("missing structure review");
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision,
      value: { stage: "structure-review", decision: "approved", knowledge_map: await readingInput(root) }, managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }) });
    expect((await currentLedger(root))?.entries.filter(entry => entry.state === "running")).toHaveLength(3);
    await completeAuthorStage(root);
    expect((await readPartitionStream(root))!.partition_ledger.entries.length).toBeGreaterThan((await currentLedger(root))!.entries.length);
    const composer = await readCurrentIndexerComposerBatch(root);
    expect(composer).toBeDefined();
    // Exercise the actual next route, including its exact batch/state guard.
    const route = await projectCurrentIndexerWorkflowRoute({ projectRoot: root,
      route: outerIndexerRoute(), managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }) });
    expect(route?.action?.input).toMatchObject({ stage: "post-author" });
    expect(await readCurrentIndexerFinalization(root)).toMatchObject({
      state: "composer-required", revision: composer!.batch_digest,
    });
    // A workspace produced by the old startup path must recover without restarting tasks.
    await rm(join(root, INDEXER_CURRENT_FINALIZATION_PATH));
    await advanceCurrentIndexerLifecycle(root);
    expect((await readCurrentIndexerComposerBatch(root))?.batch_digest).toBe(composer!.batch_digest);
    expect(await readCurrentIndexerFinalization(root)).toMatchObject({
      state: "composer-required", revision: composer!.batch_digest,
    });
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);

  test("delivers a small readable wave while later topics remain planned, then resumes after build", async () => {
    const root = await workspace({ sourceCount: 6, purpose: "Help a developer integrate the public constants." });
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
      join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    const entry = await readFile(entryPath, "utf8");
    await writeFile(entryPath, entry.replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "delivery-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await configureDeliveryCadence(root, "3");
    await completePartitionStage(root, true);
    const structure = await currentIndexerStructureReview(root);
    if (structure === undefined) throw new Error("missing structure review");
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision,
      value: { stage: "structure-review", decision: "approved", knowledge_map: await readingInput(root) }, managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }) });
    const currentSubjects = new Set(structure.preview.topics.map(topic => topic.subject_key!.local_key));
    const saved = (await readPartitionStream(root))!;
    const futureGroups = [];
    for (const entry of saved.partition_ledger.entries) {
      const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
      const accepted = readAcceptedCache({ spec, cache: await readJsonMaybe(root, acceptedCachePath(entry.execution_request_digest)) });
      const plan = accepted.operation_result as { groups: Array<{ subject_key: { local_key: string } }> };
      futureGroups.push(...plan.groups.filter(group => !currentSubjects.has(group.subject_key.local_key)));
    }
    const relatedPage = `./${futureGroups[0]!.subject_key.local_key}.md`;
    await completeAuthorStage(root, { relatedPage });
    const before = await currentLedger(root);
    expect(saved.partition_ledger.entries.length).toBeGreaterThan(before!.entries.length);
    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates[0]?.body).toContain("## API");
    expect(candidates[0]?.body).toContain("export entry");
    expect(candidates[0]?.body).toContain("Related API");
    expect(candidates[0]?.body).not.toContain(`[Related API](${relatedPage})`);
    const review = await materializeCurrentReviewBatchSet({ projectRoot: root, candidates: candidates.map((record) => {
      if (record.candidate_type !== "indexer-artifact") throw new Error("unexpected candidate kind");
      return { record, snapshot: undefined };
    }) });
    expect(await readFile(review.path, "utf8")).toContain("Help a developer integrate the public constants.");
    await approveCandidates(root, candidates);
    await placeApprovedReadingFixture(root);
    await closeProjectWorkspace(root);
    expect(await currentLedger(root)).toEqual(before);
    expect((await readIndexerDelivery(root))?.closed).toBe(true);
    // Invalid package configuration must not consume the active batch.
    const configured = await readFile(entryPath, "utf8");
    await writeFile(entryPath, configured.replace("src/package-templates/kb", "src/missing-template"));
    await expect(buildProjectPackages(root)).rejects.toThrow();
    expect((await readIndexerDelivery(root))?.current).toHaveLength(candidates.length);
    await writeFile(entryPath, configured);
    await acceptStarterPackageTemplates({ projectRoot: root });
    const built = await buildProjectPackages(root);
    expect(built.packages[0]?.files).toBeGreaterThan(0);
    expect((await readPartitionStream(root))?.completed_bindings).toHaveLength(before!.entries.length);
    expect((await currentLedger(root))?.entries.map(entry => entry.execution_request_digest)).toEqual(saved.partition_ledger.entries.map(entry => entry.execution_request_digest));
    expect((await readIndexerDelivery(root))?.current).toEqual([]);
    for (const candidate of candidates) expect(await readFile(join(root, "knowledge", candidate.path), "utf8")).toContain("#");
    await advanceCurrentIndexerLifecycle(root);
    const nextStructure = (await currentIndexerStructureReview(root))!;
    if (!nextStructure.approved) await completeCurrentIndexerAction({ cwd: root, revision: nextStructure.revision,
      value: { stage: "structure-review", decision: "approved", knowledge_map: await readingInput(root) }, managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }) });
    expect((await currentLedger(root))?.entries.some((entry) => entry.state === "running")).toBe(true);
    await completeAuthorStage(root, { relatedPage });
    const tail = await readCandidateRecords(root);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.some((page) => candidates.some((first) => first.path === page.path))).toBe(false);
    await approveCandidates(root, tail);
    await placeApprovedReadingFixture(root);
    await closeProjectWorkspace(root);
    expect(await currentLedger(root)).not.toBeUndefined();
    await buildProjectPackages(root);
    expect(await currentLedger(root)).not.toBeUndefined();
    await advanceCurrentIndexerLifecycle(root);
    const relinked = await readCandidateRecords(root);
    expect(relinked.map((page) => page.path)).toEqual(candidates.map((page) => page.path));
    expect(relinked[0]?.body).toContain(`[Related API](${relatedPage})`);
    await approveCandidates(root, relinked);
    await placeApprovedReadingFixture(root);
    await closeProjectWorkspace(root);
    await buildProjectPackages(root);
    expect(await currentLedger(root)).toBeUndefined();
    expect(await readIndexerDelivery(root)).toBeUndefined();
    for (const candidate of [...candidates, ...tail]) {
      expect(await readFile(join(root, "knowledge", candidate.path), "utf8")).toContain("## API");
    }
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);

  test("rebuilds the current batch descriptor without restarting accepted work", async () => {
    const root = await workspace({ debug: true });
    await advanceCurrentIndexerLifecycle(root);
    const before = await resolveCurrentIndexerAgentContext(root);
    if (before === undefined) throw new Error("missing current Indexer batch");
    const expected = before.descriptor.tasks.map((task) => task.workset_digest);
    const eventPath = join(root, ".tmp/context-runtime/debug/events.jsonl");
    const recoveryStart = (await readFile(eventPath, "utf8")).trim().split(/\r?\n/u).length;
    await rm(join(
      root,
      ".tmp/context-runtime/lifecycle/current-indexer-batch.json",
    ));

    const recovered = await resolveCurrentIndexerAgentContext(root);
    expect(recovered?.descriptor.tasks.map((task) => task.workset_digest)).toEqual(expected);
    expect(recovered?.descriptor.stage).toBe(before.descriptor.stage);
    const ledger = await currentLedger(root);
    expect(ledger?.entries.filter((entry) => entry.state === "running")).toHaveLength(
      expected.length,
    );
    const events = (await readFile(eventPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {
      kind: string;
      data: { counters?: Record<string, number> };
    });
    const counter = (name: string, start = 0) => events.slice(start).reduce(
      (total, event) => total + (event.data.counters?.[name] ?? 0),
      0,
    );
    expect(counter("instruction_materialize_count")).toBe(1);
    expect(counter("instructions_content_cache_hit_count")).toBe(1);
    // Restoring a descriptor must use the cache, not require another decode.
    // The initial tiny workload can legitimately select every source file;
    // only the recovered descriptor must not decode that complete source again.
    expect(counter("parser_cache_hit_count", recoveryStart)).toBeGreaterThan(0);
    expect(counter("full_fact_blob_decode_count", recoveryStart)).toBe(0);
    expect(counter("status_rebuild_count")).toBe(0);
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);

  test("commits a valid Partition peer when another batch result has an invalid schema", async () => {
    const root = await workspace();
    await advanceCurrentIndexerLifecycle(root);
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined || current.descriptor.stage !== "partition") {
      throw new Error("missing Partition batch");
    }
    expect(current.descriptor.tasks.length).toBeGreaterThan(1);
    const acceptedTask = await loadCurrentIndexerBatchTask({
      projectRoot: root,
      descriptor: current.descriptor,
      taskKey: current.descriptor.tasks[0]!.task_key,
    });
    const workset = acceptedTask.spec.request.workset;
    if (workset.stage !== "partition") throw new Error("expected Partition task");
    const validation = acceptedTask.spec.validation as {
      canonical_inventory_members: IndexerInventoryMember[];
      required_question_target_refs?: string[];
    };
    const route = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root,
      route: outerIndexerRoute(),
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
    });
    if (route === undefined) throw new Error("missing current Partition route");
    const completion = await completeCurrentIndexerAction({
      cwd: root,
      revision: route.revision,
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
      value: {
        stage: "partition",
        results: [{
          task_key: acceptedTask.descriptor.task_key,
          result: {
            stage: "partition",
            outcome: "complete",
            groups: [{
              key: "accepted-peer",
              title: "Accepted peer",
              reader_task: "Understand the accepted public fixture capability.",
              subject: {
                namespace: workset.partition_subject_key.namespace,
                kind: workset.partition_subject_key.kind,
                local_key: "accepted-peer",
              },
              subject_intent: "primary",
              members: validation.canonical_inventory_members.map((member) => member.member_id),
              questions: [...workset.reader_question_refs],
              question_targets: (validation.required_question_target_refs ?? []).map((target) => ({
                target,
                role: "primary-carrier",
              })),
              outline: ["Overview"],
            }],
            excluded: [],
            unsupported: [],
          },
        }, {
          task_key: current.descriptor.tasks[1]!.task_key,
          result: {
            stage: "partition",
            outcome: "not-a-real-outcome",
          },
        }],
      },
    });
    if (!("outcomes" in completion)) throw new Error("expected a batch completion");
    expect(completion.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        task_key: acceptedTask.descriptor.task_key,
        outcome: "accepted",
        committed: true,
      }),
      expect.objectContaining({
        task_key: current.descriptor.tasks[1]!.task_key,
        outcome: "failed",
        committed: false,
        error: expect.objectContaining({ code: "schema-invalid" }),
      }),
    ]));
    expect(completion).not.toHaveProperty("workflow");
    const nextRequired = completion.next?.resources.required;
    if (!Array.isArray(nextRequired)) {
      throw new Error(`next Route has no ready resources: ${JSON.stringify(completion.next)}`);
    }
    expect(completion.next).toMatchObject({
      node: "run-indexer-agent-step",
      resources: {
        required: expect.arrayContaining([
          expect.objectContaining({ path: expect.any(String), read_state: "read-required" }),
        ]),
      },
    });
    expect(nextRequired.some((resource) =>
      resource.command !== undefined || resource.materialize !== undefined
    )).toBe(false);
    expect(completion.progress).toMatchObject({
      stage: "partition",
      total: 2,
      accepted: 1,
      running: 1,
      pending: 0,
      current_batch: { task_count: 1 },
      eta: null,
    });
    const ledger = await currentLedger(root);
    expect(ledger?.entries.find((entry) =>
      entry.workset_digest === acceptedTask.descriptor.workset_digest
    )?.state).toBe("accepted");
    expect(ledger?.entries.find((entry) =>
      entry.workset_digest === current.descriptor.tasks[1]!.workset_digest
    )?.state).toBe("running");
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);

  test("runs one Code workload through Parser Facts, catalog-only, and public guidance", async () => {
    const root = await workspace({ debug: true });
    await advanceCurrentIndexerLifecycle(root);
    const first = await resolveCurrentIndexerAgentContext(root);
    expect(first?.descriptor.stage).toBe("partition");
    const firstTask = first === undefined ? undefined : await loadCurrentIndexerBatchTask({
      projectRoot: root,
      descriptor: first.descriptor,
      taskKey: first.descriptor.tasks[0]!.task_key,
    });
    expect(firstTask?.view.items.some((item) =>
      item.category === "consumer-anchor"
    )).toBe(true);

    await completePartitionStage(root);
    const structure = await currentIndexerStructureReview(root);
    if (structure === undefined) throw new Error("missing Code structure review");
    await completeCurrentIndexerAction({
      cwd: root,
      revision: structure.revision,
      value: { stage: "structure-review", decision: "approved", knowledge_map: await readingInput(root) },
      managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
    });
    const authored = await completeAuthorStage(root, { catalogOnlyFirst: true });
    expect(authored.catalogOnlyCount).toBe(1);

    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.body.startsWith("# "))).toBe(true);
    expect(candidates.every((candidate) =>
      candidate.body.includes("public entry point")
    )).toBe(true);

    const eventPath = join(root, ".tmp/context-runtime/debug/events.jsonl");
    const previousEvents = (await readFile(eventPath, "utf8")).length;
    const acceptedPath = join(root, ".tmp/context-runtime/indexer/main-index/accepted");
    // Review uses the committed compile and ledger, not Author execution caches.
    // Keep the cache for later compile/recovery, but make it unavailable to this read.
    await rename(acceptedPath, `${acceptedPath}-saved`);
    const status = await readProjectIndexerCandidateCompileStatus(root);
    await rename(`${acceptedPath}-saved`, acceptedPath);
    expect(status.state).toBe("current");
    const bindings = status.compile!.result_bindings;
    const ledger = await currentLedger(root);
    expect(matchesAcceptedCompileResults(ledger, [...bindings].reverse(), true)).toBe(true);
    expect(matchesAcceptedCompileResults(ledger, bindings.slice(1), true)).toBe(false);
    expect(matchesAcceptedCompileResults(ledger, [...bindings, bindings[0]!], true)).toBe(false);
    for (const field of ["acceptance_digest", "indexer_result_digest", "workset_digest", "indexer_id"] as const) {
      const changed = bindings.map((binding, index) => index === 0
        ? { ...binding, [field]: "changed" }
        : binding);
      expect(matchesAcceptedCompileResults(ledger, changed, true)).toBe(false);
    }
    const readEvents = (await readFile(eventPath, "utf8")).slice(previousEvents)
      .trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {
        kind: string;
        data: { operation?: string; detail?: { requested_operation?: string } };
      });
    const operations = readEvents.filter((event) => event.kind === "performance.measurement")
      .map((event) => event.data.detail?.requested_operation);
    expect(operations).not.toContain("read-accepted-main-author-result-records");
    expect(operations.filter((operation) => operation !== undefined))
      .toEqual(["observe-indexer-candidate-compile"]);

    // A new invocation must see configuration changes; no TTL or process cache.
    const registryPath = join(root, "src/indexers.yaml");
    const registryRaw = await readFile(registryPath, "utf8");
    const changedRegistry = YAML.parse(registryRaw);
    changedRegistry.requirements[0].reader_goals = ["integrate-module"];
    await writeFile(registryPath, YAML.stringify(changedRegistry));
    expect((await readProjectIndexerCandidateCompileStatus(root)).state).toBe("stale");
    await writeFile(registryPath, registryRaw);
    expect((await readProjectIndexerCandidateCompileStatus(root)).state).toBe("current");
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);

  test("revises an approved page twice across cleanup without Partition or Author history", async () => {
    const root = await workspace();
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
      join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    const entry = await readFile(entryPath, "utf8");
    await writeFile(entryPath, entry.replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "revision-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await completePartitionStage(root);
    const structure = await currentIndexerStructureReview(root);
    if (!structure) throw new Error("missing initial structure review");
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision,
      value: { stage: "structure-review", decision: "approved", knowledge_map: await readingInput(root) }, managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }) });
    await completeAuthorStage(root);
    const initial = await readCandidateRecords(root);
    const path = initial[0]!.path;
    await approveCandidates(root, initial);
    await placeApprovedReadingFixture(root);
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    const peers = await Promise.all(initial.slice(1).map(async (candidate) => ({
      path: candidate.path, bytes: await readFile(join(root, "knowledge", candidate.path), "utf8"),
    })));
    for (const wording of ["First revision.", "Second revision."]) {
      await rm(join(root, ".tmp"), { recursive: true, force: true });
      await rm(join(root, "dist"), { recursive: true, force: true });
      const result = await beginDocumentRevision({ projectRoot: root, selector: path,
        instruction: `Keep all other content and replace the public entry point wording with ${wording}` });
      expect(result.status).toBe("author-reopened");
      expect(await currentLedger(root)).toBeUndefined();
      const route = await projectCurrentIndexerWorkflowRoute({ projectRoot: root,
        route: outerIndexerRoute(), managed: true, authorities: contextWorkflowAuthorities({ managed: true }) });
      expect(route?.node).toBe("author-approved-revision");
      const input = route?.action?.input as { target: { markdown: string } };
      expect(input.target.markdown).toContain("context:section");
      const markdown = input.target.markdown.replace(/public entry point|First revision\./u, wording);
      const { readApprovedRevision } = await import("../project/approvedRevision.js");
      await completeCurrentIndexerAction({ cwd: root, revision: route!.revision,
        value: { stage: "approved-revision", markdown }, managed: true,
        authorities: contextWorkflowAuthorities({ managed: true }) });
      expect((await readProjectIndexerCandidateCompileStatus(root)).state).toBe("current");
      await approveCandidates(root, await readCandidateRecords(root));
      await placeApprovedReadingFixture(root);
    await closeProjectWorkspace(root);
      expect(await readApprovedRevision(root)).toBeDefined();
      if (wording === "First revision.") {
        const configured = await readFile(entryPath, "utf8");
        await writeFile(entryPath, configured.replace("src/package-templates/kb", "src/missing-template"));
        await expect(buildProjectPackages(root)).rejects.toThrow();
        expect(await readApprovedRevision(root)).toBeDefined();
        await writeFile(entryPath, configured);
      }
      await buildProjectPackages(root);
      expect(await readApprovedRevision(root)).toBeUndefined();
      expect(await currentLedger(root)).toBeUndefined();
      const approved = await readFile(join(root, "knowledge", path), "utf8");
      expect(approved).toContain(wording);
      for (const peer of peers) expect(await readFile(join(root, "knowledge", peer.path), "utf8")).toBe(peer.bytes);
    }
    const { readApprovedRevision, completeApprovedRevision } = await import("../project/approvedRevision.js");
    await beginDocumentRevision({ projectRoot: root, selector: path, instruction: "Check whether any wording still needs changing." });
    const unchanged = (await readApprovedRevision(root))!;
    await completeApprovedRevision({ projectRoot: root, revision: unchanged.revision, markdown: unchanged.target.markdown });
    expect(await readApprovedRevision(root)).toBeUndefined();
    expect(await readCandidateRecords(root)).toEqual([]);
    await beginDocumentRevision({ projectRoot: root, selector: path, instruction: "Clarify the introduction." });
    const concurrent = (await readApprovedRevision(root))!;
    const approvedPath = join(root, "knowledge", path);
    const current = await readFile(approvedPath, "utf8");
    await writeFile(approvedPath, current + "\nConcurrent user edit.\n");
    await expect(completeApprovedRevision({ projectRoot: root, revision: concurrent.revision,
      markdown: concurrent.target.markdown })).rejects.toThrow("stale");
    expect(await readFile(approvedPath, "utf8")).toContain("Concurrent user edit.");
    expect(await readCandidateRecords(root)).toEqual([]);
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);

  test("reopens only the current Candidate's owning Author workset", async () => {
    const root = await workspace();
    await completePartitionStage(root);
    const structure = await currentIndexerStructureReview(root);
    expect(structure).toBeDefined();
    const ordinaryStructureRoute = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root,
      route: outerIndexerRoute(),
      authorities: [],
      managed: false,
    });
    expect(ordinaryStructureRoute).toMatchObject({
      node: "review-current-indexer-structure",
      availability: "requires-user",
      gate: {
        authority: "context.knowledge-review",
        delegatable: true,
        resolution: "user",
        resolution_action: {
          id: "resolve-current-indexer-gate",
          runner: "agent",
          effect: "write",
          input: { stage: "structure-review" },
          output_schema: { id: "schema.resolve-current-indexer-gate.output" },
        },
      },
      commands: [{ availability: "after-human-confirmation" }],
    });
    const managedAuthorities = contextWorkflowAuthorities({ managed: true });
    const managedStructureRoute = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root,
      route: outerIndexerRoute(),
      authorities: managedAuthorities,
      managed: true,
    });
    expect(managedStructureRoute).toMatchObject({
      node: "review-current-indexer-structure",
      availability: "immediate",
      gate: {
        authority: "context.knowledge-review",
        delegatable: true,
        resolution: "session-authority",
        resolution_action: {
          id: "resolve-current-indexer-gate",
          runner: "agent",
          effect: "write",
          input: { stage: "structure-review" },
          output_schema: { id: "schema.resolve-current-indexer-gate.output" },
        },
      },
      commands: [{ availability: "immediate" }],
    });
    await completeCurrentIndexerAction({
      cwd: root,
      revision: managedStructureRoute!.revision,
      value: { stage: "structure-review", decision: "approved", knowledge_map: await readingInput(root) },
      managed: true,
      authorities: managedAuthorities,
    });
    await completeAuthorStage(root);
    expect((await readProjectIndexerCandidateCompileStatus(root)).state).toBe("current");

    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(1);
    const target = candidates[0]!;
    const collectionCandidates = candidates.filter((candidate) =>
      candidate.collection === target.collection
    );
    const collectionCandidateIds = collectionCandidates
      .map((candidate) => candidate.candidate_id)
      .sort();
    await applyReviewDecisions({
      projectRoot: root,
      payload: {
        collection: target.collection,
        scope: {
          kind: "collection",
          collection: target.collection,
          count: collectionCandidates.length,
          ids_sha256: candidateIdsHash(collectionCandidateIds),
          candidates_sha256: candidateSetHash(collectionCandidates),
        },
        decisions: [{ candidate_id: target.candidate_id, status: "rejected" }],
      },
    });
    const beforeRevision = await currentLedger(root);
    const postAuthorStates = new Map(await Promise.all(beforeRevision!.entries.map(async (entry) => [
      entry.workset_digest,
      await readFile(join(root, postAuthorCurrentStatePath(entry.workset_digest)), "utf8"),
    ] as const)));
    const result = await beginDocumentRevision({
      projectRoot: root,
      selector: target.candidate_id,
      instruction: "Clarify the public entry point.",
    });
    expect(result).toMatchObject({
      status: "author-reopened",
      candidate_id: target.candidate_id,
    });
    expect((await readProjectIndexerCandidateCompileStatus(root)).state).not.toBe("current");
    const ledger = await currentLedger(root);
    expect(ledger?.entries.filter((entry) => entry.state === "running")).toHaveLength(1);
    expect(ledger?.entries.filter((entry) => entry.state === "accepted")).toHaveLength(
      candidates.length - 1,
    );
    const running = ledger!.entries.find((entry) => entry.state === "running")!;
    const peers = ledger!.entries.filter((entry) => entry.state === "accepted");
    for (const peer of peers) {
      expect(await readFile(join(root, postAuthorCurrentStatePath(peer.workset_digest)), "utf8"))
        .toBe(postAuthorStates.get(peer.workset_digest)!);
    }
    const oldOwner = beforeRevision!.entries.find((entry) =>
      !peers.some((peer) => peer.workset_digest === entry.workset_digest)
    )!;
    expect(existsSync(join(root, postAuthorCurrentStatePath(oldOwner.workset_digest)))).toBe(false);
    const spec = await currentSpec({
      projectRoot: root,
      request_digest: running.execution_request_digest,
    });
    expect(spec.request.workset).toMatchObject({
      stage: "author",
      repair_intent: {
        target_ref: target.candidate_id,
        instruction: "Clarify the public entry point.",
        current_markdown: target.body,
      },
    });

    await completeAuthorStage(root, {
      revisionSuffix: "This revised explanation resolves the requested clarification.",
    });
    const revisedCandidates = await readCandidateRecords(root);
    const revised = revisedCandidates.find((candidate) => candidate.path === target.path);
    expect(revised).toBeDefined();
    expect(revised?.candidate_id).not.toBe(target.candidate_id);
    expect(revised?.status).toBe("draft");
    expect(revised?.body).toContain("resolves the requested clarification");
    for (const peer of peers) {
      expect(await readFile(join(root, postAuthorCurrentStatePath(peer.workset_digest)), "utf8"))
        .toBe(postAuthorStates.get(peer.workset_digest)!);
    }
    for (const original of candidates.filter((candidate) => candidate.path !== target.path)) {
      const unchanged = revisedCandidates.find((candidate) => candidate.path === original.path)!;
      expect(unchanged.candidate_id).toBe(original.candidate_id);
      expect(unchanged.body).toBe(original.body);
    }
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);
});
