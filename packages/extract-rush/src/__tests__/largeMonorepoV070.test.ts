import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import {
  buildIndexerMainWorkset,
  canonicalIndexerNodeRef,
  indexerAuthorizedPartitionStrategies,
  indexerInventoryMembersDigest,
  indexerPartitionPlanCanonicalHash,
  indexerPartitionStrategySetDigest,
  loadIndexerProviderManifest,
  parseIndexerRegistry,
  resolveIndexerPartitionStrategies,
  validateIndexerPartitionPlan,
  type IndexerInventoryMember,
  type IndexerPartitionPlan,
} from "../../../context/src/index.js";
import { indexRushWorkspace } from "../index.js";

const PROJECT_COUNT = 48;
const SOURCE_REF = "repo:20260829/anonymous-rush";
const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function projectName(index: number): string {
  return `@anonymous/project-${index.toString().padStart(2, "0")}`;
}

function projectFolder(index: number): string {
  return `projects/project-${index.toString().padStart(2, "0")}`;
}

function subspace(index: number): string {
  return ["web", "services", "shared"][index % 3]!;
}

async function createLargeRushFixture(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "anonymous-rush-large-"));
  root = workspace;
  await mkdir(join(workspace, "common", "config", "rush"), { recursive: true });
  const projects = Array.from({ length: PROJECT_COUNT }, (_, index) => ({
    packageName: projectName(index),
    projectFolder: projectFolder(index),
    subspaceName: subspace(index),
    tags: [index % 2 === 0 ? "application" : "library"],
    shouldPublish: index % 4 === 0,
  }));
  await writeFile(join(workspace, "rush.json"), JSON.stringify({
    rushVersion: "5.122.0",
    projects,
  }, null, 2), "utf8");
  await writeFile(
    join(workspace, "common", "config", "rush", "subspaces.json"),
    JSON.stringify({
      subspacesEnabled: true,
      preventSelectingAllSubspaces: true,
      subspaceNames: ["services", "shared", "web"],
    }, null, 2),
    "utf8",
  );
  for (let index = 0; index < PROJECT_COUNT; index += 1) {
    const folder = join(workspace, projectFolder(index));
    await mkdir(join(folder, "src"), { recursive: true });
    const dependencyIndex = index < 3 ? null : index - 3;
    await writeFile(join(folder, "package.json"), JSON.stringify({
      name: projectName(index),
      ...(dependencyIndex === null
        ? {}
        : { dependencies: { [projectName(dependencyIndex)]: "workspace:*" } }),
    }, null, 2), "utf8");
    await writeFile(join(folder, "src", "entry.ts"), `export const id = ${index};\n`, "utf8");
  }
  return workspace;
}

function registryYaml(input: { version: string; integrity: string }): string {
  return YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "rush-project-knowledge",
      reader_goals: ["understand"],
      coverage_domains: { "technical-structure": "required" },
      target_scope: { targets: [{ source_ref: SOURCE_REF, module_refs: [] }] },
      evidence_source_scope: { targets: [{ source_ref: SOURCE_REF, module_refs: [] }] },
    }],
    indexers: [{
      id: "anonymous-rush-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "rush-project-knowledge",
        coverage_domains: ["technical-structure"],
        owned_scope: { ref: "requirement:rush-project-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:rush-project-knowledge#target_scope"] },
      profile: {
        primary: { id: "web-application", provider: "community" },
        additional: [{
          id: "monorepo-container",
          provider: "community",
          kind: "supporting",
          variants: { build_system: "rush" },
        }],
      },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: input.version,
        integrity: input.integrity,
        distribution: {
          kind: "workspace",
          locator: "workspace://plugins/context/skills/context-code-indexer",
        },
      }],
    }],
  });
}

function projectInventory(projectNames: readonly string[]): IndexerInventoryMember[] {
  return projectNames.map((name) => ({
    member_id: `member:project/${name.replace(/^@/u, "").replace("/", ".")}`,
    member_kind: "project" as const,
  })).sort((left, right) => left.member_id.localeCompare(right.member_id));
}

