import { z } from "zod";
import {
  validateIndexerArtifactBundle,
  validateIndexerArtifactBundlePolicy,
  validateIndexerArtifactPolicyEligibilityReport,
  type IndexerArtifactBundle,
  type IndexerArtifactBundleEntry,
  type IndexerArtifactPolicyEligibility,
} from "./indexerArtifactPolicy.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  indexerPartitionPlanCanonicalHash,
  indexerPartitionPlanSchema,
  type IndexerPartitionGroup,
  type IndexerPartitionPlan,
} from "./indexerPartitionPlan.js";
import {
  validateIndexerProjectedArtifactPlan,
  type IndexerProjectedArtifact,
  type IndexerProjectedArtifactPlan,
} from "./indexerProjectedArtifactPlan.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const INDEXER_PROJECTED_ARTIFACT_WARNING_THRESHOLD = 100;
export const INDEXER_PROJECTED_ARTIFACT_REVISION_THRESHOLD = 300;
const DIAGNOSTIC_SAMPLE_LIMIT = 100;
const MISSING_REQUIREMENT_ORDER = [
  "logical-unit-owner",
  "bundle-variant",
  "evidence-justification",
] as const;

const missingRequirementSchema = z.enum(MISSING_REQUIREMENT_ORDER);

const projectedArtifactDiagnosticSchema = z.object({
  projection_ref: indexerCanonicalRefSchema,
  projection_key: z.string().min(1),
  artifact_id: indexerIdSchema,
  missing_requirements: z.array(missingRequirementSchema).min(1),
}).strict();

const fanOutAuditPayloadSchema = z.object({
  protocol: z.literal("context.indexer.projected-artifact-fan-out-audit/v1"),
  partition_plan_hash: indexerDigestSchema,
  projected_artifact_plan_digest: indexerDigestSchema,
  artifact_bundle_set_digest: indexerDigestSchema,
  state: z.enum(["ready", "warning", "plan-revision-required"]),
  thresholds: z.object({
    warning_above: z.literal(INDEXER_PROJECTED_ARTIFACT_WARNING_THRESHOLD),
    revision_above: z.literal(INDEXER_PROJECTED_ARTIFACT_REVISION_THRESHOLD),
  }).strict(),
  summary: z.object({
    projected_artifact_count: z.number().int().nonnegative(),
    legally_assigned_artifact_count: z.number().int().nonnegative(),
    unassigned_projected_artifact_count: z.number().int().nonnegative(),
  }).strict(),
  unassigned_projection_refs_digest: indexerDigestSchema,
  diagnostic_sample: z.array(projectedArtifactDiagnosticSchema).max(DIAGNOSTIC_SAMPLE_LIMIT),
  diagnostic_sample_truncated: z.boolean(),
  candidate_materialization_allowed: z.boolean(),
  user_gate_required: z.literal(false),
  profile_revision_ledger_consumed: z.literal(false),
  outcome: z.enum([
    "projected-artifact-fan-out-current",
    "indexer-plan-revision-required",
  ]),
  graph_outcome: z.enum(["completed", "partial"]),
}).strict();

export const indexerProjectedArtifactFanOutAuditSchema = fanOutAuditPayloadSchema.extend({
  audit_digest: indexerDigestSchema,
}).strict();

export type IndexerProjectedArtifactDiagnostic = z.infer<
  typeof projectedArtifactDiagnosticSchema
>;
export type IndexerProjectedArtifactFanOutAudit = z.infer<
  typeof indexerProjectedArtifactFanOutAuditSchema
>;

interface ValidatedPlanningInput {
  partitionPlan: IndexerPartitionPlan;
  projectedPlan: IndexerProjectedArtifactPlan;
  bundles: IndexerArtifactBundle[];
  bundleSetDigest: string;
}

interface LogicalUnitEligibility {
  logical_unit_ref: string;
  report: IndexerArtifactPolicyEligibility;
}

