import type { IndexerRegistry } from "@c4a/context";

/** Exclusions are explicit requirement decisions. Names such as legacy or
 * deprecated are never interpreted as permission to remove input. A shared
 * Provider keeps material needed by any of its applicable requirements. */
export function selectedIndexerExclusions(registry: IndexerRegistry, indexerId: string) {
  const indexer = registry.indexers.find((item) => item.id === indexerId);
  if (!indexer) throw new TypeError(`Unknown Indexer: ${indexerId}`);
  const refs = new Set(indexer.read_scope.refs.flatMap((ref) => {
    const match = /^requirement:([^#]+)#/u.exec(ref);
    return match ? [match[1]!] : [];
  }));
  return registry.requirements.filter((item) => refs.has(item.id)).map((item) => ({
    id: item.id, targets: [...item.target_scope.targets, ...item.evidence_source_scope.targets], exclusions: item.exclusions ?? [],
  }));
}

export function excludedIndexerSourcePath(input: {
  requirements: ReturnType<typeof selectedIndexerExclusions>;
  source_ref: string; module_ref: string | null; path: string;
}): boolean {
  const matches = (target: { source_ref: string; module_refs: string[] }) => target.source_ref === input.source_ref &&
    (target.module_refs.length === 0 || input.module_ref !== null && target.module_refs.includes(input.module_ref));
  const applicable = input.requirements.filter((item) => item.targets.some(matches));
  return applicable.length > 0 && applicable.every((item) => item.exclusions.some((exclusion) =>
    exclusion.scope.targets.some(matches) && (exclusion.paths === undefined || exclusion.paths.some((path) => {
      const normalized = path.replace(/\/$/u, "");
      return input.path === normalized || input.path.startsWith(`${normalized}/`);
    }))));
}
