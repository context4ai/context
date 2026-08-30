import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerArtifactBundle,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerProjectedArtifactPlan,
  buildIndexerSubjectCatalog,
  canonicalOwnerCellRef,
  canonicalIndexerNodeRef,
  indexerPartitionPlanCanonicalHash,
  indexerRegistryDigests,
  indexerProtocolDigest,
  type IndexerArtifactPolicyEligibility,
  type IndexerPartitionPlan,
  type IndexerRegistry,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { loadContextWorkflowProvider } from "../project/workflow/workflowProvider.js";
import { buildProjectIndexerMainPartitionWorksets } from
  "../project/indexerMainLifecycleActions.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SOURCE_REF = "repo:sample";
const MODULE_REF = "module:app";

function ownerRef(coverageDomain: string): string {
  return canonicalOwnerCellRef({
    requirementRef: "workspace-knowledge",
    coverageDomain,
    sourceRef: SOURCE_REF,
    moduleRef: MODULE_REF,
  });
}

function registry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-system"],
      coverage_domains: { architecture: "required", operations: "required" },
      target_scope: { targets: [{ source_ref: SOURCE_REF, module_refs: [MODULE_REF] }] },
      evidence_source_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: [MODULE_REF] }],
      },
    }],
    indexers: [{
      id: "component-library",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["architecture", "operations"],
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
      profile: { primary: { id: "component-library", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: digest("f"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  };
}

async function project(): Promise<{ root: string; requirementDigest: string }> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-main-lifecycle-"));
  const current = registry();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "main-lifecycle-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(current), "utf8");
  return {
    root,
    requirementDigest: indexerRegistryDigests(current).requirementSetDigest,
  };
}

async function writeInput(root: string, name: string, value: unknown): Promise<string> {
  const path = join(root, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

describe("project main Indexer lifecycle Actions", () => {
  test("accepts only the complete current owner cohort for a partition workset", async () => {
    const { root, requirementDigest } = await project();
    const complete = buildIndexerMainWorkset({
      stage: "partition",
      indexer_id: "component-library",
      requirement_ref: "requirement:workspace-knowledge",
      owner_cell_refs: [ownerRef("operations"), ownerRef("architecture")],
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      primary_registry_projection_digest: digest("1"),
      requirement_set_digest: requirementDigest,
      primary_execution_fingerprint: digest("2"),
      profile_contract_digest: digest("3"),
      subject_key_schema_digest: digest("4"),
      source_scope_digest: digest("5"),
      parser_contract_digest: digest("6"),
      primary_resource_binding_digest: digest("7"),
      question_target_inventory_digest: digest("8"),
      partition_subject_key: {
        protocol: "context.subject-key/v1",
        namespace: "sample",
        kind: "module",
        local_key: "app",
      },
      strategy_set_digest: digest("9"),
      reader_question_refs: ["question:architecture", "question:operations"],
      partition_input_digests: [digest("a")],
      partition_inventory_digest: digest("b"),
      allowed_question_target_refs: [
        "question-target:architecture",
        "question-target:operations",
      ],
    });
    if (complete.stage !== "partition") throw new Error("expected partition workset");
    const {
      protocol: _protocol,
      operation: _operation,
      workset_digest: _worksetDigest,
      ...worksetInput
    } = complete;
    void _protocol;
    void _operation;
    void _worksetDigest;
    const value = {
      protocol: "context.indexer.main-partition-workset-build-input/v1",
      worksets: [worksetInput],
    };
    const built = await buildProjectIndexerMainPartitionWorksets({
      projectRoot: root,
      value,
    });
    expect(built.worksets[0]?.owner_cell_refs).toEqual([
      ownerRef("architecture"),
      ownerRef("operations"),
    ]);

    await expect(buildProjectIndexerMainPartitionWorksets({
      projectRoot: root,
      value: {
        ...value,
        worksets: [{ ...worksetInput, owner_cell_refs: [ownerRef("architecture")] }],
      },
    })).rejects.toThrow(/owner cohort is not the complete current registry authority/);

    await expect(buildProjectIndexerMainPartitionWorksets({
      projectRoot: root,
      value: {
        ...value,
        worksets: [{
          ...worksetInput,
          owner_cell_refs: [
            ownerRef("architecture"),
            ownerRef("operations"),
            "owner-cell:foreign",
          ],
        }],
      },
    })).rejects.toThrow(/owner cohort is not the complete current registry authority/);
  });

  test("builds the current question denominator and rejects a stale requirement digest", async () => {
    const { root, requirementDigest } = await project();
    const base = {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: requirementDigest,
      profile_contract_digests: [digest("a")],
      source_inventory_digests: [digest("b")],
      items: [{
        target_domain_ref: "component-per-module",
        requirement_ref: "requirement:workspace-knowledge",
        owner_cell_ref: "owner-cell:workspace-knowledge#architecture",
        source_ref: "repo:sample@revision",
        module_ref: "module:app",
        subject_key: {
          protocol: "context.subject-key/v1",
          namespace: "sample",
          kind: "module",
          local_key: "app",
        },
        canonical_fact_slice_digest: digest("c"),
      }],
    };
    const currentPath = await writeInput(root, "question-current", base);
    const current = JSON.parse(await runCliInDir(root, [
      "indexer", "build-question-target-inventory",
      "--input", currentPath,
      "--format", "json",
    ]));
    expect(current.protocol).toBe("context.indexer.question-target-inventory/v1");
    expect(current.items).toHaveLength(1);

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
      parser_contract_digest: digest("6"),
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
    expect(graph?.entrypoints["main-index"]).toBe("build-question-target-inventory");
    expect(graph?.edges.some((edge) =>
      edge.kind === "repeat" &&
      edge.from === "converge-main-index-partition-run" &&
      edge.to === "observe-main-index-partition-worksets"
    )).toBe(true);
    expect(graph?.edges.some((edge) =>
      edge.from === "run-main-index-partition-workset" &&
      edge.to === "converge-main-index-partition-run"
    )).toBe(true);
    expect(graph?.edges.some((edge) =>
      edge.from === "prepare-main-index-partition-runs" &&
      edge.to === "observe-main-index-partition-worksets"
    )).toBe(true);
    expect(graph?.edges.some((edge) =>
      edge.from === "start-main-index-partition-run" &&
      edge.to === "run-main-index-partition-workset"
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
        profile_revision_ledger_consumed: false,
        summary: { unassigned_projected_artifact_count: 301 },
      },
    });

    const provider = await loadContextWorkflowProvider();
    const graph = provider.graphs.get("indexer")?.definition;
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "build-target-resolution-views",
        to: "audit-projected-artifact-fan-out",
      }),
      expect.objectContaining({
        from: "audit-projected-artifact-fan-out",
        to: "build-main-index-author-worksets",
        outcomes: ["completed"],
      }),
      expect.objectContaining({
        from: "audit-projected-artifact-fan-out",
        to: "main-index-plan-revision-required",
        outcomes: ["partial"],
      }),
    ]));
  });
});
