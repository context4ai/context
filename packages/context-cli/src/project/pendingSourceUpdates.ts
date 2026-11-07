import { loadSourcesRegistry, readProcessedScopes, type ProcessedScope } from "@c4a/context";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { readProductionRequirements } from "./productionRequirements.js";

export type PendingSourceScope = Pick<ProcessedScope, "requirement_ref" | "source_ref" | "module_refs">;
export interface PendingSourceIssue { reason_code: string; source_ref?: string; requirement_ref?: string; message: string }

/** Unknown baselines are not evidence that every registered source is current. */
export async function inspectPendingSourceUpdates(projectRoot: string) {
  const issues: PendingSourceIssue[] = [];
  const scopes: PendingSourceScope[] = [];
  let structure: Awaited<ReturnType<typeof readKnowledgeStructure>>;
  try { structure = await readKnowledgeStructure(projectRoot); }
  catch { return { state: "unknown" as const, scopes,
    issues: [{ reason_code: "processed-structure-invalid", message: "The knowledge structure could not be parsed; restore it before determining pending source updates." }] }; }
  if (!structure.parsed) return { state: "unknown" as const, scopes,
    issues: [{ reason_code: "processed-structure-unavailable", message: "Close or restore the knowledge structure before determining pending source updates." }] };
  let processed: ProcessedScope[];
  try { processed = readProcessedScopes(structure.parsed).filter(scope => scope.source_ref.startsWith("repo:")); }
  catch { return { state: "unknown" as const, scopes,
    issues: [{ reason_code: "processed-scopes-invalid", message: "The recorded processed scopes could not be read; restore the structure or explicitly select update scopes." }] }; }
  let sources: Awaited<ReturnType<typeof loadSourcesRegistry>>;
  let registry: Awaited<ReturnType<typeof readProductionRequirements>>;
  try { [sources, registry] = await Promise.all([loadSourcesRegistry({ rootDir: projectRoot }), readProductionRequirements(projectRoot)]); }
  catch { return { state: "unknown" as const, scopes, issues: [{ reason_code: "source-registry-unreadable",
    message: "Restore the source registry and requirements before determining pending updates." }] }; }
  const targets = registry.requirements.flatMap(requirement => [...new Set([
    ...requirement.target_scope.targets, ...requirement.evidence_source_scope?.targets ?? [],
  ].map(target => target.source_ref).filter(sourceRef => sourceRef.startsWith("repo:")))].map(sourceRef => ({
    requirement_ref: requirement.id, source_ref: sourceRef,
  })));
  for (const target of targets) {
    if (!processed.some(scope => scope.requirement_ref === target.requirement_ref && scope.source_ref === target.source_ref)) {
      issues.push({ ...target, reason_code: "processed-version-missing", message: "No processed version is recorded for this confirmed source scope; select it explicitly with context update --input." });
    }
  }
  for (const scope of processed) {
    if (!targets.some(target => target.requirement_ref === scope.requirement_ref && target.source_ref === scope.source_ref)) continue;
    const name = scope.source_ref.slice("repo:".length);
    const entries = sources.repos.filter(entry => entry.id === name || entry.name === name);
    const detail = { source_ref: scope.source_ref, requirement_ref: scope.requirement_ref };
    if (entries.length !== 1) {
      issues.push({ ...detail, reason_code: "source-registration-ambiguous", message: "The scope must identify exactly one registered repository." }); continue;
    }
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(entries[0]!.ref)) {
      issues.push({ ...detail, reason_code: "source-ref-unpinned", message: "The registered repository must use a full fixed commit before checking updates." }); continue;
    }
    if (entries[0]!.ref !== scope.processed_version) scopes.push({ ...detail,
      ...(scope.module_refs === undefined ? {} : { module_refs: scope.module_refs }) });
  }
  if (!processed.length && !targets.length && sources.repos.length) issues.push({ reason_code: "processed-version-missing",
    message: "Registered repositories have no processed scope records; explicitly select the update scope." });
  return { state: scopes.length ? "pending" as const : issues.length ? "unknown" as const : "current" as const, scopes, issues };
}
export async function pendingSourceUpdateScopes(projectRoot: string): Promise<PendingSourceScope[]> {
  return (await inspectPendingSourceUpdates(projectRoot)).scopes;
}
