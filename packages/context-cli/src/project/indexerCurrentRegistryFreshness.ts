import {
  buildIndexerPrimaryRegistryProjection,
  loadIndexerRegistry,
  type IndexerMainRunLedger,
} from "@c4a/context";
import { currentSpec } from "./indexerMainRunStoreRecords.js";

/** Compare the existing workset authority with project configuration, not source
 * bodies. One persisted request per Indexer is enough for its shared registry
 * projection; no per-file parser scan or new persistent checkpoint is needed. */
export async function hasChangedIndexerWorksetAuthority(
  projectRoot: string,
  ledger: IndexerMainRunLedger | undefined,
): Promise<boolean> {
  if (ledger === undefined || ledger.entries.length === 0) return false;
  const loaded = await loadIndexerRegistry(projectRoot);
  const checked = new Set<string>();
  for (const entry of ledger.entries) {
    if (checked.has(entry.indexer_id)) continue;
    checked.add(entry.indexer_id);
    const indexer = loaded.registry.indexers.find((item) => item.id === entry.indexer_id);
    if (indexer === undefined || !indexer.operations.includes("main-index")) return true;
    const projection = buildIndexerPrimaryRegistryProjection({
      registry: loaded.registry,
      indexer_id: indexer.id,
      pre_authority_provider_ids: indexer.providers
        .filter((provider) => provider.role === "extension")
        .map((provider) => provider.id),
    });
    const { request } = await currentSpec({
      projectRoot, request_digest: entry.execution_request_digest,
    });
    if (
      request.workset.requirement_set_digest !== loaded.requirementSetDigest ||
      request.workset.primary_registry_projection_digest !== projection.projection_digest
    ) return true;
  }
  return false;
}
