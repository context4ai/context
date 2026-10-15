import type { ProductionStage } from "./productionStage.js";

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
