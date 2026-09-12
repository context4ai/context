import { authorResultFixture } from "./authorResult.fixture.js";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerAuthorDependencyView,
  indexerInventoryMembersDigest,
  indexerPartitionPlanCanonicalHash,
  indexerRegistryDigests,
  indexerProtocolDigest,
  type IndexerPartitionPlan,
  type IndexerRegistry,
} from "@c4a/context";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import { bundledIndexerProfileContract } from "../project/indexerBaseContracts.js";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import {
  buildProjectIndexerMainAuthorWorksets,
  buildProjectIndexerMainPartitionWorksets,
  buildProjectIndexerQuestionTargetInventory,
  validateProjectIndexerMainRun,
} from "../project/indexerMainLifecycleActions.js";
import { resolveProjectIndexerMainSourceBinding } from
  "../project/indexerMainSourceAdapter.js";
import { projectIndexerPrimaryCarrierQuestionTargetRefs } from
  "../project/indexerAuthorQuestionTargets.js";
import { prepareProjectIndexerWorksetViewMaterialization } from
  "../project/indexerWorksetViewMaterialization.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function markdownRegistry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "documentation",
      reader_goals: ["understand-docs"],
      coverage_domains: {
        "business-semantics": "required",
        operations: "required",
      },
      target_scope: { targets: [{ source_ref: "file:docs", module_refs: [] }] },
      evidence_source_scope: {
        targets: [{ source_ref: "file:docs", module_refs: [] }],
      },
    }],
    indexers: [{
      id: "technical-guide",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "documentation",
        coverage_domains: ["business-semantics", "operations"],
        owned_scope: { ref: "requirement:documentation#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:documentation#target_scope"] },
      profile: { primary: { id: "technical-guide", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-markdown-indexer",
        version: "0.7.0",
        integrity: digest("f"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-markdown-indexer",
        },
      }],
    }],
  };
}

interface MarkdownFixtureFile {
  path: string;
  bytes: string;
  title: string;
}

async function writeMarkdownSnapshot(input: {
  root: string;
  files: readonly MarkdownFixtureFile[];
  capturedAt: string;
}): Promise<void> {
  const sourceRoot = join(input.root, "sources", "file", "docs");
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all(input.files.map((file) =>
    writeFile(join(sourceRoot, file.path), file.bytes, "utf8")
  ));
  await writeFile(join(sourceRoot, "manifest.json"), `${JSON.stringify(
    createDocumentSnapshotManifest({
      sourceType: "file",
      sourceName: "docs",
      capturedAt: input.capturedAt,
      files: input.files,
    }),
    null,
    2,
  )}\n`, "utf8");
}

async function markdownProject(
  files: readonly MarkdownFixtureFile[] = [{
    path: "guide.md",
    bytes: "# Guide\n\nCaptured knowledge.\n",
    title: "Guide",
  }],
): Promise<{
  root: string;
  requirementDigest: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "context-markdown-author-preparation-"));
  const current = markdownRegistry();
  const bundle = (await listCliBundledIndexers()).bundles.find((candidate) =>
    candidate.skill === "context-markdown-indexer"
  );
  if (bundle === undefined) throw new Error("missing CLI-bundled Markdown Indexer");
  Object.assign(current.indexers[0]!.providers[0]!, {
    version: bundle.version,
    integrity: bundle.integrity,
    distribution: bundle.distribution,
  });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "sources", "file"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "markdown-author-preparation-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(current), "utf8");
  await writeFile(join(root, "sources", "file", "index.yaml"), [
    "sources:",
    "  - name: docs",
    "    snapshot:",
    "      manifest: sources/file/docs/manifest.json",
    "",
  ].join("\n"), "utf8");
  await writeMarkdownSnapshot({
    root,
    files,
    capturedAt: "2026-09-02T00:00:00.000Z",
  });
  return {
    root,
    requirementDigest: indexerRegistryDigests(current).requirementSetDigest,
  };
}

