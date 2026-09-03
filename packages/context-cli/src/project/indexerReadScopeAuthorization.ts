import {
  compareIndexerCanonicalText,
  indexerRegistrySchema,
  type IndexerRegistry,
} from "@c4a/context";

export interface ProjectIndexerReadTarget {
  source_ref: string;
  module_refs: string[];
}

function scopeTargets(
  registry: IndexerRegistry,
  ref: string,
): ProjectIndexerReadTarget[] {
  const match = /^requirement:([^#]+)#(target_scope|evidence_source_scope)$/u.exec(ref);
  if (match === null) return [];
  const requirement = registry.requirements.find((item) => item.id === match[1]);
  if (requirement === undefined) return [];
  return match[2] === "target_scope"
    ? requirement.target_scope.targets
    : requirement.evidence_source_scope.targets;
}

function canonicalTargets(
  targets: readonly ProjectIndexerReadTarget[],
): ProjectIndexerReadTarget[] {
  const byIdentity = new Map<string, ProjectIndexerReadTarget>();
  for (const target of targets) {
    const moduleRefs = [...target.module_refs].sort(compareIndexerCanonicalText);
    const normalized = { source_ref: target.source_ref, module_refs: moduleRefs };
    byIdentity.set(`${target.source_ref}\0${moduleRefs.join("\0")}`, normalized);
  }
  return [...byIdentity.values()].sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.source_ref}\0${left.module_refs.join("\0")}`,
      `${right.source_ref}\0${right.module_refs.join("\0")}`,
    )
  );
}

export function projectIndexerReadTargets(input: {
  registry: unknown;
  indexer_id: string;
}): ProjectIndexerReadTarget[] {
  const registry = indexerRegistrySchema.parse(input.registry);
  const indexer = registry.indexers.find((item) => item.id === input.indexer_id);
  if (indexer === undefined) {
    throw new TypeError(`Indexer read scope is unavailable for ${input.indexer_id}`);
  }
  return canonicalTargets([
    ...indexer.read_scope.refs.flatMap((ref) => scopeTargets(registry, ref)),
    ...(indexer.read_scope.extra_targets ?? []),
  ]);
}

export function projectIndexerReadTargetAllows(input: {
  targets: readonly ProjectIndexerReadTarget[];
  source_ref: string;
  module_ref: string | null;
}): boolean {
  return input.targets.some((target) =>
    target.source_ref === input.source_ref &&
    (target.module_refs.length === 0 ||
      (input.module_ref !== null && target.module_refs.includes(input.module_ref)))
  );
}
