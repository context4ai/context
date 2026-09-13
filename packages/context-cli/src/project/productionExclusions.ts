import type { ProductionRequirements } from "./productionRequirements.js";

/** A content judgement applies only to the material that was read. Long-term
 * user exclusions have no baseline and do not trigger a source read here.
 * This projection never rewrites the user's stored decision or creates a log. */
export async function resolveProductionExclusions(
  requirements: ProductionRequirements,
  readBaseline: (source: string) => Promise<string>,
): Promise<{ requirements: ProductionRequirements; reassess: string[] }> {
  const baselines = new Map<string, Promise<string | undefined>>();
  const reassess = new Set<string>();
  const resolved = [];
  for (const requirement of requirements.requirements) {
    if (!requirement.exclusions) { resolved.push(requirement); continue; }
    const exclusions = [];
    for (const exclusion of requirement.exclusions) {
      if (!exclusion.source_baselines) { exclusions.push(exclusion); continue; }
      let current = exclusion.scope.targets.length > 0;
      for (const target of exclusion.scope.targets) {
        const expected = exclusion.source_baselines[target.source_ref];
        if (!baselines.has(target.source_ref)) baselines.set(target.source_ref,
          readBaseline(target.source_ref).catch(() => undefined));
        const actual = await baselines.get(target.source_ref);
        if (!expected || !actual || expected !== actual) current = false;
      }
      if (current) exclusions.push(exclusion);
      else for (const target of exclusion.scope.targets) reassess.add(target.source_ref);
    }
    resolved.push({ ...requirement, exclusions });
  }
  return { requirements: { requirements: resolved }, reassess: [...reassess] };
}
