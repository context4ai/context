import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const projectionKeySchema = z.string().min(1).max(512).refine(
  (value) => !value.includes("\0"),
  "projection key cannot contain NUL",
);

const projectedArtifactOwnerSchema = z.object({
  kind: z.enum(["partition-group", "catalog-fallback"]),
  group_key: z.string().min(1),
  logical_unit_ref: indexerCanonicalRefSchema,
}).strict();

const projectedArtifactBundleBindingSchema = z.object({
  bundle_digest: indexerDigestSchema,
  artifact_policy_eligibility_digest: indexerDigestSchema,
  artifact_policy_variant: indexerIdSchema,
}).strict();

const projectedArtifactSchema = z.object({
  projection_ref: indexerCanonicalRefSchema,
  projection_key: projectionKeySchema,
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  owner: projectedArtifactOwnerSchema.nullable(),
  bundle_binding: projectedArtifactBundleBindingSchema.nullable(),
  evidence_justification_refs: z.array(indexerCanonicalRefSchema),
}).strict();

const projectedArtifactPlanPayloadSchema = z.object({
  protocol: z.literal("context.indexer.projected-artifact-plan/v1"),
  partition_workset_digest: indexerDigestSchema,
  partition_plan_hash: indexerDigestSchema,
  projected_artifacts: z.array(projectedArtifactSchema),
}).strict();

export const indexerProjectedArtifactPlanSchema = projectedArtifactPlanPayloadSchema.extend({
  plan_digest: indexerDigestSchema,
}).strict();

export type IndexerProjectedArtifactOwner = z.infer<typeof projectedArtifactOwnerSchema>;
export type IndexerProjectedArtifact = z.infer<typeof projectedArtifactSchema>;
export type IndexerProjectedArtifactPlan = z.infer<
  typeof indexerProjectedArtifactPlanSchema
>;

export interface IndexerProjectedArtifactInput {
  projection_key: string;
  artifact_id: string;
  artifact_kind: string;
  owner?: IndexerProjectedArtifactOwner | null;
  bundle_binding?: {
    bundle_digest: string;
    artifact_policy_eligibility_digest: string;
    artifact_policy_variant: string;
  } | null;
  evidence_justification_refs?: readonly string[];
}

function uniqueSorted(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must contain unique values`);
  }
  return sorted;
}

function projectionRef(input: {
  partition_plan_hash: string;
  projection_key: string;
}): string {
  const digest = indexerProtocolDigest({
    partition_plan_hash: input.partition_plan_hash,
    projection_key: input.projection_key,
  });
  return `artifact-projection:${digest}`;
}

function payload(
  plan: IndexerProjectedArtifactPlan,
): Omit<IndexerProjectedArtifactPlan, "plan_digest"> {
  const { plan_digest: _digest, ...result } = plan;
  void _digest;
  return result;
}

export function buildIndexerProjectedArtifactPlan(input: {
  partition_workset_digest: string;
  partition_plan_hash: string;
  projected_artifacts: readonly IndexerProjectedArtifactInput[];
}): IndexerProjectedArtifactPlan {
  const projectionKeys = input.projected_artifacts.map((item) => item.projection_key);
  if (new Set(projectionKeys).size !== projectionKeys.length) {
    throw new TypeError("projected Artifact projection keys must be unique");
  }
  const projectedArtifacts = input.projected_artifacts.map((item) => {
    const projectionKey = projectionKeySchema.parse(item.projection_key);
    return projectedArtifactSchema.parse({
      projection_ref: projectionRef({
        partition_plan_hash: input.partition_plan_hash,
        projection_key: projectionKey,
      }),
      projection_key: projectionKey,
      artifact_id: item.artifact_id,
      artifact_kind: item.artifact_kind,
      owner: item.owner ?? null,
      bundle_binding: item.bundle_binding ?? null,
      evidence_justification_refs: uniqueSorted(
        item.evidence_justification_refs ?? [],
        `${projectionKey} evidence justification refs`,
      ),
    });
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.projection_ref, right.projection_ref)
  );
  const planPayload = projectedArtifactPlanPayloadSchema.parse({
    protocol: "context.indexer.projected-artifact-plan/v1",
    partition_workset_digest: input.partition_workset_digest,
    partition_plan_hash: input.partition_plan_hash,
    projected_artifacts: projectedArtifacts,
  });
  return indexerProjectedArtifactPlanSchema.parse({
    ...planPayload,
    plan_digest: indexerProtocolDigest(planPayload),
  });
}

export function validateIndexerProjectedArtifactPlan(
  value: unknown,
): IndexerProjectedArtifactPlan {
  const plan = indexerProjectedArtifactPlanSchema.parse(value);
  if (indexerProtocolDigest(payload(plan)) !== plan.plan_digest) {
    throw new TypeError("projected Artifact plan digest is invalid");
  }
  const rebuilt = buildIndexerProjectedArtifactPlan({
    partition_workset_digest: plan.partition_workset_digest,
    partition_plan_hash: plan.partition_plan_hash,
    projected_artifacts: plan.projected_artifacts,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(plan)) {
    throw new TypeError("projected Artifact plan is not canonical");
  }
  return plan;
}
