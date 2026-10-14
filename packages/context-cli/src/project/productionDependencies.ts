import { repoContentScopeMatches } from "@c4a/context";
import type { ProductionStage } from "./productionStage.js";

/** Sources cited by the article being revised join its task when they are
 * already authorized. Unavailable history is still inherited at submission;
 * it is never promoted into a new read permission or captured baseline. */
export async function inheritedProductionSources(sources: readonly string[], references: ReadonlyArray<{ source_ref: string }>,
  authorized: readonly string[], available: (scope: string) => Promise<boolean>): Promise<string[]> {
  const result = [...sources];
  for (const ref of references) {
    const scope = authorized.find(value => repoContentScopeMatches(value, ref.source_ref));
    if (scope && !result.includes(scope) && await available(scope)) result.push(scope);
  }
  return result;
}

export function resolveProductionDependency(value: string, incoming: ReadonlyMap<string, string>, stage: ProductionStage, replaces: readonly string[]): string {
  const fresh = incoming.get(value);
  if (fresh) return fresh;
  const valid = (task: ProductionStage["tasks"][number]) => !replaces.includes(task.id) && !["replaced", "excluded"].includes(task.status);
  const byId = stage.tasks.find(task => task.id === value);
  if (byId) {
    if (valid(byId)) return byId.id;
    throw new TypeError(`Dependency ${value} is ${replaces.includes(value) ? "being replaced" : byId.status}; use the replacement article path or an active task ID.`);
  }
  const all = stage.tasks.filter(task => task.path === value);
  const active = all.filter(task => valid(task) && ["pending", "issued", "blocked"].includes(task.status));
  const candidates = active.length ? active : all.filter(task => valid(task) && task.status === "accepted");
  if (candidates.length === 1) return candidates[0]!.id;
  throw new TypeError(`Unknown dependency article path or existing task identity, or ambiguous dependency: ${value}. Candidates: ${all.map(task => `${task.id} (${task.status})`).join(", ") || "none"}. Set after to one current task ID.`);
}
