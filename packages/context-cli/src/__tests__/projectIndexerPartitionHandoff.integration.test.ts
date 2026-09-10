import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  indexerAgentStepInputSchema,
  type IndexerPartitionSemanticInput,
} from "@c4a/context";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { projectCurrentIndexerWorkflowRoute } from "../project/indexerCurrentWorkflowRoute.js";
import { acceptedCachePath, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import type { ContextResolvedWorkflowRoute } from "../project/workflow/workflowTypes.js";
import {
  createDocumentRevisionWorkspace,
  documentRevisionOuterIndexerRoute,
} from "./projectDocumentRevisionV074.fixture.js";
import { readingItems } from "./indexerReading.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function resourceText(route: ContextResolvedWorkflowRoute, id: string): Promise<string> {
  const resource = route.resources.required.find((entry) => entry.id === id);
  if (resource === undefined || !("path" in resource) || !resource.path) {
    throw new Error(`missing ready resource ${id}`);
  }
  expect(resource.command).toBeUndefined();
  expect(resource.materialize).toBeUndefined();
  return readFile(resource.path, "utf8");
}

describe("Partition handoff uses only Agent-visible materials", () => {
  for (const managed of [false, true]) {
    test(`accepts semantic groups without strategy discovery (managed=${managed})`, async () => {
      const root = await createDocumentRevisionWorkspace();
      roots.push(root);
      await advanceCurrentIndexerLifecycle(root);
      const authorities = contextWorkflowAuthorities({ managed });
      const route = await projectCurrentIndexerWorkflowRoute({
        projectRoot: root,
        route: documentRevisionOuterIndexerRoute(),
        managed,
        authorities,
      });
      if (!route || route.node !== "run-indexer-agent-step") {
        throw new Error("missing Partition Route");
      }
      const input = indexerAgentStepInputSchema.parse(route.action?.input);
      if (input.stage !== "partition") throw new Error("expected Partition input");
      expect(input.tasks.length).toBeGreaterThan(0);

      // The actual delivered rules, not a manually assembled instruction fixture.
      const instructions = await resourceText(route, "resolved-indexer-instructions");
      const sourceRules = await readFile(resolve(
        import.meta.dir, "../../../../plugins/context/skills/context-code-indexer/references/indexer.md",
      ), "utf8");
      expect(instructions).toContain(sourceRules);

      // Form every submission from the returned transport and ready Views only.
      // No internal run spec, registry, strategy implementation, or cache lookup.
      const results = [];
      for (const task of input.tasks) {
        const view = await resourceText(route, task.workset_view_resource_id);
        const workset = input.transport.worksets.find((entry) =>
          entry.workset_digest === task.workset_digest
        );
        if (!workset || workset.stage !== "partition") throw new Error("missing task workset");
        expect(new Set(readingItems(view, "partition-authority", task.task_key).map((item) => item.ref)).size).toBe(1);
        const members = readingItems(view, "consumer-anchor", task.task_key)
          .map((entry) => entry.ref);
        expect(members.length).toBeGreaterThan(0);
        const result: IndexerPartitionSemanticInput = {
          stage: "partition",
          outcome: "complete",
          groups: [{
            key: `public-constants-${task.task_key}`,
            title: "Public constants",
            reader_task: "Find the public constant exports and their declared values.",
            subject: {
              namespace: "sample-library", kind: workset.partition_subject_key.kind,
              local_key: `public-constants-${task.task_key}`,
            },
            subject_intent: "primary",
            members,
            questions: [...workset.reader_question_refs],
            question_targets: workset.allowed_question_target_refs.map((target) => ({
              target, role: "primary-carrier",
            })),
            outline: ["Exports and values"],
          }],
          excluded: [],
          unsupported: [],
        };
        results.push({ task_key: task.task_key, result });
      }
      expect(JSON.stringify(results)).not.toMatch(/strategy/u);
      const completion = await completeCurrentIndexerAction({
        cwd: root, revision: route.revision, managed, authorities,
        value: { stage: "partition", results },
      });
      if (!("outcomes" in completion)) throw new Error("expected batch completion");
      expect(completion.outcomes).toHaveLength(results.length);
      expect(completion.outcomes.every((entry) =>
        entry.outcome === "accepted" && entry.committed
      )).toBe(true);
      expect(completion.next).not.toBeNull();
      const structure = await currentIndexerStructureReview(root);
      expect(structure?.preview.topics).toHaveLength(results.length);
      expect(structure?.preview.topics.every((topic) =>
        topic.subject_key?.namespace === "sample-library" &&
        topic.subject_key.local_key.startsWith("public-constants-")
      )).toBe(true);

      // Inspect internals only AFTER submission to verify the CLI supplied them.
      for (const task of input.tasks) {
        const spec = await currentSpec({ projectRoot: root, request_digest: task.execution_request_digest });
        const attempt = spec.request.partition_strategy_attempt;
        expect(attempt).not.toBeNull();
        const accepted = JSON.parse(await readFile(join(
          root, acceptedCachePath(task.execution_request_digest),
        ), "utf8"));
        expect(accepted.result).toMatchObject({ result: { result: {
          strategy_ref: attempt!.strategy_ref,
          strategy_digest: attempt!.strategy_digest,
          status: "complete",
        } } });
      }
    }, 20_000);
  }
});
