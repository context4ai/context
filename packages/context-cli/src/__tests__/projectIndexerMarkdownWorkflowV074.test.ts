import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
  type IndexerInventoryMember,
  type IndexerRegistry,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { initContextProject } from "../project/workspace.js";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import {
  projectCurrentIndexerWorkflowRoute,
  resolveCurrentIndexerAgentContext,
} from "../project/indexerCurrentWorkflowRoute.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { collectProjectStatusSnapshot } from "../project/status.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import type { ContextResolvedWorkflowRoute } from
  "../project/workflow/workflowTypes.js";

const roots: string[] = [];
const SOURCE_REF = "file:20260903/manual";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

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

async function markdownWorkspace(): Promise<{
  projectRoot: string;
  indexer: IndexerRegistry["indexers"][number];
}> {
  const root = await mkdtemp(join(tmpdir(), "context-markdown-workflow-"));
  roots.push(root);
  const initialized = await initContextProject({
    cwd: root,
    projectDir: "workspace",
    dev: true,
  });
  const projectRoot = initialized.projectRoot;
  const docsRoot = join(root, "manual");
  await mkdir(docsRoot, { recursive: true });
  await writeFile(join(docsRoot, "intro.md"), [
    "# Deployment guide",
    "",
    "Use the release command to publish the service.",
    "",
    "## Recovery",
    "",
    "Rerun the same command after fixing the reported configuration.",
    "",
  ].join("\n"), "utf8");
  await runCliInDir(projectRoot, [
    "source", "add", "file", "20260903",
    "--module", "manual",
    "--local", docsRoot,
    "--format", "json",
  ]);
  await writeFile(join(projectRoot, "src", "index.ts"), [
    'import { captureFile, defineProject, kbPackage, source } from "@c4a/context";',
    "",
    'const manual = source("20260903", "manual", { type: "file" });',
    "",
    "export default defineProject({",
    "  sources: [manual],",
    "  phases: [captureFile({ source: manual })],",
    "  packages: [kbPackage({",
    '    name: "markdown-workflow-kb",',
    '    template: { path: "src/package-templates/kb", vars: {} },',
    "  })],",
    "});",
    "",
  ].join("\n"), "utf8");
  await runCliInDir(projectRoot, [
    "run", "capture:file:20260903/manual", "--format", "json",
  ]);

  const bundle = (await listCliBundledIndexers()).bundles.find((candidate) =>
    candidate.skill === "context-markdown-indexer"
  );
  if (bundle === undefined) throw new Error("missing bundled Markdown Indexer");
  const indexer: IndexerRegistry["indexers"][number] = {
    id: "workspace-markdown",
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "documentation-knowledge",
      coverage_domains: ["business-semantics"],
      owned_scope: { ref: "requirement:documentation-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: {
      refs: ["requirement:documentation-knowledge#evidence_source_scope"],
    },
    profile: { primary: { id: "documentation-site", provider: "community" } },
    providers: [{
      id: "community",
      role: "primary",
      skill: bundle.skill,
      version: bundle.version,
      integrity: bundle.integrity,
      distribution: bundle.distribution,
    }],
  };
  const registry: IndexerRegistry = {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "documentation-knowledge",
      reader_goals: ["understand-documentation"],
      coverage_domains: { "business-semantics": "required" },
      target_scope: { targets: [{ source_ref: SOURCE_REF, module_refs: [] }] },
      evidence_source_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: [] }],
      },
    }],
    indexers: [],
  };
  await writeFile(
    join(projectRoot, "src", "indexers.yaml"),
    YAML.stringify(registry),
    "utf8",
  );
  return { projectRoot, indexer };
}

async function currentRoute(projectRoot: string): Promise<ContextResolvedWorkflowRoute> {
  const route = await projectCurrentIndexerWorkflowRoute({
    projectRoot,
    route: outerIndexerRoute(),
    authorities: contextWorkflowAuthorities({ managed: true }),
    managed: true,
  });
  if (route === undefined) throw new Error("missing current Indexer route");
  return route;
}

