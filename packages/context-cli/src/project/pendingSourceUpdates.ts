import { loadSourcesRegistry, readProcessedScopes, type ProcessedScope } from "@c4a/context";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { readProductionRequirements } from "./productionRequirements.js";

export type PendingSourceScope = Pick<ProcessedScope, "requirement_ref" | "source_ref" | "module_refs">;

/** Registered repositories whose fixed commit moved past a recorded processed
 * version. Moving the registration does not process knowledge; `context update`
 * does, and settles the new version only after its pages are decided. */
export async function pendingSourceUpdateScopes(projectRoot: string): Promise<PendingSourceScope[]> {
  const structure = await readKnowledgeStructure(projectRoot);
  if (!structure.parsed) return [];
  const processed = readProcessedScopes(structure.parsed).filter(scope => scope.source_ref.startsWith("repo:"));
  if (processed.length === 0) return [];
  const [sources, registry] = await Promise.all([loadSourcesRegistry({ rootDir: projectRoot }), readProductionRequirements(projectRoot)]);
  return processed.filter(scope => {
    const name = scope.source_ref.slice("repo:".length);
    const entries = sources.repos.filter(entry => entry.id === name || entry.name === name);
    if (entries.length !== 1 || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(entries[0]!.ref) || entries[0]!.ref === scope.processed_version) return false;
    const requirement = registry.requirements.find(item => item.id === scope.requirement_ref);
    return !!requirement && [...requirement.target_scope.targets, ...requirement.evidence_source_scope?.targets ?? []]
      .some(target => target.source_ref === scope.source_ref);
  }).map(scope => ({ requirement_ref: scope.requirement_ref, source_ref: scope.source_ref,
    ...(scope.module_refs === undefined ? {} : { module_refs: scope.module_refs }) }));
}