function auditPayload(
  audit: IndexerProjectedArtifactFanOutAudit,
): Omit<IndexerProjectedArtifactFanOutAudit, "audit_digest"> {
  const { audit_digest: _digest, ...payload } = audit;
  void _digest;
  return payload;
}

function validatePartitionPlanEnvelope(value: unknown): IndexerPartitionPlan {
  const plan = indexerPartitionPlanSchema.parse(value);
  const payload = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "canonical_hash"),
  ) as Omit<IndexerPartitionPlan, "canonical_hash">;
  if (indexerPartitionPlanCanonicalHash(payload) !== plan.canonical_hash) {
    throw new TypeError("projected Artifact audit received an invalid PartitionPlan hash");
  }
  if (plan.status !== "complete") {
    throw new TypeError("projected Artifact audit requires a complete PartitionPlan");
  }
  return plan;
}

function bundleEntryKey(bundleDigest: string, artifactId: string): string {
  return `${bundleDigest}\0${artifactId}`;
}

function validatePlanningInput(input: {
  partition_plan: unknown;
  projected_artifact_plan: unknown;
  artifact_bundles: readonly unknown[];
  artifact_policy_eligibilities: readonly {
    logical_unit_ref: string;
    report: unknown;
  }[];
}): ValidatedPlanningInput {
  const partitionPlan = validatePartitionPlanEnvelope(input.partition_plan);
  const projectedPlan = validateIndexerProjectedArtifactPlan(input.projected_artifact_plan);
  if (
    projectedPlan.partition_plan_hash !== partitionPlan.canonical_hash ||
    projectedPlan.partition_workset_digest !== partitionPlan.binding.partition_workset_digest
  ) {
    throw new TypeError("projected Artifact plan is stale for the current PartitionPlan");
  }
  const bundles = input.artifact_bundles.map(validateIndexerArtifactBundle).sort((left, right) =>
    compareIndexerCanonicalText(left.bundle_digest, right.bundle_digest)
  );
  if (
    new Set(bundles.map((bundle) => bundle.bundle_digest)).size !== bundles.length ||
    new Set(bundles.map((bundle) => bundle.logical_unit_ref)).size !== bundles.length
  ) {
    throw new TypeError("projected Artifact audit received duplicate Bundle plans");
  }
  const knownLogicalUnits = new Set(partitionPlan.groups.map((group) => group.logical_unit_ref));
  if (bundles.some((bundle) => !knownLogicalUnits.has(bundle.logical_unit_ref))) {
    throw new TypeError("projected Artifact audit received an unrelated Bundle plan");
  }
  const eligibilities: LogicalUnitEligibility[] = input.artifact_policy_eligibilities.map(
    (item) => ({
      logical_unit_ref: item.logical_unit_ref,
      report: validateIndexerArtifactPolicyEligibilityReport(item.report),
    }),
  );
  const eligibilityByUnit = new Map(eligibilities.map((item) => [
    item.logical_unit_ref,
    item.report,
  ]));
  if (
    eligibilityByUnit.size !== eligibilities.length ||
    eligibilities.some((item) => !knownLogicalUnits.has(item.logical_unit_ref))
  ) {
    throw new TypeError("projected Artifact audit received duplicate or unrelated eligibility");
  }
  const groupByUnit = new Map(partitionPlan.groups.map((group) => [
    group.logical_unit_ref,
    group,
  ]));
  for (const bundle of bundles) {
    const eligibility = eligibilityByUnit.get(bundle.logical_unit_ref);
    const group = groupByUnit.get(bundle.logical_unit_ref);
    if (eligibility === undefined || group === undefined) {
      throw new TypeError("Artifact Bundle plan lacks CLI policy eligibility");
    }
    validateIndexerArtifactBundlePolicy({
      bundle,
      eligibility,
      actual_artifacts: bundle.artifacts.map((entry) => ({
        artifact_id: entry.artifact_id,
        artifact_kind: entry.artifact_kind,
        evidence_refs: entry.evidence_refs,
      })),
      allowed_question_refs: group.reader_question_refs,
      known_evidence_refs: [...new Set(bundle.artifacts.flatMap((entry) =>
        entry.evidence_refs
      ))],
    });
  }
  const projectionCountByEntry = new Map<string, number>();
  for (const projection of projectedPlan.projected_artifacts) {
    if (projection.bundle_binding === null) continue;
    const key = bundleEntryKey(
      projection.bundle_binding.bundle_digest,
      projection.artifact_id,
    );
    projectionCountByEntry.set(key, (projectionCountByEntry.get(key) ?? 0) + 1);
  }
  for (const bundle of bundles) {
    for (const entry of bundle.artifacts) {
      if ((projectionCountByEntry.get(bundleEntryKey(bundle.bundle_digest, entry.artifact_id)) ?? 0) === 0) {
        throw new TypeError("projected Artifact plan does not close its Artifact Bundle plans");
      }
    }
  }
  return {
    partitionPlan,
    projectedPlan,
    bundles,
    bundleSetDigest: indexerProtocolDigest({
      bundle_digests: bundles.map((bundle) => bundle.bundle_digest),
    }),
  };
}

