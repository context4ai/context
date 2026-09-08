import { canonicalIndexerNodeRef, indexerSubjectKeySchema } from "@c4a/context";
import { currentSpec, type currentLedger } from "./indexerMainRunStoreRecords.js";
import { acceptedDeliveryPages, type IndexerDeliveryState } from "./indexerDelivery.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";

/** A pending production writer must settle before maintenance reads that page's
 * base. Conservatively wait for the same subject, rather than guessing that two
 * pages of the subject have disjoint content. No accepted result is reset. */
export async function maintenanceProductionConflict(root: string,
  targets: Array<{ path: string; view_ref: string }>,
  ledger: NonNullable<Awaited<ReturnType<typeof currentLedger>>>, delivery?: IndexerDeliveryState) {
  const structure = await readKnowledgeStructure(root);
  const nodes = new Set((Array.isArray(structure.parsed?.views) ? structure.parsed.views : [])
    .filter(view => view && typeof view === "object" && targets.some(target => target.view_ref === view.view_ref))
    .map(view => String(view.node_ref)));
  const pages = await acceptedDeliveryPages(root);
  for (const entry of ledger.entries) {
    if (entry.stage !== "author") return true;
    const ownedPages = pages.filter(page => page.workset_digest === entry.workset_digest);
    if (entry.state === "accepted" && ownedPages.length && ownedPages.every(page => delivery?.delivered[page.ref] === page.content_digest)) continue;
    const spec = await currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest });
    const subject = indexerSubjectKeySchema.safeParse((spec.validation as { expected_subject_key?: unknown }).expected_subject_key);
    if (subject.success && nodes.has(canonicalIndexerNodeRef(subject.data))) return true;
    const workset = spec.request.workset;
    if (workset.stage === "author" && workset.target_resolution_view?.entries.some(item => item.state === "resolved" && nodes.has(item.node_ref))) return true;
  }
  return false;
}
