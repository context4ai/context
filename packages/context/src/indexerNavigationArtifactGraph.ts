import {
  validateIndexerNavigationArtifactPlan,
  type IndexerNavigationArtifactPlan,
} from "./indexerNavigationArtifactPlan.js";
import { compareIndexerCanonicalText } from "./indexerProtocolCommon.js";

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must be unique`);
  }
}

export function validateIndexerNavigationArtifactGraph(input: {
  plans: readonly unknown[];
  logical_artifact_refs: readonly string[];
}): IndexerNavigationArtifactPlan[] {
  const plans = input.plans.map(validateIndexerNavigationArtifactPlan)
    .sort((left, right) => compareIndexerCanonicalText(left.artifact_ref, right.artifact_ref));
  assertUnique(plans.map((plan) => plan.plan_digest), "navigation Artifact plan digests");
  assertUnique(plans.map((plan) => plan.artifact_ref), "navigation Artifact refs");
  assertUnique(plans.map((plan) => plan.navigation_ref), "navigation refs");
  const logicalRefs = new Set(input.logical_artifact_refs);
  const planByRef = new Map(plans.map((plan) => [plan.artifact_ref, plan]));
  const knownRefs = new Set([...logicalRefs, ...planByRef.keys()]);
  for (const plan of plans) {
    const unknown = plan.child_artifact_refs.find((ref) => !knownRefs.has(ref));
    if (unknown !== undefined) {
      throw new TypeError(`navigation Artifact ${plan.artifact_ref} references unknown child ${unknown}`);
    }
  }

  const visiting = new Set<string>();
  const reachesLogical = new Map<string, boolean>();
  const visit = (artifactRef: string): boolean => {
    if (logicalRefs.has(artifactRef)) return true;
    const cached = reachesLogical.get(artifactRef);
    if (cached !== undefined) return cached;
    if (visiting.has(artifactRef)) {
      throw new TypeError(`navigation Artifact graph contains a cycle at ${artifactRef}`);
    }
    const plan = planByRef.get(artifactRef);
    if (plan === undefined) return false;
    visiting.add(artifactRef);
    const reachable = plan.child_artifact_refs.some(visit);
    visiting.delete(artifactRef);
    reachesLogical.set(artifactRef, reachable);
    return reachable;
  };
  for (const plan of plans) {
    if (!visit(plan.artifact_ref)) {
      throw new TypeError(`navigation Artifact ${plan.artifact_ref} has no logical Artifact descendant`);
    }
  }
  return plans;
}
