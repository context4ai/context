import { describe, expect, test } from "bun:test";
import {
  auditIndexerProjectedArtifactFanOut,
  buildIndexerArtifactBundle,
  buildIndexerProjectedArtifactPlan,
  canonicalIndexerNodeRef,
  evaluateIndexerCandidateMaterialization,
  indexerPartitionPlanCanonicalHash,
  indexerProtocolDigest,
  validateIndexerProjectedArtifactFanOutAudit,
  validateIndexerProjectedArtifactPlan,
  type IndexerArtifactBundleEntry,
  type IndexerArtifactPolicyEligibility,
  type IndexerPartitionPlan,
  type IndexerProjectedArtifactInput,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;

function subject(localKey = "root"): IndexerSubjectKey {
  return {
    protocol: "context.subject-key/v1",
    namespace: "sample-package",
    kind: "catalog",
    local_key: localKey,
  };
}

function partitionPlan(strategyId = "semantic-subject"): CompletePartitionPlan {
  const key = subject();
  const payload: Omit<CompletePartitionPlan, "canonical_hash"> = {
    protocol: "context.indexer.partition-plan/v1",
    status: "complete",
    binding: {
      partition_workset_digest: digest("1"),
      indexer_id: "sample-indexer",
      indexer_fingerprint: digest("2"),
      requirement_digest: digest("3"),
      subject_key_schema_digest: digest("4"),
      source_scope_digest: digest("5"),
      source_refs: ["repo:sample@revision"],
      module_ref: "module:sample",
      partition_subject_key: subject("partition-root"),
      parent_scope_ref: "module:sample",
      inventory_digest: digest("6"),
      question_target_inventory_digest: digest("7"),
    },
    strategy_ref: strategyId === "catalog-fallback"
      ? {
        kind: "cli-builtin",
        strategy_id: strategyId,
        implementation_digest: digest("8"),
      }
      : {
        kind: "project-indexer",
        indexer_id: "sample-indexer",
        strategy_id: strategyId,
        implementation_digest: digest("8"),
      },
    strategy_digest: digest("9"),
    unit_type: "catalog",
    partition_axis: strategyId,
    reader_question_refs: ["question:overview"],
    groups: [{
      group_key: "catalog:root",
      subject_key: key,
      subject_intent: "primary",
      logical_unit_ref: canonicalIndexerNodeRef(key),
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
  return {
    ...payload,
    canonical_hash: indexerPartitionPlanCanonicalHash(payload),
  };
}

function inventoryPartitionPlan(size: number): CompletePartitionPlan {
  const base = partitionPlan();
  const { canonical_hash: _baseHash, ...basePayload } = base;
  void _baseHash;
  const width = String(size - 1).length;
  const identities = Array.from({ length: size }, (_, index) => {
    const key = String(index).padStart(width, "0");
    const currentSubject = subject(`unit-${key}`);
    return {
      groupKey: `catalog:unit-${key}`,
      memberId: `member:unit-${key}`,
      subject: currentSubject,
      logicalUnitRef: canonicalIndexerNodeRef(currentSubject),
    };
  });
  const payload: Omit<CompletePartitionPlan, "canonical_hash"> = {
    ...basePayload,
    binding: {
      ...base.binding,
      inventory_digest: indexerProtocolDigest({
        members: identities.map((item) => item.memberId),
      }),
    },
    groups: identities.map((item) => ({
      group_key: item.groupKey,
      subject_key: item.subject,
      subject_intent: "primary" as const,
      logical_unit_ref: item.logicalUnitRef,
      label: item.subject.local_key,
      reader_question_refs: ["question:overview"],
      question_target_bindings: [],
      member_ids: [item.memberId],
    })),
    member_dispositions: identities.map((item) => ({
      member_id: item.memberId,
      member_kind: "project",
      inventory_disposition: "owned" as const,
      group_key: item.groupKey,
    })),
  };
  return {
    ...payload,
    canonical_hash: indexerPartitionPlanCanonicalHash(payload),
  };
}

function bundle(input?: {
  entries?: readonly IndexerArtifactBundleEntry[];
  variant?: string;
}) {
  const plan = partitionPlan();
  return buildIndexerArtifactBundle({
    logical_unit_ref: plan.groups[0]!.logical_unit_ref,
    artifact_policy_variant: input?.variant ?? "standard",
    artifacts: input?.entries ?? [{
      artifact_id: "overview",
      artifact_kind: "content",
      purpose: "required",
      reader_question_refs: ["question:overview"],
      evidence_refs: ["evidence:source"],
    }],
  });
}

function eligibility(variant = "standard"): IndexerArtifactPolicyEligibility {
  const payload: Omit<IndexerArtifactPolicyEligibility, "eligibility_digest"> = {
    protocol: "context.indexer.artifact-policy-eligibility/v1",
    profile_id: "contract-source",
    profile_contract_digest: digest("a"),
    operator_contract_digest: digest("b"),
    canonical_facts: [],
    provider_supported_variants: [variant],
    eligible_variants: [{
      id: variant,
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
  return { ...payload, eligibility_digest: indexerProtocolDigest(payload) };
}

function validProjection(input: {
  plan: CompletePartitionPlan;
  bundle: ReturnType<typeof bundle>;
  artifactId?: string;
  artifactKind?: string;
  ownerKind?: "partition-group" | "catalog-fallback";
  projectionKey?: string;
}): IndexerProjectedArtifactInput {
  const entry = input.bundle.artifacts.find((item) =>
    item.artifact_id === (input.artifactId ?? "overview")
  )!;
  return {
    projection_key: input.projectionKey ?? entry.artifact_id,
    artifact_id: entry.artifact_id,
    artifact_kind: input.artifactKind ?? entry.artifact_kind,
    owner: {
      kind: input.ownerKind ?? "partition-group",
      group_key: input.plan.groups[0]!.group_key,
      logical_unit_ref: input.plan.groups[0]!.logical_unit_ref,
    },
    bundle_binding: {
      bundle_digest: input.bundle.bundle_digest,
      artifact_policy_eligibility_digest: eligibility(
        input.bundle.artifact_policy_variant,
      ).eligibility_digest,
      artifact_policy_variant: input.bundle.artifact_policy_variant,
    },
    evidence_justification_refs: entry.evidence_refs,
  };
}

function auditWithInvalidCount(count: number) {
  const plan = partitionPlan();
  const currentBundle = bundle();
  const projections: IndexerProjectedArtifactInput[] = [
    validProjection({ plan, bundle: currentBundle }),
    ...Array.from({ length: count }, (_, index) => ({
      projection_key: `unassigned/${String(index).padStart(3, "0")}`,
      artifact_id: `unassigned-${String(index).padStart(3, "0")}`,
      artifact_kind: "content",
      owner: null,
      bundle_binding: null,
      evidence_justification_refs: [],
    })),
  ];
  const projected = buildIndexerProjectedArtifactPlan({
    partition_workset_digest: plan.binding.partition_workset_digest,
    partition_plan_hash: plan.canonical_hash,
    projected_artifacts: projections,
  });
  return auditIndexerProjectedArtifactFanOut({
    partition_plan: plan,
    projected_artifact_plan: projected,
    artifact_bundles: [currentBundle],
    artifact_policy_eligibilities: [{
      logical_unit_ref: plan.groups[0]!.logical_unit_ref,
      report: eligibility(currentBundle.artifact_policy_variant),
    }],
  });
}

function auditInventoryPageGrowth(size: number) {
  const plan = inventoryPartitionPlan(size);
  const currentEligibility = eligibility();
  const bundles = plan.groups.map((group) => buildIndexerArtifactBundle({
    logical_unit_ref: group.logical_unit_ref,
    artifact_policy_variant: "standard",
    artifacts: [{
      artifact_id: "overview",
      artifact_kind: "content",
      purpose: "required",
      reader_question_refs: ["question:overview"],
      evidence_refs: ["evidence:source"],
    }],
  }));
  const projected = buildIndexerProjectedArtifactPlan({
    partition_workset_digest: plan.binding.partition_workset_digest,
    partition_plan_hash: plan.canonical_hash,
    projected_artifacts: plan.groups.map((group, index) => ({
      projection_key: `${group.group_key}/overview`,
      artifact_id: "overview",
      artifact_kind: "content",
      owner: {
        kind: "partition-group" as const,
        group_key: group.group_key,
        logical_unit_ref: group.logical_unit_ref,
      },
      bundle_binding: {
        bundle_digest: bundles[index]!.bundle_digest,
        artifact_policy_eligibility_digest: currentEligibility.eligibility_digest,
        artifact_policy_variant: "standard",
      },
      evidence_justification_refs: ["evidence:source"],
    })),
  });
  return auditIndexerProjectedArtifactFanOut({
    partition_plan: plan,
    projected_artifact_plan: projected,
    artifact_bundles: bundles,
    artifact_policy_eligibilities: plan.groups.map((group) => ({
      logical_unit_ref: group.logical_unit_ref,
      report: currentEligibility,
    })),
  });
}

describe("projected Artifact plan", () => {
  test("derives stable refs, canonical ordering, and an exact digest", () => {
    const plan = partitionPlan();
    const currentBundle = bundle();
    const projected = buildIndexerProjectedArtifactPlan({
      partition_workset_digest: plan.binding.partition_workset_digest,
      partition_plan_hash: plan.canonical_hash,
      projected_artifacts: [validProjection({ plan, bundle: currentBundle })],
    });
    expect(validateIndexerProjectedArtifactPlan(projected)).toEqual(projected);
    expect(projected.projected_artifacts[0]!.projection_ref).toMatch(
      /^artifact-projection:sha256:/,
    );

    const forged = structuredClone(projected);
    forged.projected_artifacts[0]!.artifact_kind = "examples";
    expect(() => validateIndexerProjectedArtifactPlan(forged)).toThrow(/digest/);
  });
});

describe("projected Artifact fan-out audit", () => {
  test("does not treat total page growth across a larger same-shape inventory as inflation", () => {
    const small = auditInventoryPageGrowth(2);
    const large = auditInventoryPageGrowth(320);

    expect(small).toMatchObject({
      state: "ready",
      summary: {
        projected_artifact_count: 2,
        unassigned_projected_artifact_count: 0,
      },
      candidate_materialization_allowed: true,
    });
    expect(large).toMatchObject({
      state: "ready",
      summary: {
        projected_artifact_count: 320,
        legally_assigned_artifact_count: 320,
        unassigned_projected_artifact_count: 0,
      },
      candidate_materialization_allowed: true,
      outcome: "projected-artifact-fan-out-current",
    });
  });

  test("does not cap a large valid expanded Bundle or semantic splits", () => {
    const parent: IndexerArtifactBundleEntry = {
      artifact_id: "overview",
      artifact_kind: "content",
      purpose: "required",
      reader_question_refs: ["question:overview"],
      evidence_refs: ["evidence:source"],
    };
    const splits: IndexerArtifactBundleEntry[] = Array.from({ length: 349 }, (_, index) => {
      const key = String(index).padStart(4, "0");
      return {
        artifact_id: `continuation-${key}`,
        artifact_kind: "content",
        purpose: "semantic-split" as const,
        reader_question_refs: ["question:overview"],
        evidence_refs: ["evidence:source"],
        split_of: "overview",
        boundary: {
          axis: "source-namespace",
          start_key: `${key}-a`,
          end_key: `${key}-z`,
        },
      };
    });
    const plan = partitionPlan();
    const expanded = bundle({ entries: [parent, ...splits], variant: "expanded" });
    const projected = buildIndexerProjectedArtifactPlan({
      partition_workset_digest: plan.binding.partition_workset_digest,
      partition_plan_hash: plan.canonical_hash,
      projected_artifacts: expanded.artifacts.map((entry) => validProjection({
        plan,
        bundle: expanded,
        artifactId: entry.artifact_id,
        projectionKey: `expanded/${entry.artifact_id}`,
      })),
    });
    const audit = auditIndexerProjectedArtifactFanOut({
      partition_plan: plan,
      projected_artifact_plan: projected,
      artifact_bundles: [expanded],
      artifact_policy_eligibilities: [{
        logical_unit_ref: plan.groups[0]!.logical_unit_ref,
        report: eligibility("expanded"),
      }],
    });
    expect(audit).toMatchObject({
      state: "ready",
      summary: {
        projected_artifact_count: 350,
        legally_assigned_artifact_count: 350,
        unassigned_projected_artifact_count: 0,
      },
      candidate_materialization_allowed: true,
      outcome: "projected-artifact-fan-out-current",
      graph_outcome: "completed",
    });
  });

  test("warns for 101-300 invalid projections and pauses above 300", () => {
    expect(auditWithInvalidCount(100)).toMatchObject({
      state: "ready",
      candidate_materialization_allowed: true,
    });
    expect(auditWithInvalidCount(101)).toMatchObject({
      state: "warning",
      candidate_materialization_allowed: true,
      user_gate_required: false,
      profile_revision_ledger_consumed: false,
    });
    const blocked = auditWithInvalidCount(301);
    expect(blocked).toMatchObject({
      state: "plan-revision-required",
      candidate_materialization_allowed: false,
      outcome: "indexer-plan-revision-required",
      graph_outcome: "partial",
      user_gate_required: false,
      profile_revision_ledger_consumed: false,
      diagnostic_sample_truncated: true,
    });
    expect(blocked.diagnostic_sample).toHaveLength(100);
  });

  test("reports each missing ownership, Bundle, and evidence condition", () => {
    const audit = auditWithInvalidCount(1);
    expect(audit.diagnostic_sample).toContainEqual(expect.objectContaining({
      artifact_id: "unassigned-000",
      missing_requirements: [
        "logical-unit-owner",
        "bundle-variant",
        "evidence-justification",
      ],
    }));
  });

  test("rejects a Bundle variant outside current CLI eligibility", () => {
    const plan = partitionPlan();
    const currentBundle = bundle();
    const projected = buildIndexerProjectedArtifactPlan({
      partition_workset_digest: plan.binding.partition_workset_digest,
      partition_plan_hash: plan.canonical_hash,
      projected_artifacts: [validProjection({ plan, bundle: currentBundle })],
    });
    expect(() => auditIndexerProjectedArtifactFanOut({
      partition_plan: plan,
      projected_artifact_plan: projected,
      artifact_bundles: [currentBundle],
      artifact_policy_eligibilities: [{
        logical_unit_ref: plan.groups[0]!.logical_unit_ref,
        report: eligibility("expanded"),
      }],
    })).toThrow(/ineligible policy variant/);
  });

  test("treats the single catalog fallback parent as a legal owner", () => {
    const plan = partitionPlan("catalog-fallback");
    const currentBundle = buildIndexerArtifactBundle({
      logical_unit_ref: plan.groups[0]!.logical_unit_ref,
      artifact_policy_variant: "catalog",
      artifacts: [{
        artifact_id: "catalog",
        artifact_kind: "content",
        purpose: "required",
        reader_question_refs: ["question:overview"],
        evidence_refs: ["evidence:source"],
      }],
    });
    const projected = buildIndexerProjectedArtifactPlan({
      partition_workset_digest: plan.binding.partition_workset_digest,
      partition_plan_hash: plan.canonical_hash,
      projected_artifacts: [validProjection({
        plan,
        bundle: currentBundle,
        artifactId: "catalog",
        ownerKind: "catalog-fallback",
      })],
    });
    expect(auditIndexerProjectedArtifactFanOut({
      partition_plan: plan,
      projected_artifact_plan: projected,
      artifact_bundles: [currentBundle],
      artifact_policy_eligibilities: [{
        logical_unit_ref: plan.groups[0]!.logical_unit_ref,
        report: eligibility("catalog"),
      }],
    })).toMatchObject({
      state: "ready",
      summary: { unassigned_projected_artifact_count: 0 },
    });
  });

  test("recomputes readiness and rejects stale plans or forged reports", () => {
    const ready = auditWithInvalidCount(0);
    expect(validateIndexerProjectedArtifactFanOutAudit(ready)).toEqual(ready);
    const forged = structuredClone(ready);
    forged.summary.unassigned_projected_artifact_count = 301;
    expect(() => validateIndexerProjectedArtifactFanOutAudit(forged)).toThrow(/digest/);

    const plan = partitionPlan();
    const currentBundle = bundle();
    const projected = buildIndexerProjectedArtifactPlan({
      partition_workset_digest: plan.binding.partition_workset_digest,
      partition_plan_hash: digest("f"),
      projected_artifacts: [validProjection({ plan, bundle: currentBundle })],
    });
    expect(() => evaluateIndexerCandidateMaterialization({
      partition_plan: plan,
      projected_artifact_plan: projected,
      artifact_bundles: [currentBundle],
      artifact_policy_eligibilities: [{
        logical_unit_ref: plan.groups[0]!.logical_unit_ref,
        report: eligibility(),
      }],
    })).toThrow(/stale/);

    const blocked = auditWithInvalidCount(301);
    expect(blocked.outcome).toBe("indexer-plan-revision-required");
    expect(blocked.graph_outcome).toBe("partial");
  });
});
