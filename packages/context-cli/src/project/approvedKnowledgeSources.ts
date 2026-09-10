import type { IndexerApprovedKnowledge, IndexerRegistry } from "@c4a/context";
import { projectIndexerReadTargetAllows, projectIndexerReadTargets, type ProjectIndexerReadTarget } from "./indexerReadScopeAuthorization.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";
import { resolveProjectIndexerMainSourceBinding, resolveProjectIndexerMainSourceIdentity, type ProjectIndexerMainSourceBinding } from "./indexerMainSourceAdapter.js";

export interface ApprovedKnowledgeSource {
  indexer_id: string;
  binding: ProjectIndexerMainSourceBinding;
}

/** Resolve only explicitly referenced, authorized source files from the Host's
 * registered material. An earlier approved article does not need a new owned
 * Partition group merely to expose its evidence. No remote acquisition occurs. */
export async function resolveApprovedKnowledgeSources(input: {
  projectRoot: string;
  registry: IndexerRegistry;
  authorized_targets: readonly ProjectIndexerReadTarget[];
  snapshots: readonly IndexerApprovedKnowledge[];
  current: readonly ApprovedKnowledgeSource[];
}): Promise<ApprovedKnowledgeSource[]> {
  const result = [...input.current];
  const targets = new Map<string, { source_ref: string; module_ref: string | null; paths: Set<string> }>();
  for (const snapshot of input.snapshots) for (const evidence of snapshot.evidence_bindings) {
    if (!projectIndexerReadTargetAllows({ targets: input.authorized_targets, ...evidence })) continue;
    const key = JSON.stringify([evidence.source_ref, evidence.module_ref]);
    const target = targets.get(key) ?? { source_ref: evidence.source_ref, module_ref: evidence.module_ref, paths: new Set<string>() };
    target.paths.add(evidence.locator.path);
    targets.set(key, target);
  }
  for (const target of targets.values()) {
    const available = new Set(result.filter(item => item.binding.source_ref === target.source_ref && item.binding.module_ref === target.module_ref)
      .flatMap(item => item.binding.source_identity_inventory.files.map(file => file.normalized_path)));
    if ([...target.paths].every(path => available.has(path))) continue;
    // Source ownership selects a registered reader; content/profile suitability
    // was already settled by the existing Provider configuration.
    const readers = input.registry.indexers.filter(indexer => indexer.requirement_bindings.some(binding => {
      if (binding.role !== "primary") return false;
      if ("targets" in binding.owned_scope) return projectIndexerReadTargetAllows({ targets: binding.owned_scope.targets, ...target });
      const ref = /^requirement:([^#]+)#target_scope$/u.exec(binding.owned_scope.ref);
      const requirement = input.registry.requirements.find(item => item.id === ref?.[1]);
      return requirement !== undefined && projectIndexerReadTargetAllows({ targets: requirement.target_scope.targets, ...target });
    }) && projectIndexerReadTargetAllows({ targets: projectIndexerReadTargets({ registry: input.registry, indexer_id: indexer.id }), ...target }))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const reader of readers) {
      const authority = await resolveCurrentProjectIndexerPrimaryAuthority({ projectRoot: input.projectRoot, registry: input.registry, indexer_id: reader.id });
      const source = { projectRoot: input.projectRoot, indexer_id: reader.id, source_ref: target.source_ref,
        module_ref: target.module_ref, profile_contract_digest: authority.profile_contract.contract_digest };
      const identity = await resolveProjectIndexerMainSourceIdentity(source);
      const paths = [...target.paths].filter(path => identity.files.some(file => file.normalized_path === path));
      if (!paths.length) continue; // Missing files remain a dependency diagnostic.
      const binding = await resolveProjectIndexerMainSourceBinding({ ...source, parser_selection: { paths } });
      result.push({ indexer_id: reader.id, binding });
      for (const file of binding.source_identity_inventory.files) available.add(file.normalized_path);
      if ([...target.paths].every(path => available.has(path))) break;
    }
  }
  return result;
}