function validOwner(input: {
  projection: IndexerProjectedArtifact;
  partitionPlan: IndexerPartitionPlan;
  groupByKey: ReadonlyMap<string, IndexerPartitionGroup>;
}): boolean {
  const owner = input.projection.owner;
  if (owner === null) return false;
  const group = input.groupByKey.get(owner.group_key);
  if (group?.logical_unit_ref !== owner.logical_unit_ref) return false;
  if (owner.kind === "partition-group") return true;
  return input.partitionPlan.strategy_ref.kind === "cli-builtin" &&
    input.partitionPlan.strategy_ref.strategy_id === "catalog-fallback" &&
    input.partitionPlan.groups.length === 1;
}

function matchedBundleEntry(input: {
  projection: IndexerProjectedArtifact;
  bundlesByDigest: ReadonlyMap<string, IndexerArtifactBundle>;
  eligibilityByUnit: ReadonlyMap<string, IndexerArtifactPolicyEligibility>;
  projectionCountByEntry: ReadonlyMap<string, number>;
}): { bundle: IndexerArtifactBundle; entry: IndexerArtifactBundleEntry } | null {
  const binding = input.projection.bundle_binding;
  if (binding === null) return null;
  const bundle = input.bundlesByDigest.get(binding.bundle_digest);
  const entry = bundle?.artifacts.find((item) => item.artifact_id === input.projection.artifact_id);
  if (
    bundle === undefined ||
    entry === undefined ||
    input.eligibilityByUnit.get(bundle.logical_unit_ref)?.eligibility_digest !==
      binding.artifact_policy_eligibility_digest ||
    binding.artifact_policy_variant !== bundle.artifact_policy_variant ||
    entry.artifact_kind !== input.projection.artifact_kind ||
    (input.projection.owner !== null &&
      bundle.logical_unit_ref !== input.projection.owner.logical_unit_ref) ||
    input.projectionCountByEntry.get(bundleEntryKey(bundle.bundle_digest, entry.artifact_id)) !== 1
  ) {
    return null;
  }
  return { bundle, entry };
}

function missingRequirements(input: {
  projection: IndexerProjectedArtifact;
  partitionPlan: IndexerPartitionPlan;
  groupByKey: ReadonlyMap<string, IndexerPartitionGroup>;
  bundlesByDigest: ReadonlyMap<string, IndexerArtifactBundle>;
  eligibilityByUnit: ReadonlyMap<string, IndexerArtifactPolicyEligibility>;
  projectionCountByEntry: ReadonlyMap<string, number>;
}): IndexerProjectedArtifactDiagnostic["missing_requirements"] {
  const missing: IndexerProjectedArtifactDiagnostic["missing_requirements"] = [];
  if (!validOwner(input)) missing.push("logical-unit-owner");
  const match = matchedBundleEntry(input);
  if (match === null) missing.push("bundle-variant");
  if (
    match === null ||
    canonicalIndexerJson(input.projection.evidence_justification_refs) !==
      canonicalIndexerJson(match.entry.evidence_refs)
  ) {
    missing.push("evidence-justification");
  }
  return missing;
}

