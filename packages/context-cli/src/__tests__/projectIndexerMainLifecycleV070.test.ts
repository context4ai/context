import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerArtifactBundle,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerProjectedArtifactPlan,
  buildIndexerSubjectCatalog,
  canonicalOwnerCellRef,
  canonicalIndexerNodeRef,
  indexerPartitionPlanCanonicalHash,
  indexerProtocolDigest,
  type IndexerArtifactPolicyEligibility,
  type IndexerInventoryMember,
  type IndexerPartitionPlan,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { loadContextWorkflowProvider } from "../project/workflow/workflowProvider.js";
import { buildProjectIndexerMainPartitionWorksets } from
  "../project/indexerMainLifecycleActions.js";
import { buildProjectIndexerQuestionTargetInventory } from
  "../project/indexerMainLifecycleActions.js";
import { bundledIndexerProfileContract } from "../project/indexerBaseContracts.js";
import { project, registry, bindCurrentCliBundle, SOURCE_REF, MODULE_REF } from "./projectIndexerMainLifecycleV070.fixture.js";
import { resolveProjectIndexerMainSourceBinding } from
  "../project/indexerMainSourceAdapter.js";
import {
  ensureCurrentProjectIndexerParserExecution,
  ensureCurrentProjectIndexerParserSourceSlice,
} from
  "../project/indexerParserCurrentExecution.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "../project/indexerCurrentPrimaryAuthority.js";
import { clearCompletedLifecycle } from "../project/lifecycleCleanup.js";
import { prepareProjectIndexerWorksetViewMaterialization } from
  "../project/indexerWorksetViewMaterialization.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function ownerRef(coverageDomain: string): string {
  return canonicalOwnerCellRef({
    requirementRef: "workspace-knowledge",
    coverageDomain,
    sourceRef: SOURCE_REF,
    moduleRef: MODULE_REF,
  });
}


