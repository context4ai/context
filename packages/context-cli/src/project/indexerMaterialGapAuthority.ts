import {
  canonicalOwnerCellRef,
  compareIndexerCanonicalText,
  type IndexerRegistry,
} from "@c4a/context";

export interface IndexerOwnerDomainAuthority {
  owner_cell_ref: string;
  requirement_ref: string;
  domain_state: "required" | "optional" | "out-of-scope";
}

function bindingTargets(
  requirement: IndexerRegistry["requirements"][number],
  binding: IndexerRegistry["indexers"][number]["requirement_bindings"][number],
) {
  return "ref" in binding.owned_scope
    ? requirement.target_scope.targets
    : binding.owned_scope.targets;
}

export function indexerOwnerDomainAuthorities(
  registry: IndexerRegistry,
): IndexerOwnerDomainAuthority[] {
  const authorities = registry.requirements.flatMap((requirement) =>
    Object.entries(requirement.coverage_domains).flatMap(([coverageDomain, domainState]) =>
      requirement.target_scope.targets.flatMap((target) => {
        const moduleRefs = target.module_refs.length === 0 ? [null] : target.module_refs;
        return moduleRefs.map((moduleRef) => ({
          owner_cell_ref: canonicalOwnerCellRef({
            requirementRef: requirement.id,
            coverageDomain,
            sourceRef: target.source_ref,
            moduleRef,
          }),
          requirement_ref: `requirement:${requirement.id}`,
          domain_state: domainState,
        }));
      })
    )
  ).sort((left, right) =>
    compareIndexerCanonicalText(left.owner_cell_ref, right.owner_cell_ref)
  );
  const byOwner = new Map<string, IndexerOwnerDomainAuthority>();
  for (const authority of authorities) {
    const previous = byOwner.get(authority.owner_cell_ref);
    if (
      previous !== undefined &&
      (previous.requirement_ref !== authority.requirement_ref ||
        previous.domain_state !== authority.domain_state)
    ) {
      throw new TypeError("Indexer owner-cell authority is ambiguous");
    }
    byOwner.set(authority.owner_cell_ref, authority);
  }
  return [...byOwner.values()].sort((left, right) =>
    compareIndexerCanonicalText(left.owner_cell_ref, right.owner_cell_ref)
  );
}

export function indexerAuthoritativeOwnerCellRefs(
  registry: IndexerRegistry,
): string[] {
  return indexerOwnerDomainAuthorities(registry).map((item) => item.owner_cell_ref);
}

export function indexerOwnedScopeOwnerCellRefs(
  registry: IndexerRegistry,
): string[] {
  const requirements = new Map(
    registry.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const refs = registry.indexers.flatMap((indexer) =>
    indexer.requirement_bindings.flatMap((binding) => {
      if (binding.role !== "primary") return [];
      const requirement = requirements.get(binding.requirement_ref);
      if (requirement === undefined) return [];
      return binding.coverage_domains.flatMap((coverageDomain) =>
        bindingTargets(requirement, binding).flatMap((target) => {
          const moduleRefs = target.module_refs.length === 0 ? [null] : target.module_refs;
          return moduleRefs.map((moduleRef) => canonicalOwnerCellRef({
            requirementRef: requirement.id,
            coverageDomain,
            sourceRef: target.source_ref,
            moduleRef,
          }));
        })
      );
    })
  ).sort(compareIndexerCanonicalText);
  return [...new Set(refs)];
}