async function configureMarkdownIndexer(input: {
  projectRoot: string;
  indexer: IndexerRegistry["indexers"][number];
}) {
  const authorities = contextWorkflowAuthorities({ managed: true });
  const providerRoute = await currentRoute(input.projectRoot);
  await completeCurrentIndexerAction({
    cwd: input.projectRoot,
    revision: providerRoute.revision,
    managed: true,
    authorities,
    value: {
      stage: "provider-selection",
      host_visible_skills: [],
      indexers: [input.indexer],
    },
  });
  return authorities;
}

describe("0.7.4 Markdown current workflow", () => {
  test("captures one document and completes Partition, Author, Review, close, and build", async () => {
    const { projectRoot, indexer } = await markdownWorkspace();
    const providerRoute = await currentRoute(projectRoot);
    expect(providerRoute).toMatchObject({
      node: "configure-indexer-providers",
      action: { input: { stage: "provider-selection" } },
    });
    const authorities = await configureMarkdownIndexer({ projectRoot, indexer });

    while (true) {
      const current = await resolveCurrentIndexerAgentContext(projectRoot);
      if (current === undefined || current.spec.request.workset.stage !== "partition") break;
      const workset = current.spec.request.workset;
      const validation = current.spec.validation as {
        canonical_inventory_members: IndexerInventoryMember[];
        required_question_target_refs?: string[];
      };
      expect(current.worksetView.projection.view.items.some((item) =>
        item.category === "document"
      )).toBe(true);
      const route = await currentRoute(projectRoot);
      expect(route.commands).toEqual([expect.objectContaining({
        command: expect.stringContaining("action complete-current"),
      })]);
      await completeCurrentIndexerAction({
        cwd: projectRoot,
        revision: route.revision,
        managed: true,
        authorities,
        value: {
          stage: "partition",
          outcome: "complete",
          unit_type: "document-topic",
          partition_axis: "reader-task",
          groups: [{
            key: "deployment-guide",
            title: "Deployment guide",
            reader_task: "Deploy and recover the service.",
            subject: {
              namespace: workset.partition_subject_key.namespace,
              kind: workset.partition_subject_key.kind,
              local_key: "deployment-guide",
            },
            subject_intent: "primary",
            members: validation.canonical_inventory_members.map((member) => member.member_id),
            questions: [...workset.reader_question_refs],
            question_targets: (validation.required_question_target_refs ?? []).map((target) => ({
              target,
              role: "primary-carrier",
            })),
            outline: ["Deployment", "Recovery"],
          }],
          excluded: [],
          unsupported: [],
        },
      });
    }

    const structureRoute = await currentRoute(projectRoot);
    expect(structureRoute).toMatchObject({
      node: "review-indexer-semantic-structure",
      availability: "immediate",
    });
    expect((await currentIndexerStructureReview(projectRoot))?.preview.topics[0]?.target)
      .toEqual({ mode: "create", node_ref: null });
    await completeCurrentIndexerAction({
      cwd: projectRoot,
      revision: structureRoute.revision,
      managed: true,
      authorities,
      value: { stage: "structure-review", decision: "approved" },
    });

    while (true) {
      const current = await resolveCurrentIndexerAgentContext(projectRoot);
      if (current === undefined || current.spec.request.workset.stage !== "author") break;
      const workset = current.spec.request.workset;
      const validation = current.spec.validation as {
        dependency_view: {
          positive_nodes: Array<{ kind: string; evidence_ref?: string }>;
        };
        artifact_policy_eligibility: { eligible_variants: Array<{ id: string }> };
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
      const evidence = validation.dependency_view.positive_nodes.find((node) =>
        node.kind === "source-span" && node.evidence_ref !== undefined
      )?.evidence_ref;
      const intent = validation.allowed_artifact_intents[0];
      const policy = validation.artifact_policy_eligibility.eligible_variants[0];
      if (evidence === undefined || intent === undefined || policy === undefined) {
        throw new Error("Markdown Author lacks current source or policy");
      }
      const route = await currentRoute(projectRoot);
      await completeCurrentIndexerAction({
        cwd: projectRoot,
        revision: route.revision,
        managed: true,
        authorities,
        value: {
          stage: "author",
          group_key: workset.group_key,
          outcome: "publish",
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
              ? "reuse-existing"
              : "create-independent",
          })),
          title: "Deployment and recovery guide",
          summary: "How to publish the service and recover a failed release.",
          sections: [{
            key: "workflow",
            heading: "Deployment and recovery",
            markdown: [
              "Run the release command to publish the service.",
              "If configuration fails, fix it and rerun the same command.",
            ].join("\n\n"),
            source_items: [evidence],
            facts: [],
            answers: validation.allowed_question_targets.map((target) =>
              target.question_target_key
            ),
          }],
          member_dispositions: validation.canonical_inventory_members.map((member) => ({
            item: member.member_id,
            state: "covered",
            section: "workflow",
          })),
          material_gaps: [],
          diagnostics: [],
        },
      });
    }

    const candidates = await readCandidateRecords(projectRoot);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.body).toContain("# Deployment and recovery guide");
    expect(candidates[0]?.body).toContain("fix it and rerun the same command");

    const approved = JSON.parse(await runCliInDir(projectRoot, [
      "review", "approve-all", "--all", "--managed", "--format", "json",
    ])) as { approved: number; materialized: number };
    expect(approved).toMatchObject({ approved: 1, materialized: 1 });

    const closed = JSON.parse(await runCliInDir(projectRoot, [
      "close", "--format", "json",
    ])) as { action: string; verifyErrors: number };
    expect(closed).toMatchObject({ action: "closed", verifyErrors: 0 });
    const afterClose = await collectProjectStatusSnapshot(projectRoot, { managed: true });
    expect(afterClose.status.workflow.current?.node).not.toBe("run-indexer-lifecycle");
    await runCliInDir(projectRoot, [
      "package", "template", "accept", "--all", "--format", "json",
    ]);
    const built = JSON.parse(await runCliInDir(projectRoot, [
      "build", "--format", "json",
    ])) as { packages: Array<{ name: string; state: string; files: number }> };
    expect(built.packages).toEqual([expect.objectContaining({
      name: "markdown-workflow-kb",
      files: expect.any(Number),
    })]);

    const approvedPage = join(projectRoot, "knowledge", candidates[0]!.path);
    expect(await readFile(approvedPage, "utf8")).toContain(
      "# Deployment and recovery guide",
    );
  }, 30_000);

  test("keeps deterministic catalog fallback out of the Agent route", async () => {
    const { projectRoot, indexer } = await markdownWorkspace();
    const authorities = await configureMarkdownIndexer({ projectRoot, indexer });
    const exposedStrategies: string[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await resolveCurrentIndexerAgentContext(projectRoot);
      if (current === undefined) break;
      expect(current.spec.request.workset.stage).toBe("partition");
      const strategy = current.spec.request.partition_strategy_attempt?.strategy_ref.strategy_id;
      if (strategy !== undefined) exposedStrategies.push(strategy);
      const validation = current.spec.validation as {
        canonical_inventory_members: IndexerInventoryMember[];
      };
      const route = await currentRoute(projectRoot);
      await completeCurrentIndexerAction({
        cwd: projectRoot,
        revision: route.revision,
        managed: true,
        authorities,
        value: {
          stage: "partition",
          outcome: "failed",
          unit_type: "document-topic",
          partition_axis: "reader-task",
          groups: [],
          excluded: [],
          unsupported: [],
          failure: {
            code: "strategy-failed",
            message: "No stable semantic split was found.",
            unassigned: validation.canonical_inventory_members.map((member) => member.member_id),
          },
        },
      });
    }
    expect(exposedStrategies).not.toContain(INDEXER_CATALOG_FALLBACK_STRATEGY_ID);
    expect(await currentRoute(projectRoot)).toMatchObject({
      node: "review-indexer-semantic-structure",
    });
  }, 30_000);
});
