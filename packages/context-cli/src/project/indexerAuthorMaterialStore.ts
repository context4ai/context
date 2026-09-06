import { buildIndexerMainWorksetSet } from "@c4a/context";
import type { prepareIndexerAuthorMaterial } from "./indexerAuthorMaterial.js";
import { currentLedger, currentSpec } from "./indexerMainRunStoreRecords.js";
import { prepareIndexerMainRunStore, startIndexerMainRunsStore } from "./indexerMainRunStore.js";
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
    const ledger = await currentLedger(input.projectRoot);
    if (ledger === undefined) throw new TypeError("Author material request has no current run ledger");
    const replacements = new Map(input.materials.map((material) => [material.previous_request_digest, material.spec]));
    for (const digest of replacements.keys()) {
      if (!ledger.entries.some((entry) => entry.execution_request_digest === digest && entry.state === "running")) {
        throw new TypeError("Author task changed while source material was being prepared; read the current route before retrying");
      }
    }
    const specs = await Promise.all(ledger.entries.map((entry) => replacements.get(entry.execution_request_digest) ??
      currentSpec({ projectRoot: input.projectRoot, request_digest: entry.execution_request_digest })));
    for (const view of prepared) await persistPreparedIndexerWorksetView({ workspaceRoot: input.projectRoot, prepared: view });
    await prepareIndexerMainRunStore({ projectRoot: input.projectRoot,
      workset_set: buildIndexerMainWorksetSet(specs.map((spec) => spec.request.workset)), run_specs: specs });
    await startIndexerMainRunsStore({ projectRoot: input.projectRoot,
      workset_digests: input.materials.map((material) => material.spec.request.workset.workset_digest) });
  });
}
