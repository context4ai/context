import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  canonicalIndexerJson,
  type IndexerInventoryMember,
} from "@c4a/context";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { projectCurrentIndexerWorkflowRoute } from
  "../project/indexerCurrentWorkflowRoute.js";
import { buildIndexerPartitionRunResultFromSemantic } from
  "../project/indexerSemanticPartitionResult.js";
import { buildIndexerAuthorRunResultFromSemantic } from
  "../project/indexerSemanticAuthorResult.js";
import { currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import {
  acceptIndexerMainAuthorRunsStore,
  acceptIndexerMainPartitionRunsStore,
} from "../project/indexerMainRunStore.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import {
  currentIndexerStructureReview,
} from "../project/indexerStructureReview.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import {
  createDocumentRevisionWorkspace,
  DOCUMENT_REVISION_SOURCE_REF as SOURCE_REF,
  documentRevisionOuterIndexerRoute as outerIndexerRoute,
} from "./projectDocumentRevisionV074.fixture.js";

const DOCUMENT_REVISION_TEST_TIMEOUT_MS = 60_000;
const temporaryRoots: string[] = [];

async function workspace(options: { debug?: boolean } = {}): Promise<string> {
  const root = await createDocumentRevisionWorkspace(options);
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

async function completePartitionStage(root: string): Promise<void> {
  await advanceCurrentIndexerLifecycle(root);
  while (true) {
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined || current.descriptor.stage !== "partition") return;
    const runs = [];
    for (const descriptor of current.descriptor.tasks) {
      const task = await loadCurrentIndexerBatchTask({
        projectRoot: root,
        descriptor: current.descriptor,
        taskKey: descriptor.task_key,
      });
      const workset = task.spec.request.workset;
      if (workset.stage !== "partition") throw new Error("expected Partition task");
      const validation = task.spec.validation as {
        canonical_inventory_members: IndexerInventoryMember[];
        authorized_source_refs: string[];
        subject_key_contract: unknown;
        required_question_target_refs?: string[];
      };
      const suffix = workset.workset_digest.slice(-8);
      const semantic = {
        stage: "partition" as const,
        outcome: "complete" as const,
        groups: [{
          key: `fixture-${suffix}`,
          title: `Fixture ${suffix}`,
          reader_task: "Understand the public fixture capability.",
          subject: {
            namespace: workset.partition_subject_key.namespace,
            kind: workset.partition_subject_key.kind,
            local_key: `fixture-${suffix}`,
          },
          subject_intent: "primary" as const,
          members: validation.canonical_inventory_members.map((member) => member.member_id),
          questions: [...workset.reader_question_refs],
          question_targets: (validation.required_question_target_refs ?? []).map((target) => ({
            target,
            role: "primary-carrier" as const,
          })),
          outline: ["Overview"],
        }],
        excluded: [],
        unsupported: [],
      };
      runs.push({
        workset_digest: workset.workset_digest,
        semantic,
        execution_request_digest: task.spec.request.execution_request_digest,
        result: buildIndexerPartitionRunResultFromSemantic({
          request: task.spec.request,
          view: task.view,
          semantic,
          validation: { ...validation, partition_unit_type: "semantic-subject" },
        }),
      });
    }
    const converged = await acceptIndexerMainPartitionRunsStore({
      projectRoot: root,
      runs,
    });
    expect(converged.outcomes.every((outcome) => outcome.outcome === "accepted")).toBe(true);
    for (const run of runs) {
      const semanticPath = join(
        root,
        ".tmp/context-runtime/indexer/semantic-results",
        `${run.execution_request_digest.slice("sha256:".length)}.json`,
      );
      await mkdir(join(semanticPath, ".."), { recursive: true });
      await writeFile(semanticPath, canonicalIndexerJson(run.semantic));
    }
    await advanceCurrentIndexerLifecycle(root);
  }
}

