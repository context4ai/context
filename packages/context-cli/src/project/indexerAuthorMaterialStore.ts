import {
  initializeIndexerMainRunLedger, indexerMainWorksetSetDigest,
  buildIndexerMainWorksetSet, indexerProtocolDigest, validateIndexerMainRunLedger,
} from "@c4a/context";
import type { prepareIndexerAuthorMaterial } from "./indexerAuthorMaterial.js";
import { currentLedger, normalizeRunSpec, persistLedger, runSpecPath } from "./indexerMainRunStoreRecords.js";
import { recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";
import { prepareProjectIndexerWorksetViewMaterialization, persistPreparedIndexerWorksetView } from "./indexerWorksetViewMaterialization.js";
import { withProjectWriteLock } from "./writeLock.js";

export type PreparedAuthorMaterial = Awaited<ReturnType<typeof prepareIndexerAuthorMaterial>>;

/** Replace only pending material requests after normal peer submissions have
 * committed. The existing run ledger remains the sole continuation state. */
export async function applyIndexerAuthorMaterials(input: {
  projectRoot: string;
  materials: readonly PreparedAuthorMaterial[];
}) {
  if (input.materials.length === 0) return;
  // Verify actual delivery before making the expanded request current.
  const prepared = await Promise.all(input.materials.map((material) =>
    prepareProjectIndexerWorksetViewMaterialization({ projectRoot: input.projectRoot, run_spec: material.spec })));
  await withProjectWriteLock(input.projectRoot, "indexer-author-material", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const ledger = await currentLedger(input.projectRoot);
    if (ledger === undefined) throw new TypeError("Author material request has no current run ledger");
    const replacements = new Map(input.materials.map((material) => [material.previous_request_digest, material.spec]));
    for (const digest of replacements.keys()) {
      if (!ledger.entries.some((entry) => entry.execution_request_digest === digest && entry.state === "running")) {
        throw new TypeError("Author task changed while source material was being prepared; read the current route before retrying");
      }
    }
    for (const view of prepared) await persistPreparedIndexerWorksetView({ workspaceRoot: input.projectRoot, prepared: view });
    const changed = input.materials.filter((material) =>
      material.previous_request_digest !== material.spec.request.execution_request_digest);
    if (changed.length === 0) return;
    const specs = changed.map((material) => normalizeRunSpec(material.spec));
    const replacementLedger = initializeIndexerMainRunLedger({
      workset_set: buildIndexerMainWorksetSet(specs.map((spec) => spec.request.workset)),
      run_identities: specs.map((spec) => ({ workset_digest: spec.request.workset.workset_digest,
        execution_request_digest: spec.request.execution_request_digest })),
    });
    const nextByRequest = new Map(replacementLedger.entries.map((entry, index) =>
      [entry.execution_request_digest, { entry, item: replacementLedger.workset_set.items[index]! }]));
    const changedByRequest = new Map(changed.map((material) =>
      [material.previous_request_digest, nextByRequest.get(material.spec.request.execution_request_digest)!]));
    // Expansion changes material, not the topic, owner or peer task state.
    for (const entry of ledger.entries) {
      const next = changedByRequest.get(entry.execution_request_digest);
      if (next !== undefined && next.entry.item_ref !== entry.item_ref) {
        throw new TypeError("Author material expansion cannot change the task's topic or owner");
      }
    }
    const setPayload = { protocol: ledger.workset_set.protocol,
      items: ledger.workset_set.items.map((item, index) =>
        changedByRequest.get(ledger.entries[index]!.execution_request_digest)?.item ?? item) };
    const payload = { protocol: ledger.protocol,
      workset_set: { ...setPayload, workset_set_digest: indexerMainWorksetSetDigest(setPayload) },
      entries: ledger.entries.map((entry) => {
        const next = changedByRequest.get(entry.execution_request_digest);
        return next === undefined ? entry : { ...next.entry, state: "running" as const };
      }) };
    await persistLedger({ projectRoot: input.projectRoot, operation: "prepare",
      transaction_kind: "expand-author-material",
      ledger: validateIndexerMainRunLedger({ ...payload, ledger_digest: indexerProtocolDigest(payload) }),
      immutable_records: specs.map((spec) => ({ path: runSpecPath(spec.request.execution_request_digest), value: spec })),
    });
  });
}
