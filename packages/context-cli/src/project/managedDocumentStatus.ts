import { loadIndexerRegistry } from "@c4a/context";
import { loadContextProjectModule } from "./workspace.js";
import { readManagedDocumentSnapshot } from "./managedDocumentSnapshot.js";
import type { DocumentSourcesRegistryView } from "./documentSources.js";
import type { DocumentSourceStatus } from "./statusTypes.js";

/** Discovery alone is not authorization to produce pages. Saved-only documents
 * remain visible through source list without starting a fake Indexer task. */
export async function boundManagedDocumentStatuses(projectRoot: string, sources: DocumentSourcesRegistryView): Promise<DocumentSourceStatus[]> {
  const refs = new Set<string>();
  if (sources.notes.length > 0 || sources.sessions.length > 0) {
    const { project } = await loadContextProjectModule(projectRoot);
    for (const source of project.sources) {
      if (!("type" in source) || (source.type !== "note" && source.type !== "sessions")) continue;
      if (source.kind === "source.collection") {
        for (const entry of source.type === "note" ? sources.notes : sources.sessions) {
          refs.add(`${source.type}:${entry.name}`);
        }
      } else {
        refs.add(`${source.type}:${source.name}`);
      }
    }
  }
  try {
    const { registry } = await loadIndexerRegistry(projectRoot);
    for (const requirement of registry.requirements) {
      for (const target of [...requirement.target_scope.targets, ...requirement.evidence_source_scope.targets]) {
        refs.add(target.source_ref);
      }
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    // Explicit project sources must reach requirement setup before a registry exists.
  }
  const statuses: DocumentSourceStatus[] = [];
  for (const [type, entries] of [["note", sources.notes], ["sessions", sources.sessions]] as const) {
    for (const source of entries) {
      if (!refs.has(`${type}:${source.name}`)) continue;
      const { manifest } = await readManagedDocumentSnapshot(projectRoot, type, source.name);
      statuses.push({ type, id: source.id, name: source.name, materializedAt: source.materializedAt,
        manifest: source.materializedAt, snapshotReady: true, snapshotHash: manifest.snapshot_hash,
        normalizerVersion: manifest.normalizer_version, diagnostics: [], agent_hints: [], workspaceDiagnostics: [] });
    }
  }
  return statuses;
}
