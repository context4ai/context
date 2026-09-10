import { readPartitionStream } from "./indexerPartitionStream.js";
import { acceptedDeliveryPages, readIndexerDelivery, selectDeliveryPages } from "./indexerDelivery.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { authorityCommandOptions } from "./workflow/workflowProvider.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

/** A user-requested alternative, never an automatically executable Route command. */
export async function indexerDeliveryGuidance(projectRoot: string, authorities: readonly ContextWorkflowAuthority[] = []) {
  const ledger = await currentLedger(projectRoot);
  if (ledger?.entries[0]?.stage !== "author") return undefined;
  const state = await readIndexerDelivery(projectRoot);
  const pages = await acceptedDeliveryPages(projectRoot);
  const delivered = state?.delivered ?? {};
  const ready = new Set(pages.filter(page => delivered[page.ref] !== page.content_digest).map(page => page.ref)).size;
  const allAccepted = ledger.entries.every(entry => entry.state === "accepted");
  const stream = await readPartitionStream(projectRoot);
  const selected = selectDeliveryPages({ ...(stream?.phase === "author" ? { waveSize: stream.active_bindings.length } : {}), pages, delivered, allAuthorsAccepted: allAccepted, requestedEarly: state?.early_requested === true });
  const waitingFor = state?.current.length ? "current-delivery"
    : ledger.entries.some(entry => entry.state === "running") ? "current-author-batch"
    : ready === 0 ? "complete-pages"
    : selected.length ? "delivery-preparation" : stream?.phase === "author" ? "current-author-wave" : "automatic-page-threshold";
  return {
    accepted_pages_waiting: ready,
    early_requested: state?.early_requested === true,
    waiting_for: waitingFor,
    automatic_policy: stream?.phase === "author"
      ? "Theme waves: 3, 7, 10, 20, 30, 30, then 50. Confirmed totals below 10 stay together. Each wave completes composition, Review, close and build; repairs or failed delivery hold the step. User-fixed sizes override automatic sizing."
      : "First delivery: 1–3 complete pages. Later: a declared reader-task boundary at 30–50 pages, otherwise 50; deliver the remaining tail when Author finishes. delivery_boundary=false does not disable batching.",
    request: {
      command: `context${authorityCommandOptions(authorities, "workflow")} run --deliver --format json`,
      when: "Only when the user asks to build or inspect newly authored pages now. Finish the running command first; this requests a checkpoint, not approval.",
    },
    next: state?.early_requested
      ? "Finish only the current Author batch, then follow the new Route through applicable composition, Review, close and build before starting another Author batch."
      : "Accepted Author results are not yet built pages. Use the request above for earlier delivery; do not wait for all Author tasks or run build on old approved content as a substitute.",
  };
}

export type IndexerDeliveryGuidance = NonNullable<Awaited<ReturnType<typeof indexerDeliveryGuidance>>>;
