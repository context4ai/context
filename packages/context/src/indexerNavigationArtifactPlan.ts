import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const navigationArtifactPlanPayloadSchema = z.object({
  protocol: z.literal("context.indexer.navigation-artifact-plan/v1"),
  navigation_ref: indexerCanonicalRefSchema,
  artifact_ref: indexerCanonicalRefSchema,
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  output_path: portableIndexerPathSchema,
  child_artifact_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerNavigationArtifactPlanSchema = navigationArtifactPlanPayloadSchema.extend({
  plan_digest: indexerDigestSchema,
}).strict();

export type IndexerNavigationArtifactPlan = z.infer<typeof indexerNavigationArtifactPlanSchema>;

function uniqueSorted(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must be unique`);
  }
  return sorted;
}

function navigationArtifactRef(input: {
  navigation_ref: string;
  artifact_id: string;
  artifact_kind: string;
}): string {
  return `artifact:navigation:${indexerProtocolDigest({
    protocol: "context.indexer.navigation-artifact-identity/v1",
    navigation_ref: input.navigation_ref,
    artifact_id: input.artifact_id,
    artifact_kind: input.artifact_kind,
  })}`;
}

function withoutPlanDigest(
  value: IndexerNavigationArtifactPlan,
): Omit<IndexerNavigationArtifactPlan, "plan_digest"> {
  const { plan_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function buildIndexerNavigationArtifactPlan(input: {
  navigation_ref: string;
  artifact_id: string;
  artifact_kind?: string;
  output_path: string;
  child_artifact_refs: readonly string[];
}): IndexerNavigationArtifactPlan {
  const artifactKind = input.artifact_kind ?? "navigation";
  const payload = navigationArtifactPlanPayloadSchema.parse({
    protocol: "context.indexer.navigation-artifact-plan/v1",
    navigation_ref: input.navigation_ref,
    artifact_ref: navigationArtifactRef({
      navigation_ref: input.navigation_ref,
      artifact_id: input.artifact_id,
      artifact_kind: artifactKind,
    }),
    artifact_id: input.artifact_id,
    artifact_kind: artifactKind,
    output_path: input.output_path,
    child_artifact_refs: uniqueSorted(input.child_artifact_refs, "navigation child Artifact refs"),
  });
  return indexerNavigationArtifactPlanSchema.parse({
    ...payload,
    plan_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerNavigationArtifactPlan(
  value: unknown,
): IndexerNavigationArtifactPlan {
  const plan = indexerNavigationArtifactPlanSchema.parse(value);
  const expected = buildIndexerNavigationArtifactPlan(plan);
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(plan)) {
    throw new TypeError("navigation Artifact plan is stale or forged");
  }
  if (indexerProtocolDigest(withoutPlanDigest(plan)) !== plan.plan_digest) {
    throw new TypeError("navigation Artifact plan digest is invalid");
  }
  return plan;
}
