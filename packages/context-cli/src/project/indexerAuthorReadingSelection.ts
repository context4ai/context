import type { IndexerAuthorizedWorksetView } from "@c4a/context";
import { selectIndexerAuthorFiles } from "./indexerAuthorFileSelection.js";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Reading-only projection also narrows older running tasks. Keep their request,
 * inventory, accepted results and submission authority unchanged. Additional
 * explicitly requested bodies and other Providers' material remain visible.
 */
export function selectIndexerAuthorReading(view: IndexerAuthorizedWorksetView): IndexerAuthorizedWorksetView {
  const members = new Set(view.items.filter((item) => item.category === "inventory-member")
    .map((item) => record(item.value).member_id).filter((id): id is string => typeof id === "string"));
  const files = new Map<string, { file_ref: string; normalized_path: string;
    facts: { fact_ref: string; kind: string; payload: unknown }[] }>();
  const factPaths = new Map<string, string>();
  for (const item of view.items) {
    if (item.category !== "fact") continue;
    const fact = record(item.value);
    const locator = record(fact.locator);
    if (locator.source_ref !== view.source_ref || locator.module_ref !== view.module_ref || typeof locator.normalized_path !== "string") continue;
    const path = locator.normalized_path;
    const file = files.get(path) ?? { file_ref: item.provenance.container_ref ?? "", normalized_path: path, facts: [] };
    file.facts.push({ fact_ref: item.ref, kind: String(fact.kind), payload: fact.payload });
    files.set(path, file);
    factPaths.set(item.ref, path);
  }
  const requested = new Set<string>();
  for (const item of view.items) {
    const node = record(item.value);
    if (item.category === "dependency" && node.kind === "source-span" &&
        node.source_ref === view.source_ref && node.module_ref === view.module_ref && Array.isArray(node.targets) && node.targets.length > 0) {
      const path = record(node.locator).path;
      if (typeof path === "string") requested.add(path);
    }
  }
  const selected = selectIndexerAuthorFiles({ files: [...files.values()], member_ids: members, requested_paths: requested });
  const omit = (path: unknown) => typeof path === "string" && files.has(path) && !selected.has(path);
  return { ...view, items: view.items.filter((item) => {
    if (item.category === "fact") return !omit(factPaths.get(item.ref));
    const value = record(item.value);
    if (item.category === "source-text" && value.source_ref === view.source_ref && value.module_ref === view.module_ref) return !omit(value.path);
    if (item.category === "dependency") {
      if (value.kind === "source-span" && value.source_ref === view.source_ref && value.module_ref === view.module_ref) return !omit(record(value.locator).path);
      if (value.kind === "selected-fact") return !omit(factPaths.get(String(value.fact_ref)));
    }
    return true;
  }) };
}