describe("project current Author preparation", () => {
  test("reserves question dispositions for the partition primary carrier", () => {
    expect(projectIndexerPrimaryCarrierQuestionTargetRefs([{
      target_ref: "question-target:primary",
      role: "primary-carrier",
    }, {
      target_ref: "question-target:supporting",
      role: "enricher",
    }])).toEqual(["question-target:primary"]);
    expect(projectIndexerPrimaryCarrierQuestionTargetRefs([{
      target_ref: "question-target:supporting",
      role: "enricher",
    }])).toEqual([]);
  });

  test("derives Author worksets and run specs from a validated Markdown partition", async () => {
    const { root, requirementDigest } = await markdownProject();
    const questionTargetInventory = await buildProjectIndexerQuestionTargetInventory({
      projectRoot: root,
      value: {
        protocol: "context.indexer.question-target-inventory-input/v1",
        requirement_set_digest: requirementDigest,
      },
    });
    const partition = await buildProjectIndexerMainPartitionWorksets({
      projectRoot: root,
      value: {
        protocol: "context.indexer.main-partition-workset-build-input/v1",
        question_target_inventory: questionTargetInventory,
      },
    });
    const workset = partition.worksets[0]!;
    const partitionRunSpec = partition.run_specs[0]!;
    if (partitionRunSpec.validation.stage !== "partition") {
      throw new Error("expected a partition validation spec");
    }
    const profileContractDigest = bundledIndexerProfileContract().contract_digest;
    const binding = await resolveProjectIndexerMainSourceBinding({
      projectRoot: root,
      indexer_id: "technical-guide",
      source_ref: "file:docs",
      module_ref: null,
      profile_contract_digest: profileContractDigest,
    });
    expect(binding.partition_inventory.map((member) => member.member_kind)).toEqual([
      "document",
    ]);
    expect(workset.partition_inventory_digest).toBe(
      indexerInventoryMembersDigest(binding.partition_inventory),
    );
    const partitionValidation = partitionRunSpec.validation as typeof partitionRunSpec.validation & {
      canonical_inventory_members: typeof binding.partition_inventory;
      authorized_source_refs: string[];
      authorized_strategies: Array<{
        strategy_ref: Extract<IndexerPartitionPlan, { status: "complete" }>["strategy_ref"];
        strategy_digest: string;
      }>;
      required_question_target_refs: string[];
    };
    type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
    const groupKey = "reader-subject:guide";
    const planPayload: Omit<CompletePartitionPlan, "canonical_hash"> = {
      protocol: "context.indexer.partition-plan/v1",
      status: "complete",
      binding: {
        partition_workset_digest: workset.workset_digest,
        indexer_id: workset.indexer_id,
        indexer_fingerprint: workset.primary_execution_fingerprint,
        requirement_digest: workset.requirement_set_digest,
        source_scope_digest: workset.source_scope_digest,
        source_refs: [workset.source_ref],
        module_ref: workset.module_ref,
        parent_scope_ref: workset.module_ref ?? workset.source_ref,
        inventory_digest: workset.partition_inventory_digest,
        question_target_inventory_digest: workset.question_target_inventory_digest,
      },
      strategy_ref: partitionValidation.authorized_strategies[0]!.strategy_ref,
      strategy_digest: partitionValidation.authorized_strategies[0]!.strategy_digest,
      unit_type: "reader-subject",
      partition_axis: "reader-subject",
      reader_question_refs: workset.reader_question_refs,
      groups: [{
        group_key: groupKey,
        logical_unit_ref: indexerProtocolDigest({ indexer_id: workset.indexer_id, source_ref: workset.source_ref, module_ref: workset.module_ref, group_key: groupKey }),
        label: "Guide",
        reader_question_refs: workset.reader_question_refs,
        question_target_bindings: workset.allowed_question_target_refs.map((targetRef) => ({
          target_ref: targetRef,
          role: "primary-carrier" as const,
        })),
        member_ids: binding.partition_inventory.map((member) => member.member_id),
      }],
      member_dispositions: binding.partition_inventory.map((member) => ({
        member_id: member.member_id,
        member_kind: member.member_kind,
        inventory_disposition: "owned" as const,
        group_key: groupKey,
      })),
      failure: null,
    };
    const plan: CompletePartitionPlan = {
      ...planPayload,
      canonical_hash: indexerPartitionPlanCanonicalHash(planPayload),
    };
    const author = await buildProjectIndexerMainAuthorWorksets({
      projectRoot: root,
      value: {
        protocol: "context.indexer.main-author-workset-build-input/v1",
        partitions: [{
          plan,
          workset,
          canonical_inventory_members: partitionValidation.canonical_inventory_members,
          authorized_source_refs: partitionValidation.authorized_source_refs,
          authorized_strategies: partitionValidation.authorized_strategies,
          required_question_target_refs: partitionValidation.required_question_target_refs,
        }],
      },
    });
    if (!("worksets" in author)) throw new Error("expected author worksets");
    expect(author.requirement_set_digest).toBe(requirementDigest);
    expect(author.worksets).toHaveLength(1);
    expect(author.run_specs).toHaveLength(1);
    expect(author.run_specs[0]?.request.workset.workset_digest).toBe(
      author.worksets[0]?.workset_digest,
    );
    const authorValidation = author.run_specs[0]!.validation;
    if (authorValidation.stage !== "author") {
      throw new Error("expected an author validation spec");
    }
    const currentAuthorValidation = authorValidation as typeof authorValidation & {
      dependency_view: { logical_unit_ref: string };
      canonical_inventory_members: typeof binding.partition_inventory;
      allowed_question_targets: Array<{ question_ref: string }>;
      artifact_policy_eligibility: { eligible_variants: Array<{ id: string }> };
      allowed_artifact_intents: Array<{
        source_role: string;
        document_kind: string;
        reader_goal: string;
        artifact_kind: string;
      }>;
    };
    expect(currentAuthorValidation.dependency_view.logical_unit_ref).toBe(
      indexerProtocolDigest({ indexer_id: workset.indexer_id, source_ref: workset.source_ref, module_ref: workset.module_ref, group_key: groupKey }),
    );
    expect(indexerInventoryMembersDigest(
      currentAuthorValidation.canonical_inventory_members,
    )).toBe(author.worksets[0]!.member_inventory_digest);
    expect(workset.reader_question_refs).toEqual([]);
    expect(currentAuthorValidation.allowed_question_targets).toEqual([]);
    expect(currentAuthorValidation.artifact_policy_eligibility.eligible_variants.map((item) =>
      item.id
    )).toEqual(["standard"]);
    expect(currentAuthorValidation.allowed_artifact_intents).toEqual([
      {
        source_role: "authoritative-document",
        document_kind: "technical-guide",
        reader_goal: "understand-technical-design",
        artifact_kind: "content",
      },
    ]);
    const restoredView = await prepareProjectIndexerWorksetViewMaterialization({
      projectRoot: root,
      run_spec: author.run_specs[0],
    });
    expect(restoredView.projection.view.workset_digest).toBe(
      author.worksets[0]!.workset_digest,
    );
    expect(restoredView.projection.view.items.filter((item) =>
      item.category === "document"
    )).toHaveLength(1);
    expect(restoredView.projection.view.items.filter((item) =>
      item.category === "author-authority"
    )).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({
          allowed_artifact_intents: currentAuthorValidation.allowed_artifact_intents,
          allowed_question_targets: currentAuthorValidation.allowed_question_targets,
        }),
      }),
    ]);

    const fixture = await authorResultFixture(root, author.run_specs[0]!);
    const validationInput = {
      protocol: "context.indexer.main-run-validation-input/v1" as const,
      request: author.run_specs[0]!.request,
      validation: author.run_specs[0]!.validation,
      result: fixture.result,
    };
    const validated = await validateProjectIndexerMainRun({
      projectRoot: root,
      value: validationInput,
    });
    expect(validated).toMatchObject({
      protocol: "context.indexer.main-run-validation/v1",
      graph_outcome: "completed",
    });

    // The source lookup is CLI-derived. Reconstruct it instead of asking an
    // Agent to repair an obsolete inventory fingerprint after an upgrade.
    const metadataDrift = structuredClone(validationInput);
    metadataDrift.validation.source_identity_inventory = { inventory_digest: digest("f") };
    await expect(validateProjectIndexerMainRun({ projectRoot: root, value: metadataDrift }))
      .resolves.toMatchObject({ graph_outcome: "completed" });

    const staleInput = structuredClone(validationInput);
    const staleValidation = staleInput.validation as Record<string, unknown>;
    const currentDependencyView = staleValidation.dependency_view as {
      module_ref: string | null;
      logical_unit_ref: string;
      positive_nodes: unknown[];
      negative_nodes: unknown[];
    };
    staleValidation.dependency_view = buildIndexerAuthorDependencyView({
      source_ref: "file:another-source",
      module_ref: currentDependencyView.module_ref,
      logical_unit_ref: currentDependencyView.logical_unit_ref,
      positive_nodes: currentDependencyView.positive_nodes.map((node) =>
        Object.fromEntries(Object.entries(node as Record<string, unknown>).filter(([key]) =>
          key !== "node_ref"
        ))
      ),
      negative_nodes: currentDependencyView.negative_nodes.map((node) =>
        Object.fromEntries(Object.entries(node as Record<string, unknown>).filter(([key]) =>
          key !== "node_ref"
        ))
      ),
    });
    await expect(validateProjectIndexerMainRun({
      projectRoot: root,
      value: staleInput,
    })).rejects.toThrow(/stale source adapter binding/);
  });

});
