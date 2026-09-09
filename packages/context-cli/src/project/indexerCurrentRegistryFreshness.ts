import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import {
  buildIndexerPrimaryRegistryProjection,
  type IndexerMainRunLedger,
  type IndexerMainWorkset, type IndexerRegistry,
} from "@c4a/context";
import { currentSpec } from "./indexerMainRunStoreRecords.js";

export function hasCurrentIndexerRegistryProjection(registry: IndexerRegistry, workset: IndexerMainWorkset): boolean {
  const indexer = registry.indexers.find((entry) => entry.id === workset.indexer_id);
  if (!indexer || !indexer.operations.includes("main-index")) return false;
  const projection = buildIndexerPrimaryRegistryProjection({ registry, indexer_id: indexer.id,
    pre_authority_provider_ids: indexer.providers.filter((provider) => provider.role === "extension").map((provider) => provider.id) });
  return projection.projection_digest === workset.primary_registry_projection_digest;
}

/** Compare the existing workset authority with project configuration, not source
 * bodies. One persisted request per Indexer is enough for its shared registry
 * projection; no per-file parser scan or new persistent checkpoint is needed. */
export async function hasChangedIndexerWorksetAuthority(
  projectRoot: string,
  ledger: IndexerMainRunLedger | undefined,
): Promise<boolean> {
  if (ledger === undefined || ledger.entries.length === 0) return false;
  const loaded = await loadIndexerRegistry(projectRoot);
  const expected = loaded.registry.indexers.filter((item) => item.operations.includes("main-index"));
  const requests = [...new Map(ledger.entries.map((entry) => [entry.indexer_id, entry.execution_request_digest])).values()];
  if (ledger.entries.every((entry) => entry.stage === "author") &&
      expected.some((item) => !ledger.entries.some((entry) => entry.indexer_id === item.id))) {
    const { readStructurePartitionRequestDigests } = await import("./indexerStructureReview.js");
    requests.push(...await readStructurePartitionRequestDigests(projectRoot) ?? []);
  }
  const checked = new Set<string>();
  for (const digest of requests) {
    const { request } = await currentSpec({ projectRoot, request_digest: digest });
    if (checked.has(request.workset.indexer_id)) continue;
    checked.add(request.workset.indexer_id);
    if (!hasCurrentIndexerRegistryProjection(loaded.registry, request.workset)) return true;
  }
  return expected.some((item) => !checked.has(item.id));
}