async function writeInput(root: string, name: string, value: unknown): Promise<string> {
  const path = join(root, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

describe("project main Indexer lifecycle Actions", () => {
  test("keeps composer-only selection outside primary authority", async () => {
    const withoutComposer = registry();
    await bindCurrentCliBundle(withoutComposer, "context-code-indexer");
    const base = await resolveCurrentProjectIndexerPrimaryAuthority({
      registry: withoutComposer,
      indexer_id: "component-library",
    });
    const withComposer = structuredClone(withoutComposer);
    withComposer.indexers[0]!.profile.composers = [{
      id: "public-contract",
      provider: "community",
    }];
    const composed = await resolveCurrentProjectIndexerPrimaryAuthority({
      registry: withComposer,
      indexer_id: "component-library",
    });
    expect(composed.primary_registry.projection_digest).toBe(
      base.primary_registry.projection_digest,
    );
    expect(composed.primary_execution.primary_execution_fingerprint).toBe(
      base.primary_execution.primary_execution_fingerprint,
    );
    expect(composed.primary_execution.primary_resource_binding_digest).toBe(
      base.primary_execution.primary_resource_binding_digest,
    );
  });

  test("reuses, repairs, and clears the internal current parser execution", async () => {
    const { root } = await project();
    const cacheRoot = join(
      root,
      ".tmp",
      "context-runtime",
      "lifecycle",
      "indexer-parser-executions",
    );
    await mkdir(cacheRoot, { recursive: true });
    const legacyIdentity = createHash("sha256").update("component-library").digest("hex");
    const legacyCache = join(cacheRoot, `${legacyIdentity}.json`);
    const legacyMetadata = join(cacheRoot, `${legacyIdentity}.meta.json`);
    await writeFile(legacyCache, "{}\n", "utf8");
    await writeFile(legacyMetadata, "{}\n", "utf8");
    const first = await ensureCurrentProjectIndexerParserExecution({
      projectRoot: root,
      indexer_id: "component-library",
    });
    expect(existsSync(legacyCache)).toBe(false);
    expect(existsSync(legacyMetadata)).toBe(false);
    const entries = await readdir(cacheRoot, { withFileTypes: true });
    const runtimeDirectories = entries.filter((entry) => entry.isDirectory());
    expect(runtimeDirectories).toHaveLength(1);
    const manifestFile = join(cacheRoot, runtimeDirectories[0]!.name, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
      cache_format: number;
      global_chunk: { file: string };
      sources: unknown[];
    };
    expect(manifest.cache_format).toBe(5);
    expect(manifest.sources).toHaveLength(1);

    const second = await ensureCurrentProjectIndexerParserExecution({
      projectRoot: root,
      indexer_id: "component-library",
    });
    expect(second.execution_digest).toBe(first.execution_digest);

    const cacheFile = join(
      cacheRoot,
      runtimeDirectories[0]!.name,
      "chunks",
      manifest.global_chunk.file,
    );
    await writeFile(cacheFile, "not-json\n", "utf8");
    const sourceSlice = await ensureCurrentProjectIndexerParserSourceSlice({
      projectRoot: root,
      indexer_id: "component-library",
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      profile_contract_digest: bundledIndexerProfileContract().contract_digest,
    });
    expect(sourceSlice.source_binding.binding_digest).toBe(
      first.source_bindings[0]!.binding_digest,
    );
    const repaired = await ensureCurrentProjectIndexerParserExecution({
      projectRoot: root,
      indexer_id: "component-library",
    });
    expect(repaired.execution_digest).toBe(first.execution_digest);
    expect(JSON.parse(await readFile(cacheFile, "utf8"))).toMatchObject({
      protocol: "context.indexer.parser-runtime-execution/v1",
    });

    await clearCompletedLifecycle(root);
    await expect(readdir(cacheRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("reuses an unchanged source slice when the surrounding registry changes", async () => {
    const { root } = await project();
    const first = await ensureCurrentProjectIndexerParserExecution({
      projectRoot: root,
      indexer_id: "component-library",
    });
    const sourceRoot = join(root, "sources", "repo", "20260902", "sample");
    const sourceRef = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRoot,
      encoding: "utf8",
    }).trim();
    const registryPath = join(root, "sources", "repo", "index.yaml");
    const currentRegistry = await readFile(registryPath, "utf8");
    await writeFile(registryPath, [
      currentRegistry.trimEnd(),
      "      - name: unused",
      "        materializedAt: sources/repo/20260902/unused",
      "        git:",
      "          remote: https://example.test/unused.git",
      `          ref: ${sourceRef}`,
      "",
    ].join("\n"), "utf8");

    const second = await ensureCurrentProjectIndexerParserExecution({
      projectRoot: root,
      indexer_id: "component-library",
    });

    expect(second.execution_plan_digest).not.toBe(first.execution_plan_digest);
    expect(second.source_bindings[0]!.binding_digest).toBe(
      first.source_bindings[0]!.binding_digest,
    );
    expect(second.fact_views[0]!.view_digest).toBe(first.fact_views[0]!.view_digest);
    expect(second.adapter_results[0]!.output_digest).toBe(
      first.adapter_results[0]!.output_digest,
    );
  });

  test("derives the complete current owner cohort for a partition workset", async () => {
    const { root, requirementDigest } = await project();
    const questionTargetInventory = await buildProjectIndexerQuestionTargetInventory({
      projectRoot: root,
      value: {
        protocol: "context.indexer.question-target-inventory-input/v1",
        requirement_set_digest: requirementDigest,
      },
    });
    const profileContractDigest = bundledIndexerProfileContract().contract_digest;
    const value = {
      protocol: "context.indexer.main-partition-workset-build-input/v1",
      question_target_inventory: questionTargetInventory,
    };
    const built = await buildProjectIndexerMainPartitionWorksets({
      projectRoot: root,
      value,
    });
    expect(built.worksets[0]?.owner_cell_refs).toEqual([
      ownerRef("architecture"),
      ownerRef("operations"),
    ]);
    expect(built.run_specs[0]?.request.partition_strategy_attempt?.strategy_order).toBe(0);
    expect(built.run_specs[0]?.request.workset.workset_digest).toBe(
      built.worksets[0]?.workset_digest,
    );
    const binding = await resolveProjectIndexerMainSourceBinding({
      projectRoot: root,
      indexer_id: "component-library",
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      profile_contract_digest: profileContractDigest,
    });
    expect(built.worksets[0]?.source_binding_digest).toBe(binding.source_binding_digest);
    expect(built.worksets[0]?.partition_input_digests).toEqual(
      expect.arrayContaining(binding.partition_input_digests),
    );
  });

  test("assigns module reader questions to the strongest public consumer family", async () => {
    const { root, requirementDigest } = await project({ rankedCodeInventory: true });
    const questionTargetInventory = await buildProjectIndexerQuestionTargetInventory({
      projectRoot: root,
      value: {
        protocol: "context.indexer.question-target-inventory-input/v1",
        requirement_set_digest: requirementDigest,
      },
    });
    const built = await buildProjectIndexerMainPartitionWorksets({
      projectRoot: root,
      value: {
        protocol: "context.indexer.main-partition-workset-build-input/v1",
        question_target_inventory: questionTargetInventory,
      },
    });
    const carriers = built.run_specs.filter((spec) =>
      spec.request.workset.stage === "partition" &&
      spec.request.workset.allowed_question_target_refs.length > 0
    );
    expect(carriers).toHaveLength(1);
    const carrierMembers = (carriers[0]!.validation as {
      canonical_inventory_members: IndexerInventoryMember[];
    }).canonical_inventory_members;
    const shardMemberCounts = built.run_specs.map((spec) =>
      (spec.validation as { canonical_inventory_members: IndexerInventoryMember[] })
        .canonical_inventory_members.length
    );
    expect(carrierMembers.length).toBe(Math.max(...shardMemberCounts));
    expect(carrierMembers.length).toBeGreaterThan(1);
    const preparedView = await prepareProjectIndexerWorksetViewMaterialization({
      projectRoot: root,
      run_spec: carriers[0]!,
    });
    const parserFiles = preparedView.projection.view.items.filter((item) =>
      item.category === "parser-file"
    );
    expect(parserFiles.length).toBeGreaterThan(0);
    expect(parserFiles.every((item) =>
      typeof item.value === "object" && item.value !== null &&
      !Array.isArray(item.value) && !("facts" in item.value)
    )).toBe(true);
    expect(preparedView.projection.view.items.some((item) =>
      item.category === "consumer-anchor"
    )).toBe(true);
    expect(preparedView.projection.view.items.some((item) =>
      item.category === "supporting-fact"
    )).toBe(false);
    expect(preparedView.projection.view.items.some((item) =>
      item.category === "inventory-member"
    )).toBe(false);
  });

  test("builds the current question denominator and rejects a stale requirement digest", async () => {
    const { root, requirementDigest } = await project();
    const base = {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: requirementDigest,
    };
    const currentPath = await writeInput(root, "question-current", base);
    const current = JSON.parse(await runCliInDir(root, [
      "indexer", "build-question-target-inventory",
      "--input", currentPath,
      "--format", "json",
    ]));
    expect(current.protocol).toBe("context.indexer.question-target-inventory/v1");
    expect(current.profile_contract_digests).toEqual([
      bundledIndexerProfileContract().contract_digest,
    ]);
    expect(current.source_inventory_digests).toHaveLength(1);
    expect(current.items).toHaveLength(2);
    expect(current.items.map((item: { owner_cell_ref: string }) => item.owner_cell_ref).sort())
      .toEqual([ownerRef("architecture"), ownerRef("operations")].sort());
    expect(current.items.every((item: { source_ref: string }) =>
      item.source_ref === SOURCE_REF
    )).toBe(true);

    const stalePath = await writeInput(root, "question-stale", {
      ...base,
      requirement_set_digest: digest("d"),
    });
    await expect(runCliInDir(root, [
      "indexer", "build-question-target-inventory",
      "--input", stalePath,
      "--format", "json",
    ])).rejects.toThrow(/stale requirement set/);
  });

  test("publishes deterministic main workset counts and exposes the Graph entrypoint", async () => {
    const { root, requirementDigest } = await project();
    const workset = buildIndexerMainWorkset({
      stage: "partition",
      indexer_id: "component-library",
      requirement_ref: "requirement:workspace-knowledge",
      owner_cell_refs: ["owner-cell:workspace-knowledge#architecture"],
      source_ref: "repo:sample@revision",
      module_ref: "module:app",
      primary_registry_projection_digest: digest("1"),
      requirement_set_digest: requirementDigest,
      primary_execution_fingerprint: digest("2"),
      profile_contract_digest: digest("3"),
      subject_key_schema_digest: digest("4"),
      source_scope_digest: digest("5"),
      source_binding_digest: digest("6"),
      primary_resource_binding_digest: digest("7"),
      question_target_inventory_digest: digest("8"),
      partition_subject_key: {
        protocol: "context.subject-key/v1",
        namespace: "sample",
        kind: "module",
        local_key: "app",
      },
      strategy_set_digest: digest("9"),
      reader_question_refs: ["question:architecture"],
      partition_input_digests: [digest("a")],
      partition_inventory_digest: digest("b"),
      allowed_question_target_refs: ["question-target:architecture"],
    });
    const worksetSet = buildIndexerMainWorksetSet([workset]);
    const inputPath = await writeInput(root, "main-observe", {
      protocol: "context.indexer.main-workset-observation-input/v1",
      workset_set: worksetSet,
      records: [],
    });
    const status = JSON.parse(await runCliInDir(root, [
      "indexer", "observe-main-index-worksets",
      "--input", inputPath,
      "--format", "json",
    ]));
    expect(status).toMatchObject({
      total_count: 1,
      pending_count: 1,
      accepted_count: 0,
      outcome: "index-main-workset-pending",
      can_advance: false,
    });
    expect(status.accepted_result_set_digest).toBe(indexerProtocolDigest({
      protocol: "context.indexer.accepted-main-result-set/v1",
      results: [],
    }));

    const provider = await loadContextWorkflowProvider();
    const graph = provider.graphs.get("indexer")?.definition;
    expect(graph?.entrypoints["main-index"]).toBe("advance-current-indexer-lifecycle");
    expect(graph?.entrypoints["current-lifecycle"]).toBe(
      "advance-current-indexer-lifecycle",
    );
    expect(graph?.edges.some((edge) =>
      edge.from === "advance-current-indexer-lifecycle" &&
      edge.to === "run-current-indexer-agent"
    )).toBe(true);
    expect(graph?.edges.some((edge) =>
      edge.from === "run-current-indexer-agent" &&
      edge.to === "review-current-indexer-structure"
    )).toBe(true);
    expect(graph?.edges.some((edge) =>
      edge.from === "run-current-indexer-composer" &&
      edge.to === "resolve-current-indexer-block"
    )).toBe(true);
    expect(graph?.edges.some((edge) =>
      edge.from === "confirm-current-indexer-layout" &&
      edge.to === "current-indexer-ready"
    )).toBe(true);
  });

  test("returns a typed blocking Outcome for an ambiguous exact SubjectKey", async () => {
    const { root, requirementDigest } = await project();
    const subjectKey = {
      protocol: "context.subject-key/v1" as const,
      namespace: "sample",
      kind: "component",
      local_key: "legacy-card",
    };
    const catalog = buildIndexerSubjectCatalog({
      requirement_ref: "requirement:workspace-knowledge",
      subject_key_schema_digest: digest("a"),
      approved_subjects: [{
        node_ref: "node:legacy/card-a",
        subject_key: subjectKey,
      }, {
        node_ref: "node:legacy/card-b",
        subject_key: subjectKey,
      }],
      partition_subjects: [],
    });
    const inputPath = await writeInput(root, "target-resolution-ambiguous", {
      protocol: "context.indexer.target-resolution-build-input/v1",
      requirement_set_digest: requirementDigest,
      catalog,
      queries: [{
        group_ref: "partition-group:ambiguous",
        subject_intent: "enrich-or-independent",
        subject_key: subjectKey,
      }],
    });
    const result = JSON.parse(await runCliInDir(root, [
      "indexer", "build-target-resolution-views",
      "--input", inputPath,
      "--format", "json",
    ]));
    expect(result).toMatchObject({
      protocol: "context.indexer.target-resolution-build/v1",
      outcome: "index-target-resolution-ambiguous",
      graph_outcome: "blocked",
      conflicts: [{
        group_ref: "partition-group:ambiguous",
        conflicting_node_refs: ["node:legacy/card-a", "node:legacy/card-b"],
      }],
    });
  });

  test("pauses Candidate materialization through a non-Gate partial outcome", async () => {
    const { root, requirementDigest } = await project();
    const subjectKey = {
      protocol: "context.subject-key/v1" as const,
      namespace: "sample",
      kind: "catalog",
      local_key: "root",
    };
    type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
    const planPayload: Omit<CompletePartitionPlan, "canonical_hash"> = {
      protocol: "context.indexer.partition-plan/v1",
      status: "complete",
      binding: {
        partition_workset_digest: digest("1"),
        indexer_id: "sample-indexer",
        indexer_fingerprint: digest("2"),
        requirement_digest: requirementDigest,
        subject_key_schema_digest: digest("3"),
        source_scope_digest: digest("4"),
        source_refs: ["repo:sample@revision"],
        module_ref: "module:app",
        partition_subject_key: subjectKey,
        parent_scope_ref: "module:app",
        inventory_digest: digest("5"),
        question_target_inventory_digest: digest("6"),
      },
      strategy_ref: {
        kind: "project-indexer",
        indexer_id: "sample-indexer",
        strategy_id: "semantic-subject",
        implementation_digest: digest("7"),
      },
      strategy_digest: digest("8"),
      unit_type: "catalog",
      partition_axis: "semantic-subject",
      reader_question_refs: ["question:overview"],
      groups: [{
        group_key: "catalog:root",
        subject_key: subjectKey,
        subject_intent: "primary",
        logical_unit_ref: canonicalIndexerNodeRef(subjectKey),
        label: "Catalog",
        reader_question_refs: ["question:overview"],
        question_target_bindings: [],
        member_ids: ["member:root"],
      }],
      member_dispositions: [{
        member_id: "member:root",
        member_kind: "project",
        inventory_disposition: "owned",
        group_key: "catalog:root",
      }],
      failure: null,
    };
    const plan: CompletePartitionPlan = {
      ...planPayload,
      canonical_hash: indexerPartitionPlanCanonicalHash(planPayload),
    };
    const bundle = buildIndexerArtifactBundle({
      logical_unit_ref: plan.groups[0]!.logical_unit_ref,
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "overview",
        artifact_kind: "content",
        purpose: "required",
        reader_question_refs: ["question:overview"],
        evidence_refs: ["evidence:source"],
      }],
    });
    const eligibilityPayload: Omit<IndexerArtifactPolicyEligibility, "eligibility_digest"> = {
      protocol: "context.indexer.artifact-policy-eligibility/v1",
      profile_id: "contract-source",
      profile_contract_digest: digest("9"),
      operator_contract_digest: digest("a"),
      canonical_facts: [],
      provider_supported_variants: ["standard"],
      eligible_variants: [{
        id: "standard",
        required_artifact_kinds: ["content"],
        discretionary_artifact_kinds: [],
        thresholds: [{
          metric_id: "discretionary-artifacts-per-unit",
          metric_operator: "discretionary-artifact-count",
          unit: "count",
          recommended_max: 0,
          hard_max: 0,
        }],
      }],
    };
    const eligibility = {
      ...eligibilityPayload,
      eligibility_digest: indexerProtocolDigest(eligibilityPayload),
    };
    const projected = buildIndexerProjectedArtifactPlan({
      partition_workset_digest: plan.binding.partition_workset_digest,
      partition_plan_hash: plan.canonical_hash,
      projected_artifacts: [{
        projection_key: "overview",
        artifact_id: "overview",
        artifact_kind: "content",
        owner: {
          kind: "partition-group",
          group_key: plan.groups[0]!.group_key,
          logical_unit_ref: plan.groups[0]!.logical_unit_ref,
        },
        bundle_binding: {
          bundle_digest: bundle.bundle_digest,
          artifact_policy_eligibility_digest: eligibility.eligibility_digest,
          artifact_policy_variant: bundle.artifact_policy_variant,
        },
        evidence_justification_refs: ["evidence:source"],
      }, ...Array.from({ length: 301 }, (_, index) => ({
        projection_key: `unassigned/${index}`,
        artifact_id: `unassigned-${index}`,
        artifact_kind: "content",
        owner: null,
        bundle_binding: null,
        evidence_justification_refs: [],
      }))],
    });
    const inputPath = await writeInput(root, "projected-fan-out", {
      protocol: "context.indexer.projected-artifact-fan-out-audit-input/v1",
      partition_plan: plan,
      projected_artifact_plan: projected,
      artifact_bundles: [bundle],
      artifact_policy_eligibilities: [{
        logical_unit_ref: plan.groups[0]!.logical_unit_ref,
        report: eligibility,
      }],
    });
    const result = JSON.parse(await runCliInDir(root, [
      "indexer", "audit-projected-artifact-fan-out",
      "--input", inputPath,
      "--format", "json",
    ]));
    expect(result).toMatchObject({
      protocol: "context.indexer.candidate-materialization-readiness/v1",
      can_materialize_candidate: false,
      outcome: "indexer-plan-revision-required",
      graph_outcome: "partial",
      audit: {
        user_gate_required: false,
        summary: { unassigned_projected_artifact_count: 301 },
      },
    });

  });
});