function completeProjectPlan(input: {
  workset: Extract<ReturnType<typeof buildIndexerMainWorkset>, { stage: "partition" }>;
  inventory: readonly IndexerInventoryMember[];
  strategy: ReturnType<typeof indexerAuthorizedPartitionStrategies>[number];
}): IndexerPartitionPlan {
  const groups = input.inventory.map((member) => {
    const localKey = member.member_id.slice("member:project/".length);
    const subjectKey = {
      protocol: "context.subject-key/v1" as const,
      namespace: "anonymous-rush",
      kind: "rush-project",
      local_key: localKey,
    };
    return {
      group_key: `project:${localKey}`,
      subject_key: subjectKey,
      subject_intent: "primary" as const,
      logical_unit_ref: canonicalIndexerNodeRef(subjectKey),
      label: localKey,
      reader_question_refs: ["question:responsibility-and-entry"],
      question_target_bindings: [{
        target_ref: `question-target:rush-project-responsibility/${localKey}`,
        role: "primary-carrier" as const,
      }],
      member_ids: [member.member_id],
    };
  });
  type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
  const payload: Omit<CompletePartitionPlan, "canonical_hash"> = {
    protocol: "context.indexer.partition-plan/v1",
    status: "complete",
    binding: {
      partition_workset_digest: input.workset.workset_digest,
      indexer_id: input.workset.indexer_id,
      indexer_fingerprint: input.workset.primary_execution_fingerprint,
      requirement_digest: input.workset.requirement_set_digest,
      subject_key_schema_digest: input.workset.subject_key_schema_digest,
      source_scope_digest: input.workset.source_scope_digest,
      source_refs: [SOURCE_REF],
      module_ref: input.workset.module_ref,
      partition_subject_key: input.workset.partition_subject_key,
      parent_scope_ref: input.workset.module_ref!,
      inventory_digest: input.workset.partition_inventory_digest,
      question_target_inventory_digest: input.workset.question_target_inventory_digest,
    },
    strategy_ref: input.strategy.strategy_ref,
    strategy_digest: input.strategy.strategy_digest,
    unit_type: "rush-project",
    partition_axis: "rush-project-folder",
    reader_question_refs: ["question:responsibility-and-entry"],
    groups,
    member_dispositions: groups.map((group) => ({
      member_id: group.member_ids[0]!,
      member_kind: "project" as const,
      inventory_disposition: "owned" as const,
      group_key: group.group_key,
    })),
    failure: null,
  };
  return { ...payload, canonical_hash: indexerPartitionPlanCanonicalHash(payload) };
}