function stateForCount(
  count: number,
): IndexerProjectedArtifactFanOutAudit["state"] {
  if (count > INDEXER_PROJECTED_ARTIFACT_REVISION_THRESHOLD) {
    return "plan-revision-required";
  }
  if (count > INDEXER_PROJECTED_ARTIFACT_WARNING_THRESHOLD) return "warning";
  return "ready";
}

export function auditIndexerProjectedArtifactFanOut(input: {
  partition_plan: unknown;
  projected_artifact_plan: unknown;
  artifact_bundles: readonly unknown[];
  artifact_policy_eligibilities: readonly {
    logical_unit_ref: string;
    report: unknown;
  }[];
}): IndexerProjectedArtifactFanOutAudit {
  const planning = validatePlanningInput(input);
  const groupByKey = new Map(planning.partitionPlan.groups.map((group) => [
    group.group_key,
    group,
  ]));
  const bundlesByDigest = new Map(planning.bundles.map((bundle) => [
    bundle.bundle_digest,
    bundle,
  ]));
  const eligibilityByUnit = new Map(input.artifact_policy_eligibilities.map((item) => {
    const report = validateIndexerArtifactPolicyEligibilityReport(item.report);
    return [item.logical_unit_ref, report] as const;
  }));
  const projectionCountByEntry = new Map<string, number>();
  for (const projection of planning.projectedPlan.projected_artifacts) {
    if (projection.bundle_binding === null) continue;
    const key = bundleEntryKey(
      projection.bundle_binding.bundle_digest,
      projection.artifact_id,
    );
    projectionCountByEntry.set(key, (projectionCountByEntry.get(key) ?? 0) + 1);
  }
  const diagnostics = planning.projectedPlan.projected_artifacts.flatMap((projection) => {
    const missing = missingRequirements({
      projection,
      partitionPlan: planning.partitionPlan,
      groupByKey,
      bundlesByDigest,
      eligibilityByUnit,
      projectionCountByEntry,
    });
    return missing.length === 0 ? [] : [{
      projection_ref: projection.projection_ref,
      projection_key: projection.projection_key,
      artifact_id: projection.artifact_id,
      missing_requirements: missing,
    }];
  });
  const unassignedRefs = diagnostics.map((item) => item.projection_ref);
  const state = stateForCount(diagnostics.length);
  const allowed = state !== "plan-revision-required";
  const auditBase = fanOutAuditPayloadSchema.parse({
    protocol: "context.indexer.projected-artifact-fan-out-audit/v1",
    partition_plan_hash: planning.partitionPlan.canonical_hash,
    projected_artifact_plan_digest: planning.projectedPlan.plan_digest,
    artifact_bundle_set_digest: planning.bundleSetDigest,
    state,
    thresholds: {
      warning_above: INDEXER_PROJECTED_ARTIFACT_WARNING_THRESHOLD,
      revision_above: INDEXER_PROJECTED_ARTIFACT_REVISION_THRESHOLD,
    },
    summary: {
      projected_artifact_count: planning.projectedPlan.projected_artifacts.length,
      legally_assigned_artifact_count:
        planning.projectedPlan.projected_artifacts.length - diagnostics.length,
      unassigned_projected_artifact_count: diagnostics.length,
    },
    unassigned_projection_refs_digest: indexerProtocolDigest({
      projection_refs: unassignedRefs,
    }),
    diagnostic_sample: diagnostics.slice(0, DIAGNOSTIC_SAMPLE_LIMIT),
    diagnostic_sample_truncated: diagnostics.length > DIAGNOSTIC_SAMPLE_LIMIT,
    candidate_materialization_allowed: allowed,
    user_gate_required: false,
    profile_revision_ledger_consumed: false,
    outcome: allowed
      ? "projected-artifact-fan-out-current"
      : "indexer-plan-revision-required",
    graph_outcome: allowed ? "completed" : "partial",
  });
  return indexerProjectedArtifactFanOutAuditSchema.parse({
    ...auditBase,
    audit_digest: indexerProtocolDigest(auditBase),
  });
}

