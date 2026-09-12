import { access } from "node:fs/promises";
import { join } from "node:path";
import { readProcessedScopes, validateArticleStructureEntries, validateFinalizedIndexerRegistry, type IndexerRegistry } from "@c4a/context";
import { loadCurrentIndexerRegistry } from "./currentIndexerRegistry.js";
import { readDocumentSourcesRegistry } from "./documentSources.js";
import { boundManagedDocumentStatuses } from "./managedDocumentStatus.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { beginKnowledgeUpdate } from "./knowledgeUpdate.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { readCandidateRecords } from "./candidateLedger.js";

export async function unassignedManagedSources(projectRoot: string, registry: IndexerRegistry): Promise<string[]> {
  const selected = await boundManagedDocumentStatuses(projectRoot, await readDocumentSourcesRegistry(projectRoot));
  const covered = new Set(registry.requirements.flatMap(requirement =>
    [...requirement.target_scope.targets, ...requirement.evidence_source_scope.targets].map(target => target.source_ref)));
  return selected.filter(source => !covered.has(`${source.type}:${source.name}`) &&
    !covered.has(`docs:${source.name}`) && !covered.has(`${source.type}:${source.id}`) && !covered.has(`docs:${source.id}`))
    .map(source => `${source.type}:${source.name}`).sort();
}

/** Newly selected saved text in an established workspace uses the existing
 * scoped update workflow. Do not recreate the completed production ledger.
 * Active work and already incorporated material retain their normal lifecycle.
 */
export async function planManagedSourceKnowledgeUpdate(projectRoot: string) {
  const scopes: Array<{ requirement_ref: string; source_ref: string; module_refs?: string[] }> = [];
  const { readKnowledgeUpdate } = await import("./knowledgeUpdate.js");
  const { readApprovedRevision } = await import("./approvedRevision.js");
  const { readTaskRollback } = await import("./taskRollback.js");
  if (await readKnowledgeUpdate(projectRoot) || await readApprovedRevision(projectRoot) || await readTaskRollback(projectRoot)) return scopes;
  if (await currentLedger(projectRoot) || (await readCandidateRecords(projectRoot)).length) return scopes;
  const structure = await readKnowledgeStructure(projectRoot);
  const articles = validateArticleStructureEntries(structure.parsed?.articles ?? []);
  if (!articles.length) return scopes;
  // A configuration/structure fixture or an incomplete first production is not
  // an established set of approved pages.
  if (!await Promise.all(articles.map(article =>
    access(join(projectRoot, "knowledge", article.path)).then(() => true, () => false)
  )).then(results => results.every(Boolean))) return scopes;
  const { registry } = await loadCurrentIndexerRegistry(projectRoot);
  try { validateFinalizedIndexerRegistry(registry); } catch { return scopes; }
  const selected = await boundManagedDocumentStatuses(projectRoot, await readDocumentSourcesRegistry(projectRoot));
  const available = new Set(selected.map(source => `${source.type}:${source.name}`));
  const referenced = articles.flatMap(article => article.sections.flatMap(section =>
    section.references.map(reference => reference.source_ref)));
  const processed = readProcessedScopes(structure.parsed);
  for (const requirement of registry.requirements) {
    const targets = requirement.target_scope.targets;
    const additions = [...targets, ...requirement.evidence_source_scope.targets].filter(target =>
      available.has(target.source_ref) &&
      !referenced.some(ref => ref === target.source_ref || ref.startsWith(`${target.source_ref}/`) || ref.startsWith(`${target.source_ref}#`)) &&
      !processed.some(scope => scope.requirement_ref === requirement.id && scope.source_ref === target.source_ref));
    if (!additions.length) continue;
    // Supporting text needs the existing target pages in the impact view.
    const supporting = additions.some(addition => !targets.some(target => target.source_ref === addition.source_ref));
    const requested = supporting ? [...targets, ...additions] : additions;
    for (const target of requested) {
      const scope = { requirement_ref: requirement.id, source_ref: target.source_ref,
        ...(target.module_refs.length ? { module_refs: target.module_refs } : {}) };
      if (!scopes.some(existing => JSON.stringify(existing) === JSON.stringify(scope))) scopes.push(scope);
    }
  }
  return scopes;
}

export async function prepareManagedSourceKnowledgeUpdate(projectRoot: string): Promise<boolean> {
  const scopes = await planManagedSourceKnowledgeUpdate(projectRoot);
  if (!scopes.length) return false;
  await beginKnowledgeUpdate(projectRoot, { scopes });
  return true;
}
