import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerArtifactBundle,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerAuthorDependencyView,
  buildIndexerInventoryDispositionSet,
  canonicalIndexerNodeRef,
  indexerArtifactResultDigest,
  indexerEvidenceBindingDigest,
  indexerInventoryMembersDigest,
  indexerPartitionPlanCanonicalHash,
  indexerRegistryDigests,
  type IndexerArtifactResult,
  type IndexerMainAuthorWorkset,
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
import {
  type MainRunSpec,
} from "../project/indexerMainRunStoreRecords.js";

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

function authorResultFixture(spec: MainRunSpec) {
  const workset = spec.request.workset as IndexerMainAuthorWorkset;
  const validation = spec.validation as {
    dependency_view: {
      positive_nodes: Array<{
        kind: string;
        evidence_ref?: string;
        source_ref?: string;
        module_ref?: string | null;
        locator?: { path: string; start_line: number; end_line: number };
        content_digest?: string;
      }>;
    };
    canonical_inventory_members: Array<{ member_id: string; member_kind: "document" }>;
    expected_subject_key: IndexerMainAuthorWorkset["stage"] extends "author"
      ? { protocol: "context.subject-key/v1"; namespace: string; kind: string; local_key: string }
      : never;
    artifact_policy_eligibility: {
      eligible_variants: Array<{
        id: string;
        required_artifact_kinds: string[];
      }>;
    };
    allowed_artifact_intents: Array<{
      source_role: string;
      document_kind: string;
      reader_goal: string;
      artifact_kind: string;
    }>;
  };
  const sourceSpan = validation.dependency_view.positive_nodes.find((node) =>
    node.kind === "source-span"
  );
  if (
    sourceSpan?.evidence_ref === undefined ||
    sourceSpan.source_ref === undefined ||
    sourceSpan.module_ref === undefined ||
    sourceSpan.locator === undefined ||
    sourceSpan.content_digest === undefined
  ) {
    throw new Error("author fixture requires one source span");
  }
  const variant = validation.artifact_policy_eligibility.eligible_variants.find((candidate) =>
    workset.allowed_artifact_policy_variants.includes(candidate.id)
  );
  const artifactKind = variant?.required_artifact_kinds[0];
  const intent = validation.allowed_artifact_intents.find((candidate) =>
    candidate.artifact_kind === artifactKind
  );
  if (variant === undefined || artifactKind === undefined || intent === undefined) {
    throw new Error("author fixture requires one eligible required Artifact intent");
  }
  const artifactId = "content";
  const sectionKey = "overview";
  const evidencePayload = {
    evidence_ref: sourceSpan.evidence_ref,
    kind: "documentation" as const,
    source_ref: sourceSpan.source_ref,
    module_ref: sourceSpan.module_ref,
    locator: sourceSpan.locator,
    content_digest: sourceSpan.content_digest,
    coverage_tier: "lightweight-evidence" as const,
  };
  const evidence = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
  const artifactPayload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: workset.workset_digest,
    partition_plan_binding_digest: workset.partition_plan_binding_digest,
    group_projection_digest: workset.group_projection_digest,
    indexer_id: workset.indexer_id,
    provider_layer_ref: spec.request.final_authority.layer_ref,
    provider_integrity: spec.request.final_authority.integrity,
    provider_bundle_digest: spec.request.final_authority.bundle_digest,
    config_fingerprint: spec.request.final_authority.config_fingerprint,
    customization_fingerprint: spec.request.final_authority.customization_fingerprint,
    requirement_ref: workset.requirement_ref,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    source_role: spec.request.run_environment.source_role,
    logical_unit: {
      group_key: workset.group_key,
      subject_key: validation.expected_subject_key,
      logical_unit_ref: workset.logical_unit_ref,
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: validation.canonical_inventory_members.map((member) => member.member_id),
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      dispositions: validation.canonical_inventory_members.map((member) => ({
        ...member,
        inventory_disposition: "owned" as const,
        projection_disposition: "detailed" as const,
        section_evidence: [{
          artifact_id: artifactId,
          section_key: sectionKey,
          evidence_refs: [evidence.evidence_ref],
        }],
      })),
    }),
    facts: [],
    evidence_bindings: [evidence],
    artifacts: [{
      artifact_id: artifactId,
      artifact_kind: artifactKind,
      artifact_policy_variant: variant.id,
      representation: "sections",
      sections: [{
        section_key: sectionKey,
        owner_indexer_id: workset.indexer_id,
        document_kind: intent.document_kind,
        reader_goal: intent.reader_goal,
        artifact_kind: artifactKind,
        blocks: [{
          block_id: "summary",
          layer: "semantic-prose",
          markdown: `# ${workset.group_key}\n\nStable group knowledge.`,
          evidence_refs: [evidence.evidence_ref],
        }],
      }],
    }],
    artifact_bundle: buildIndexerArtifactBundle({
      logical_unit_ref: workset.logical_unit_ref,
      artifact_policy_variant: variant.id,
      artifacts: [{
        artifact_id: artifactId,
        artifact_kind: artifactKind,
        purpose: "required",
        reader_question_refs: [],
        evidence_refs: [evidence.evidence_ref],
      }],
    }),
    material_question_proposals: [],
    question_target_dispositions: [],
    diagnostics: [],
    input_digest: spec.request.execution_request_digest,
  };
  const artifact = {
    ...artifactPayload,
    output_digest: indexerArtifactResultDigest(artifactPayload),
  };
  return {
    artifact,
    result: {
      protocol: "context.indexer.run-result/v1" as const,
      operation: "main-index" as const,
      consumed_input_view_digest: spec.request.composition_input.view_digest,
      result: {
        protocol: "context.indexer.main-result/v1" as const,
        stage: "author" as const,
        workset_digest: workset.workset_digest,
        execution_request_digest: spec.request.execution_request_digest,
        result: artifact,
      },
    },
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
        subject_key_schema_digest: workset.subject_key_schema_digest,
        source_scope_digest: workset.source_scope_digest,
        source_refs: [workset.source_ref],
        module_ref: workset.module_ref,
        partition_subject_key: workset.partition_subject_key,
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
        subject_key: workset.partition_subject_key,
        subject_intent: "primary",
        logical_unit_ref: canonicalIndexerNodeRef(workset.partition_subject_key),
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
        target_resolution_views: [],
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
      canonicalIndexerNodeRef(workset.partition_subject_key),
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
          expected_subject_key: workset.partition_subject_key,
          allowed_artifact_intents: currentAuthorValidation.allowed_artifact_intents,
          allowed_question_targets: currentAuthorValidation.allowed_question_targets,
        }),
      }),
    ]);

    const fixture = authorResultFixture(author.run_specs[0]!);
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
