import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { selectedIndexerExclusions } from "./indexerScopeExclusions.js";
import { indexerProtocolDigest, loadSourcesRegistry, type SourcesRegistry } from "@c4a/context";
import { projectIndexerReadTargets, type ProjectIndexerReadTarget } from "./indexerReadScopeAuthorization.js";

/** Bind only inputs the selected Indexer can read. Unrelated registrations or
 * notes saved for later are not parser invalidations. */
export function scopedIndexerSourceBoundaryDigest(sources: SourcesRegistry, targets: readonly ProjectIndexerReadTarget[], exclusions?: unknown): string {
  const selected = targets.map((target) => {
    const separator = target.source_ref.indexOf(":");
    const type = target.source_ref.slice(0, separator);
    const name = target.source_ref.slice(separator + 1);
    const entries = type === "repo" ? sources.repos : type === "file" ? sources.files :
      type === "lark" ? sources.larks : type === "note" ? sources.notes : type === "sessions" ? sources.sessions : [];
    const matching = entries.filter((entry) => entry.id === name || entry.name === name);
    if (matching.length !== 1) throw new TypeError(`Indexer input must resolve one source: ${target.source_ref}`);
    return { source_ref: target.source_ref, module_refs: [...target.module_refs].sort(), source: matching[0] };
  }).sort((a, b) => indexerProtocolDigest(a).localeCompare(indexerProtocolDigest(b)));
  return indexerProtocolDigest({ protocol: "context.indexer.source-boundary/v1", sources: selected, ...(exclusions === undefined ? {} : { exclusions }) });
}

export async function currentIndexerSourceBoundaryDigest(projectRoot: string, indexerId: string): Promise<string> {
  const [sources, loaded] = await Promise.all([loadSourcesRegistry({ rootDir: projectRoot }), loadIndexerRegistry(projectRoot)]);
  return scopedIndexerSourceBoundaryDigest(sources, projectIndexerReadTargets({ registry: loaded.registry, indexer_id: indexerId }), selectedIndexerExclusions(loaded.registry, indexerId));
}
