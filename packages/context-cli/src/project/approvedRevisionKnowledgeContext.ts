import { approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { loadCurrentIndexerRegistry } from "./currentIndexerRegistry.js";
import { partitionApprovedArticleCatalog } from "./indexerPartitionNavigation.js";
import { projectIndexerReadTargetAllows, projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";

/** Read-only identity catalog for an existing revision. The Agent can choose
 * replacement upstream articles without probing internal storage paths. */
export async function approvedRevisionKnowledgeContext(root: string, path: string) {
  const snapshots = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed);
  const target = snapshots.find(snapshot => snapshot.path === path);
  if (!target?.primary_indexer_id) return undefined;
  const { registry } = await loadCurrentIndexerRegistry(root);
  if (!registry.indexers.some(indexer => indexer.id === target.primary_indexer_id)) return undefined;
  const targets = projectIndexerReadTargets({ registry, indexer_id: target.primary_indexer_id });
  const evidence = target.evidence_bindings.filter(binding => projectIndexerReadTargetAllows({ targets,
    source_ref: binding.source_ref, module_ref: binding.module_ref }));
  const allowed = new Set(evidence.map(binding => binding.evidence_ref));
  const facts = target.facts.filter(fact => fact.fact_kind !== "approved-knowledge-fact" && fact.evidence_refs.every(ref => allowed.has(ref)));
  return { approved_articles: partitionApprovedArticleCatalog(snapshots.filter(snapshot => snapshot.artifact_ref !== target.artifact_ref), targets),
    current_dependencies: target.dependencies,
    current_sections: target.sections.map(section => ({ section_key: section.section_key, section_ref: section.section_ref,
      fact_refs: section.fact_refs, evidence_refs: section.evidence_refs })),
    prior_direct_support: { facts, evidence_bindings: evidence,
      guidance: "Previously approved source facts retain their recorded versions. Recheck changed sources before using them as current proof." },
    adjustment: "Use context task adjust with instruction and knowledge_dependencies { dependencies, sections? }. Read replacement knowledge_input before selecting each retained section's fact_refs and evidence_refs. Review applies the change." };
}
