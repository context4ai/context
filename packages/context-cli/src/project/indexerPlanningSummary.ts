import { join } from "node:path";
import { indexerProtocolDigest, type IndexerMainRunLedger } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { currentSpec, readJsonMaybe } from "./indexerMainRunStoreRecords.js";

type Location = { indexer_id: string; source_ref: string; module_ref: string | null };

/** Cache immutable request locations, never accepted counts or completion state. */
export async function indexerPlanningSummary(root: string, ledger: IndexerMainRunLedger) {
  const digest = indexerProtocolDigest(ledger.entries.map(entry => entry.execution_request_digest).sort());
  const path = `.tmp/context-runtime/indexer/planning-summaries/${digest.slice(7)}.json`;
  const cached = await readJsonMaybe(root, path) as { locations?: Record<string, Location> } | undefined;
  let locations = cached?.locations;
  if (!locations || !ledger.entries.every(entry => locations![entry.execution_request_digest])) {
    locations = {};
    for (let offset = 0; offset < ledger.entries.length; offset += 8) {
      await Promise.all(ledger.entries.slice(offset, offset + 8).map(async entry => {
        const { request } = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
        locations![entry.execution_request_digest] = { indexer_id: entry.indexer_id,
          source_ref: request.workset.source_ref, module_ref: request.workset.module_ref ?? null };
      }));
    }
    await atomicWriteFile(join(root, path), JSON.stringify({ locations }));
  }
  const groups = new Map<string, Location & { total: number; accepted: number; remaining: number }>();
  for (const entry of ledger.entries) {
    const location = locations[entry.execution_request_digest]!;
    const key = JSON.stringify([location.indexer_id, location.source_ref, location.module_ref]);
    const group = groups.get(key) ?? { ...location, total: 0, accepted: 0, remaining: 0 };
    group.total++;
    if (entry.state === "accepted") group.accepted++; else group.remaining++;
    groups.set(key, group);
  }
  const byIndexer = new Map<string, { indexer_id: string; total: number; accepted: number; remaining: number }>();
  for (const group of groups.values()) {
    const total = byIndexer.get(group.indexer_id) ?? { indexer_id: group.indexer_id, total: 0, accepted: 0, remaining: 0 };
    total.total += group.total; total.accepted += group.accepted; total.remaining += group.remaining;
    byIndexer.set(group.indexer_id, total);
  }
  return { by_indexer: [...byIndexer.values()].sort((a, b) => a.indexer_id.localeCompare(b.indexer_id)), unit: "planning-task" as const,
    definition: "Counts by Indexer, registered source and declared module. Null module means no module binding; counts are not page estimates or inferred frontend/backend classifications.",
    groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group) };
}
