import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  canonicalIndexerJson,
  type IndexerInventoryMember,
  type IndexerRegistry,
} from "@c4a/context";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
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
  acceptIndexerMainRunStore,
  convergeIndexerMainPartitionRunStore,
} from "../project/indexerMainRunStore.js";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import {
  currentIndexerStructureReview,
} from "../project/indexerStructureReview.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import type { ContextResolvedWorkflowRoute } from
  "../project/workflow/workflowTypes.js";

const SOURCE_REF = "repo:20260903/revision-fixture";

function outerIndexerRoute(): ContextResolvedWorkflowRoute {
  return {
    protocol: "context.workflow.route.v1",
    id: "run-indexer-lifecycle",
    revision: `sha256:${"f".repeat(64)}`,
    node: "run-indexer-lifecycle",
    reason_code: "route.indexer.lifecycle-required",
    availability: "immediate",
    commands: [],
    resources: { required: [], recommended: [] },
    after_action: { evaluate: true },
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-revise-"));
  const bundle = (await listCliBundledIndexers()).bundles.find((item) =>
    item.skill === "context-code-indexer"
  );
  if (bundle === undefined) throw new Error("missing bundled Code Indexer");
  const registry: IndexerRegistry = {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-system"],
      coverage_domains: { architecture: "required" },
      target_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: ["module:app"] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: ["module:app"] }],
      },
    }],
    indexers: [{
      id: "revision-fixture",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
      profile: { primary: { id: "component-library", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: bundle.skill,
        version: bundle.version,
        integrity: bundle.integrity,
        distribution: bundle.distribution,
      }],
    }],
  };
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "knowledge"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "revision-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`);
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(registry));
  await writeFile(join(root, "src", "index.ts"), [
    'import { defineProject, source } from "@c4a/context";',
    'const fixture = source("20260903", "revision-fixture");',
    "export default defineProject({ sources: [fixture], phases: [], packages: [] });",
    "",
  ].join("\n"));
  await writeFile(join(root, "knowledge", "structure.yaml"), YAML.stringify({
    schema_version: "context.approved-structure.v1",
    nodes: [{ node_ref: "node:revision-fixture", title: "Revision fixture", node_type: "entity" }],
    views: [{
      view_ref: "architecture:revision-fixture",
      node_ref: "node:revision-fixture",
      title: "Revision fixture",
      path: "architecture/revision-fixture.md",
      sources: [SOURCE_REF],
      sections: [],
    }],
    edges: [],
  }));
  const sourceRoot = join(root, "fixture-source");
  await mkdir(join(sourceRoot, "src"), { recursive: true });
  await writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({
    name: "revision-fixture-source",
    private: true,
    exports: "./src/index.ts",
  }, null, 2)}\n`);
  await writeFile(join(sourceRoot, "src", "index.ts"), "export const answer = 42;\n");
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.email", "context-test@example.test"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.name", "Context Test"], { cwd: sourceRoot });
  execFileSync("git", ["add", "package.json", "src/index.ts"], { cwd: sourceRoot });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: sourceRoot });
  const ref = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
  const materializedRoot = join(
    root,
    "sources",
    "repo",
    "20260903",
    "revision-fixture",
  );
  await mkdir(join(materializedRoot, ".."), { recursive: true });
  await symlink(sourceRoot, materializedRoot);
  await writeFile(join(root, "sources", "repo", "index.yaml"), [
    "sources:",
    "  - name: '20260903'",
    "    modules:",
    "      - name: revision-fixture",
    "        local: fixture-source",
    "        materializedAt: sources/repo/20260903/revision-fixture",
    "        git:",
    "          remote: https://example.test/revision-fixture.git",
    `          ref: ${ref}`,
    "",
  ].join("\n"));
  return root;
}

async function completePartitionStage(root: string): Promise<void> {
  await advanceCurrentIndexerLifecycle(root);
  while (true) {
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined || current.spec.request.workset.stage !== "partition") return;
    const workset = current.spec.request.workset;
    const validation = current.spec.validation as {
      canonical_inventory_members: IndexerInventoryMember[];
      authorized_source_refs: string[];
      subject_key_contract: unknown;
      required_question_target_refs?: string[];
    };
    const suffix = workset.workset_digest.slice(-8);
    const semantic = {
      stage: "partition" as const,
      outcome: "complete" as const,
      unit_type: "capability",
      partition_axis: "capability-boundary",
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
    const result = buildIndexerPartitionRunResultFromSemantic({
      request: current.spec.request,
      view: current.worksetView.projection.view,
      semantic,
      validation,
    });
    const converged = await convergeIndexerMainPartitionRunStore({
      projectRoot: root,
      workset_digest: workset.workset_digest,
      result,
    });
    expect(converged.convergence.decision).toBe("accepted");
    const semanticPath = join(
      root,
      ".tmp/context-runtime/indexer/semantic-results",
      `${current.spec.request.execution_request_digest.slice("sha256:".length)}.json`,
    );
    await mkdir(join(semanticPath, ".."), { recursive: true });
    await writeFile(semanticPath, canonicalIndexerJson(semantic));
    await advanceCurrentIndexerLifecycle(root);
  }
}

async function completeAuthorStage(
  root: string,
  options: { catalogOnlyFirst?: boolean } = {},
): Promise<{ catalogOnlyCount: number }> {
  let catalogOnlyCount = 0;
  while (true) {
    const current = await resolveCurrentIndexerAgentContext(root);
    if (current === undefined || current.spec.request.workset.stage !== "author") {
      return { catalogOnlyCount };
    }
    const workset = current.spec.request.workset;
    const validation = current.spec.validation as {
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
    const catalogFact = current.worksetView.projection.view.items.find((item) =>
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
        markdown: "Use the exported answer constant as the public entry point.",
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
    const result = buildIndexerAuthorRunResultFromSemantic({
      request: current.spec.request,
      view: current.worksetView.projection.view,
      semantic,
      validation,
    });
    await acceptIndexerMainRunStore({
      projectRoot: root,
      workset_digest: workset.workset_digest,
      result,
    });
    await advanceCurrentIndexerLifecycle(root);
  }
}

describe("current Indexer document revision", () => {
  test("runs one Code workload through Parser Facts, catalog-only, and public guidance", async () => {
    const root = await workspace();
    await advanceCurrentIndexerLifecycle(root);
    const first = await resolveCurrentIndexerAgentContext(root);
    expect(first?.spec.request.workset.stage).toBe("partition");
    expect(first?.worksetView.projection.view.items.some((item) =>
      item.category === "fact"
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
  }, 20_000);

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
    expect(ledger?.entries.filter((entry) => entry.state === "running")).toHaveLength(1);
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
      node: "review-indexer-semantic-structure",
      availability: "requires-user",
      gate: {
        authority: "context.knowledge-review",
        delegatable: true,
        resolution: "user",
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
      node: "review-indexer-semantic-structure",
      availability: "immediate",
      gate: {
        authority: "context.knowledge-review",
        delegatable: true,
        resolution: "session-authority",
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
  }, 20_000);
});