async function completeAuthorStage(
  root: string,
  options: { catalogOnlyFirst?: boolean; revisionSuffix?: string } = {},
): Promise<{ catalogOnlyCount: number }> {
  let catalogOnlyCount = 0;
  while (true) {
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined || current.descriptor.stage !== "author") {
      return { catalogOnlyCount };
    }
    const runs = [];
    for (const descriptor of current.descriptor.tasks) {
      const task = await loadCurrentIndexerBatchTask({
        projectRoot: root,
        descriptor: current.descriptor,
        taskKey: descriptor.task_key,
      });
      const workset = task.spec.request.workset;
      if (workset.stage !== "author") throw new Error("expected Author task");
      const validation = task.spec.validation as {
      dependency_view: {
        positive_nodes: Array<{ kind: string; evidence_ref?: string }>;
      };
      expected_subject_key: unknown;
      artifact_policy_eligibility: {
        eligible_variants: Array<{ id: string }>;
      };
      allowed_source_roles: string[];
      allowed_artifact_intents: Array<{
        source_role: string;
        document_kind: string;
        reader_goal: string;
        artifact_kind: string;
      }>;
      canonical_inventory_members: IndexerInventoryMember[];
      allowed_question_targets: Array<{
        question_target_key: string;
        question_ref: string;
      }>;
      };
      const source = validation.dependency_view.positive_nodes.find((node) =>
        node.kind === "source-span" && node.evidence_ref !== undefined
      );
      if (source?.evidence_ref === undefined) throw new Error("fixture Author has no source span");
      const intent = validation.allowed_artifact_intents[0];
      const policy = validation.artifact_policy_eligibility.eligible_variants[0];
      if (intent === undefined || policy === undefined) throw new Error("fixture Author has no output policy");
      const catalogFact = task.view.items.find((item) =>
        item.category === "fact"
      );
      const catalogOnly = options.catalogOnlyFirst === true &&
        catalogOnlyCount === 0 && catalogFact !== undefined;
      if (catalogOnly) catalogOnlyCount++;
      const semantic = {
      stage: "author" as const,
      group_key: workset.group_key,
      outcome: catalogOnly ? "catalog-only" as const : "publish" as const,
      artifact_intent: [
        intent.source_role,
        intent.document_kind,
        intent.reader_goal,
        intent.artifact_kind,
      ].join("/"),
      policy: policy.id,
      target_resolutions: (workset.target_resolution_view?.entries ?? []).map((entry) => ({
        target: entry.query_ref,
        disposition: entry.state === "resolved"
          ? "reuse-existing" as const
          : "create-independent" as const,
      })),
      title: `Fixture ${workset.group_key}`,
      summary: "A focused guide to the fixture's public entry point.",
      sections: [{
        key: "overview",
        heading: "Overview",
        markdown: [
          "Use the exported answer constant as the public entry point.",
          options.revisionSuffix,
        ].filter((value): value is string => value !== undefined).join("\n\n"),
        source_items: [source.evidence_ref],
        facts: catalogOnly ? [catalogFact.ref] : [],
        answers: validation.allowed_question_targets.map((target) =>
          target.question_target_key
        ),
      }],
      member_dispositions: validation.canonical_inventory_members.map((member) => ({
        item: member.member_id,
        state: catalogOnly ? "catalog-only" as const : "covered" as const,
        ...(catalogOnly ? {} : { section: "overview" }),
      })),
      material_gaps: [],
      diagnostics: [],
      };
      runs.push({
        workset_digest: workset.workset_digest,
        result: buildIndexerAuthorRunResultFromSemantic({
          request: task.spec.request,
          view: task.view,
          semantic,
          validation,
        }),
      });
    }
    await acceptIndexerMainAuthorRunsStore({
      projectRoot: root,
      runs,
    });
    await advanceCurrentIndexerLifecycle(root);
  }
}

describe("current Indexer document revision", () => {
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
    const root = await workspace();
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
      value: { stage: "structure-review", decision: "approved" },
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
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);

  test("reopens only the approved page source as a recoverable Partition run", async () => {
    const root = await workspace();
    const staleDerivedPath = join(
      root,
      ".tmp/context-runtime/indexer/finalization/current.json",
    );
    await mkdir(join(staleDerivedPath, ".."), { recursive: true });
    await writeFile(staleDerivedPath, "{}\n");

    const result = await beginDocumentRevision({
      projectRoot: root,
      selector: "architecture/revision-fixture.md",
      instruction: "Explain the public entry point more clearly.",
    });

    if (result.status !== "partition-reopened") {
      throw new TypeError(`expected partition revision, received ${result.status}`);
    }
    expect(result).toMatchObject({
      status: "partition-reopened",
      path: "architecture/revision-fixture.md",
      source_refs: [SOURCE_REF],
    });
    expect(result.workset_count).toBeGreaterThan(0);
    expect(existsSync(staleDerivedPath)).toBe(false);
    const ledger = await currentLedger(root);
    expect(ledger?.entries).toHaveLength(result.workset_count);
    expect(ledger?.entries.some((entry) => entry.state === "running")).toBe(true);
    expect(ledger?.entries.every((entry) => entry.stage === "partition")).toBe(true);
    const running = ledger!.entries.find((entry) => entry.state === "running")!;
    const spec = await currentSpec({
      projectRoot: root,
      request_digest: running.execution_request_digest,
    });
    expect(spec.request.workset).toMatchObject({
      stage: "partition",
      source_ref: SOURCE_REF,
      repair_intent: {
        target_ref: "knowledge/architecture/revision-fixture.md",
        instruction: "Explain the public entry point more clearly.",
      },
    });
  });

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
      value: { stage: "structure-review", decision: "approved" },
      managed: true,
      authorities: managedAuthorities,
    });
    await completeAuthorStage(root);

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
    const result = await beginDocumentRevision({
      projectRoot: root,
      selector: target.candidate_id,
      instruction: "Clarify the public entry point.",
    });
    expect(result).toMatchObject({
      status: "author-reopened",
      candidate_id: target.candidate_id,
    });
    const ledger = await currentLedger(root);
    expect(ledger?.entries.filter((entry) => entry.state === "running")).toHaveLength(1);
    expect(ledger?.entries.filter((entry) => entry.state === "accepted")).toHaveLength(
      candidates.length - 1,
    );
    const running = ledger!.entries.find((entry) => entry.state === "running")!;
    const spec = await currentSpec({
      projectRoot: root,
      request_digest: running.execution_request_digest,
    });
    expect(spec.request.workset).toMatchObject({
      stage: "author",
      repair_intent: {
        target_ref: target.candidate_id,
        instruction: "Clarify the public entry point.",
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
  }, DOCUMENT_REVISION_TEST_TIMEOUT_MS);
});