export function validateIndexerProjectedArtifactFanOutAudit(
  value: unknown,
): IndexerProjectedArtifactFanOutAudit {
  const audit = indexerProjectedArtifactFanOutAuditSchema.parse(value);
  if (indexerProtocolDigest(auditPayload(audit)) !== audit.audit_digest) {
    throw new TypeError("projected Artifact fan-out audit digest is invalid");
  }
  const expectedState = stateForCount(audit.summary.unassigned_projected_artifact_count);
  const allowed = expectedState !== "plan-revision-required";
  if (
    audit.state !== expectedState ||
    audit.summary.legally_assigned_artifact_count +
        audit.summary.unassigned_projected_artifact_count !==
      audit.summary.projected_artifact_count ||
    audit.candidate_materialization_allowed !== allowed ||
    audit.outcome !== (allowed
      ? "projected-artifact-fan-out-current"
      : "indexer-plan-revision-required") ||
    audit.graph_outcome !== (allowed ? "completed" : "partial") ||
    audit.diagnostic_sample_truncated !==
      (audit.summary.unassigned_projected_artifact_count > DIAGNOSTIC_SAMPLE_LIMIT) ||
    audit.diagnostic_sample.length !== Math.min(
      audit.summary.unassigned_projected_artifact_count,
      DIAGNOSTIC_SAMPLE_LIMIT,
    )
  ) {
    throw new TypeError("projected Artifact fan-out audit summary is inconsistent");
  }
  const sorted = [...audit.diagnostic_sample].sort((left, right) =>
    compareIndexerCanonicalText(left.projection_ref, right.projection_ref)
  );
  if (
    new Set(audit.diagnostic_sample.map((item) => item.projection_ref)).size !==
      audit.diagnostic_sample.length ||
    canonicalIndexerJson(sorted) !== canonicalIndexerJson(audit.diagnostic_sample) ||
    audit.diagnostic_sample.some((item) => {
      const expected = MISSING_REQUIREMENT_ORDER.filter((requirement) =>
        item.missing_requirements.includes(requirement)
      );
      return canonicalIndexerJson(expected) !== canonicalIndexerJson(item.missing_requirements);
    })
  ) {
    throw new TypeError("projected Artifact fan-out diagnostics are not canonical");
  }
  if (!audit.diagnostic_sample_truncated) {
    const expectedRefsDigest = indexerProtocolDigest({
      projection_refs: audit.diagnostic_sample.map((item) => item.projection_ref),
    });
    if (expectedRefsDigest !== audit.unassigned_projection_refs_digest) {
      throw new TypeError("projected Artifact fan-out unassigned ref digest is invalid");
    }
  }
  return audit;
}

export function evaluateIndexerCandidateMaterialization(input: {
  partition_plan: unknown;
  projected_artifact_plan: unknown;
  artifact_bundles: readonly unknown[];
  artifact_policy_eligibilities: readonly {
    logical_unit_ref: string;
    report: unknown;
  }[];
}): {
  audit: IndexerProjectedArtifactFanOutAudit;
  can_materialize_candidate: boolean;
  outcome: "projected-artifact-fan-out-current" | "indexer-plan-revision-required";
  graph_outcome: "completed" | "partial";
} {
  const audit = auditIndexerProjectedArtifactFanOut(input);
  return {
    audit,
    can_materialize_candidate: audit.candidate_materialization_allowed,
    outcome: audit.outcome,
    graph_outcome: audit.graph_outcome,
  };
}
