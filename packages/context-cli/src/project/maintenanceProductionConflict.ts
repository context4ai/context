import { indexerArtifactRef } from "@c4a/context";
import { currentSpec, type currentLedger } from "./indexerMainRunStoreRecords.js";
import { acceptedDeliveryPages, type IndexerDeliveryState } from "./indexerDelivery.js";

/** Wait for actual article writers, not every page sharing a modeled subject.
 * Accepted results and the active production ledger are never reset. */
export async function maintenanceProductionConflict(root: string,
  targets: Array<{ path: string; article_id: string }>,
  ledger: NonNullable<Awaited<ReturnType<typeof currentLedger>>>, delivery?: IndexerDeliveryState) {
  const ids = new Set(targets.map(target => target.article_id));
  const pages = await acceptedDeliveryPages(root);
  for (const entry of ledger.entries) {
    if (entry.stage !== "author") continue;
    const ownedPages = pages.filter(page => page.workset_digest === entry.workset_digest);
    if (entry.state === "accepted" && ownedPages.length &&
        ownedPages.every(page => delivery?.delivered[page.ref] === page.content_digest)) continue;
    if (ownedPages.some(page => ids.has(page.ref))) return true;
    const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    const workset = spec.request.workset;
    if (workset.stage !== "author") continue;
    const plan = spec.validation.page_plan as { articles?: Array<{ key: string }> } | undefined;
    const articles = plan?.articles ?? [{ key: "main" }];
    if (articles.some(article => ids.has(indexerArtifactRef(workset.logical_unit_ref, { artifact_id: article.key })))) return true;
  }
  return false;
}