describe("anonymous large Rush project-first fixture", () => {
  test("keeps the project denominator and supporting profile composition stable", async () => {
    const workspace = await createLargeRushFixture();
    const first = await indexRushWorkspace(workspace);
    expect(first.projects).toHaveLength(PROJECT_COUNT);
    expect(first.subspaces.map((item) => item.name)).toEqual([
      "default",
      "services",
      "shared",
      "web",
    ]);
    expect(first.projects.flatMap((item) => item.workspaceDependencies))
      .toHaveLength(PROJECT_COUNT - 3);

    const manifest = await loadIndexerProviderManifest(join(
      REPOSITORY_ROOT,
      "plugins",
      "context",
      "skills",
      "context-code-indexer",
    ));
    const registry = parseIndexerRegistry(registryYaml({
      version: manifest.version,
      integrity: digest("a"),
    }));
    const profile = registry.indexers[0]!.profile;
    expect(profile.primary.id).toBe("web-application");
    expect(profile.additional).toEqual([{
      id: "monorepo-container",
      provider: "community",
      kind: "supporting",
      variants: { build_system: "rush" },
    }]);

    const resolution = resolveIndexerPartitionStrategies({
      indexer_id: "anonymous-rush-indexer",
      indexer_fingerprint: digest("b"),
      registry_projection_digest: digest("c"),
      selected_profile_ids: [profile.primary.id, ...profile.additional!.map((item) => item.id)],
      provider: {
        layer_ref: "provider-layer:community",
        id: manifest.id,
        version: manifest.version,
        integrity: digest("a"),
        bundle_digest: digest("d"),
        manifest_digest: digest("e"),
        manifest,
      },
      cli_release_digest: digest("f"),
      cli_builtins: [{
        strategy_id: "single-semantic-catalog",
        priority: 0,
        implementation_digest: digest("1"),
      }],
    });
    expect(resolution.selected_profile_ids).toEqual(["monorepo-container", "web-application"]);
    expect(resolution.strategies.map((item) => item.strategy_ref.strategy_id)).toEqual([
      "canonical-semantic-subject",
      "single-semantic-catalog",
      "catalog-fallback",
    ]);
    const authorized = indexerAuthorizedPartitionStrategies(resolution);
    const inventory = projectInventory(first.projects.map((item) => item.packageName));
    const questionTargetRefs = inventory.map((member) =>
      `question-target:rush-project-responsibility/${member.member_id.slice("member:project/".length)}`
    );
    const workset = buildIndexerMainWorkset({
      stage: "partition",
      indexer_id: "anonymous-rush-indexer",
      requirement_ref: "requirement:rush-project-knowledge",
      owner_cell_refs: ["owner-cell:rush-project-knowledge#technical-structure"],
      source_ref: SOURCE_REF,
      module_ref: "module:anonymous-rush",
      primary_registry_projection_digest: digest("2"),
      requirement_set_digest: digest("3"),
      primary_execution_fingerprint: digest("b"),
      profile_contract_digest: digest("4"),
      subject_key_schema_digest: digest("5"),
      source_scope_digest: digest("6"),
      source_binding_digest: digest("7"),
      primary_resource_binding_digest: digest("8"),
      question_target_inventory_digest: digest("9"),
      partition_subject_key: {
        protocol: "context.subject-key/v1",
        namespace: "anonymous-rush",
        kind: "monorepo-container",
        local_key: "root",
      },
      strategy_set_digest: indexerPartitionStrategySetDigest(authorized),
      reader_question_refs: ["question:responsibility-and-entry"],
      partition_input_digests: [digest("a")],
      partition_inventory_digest: indexerInventoryMembersDigest(inventory),
      allowed_question_target_refs: questionTargetRefs,
    });
    if (workset.stage !== "partition") throw new Error("expected partition workset");
    const plan = completeProjectPlan({ workset, inventory, strategy: authorized[0]! });
    expect(validateIndexerPartitionPlan({
      plan,
      workset,
      canonical_inventory_members: inventory,
      authorized_source_refs: [SOURCE_REF],
      authorized_strategies: authorized,
      required_question_target_refs: questionTargetRefs,
    }).groups).toHaveLength(PROJECT_COUNT);

    for (let index = 0; index < PROJECT_COUNT; index += 1) {
      const extraRoot = join(workspace, projectFolder(index), "src", "generated");
      await mkdir(extraRoot, { recursive: true });
      for (let fileIndex = 0; fileIndex < 4; fileIndex += 1) {
        await writeFile(
          join(extraRoot, `extra-${fileIndex}.ts`),
          `export const value${fileIndex} = ${index + fileIndex};\n`,
          "utf8",
        );
      }
    }
    const afterSourceGrowth = await indexRushWorkspace(workspace);
    const afterInventory = projectInventory(afterSourceGrowth.projects.map((item) => item.packageName));
    expect(afterSourceGrowth.projects).toHaveLength(PROJECT_COUNT);
    expect(indexerInventoryMembersDigest(afterInventory)).toBe(
      indexerInventoryMembersDigest(inventory),
    );
  }, 20_000);
});
