import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import {
  indexerAgentStepInputSchema,
  buildIndexerAuthorDependencyView, indexerAuthorDependencyViewSchema,
  indexerAuthorSemanticInputSchema, indexerProtocolDigest, validateIndexerMainRunResult,
  type IndexerRegistry, type IndexerInventoryMember,
} from "@c4a/context";
import * as bundled from "../project/indexerCliBundledProvider.js";
import * as reading from "../project/indexerAgentReading.js";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { projectCurrentIndexerWorkflowRoute, resolveCurrentIndexerAgentContext } from "../project/indexerCurrentWorkflowRoute.js";
import { loadCurrentIndexerBatchTask } from "../project/indexerCurrentBatch.js";
import { currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import { reuseCurrentIndexerRuns } from "../project/indexerRunContinuation.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import type { ContextResolvedWorkflowRoute } from "../project/workflow/workflowTypes.js";
import { completeCurrentIndexerProviderSelection } from "../project/indexerCurrentProviderSetup.js";
import { createDocumentRevisionWorkspace, documentRevisionOuterIndexerRoute } from "./projectDocumentRevisionV074.fixture.js";
import { readingItems, readingObjects } from "./indexerReading.fixture.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { LIFECYCLE_ROOT } from "../project/lifecyclePaths.js";
import { readIndexerDelivery } from "../project/indexerDelivery.js";
import { readCandidateRecords } from "../project/candidateLedger.js";

const packageRoot = resolve(import.meta.dir, "../..");
const roots: string[] = [];
let assets: string;
let oldAssets: string;
let installedAssets: string;
let assetSpy: ReturnType<typeof spyOn<typeof bundled, "defaultCliIndexerAssetsRoot">> | undefined;
let readingSpy: ReturnType<typeof spyOn<typeof reading, "buildIndexerTaskReading">> | undefined;

function rebuildDependency(view: ReturnType<typeof indexerAuthorDependencyViewSchema.parse>) {
  const withoutNodeRef = ({ node_ref: _ref, ...node }: { node_ref: string }) => {
    void _ref;
    return node;
  };
  return buildIndexerAuthorDependencyView({ ...view,
    positive_nodes: view.positive_nodes.map(withoutNodeRef),
    negative_nodes: view.negative_nodes.map(withoutNodeRef),
  });
}

async function resource(route: ContextResolvedWorkflowRoute, id: string): Promise<string> {
  const item = route.resources.required.find((entry) => entry.id === id);
  if (!item || !("path" in item) || !item.path) throw new Error(`missing ready ${id}`);
  return readFile(item.path, "utf8");
}

async function assertAuthorReadingCost(root: string, route: ContextResolvedWorkflowRoute) {
  const paths = new Set<string>();
  const taskPaths = new Set<string>();
  for (const item of route.resources.required) {
    if ("path" in item && item.path &&
        (item.id === "resolved-indexer-instructions" || item.id.startsWith("indexer-shared-material/") ||
          item.id.startsWith("authorized-indexer-workset-view/"))) {
      paths.add(item.path);
      if (item.id.startsWith("authorized-indexer-workset-view/")) taskPaths.add(item.path);
    }
  }
  const context = await resolveCurrentIndexerAgentContext(root);
  if (!context) throw new Error("missing Author context");
  expect(taskPaths.size).toBe(context.descriptor.tasks.length);
  expect(taskPaths.size).toBeGreaterThan(0);
  const bytes = (await Promise.all([...paths].map(async (path) => (await readFile(path)).byteLength)))
    .reduce((total, size) => total + size, 0);
  expect(context?.descriptor.input_bytes).toBe(bytes);
}

beforeAll(async () => {
  installedAssets = bundled.defaultCliIndexerAssetsRoot();
  assets = await mkdtemp(join(tmpdir(), "context-provider-upgrade-"));
  const sourceRoot = join(assets, "skills");
  // Only the tiny shipped Skills, never a customer repository or node_modules.
  await cp(resolve(packageRoot, "../../plugins/context/skills"), sourceRoot, { recursive: true });
  const rules = join(sourceRoot, "context-code-indexer/references/indexer.md");
  await writeFile(rules, `${await readFile(rules, "utf8")}\nPrior installation guidance.\n`);
  oldAssets = join(assets, "old");
  await materializeBundledIndexerDistribution({ packageRoot, sourceRoot, outputRoot: oldAssets });
}, 30_000);

afterEach(async () => {
  assetSpy?.mockRestore();
  assetSpy = undefined;
  readingSpy?.mockRestore();
  readingSpy = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
afterAll(async () => { if (assets) await rm(assets, { recursive: true, force: true }); });

describe("installed Provider upgrades preserve useful work", () => {
  for (const managed of [false, true]) {
    test(`resumes an old running Partition with current instructions (managed=${managed})`, async () => {
      assetSpy = spyOn(bundled, "defaultCliIndexerAssetsRoot").mockReturnValue(oldAssets);
      const root = await createDocumentRevisionWorkspace();
      roots.push(root);
      const registryPath = join(root, "src/indexers.yaml");
      const registryBefore = await readFile(registryPath, "utf8");
      const sourcesBefore = await readFile(join(root, "sources/repo/index.yaml"), "utf8");
      const authorities = contextWorkflowAuthorities({ managed });
      const current = async () => {
        const route = await projectCurrentIndexerWorkflowRoute({
          projectRoot: root, route: documentRevisionOuterIndexerRoute(), managed, authorities,
        });
        if (!route) throw new Error("missing current route");
        return route;
      };
      // Cover an applied selection as well as a directly configured registry.
      if (managed) await completeCurrentIndexerProviderSelection({
        projectRoot: root, currentRegistry: YAML.parse(registryBefore) as IndexerRegistry,
        semantic: { stage: "provider-selection", host_visible_skills: [],
          indexers: (YAML.parse(registryBefore) as IndexerRegistry).indexers },
      });
      await advanceCurrentIndexerLifecycle(root);
      const before = await current();
      expect(await resource(before, "resolved-indexer-instructions")).toContain("Prior installation guidance.");
      const ledgerBefore = await currentLedger(root);

      // Actual installed assets change; the registry and persisted task remain old.
      assetSpy.mockReturnValue(installedAssets);
      const after = await current();
      expect(after.node).toBe("run-indexer-agent-step");
      expect(after.revision).not.toBe(before.revision);
      expect(await resource(after, "resolved-indexer-instructions")).not.toContain("Prior installation guidance.");
      expect(await currentLedger(root)).toEqual(ledgerBefore);
      expect((await current()).revision).toBe(after.revision);
      const input = indexerAgentStepInputSchema.parse(after.action?.input);
      if (input.stage !== "partition") throw new Error("expected Partition");
      const results = [];
      for (const task of input.tasks) {
        const view = await resource(after, task.workset_view_resource_id);
        const workset = input.transport.worksets.find((entry) => entry.workset_digest === task.workset_digest);
        if (!workset || workset.stage !== "partition") throw new Error("missing workset");
        results.push({ task_key: task.task_key, result: {
          stage: "partition", outcome: "complete", groups: [{
            key: task.task_key, title: "Public constants", subject: task.task_key, subject_intent: "primary",
            reader_task: "Find exported constants and their values.",
            members: readingItems(view, "consumer-anchor", task.task_key).map((item) => item.ref),
            questions: [...workset.reader_question_refs],
            question_targets: workset.allowed_question_target_refs.map((target) => ({ target, role: "primary-carrier" })),
            outline: ["Exports"],
          }], excluded: [], unsupported: [],
        } });
      }
      await expect(completeCurrentIndexerAction({
        cwd: root, revision: before.revision, managed, authorities, value: { stage: "partition", results },
      })).rejects.toThrow("revision does not match the current Indexer route");
      const completed = await completeCurrentIndexerAction({
        cwd: root, revision: after.revision, managed, authorities, value: { stage: "partition", results },
      });
      if (!("outcomes" in completed)) throw new Error("missing batch completion");
      expect(completed.outcomes.filter((item) => item.outcome !== "accepted" || !item.committed)).toEqual([]);
      expect(completed.next).not.toBeNull();
      // Reconciliation must not throw away the just accepted grouping after the
      // Provider upgrade and ask the Agent to generate the same groups again.
      const ledgerAfter = await currentLedger(root);
      expect(ledgerAfter?.entries.every((entry) => entry.stage === "author")).toBe(true);
      const gate = await current();
      expect(gate.gate).toBeDefined();
      if (managed) {
        const build = reading.buildIndexerTaskReading;
        readingSpy = spyOn(reading, "buildIndexerTaskReading").mockImplementation((...args) => {
          const task = build(...args);
          return { ...task, introduction: `${task.introduction}\n${"delivery ".repeat(33_000)}` };
        });
      }
      await completeCurrentIndexerAction({
        cwd: root, revision: gate.revision, managed, authorities,
        value: { stage: "structure-review", decision: "approved" },
      });
      await advanceCurrentIndexerLifecycle(root);
      const author = await current();
      expect(indexerAgentStepInputSchema.parse(author.action?.input).stage).toBe("author");
      expect(await resource(author, "resolved-indexer-instructions")).not.toContain("Prior installation guidance.");
      await assertAuthorReadingCost(root, author);
      // The same rule applies when tools change while Author is already pending.
      const authorLedger = await currentLedger(root);
      assetSpy.mockReturnValue(oldAssets);
      const olderAuthor = await current();
      expect(olderAuthor.revision).not.toBe(author.revision);
      expect(await resource(olderAuthor, "resolved-indexer-instructions")).toContain("Prior installation guidance.");
      await assertAuthorReadingCost(root, olderAuthor);
      assetSpy.mockReturnValue(installedAssets);
      expect((await current()).revision).toBe(author.revision);
      expect(await currentLedger(root)).toEqual(authorLedger);
      const context = await resolveCurrentIndexerAgentContext(root);
      if (!context) throw new Error("missing Author context");
      // Old delivery caches are rebuilt from running specs, not by resetting
      // the source, Partition or task ledger.
      const descriptorPath = join(root, LIFECYCLE_ROOT, "current-indexer-batch.json");
      const { descriptor_digest: _digest, ...oldDescriptor } = context.descriptor;
      void _digest;
      const oldPayload = { ...oldDescriptor, cache_format: 2 };
      await writeFile(descriptorPath, JSON.stringify({ ...oldPayload, descriptor_digest: indexerProtocolDigest(oldPayload) }));
      const resumed = await resolveCurrentIndexerAgentContext(root);
      expect(resumed?.descriptor.cache_format).toBe(5);
      expect(resumed?.descriptor.tasks.map((task) => task.workset_digest))
        .toEqual(context.descriptor.tasks.map((task) => task.workset_digest));
      expect(await currentLedger(root)).toEqual(authorLedger);
      // A parser upgrade may enrich locators or Fact payload metadata after
      // Author was prepared. It must not discard the existing run ledger.
      const originalAuthor = await currentSpec({ projectRoot: root,
        request_digest: authorLedger!.entries[0]!.execution_request_digest });
      const upgradedAuthor = structuredClone(originalAuthor);
      const dependency = indexerAuthorDependencyViewSchema.parse(upgradedAuthor.validation.dependency_view);
      const refreshedDependency = rebuildDependency({
        ...dependency,
        positive_nodes: dependency.positive_nodes.map((node) => node.kind === "selected-fact"
          ? { ...node, fact_digest: indexerProtocolDigest({ current_parser: node.fact_ref }) } : node),
      });
      upgradedAuthor.validation.dependency_view = refreshedDependency;
      if (upgradedAuthor.request.workset.stage !== "author") throw new Error("expected Author");
      upgradedAuthor.request.workset.group_dependency_view_digest = refreshedDependency.view_digest;
      upgradedAuthor.request.workset.source_binding_digest = refreshedDependency.view_digest;
      upgradedAuthor.request.run_environment.dependency_view_digest = refreshedDependency.view_digest;
      upgradedAuthor.request.run_environment.source_dependency_fingerprint = refreshedDependency.view_digest;
      expect((await reuseCurrentIndexerRuns({ projectRoot: root, specs: [upgradedAuthor] }))[0]).toEqual(originalAuthor);
      const changedSource = structuredClone(upgradedAuthor);
      const changedView = indexerAuthorDependencyViewSchema.parse(changedSource.validation.dependency_view);
      changedSource.validation.dependency_view = rebuildDependency({
        ...changedView, positive_nodes: changedView.positive_nodes.map((node) => node.kind === "source-span"
          ? { ...node, content_digest: indexerProtocolDigest("changed source bytes") } : node),
      });
      expect((await reuseCurrentIndexerRuns({ projectRoot: root, specs: [changedSource] }))[0]).toBe(changedSource);
      if (managed) {
        expect(context.descriptor.tasks).toHaveLength(1);
        expect(context.descriptor.input_bytes).toBeGreaterThan(256 * 1024);
      }
      const authorResults = [];
      for (const descriptor of context.descriptor.tasks) {
        const task = await loadCurrentIndexerBatchTask({ projectRoot: root, descriptor: context.descriptor, taskKey: descriptor.task_key });
        const workset = task.spec.request.workset;
        if (workset.stage !== "author") throw new Error("expected Author workset");
        const validation = task.spec.validation as {
          dependency_view: { positive_nodes: Array<{ kind: string; evidence_ref?: string }> };
          artifact_policy_eligibility: { eligible_variants: Array<{ id: string }> };
          allowed_artifact_intents: Array<{ source_role: string; document_kind: string; reader_goal: string; artifact_kind: string }>;
          canonical_inventory_members: IndexerInventoryMember[];
          allowed_question_targets: Array<{ question_target_key: string }>;
        };
        // Use the source_items actually handed to a fresh Agent, not internal
        // dependency/evidence IDs hidden in the run spec.
        const material = await resource(author, `authorized-indexer-workset-view/${descriptor.task_key}`);
        const source = readingObjects(material).find((item) => Array.isArray(item.source_items));
        expect(source?.source_items).toBeDefined();
        const intent = validation.allowed_artifact_intents[0]!;
        const missingMaterial = indexerAuthorSemanticInputSchema.parse({
          stage: "author", group_key: workset.group_key, outcome: "request-material",
          material_gaps: [{ question: "Need the complete declaration body", source_hints: source!.source_items }],
          member_dispositions: validation.canonical_inventory_members.map((member) => ({
            item: member.member_id, state: "catalog-only", reason_code: "missing-source-body",
          })),
        });
        expect(() => buildIndexerAuthorRunResultFromSemantic({
          request: task.spec.request, view: task.view, semantic: missingMaterial,
          validation: { ...task.spec.validation, allowed_question_targets: [] } as unknown as
            Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"],
        })).toThrow("Author requested source material: Need the complete declaration body");
        expect(await currentLedger(root)).toEqual(authorLedger);
        authorResults.push({ task_key: descriptor.task_key, result: {
          stage: "author", group_key: workset.group_key, outcome: "publish",
          artifact_intent: [intent.source_role, intent.document_kind, intent.reader_goal, intent.artifact_kind].join("/"),
          policy: validation.artifact_policy_eligibility.eligible_variants[0]!.id,
          target_resolutions: (workset.target_resolution_view?.entries ?? []).map((entry) => ({
            target: entry.query_ref, disposition: entry.state === "resolved" ? "reuse-existing" : "create-independent",
          })),
          title: `Constants ${workset.group_key}`, summary: "Find the public constant exports.",
          sections: [{ key: "exports", heading: "Exports", markdown: "Use the exported constants at the public entry point.",
            source_items: source!.source_items,
            facts: task.view.items.filter((item) => item.category === "fact").map((item) => item.ref),
            answers: validation.allowed_question_targets.map((target) => target.question_target_key) }],
          member_dispositions: validation.canonical_inventory_members.map((member) => ({ item: member.member_id, state: "covered", section: "exports" })),
          material_gaps: [], diagnostics: [],
        } });
        const repeated = indexerAuthorSemanticInputSchema.parse(authorResults.at(-1)!.result);
        const section = repeated.sections[0]!;
        section.facts = [...section.facts, ...section.facts];
        section.answers = [...section.answers, ...section.answers];
        repeated.sections.push({ ...section, key: "details", heading: "Details" });
        const normalized = buildIndexerAuthorRunResultFromSemantic({ request: task.spec.request,
          view: task.view, semantic: repeated, validation: task.spec.validation as unknown as
            Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"] });
        expect(() => validateIndexerMainRunResult({ request: task.spec.request, result: normalized,
          validation: task.spec.validation as unknown as Parameters<typeof validateIndexerMainRunResult>[0]["validation"],
        })).not.toThrow();
      }
      const authored = await completeCurrentIndexerAction({
        cwd: root, revision: author.revision, managed, authorities,
        value: { stage: "author", results: authorResults },
      });
      if (!("outcomes" in authored)) throw new Error("missing Author completion");
      expect(authored.outcomes.every((item) => item.outcome === "accepted" && item.committed)).toBe(true);
      expect(authored.next).not.toBeNull();
      if (managed) {
        expect((await currentLedger(root))?.entries.filter((entry) => entry.state === "accepted")).toHaveLength(1);
        const next = await resolveCurrentIndexerAgentContext(root);
        expect(next).toBeUndefined();
        expect((await readIndexerDelivery(root))?.current).toHaveLength(1);
        expect(await readCandidateRecords(root)).toHaveLength(1);
        expect((await currentLedger(root))?.entries.filter((entry) => entry.state === "pending")).toHaveLength(1);
      }
      expect(await readFile(join(root, "sources/repo/index.yaml"), "utf8")).toBe(sourcesBefore);
      expect((YAML.parse(await readFile(registryPath, "utf8")) as IndexerRegistry).indexers[0]!.providers[0]!.integrity)
        .toBe((YAML.parse(registryBefore) as IndexerRegistry).indexers[0]!.providers[0]!.integrity);
    }, 45_000);
  }

  test("reuses instructions-only changes but not changed source, program, config or result contracts", async () => {
    const root = await createDocumentRevisionWorkspace();
    roots.push(root);
    await advanceCurrentIndexerLifecycle(root);
    const ledger = await currentLedger(root);
    const original = await currentSpec({ projectRoot: root, request_digest: ledger!.entries[0]!.execution_request_digest });
    const guidance = structuredClone(original);
    const changedDigest = `sha256:${"0".repeat(64)}`;
    guidance.request.workset.primary_execution_fingerprint = changedDigest;
    guidance.request.workset.primary_resource_binding_digest = changedDigest;
    guidance.request.run_environment.primary_execution_projection.instructions_digest = changedDigest;
    expect((await reuseCurrentIndexerRuns({ projectRoot: root, specs: [guidance] }))[0]).toEqual(original);
    for (const field of ["program_digest", "config_digest", "cli_contract_digest", "profile_contract_digest"] as const) {
      const changed = structuredClone(guidance);
      changed.request.run_environment.primary_execution_projection[field] = changedDigest;
      expect((await reuseCurrentIndexerRuns({ projectRoot: root, specs: [changed] }))[0]).toBe(changed);
    }
    const changed = structuredClone(guidance);
    changed.request.workset.source_scope_digest = changedDigest;
    expect((await reuseCurrentIndexerRuns({ projectRoot: root, specs: [changed] }))[0]).toBe(changed);
    const validation = structuredClone(guidance);
    validation.validation.allowed_question_targets = [];
    expect((await reuseCurrentIndexerRuns({ projectRoot: root, specs: [validation] }))[0]).toBe(validation);
  });

  test("missing capability returns the existing selection Action, not an identity dead end", async () => {
    const root = await createDocumentRevisionWorkspace();
    roots.push(root);
    const path = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(path, "utf8")) as IndexerRegistry;
    registry.indexers[0]!.profile.primary.id = "removed-profile";
    await writeFile(path, YAML.stringify(registry));
    const route = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root, route: documentRevisionOuterIndexerRoute(), managed: true,
      authorities: contextWorkflowAuthorities({ managed: true }),
    });
    expect(route?.action?.input).toMatchObject({ stage: "provider-selection" });
    expect(route?.commands[0]?.command).toContain("action complete-current");
    expect(route?.action?.output_schema).toBeDefined();
  });
});
