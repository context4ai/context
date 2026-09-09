import { interruptDeliveryCadence } from "./indexerDeliveryCadence.js";
import { finishPartitionStream, readPartitionStream, resumePartitionStream } from "./indexerPartitionStream.js";
import { reuseCommandValue } from "./commandReadCache.js";
import { selectPartialDelivery, type PartialDeliveryScope } from "./partialDelivery.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readRejectedDecisions } from "./reviewDecisions.js";
import { withProjectWriteLock } from "./writeLock.js";
import { deliveryLinkDigest } from "./indexerDeliveryLinks.js";
import { existsSync } from "node:fs";
import { z } from "zod";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { indexerArtifactResultSchema, indexerLayoutArtifactRef, indexerProtocolDigest,
  materializeIndexerEffectiveArtifactSet, type IndexerArtifact, type IndexerArtifactResult } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { currentLedger, readJsonMaybe } from "./indexerMainRunStoreRecords.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import { readCurrentIndexerPostAuthorEnvelopesForResults } from "./indexerPostAuthorRunStore.js";
import { clearCompletedLifecycle } from "./lifecycleCleanup.js";

const PATH = join(".tmp", "context-runtime", "indexer", "delivery.json");
const pageSchema = z.object({
  ref: z.string().min(1), artifact_id: z.string().min(1), result_digest: z.string().min(1),
  workset_digest: z.string().min(1), content_digest: z.string().min(1),
  boundary: z.boolean(), priority: z.number().int().nonnegative(),
}).strict();
const stateSchema = z.object({ partial: z.object({ kind: z.enum(["indexer", "revision"]),
  paths: z.array(z.string().startsWith("knowledge/")).min(1), refs: z.array(z.string()).min(1) }).strict().optional(), delivered: z.record(z.string()), current: z.array(pageSchema).max(50),
  link_targets: z.record(z.array(z.string().startsWith("knowledge/").refine((path) => !path.split("/").includes("..")))).optional(),
  paths: z.array(z.string()), closed: z.boolean().optional(), early_requested: z.boolean().optional() }).strict();
export interface DeliveryPage {
  ref: string;
  artifact_id: string;
  result_digest: string;
  workset_digest: string;
  content_digest: string;
  boundary: boolean;
  priority: number;
}
export interface IndexerDeliveryState {
  partial?: PartialDeliveryScope | undefined;
  link_targets?: Record<string, string[]> | undefined;
  delivered: Record<string, string>;
  current: DeliveryPage[];
  paths: string[];
  closed?: boolean | undefined;
  early_requested?: boolean | undefined;
}

export async function readIndexerDelivery(projectRoot: string): Promise<IndexerDeliveryState | undefined> {
  const value = await readJsonMaybe(projectRoot, PATH);
  return value === undefined ? undefined : stateSchema.parse(value);
}
async function save(projectRoot: string, state: IndexerDeliveryState): Promise<void> {
  await atomicWriteFile(join(projectRoot, PATH), `${JSON.stringify(state)}\n`);
}

/** Counts complete, stable pages, independently of worksets and transport calls. */
export function selectDeliveryPages(input: {
  pages: readonly DeliveryPage[];
  delivered: Readonly<Record<string, string>>;
  allAuthorsAccepted: boolean;
  requestedEarly?: boolean;
  hasPriorDelivery?: boolean;
  waveSize?: number;
}): DeliveryPage[] {
  const unique = new Map<string, DeliveryPage>();
  for (const page of input.pages) {
    const previous = unique.get(page.ref);
    if (previous !== undefined && previous.content_digest !== page.content_digest) {
      throw new TypeError(`conflicting accepted page identity: ${page.ref}`);
    }
    unique.set(page.ref, page);
  }
  const ready = [...unique.values()].filter((page) => input.delivered[page.ref] !== page.content_digest)
    .sort((a, b) => a.priority - b.priority || a.ref.localeCompare(b.ref));
  if (ready.length === 0) return [];
  if (input.waveSize !== undefined) {
    if (input.requestedEarly || input.allAuthorsAccepted) {
      // Wave size counts themes, not derived pages. Keep the existing page cap.
      return ready.slice(0, 50);
    }
    return [];
  }
  if (!input.hasPriorDelivery && Object.keys(input.delivered).length === 0) {
    const firstBoundary = ready.slice(0, 50).findIndex((page) => page.boundary);
    return ready.slice(0, firstBoundary < 0 ? 3 : firstBoundary + 1);
  }
  if (input.requestedEarly || input.allAuthorsAccepted) return ready.slice(0, 50);
  const upper = Math.min(ready.length, 50);
  let boundary = -1;
  for (let index = 29; index < upper; index++) if (ready[index]!.boundary) boundary = index;
  if (boundary >= 29) return ready.slice(0, boundary + 1);
  return ready.length >= 50 ? ready.slice(0, 50) : [];
}

export function deliveryPageContentDigest(artifact: IndexerArtifact, result: Pick<IndexerArtifactResult, "facts" | "evidence_bindings">): string {
  const blocks = artifact.representation === "template" ? Object.values(artifact.variables)
    : artifact.sections.flatMap((section) => section.blocks);
  const factRefs = new Set(blocks.flatMap((block) => "fact_refs" in block ? block.fact_refs : []));
  const facts = result.facts.filter((fact) => factRefs.has(fact.fact_ref));
  const evidenceRefs = new Set([...blocks.flatMap((block) => "evidence_refs" in block ? block.evidence_refs : []),
    ...facts.flatMap((fact) => fact.evidence_refs)]);
  return indexerProtocolDigest({ artifact, facts,
    evidence_bindings: result.evidence_bindings.filter((binding) => evidenceRefs.has(binding.evidence_ref)) });
}

export async function acceptedDeliveryPages(projectRoot: string, includeLinks = true): Promise<DeliveryPage[]> {
  const delivery = includeLinks ? await readIndexerDelivery(projectRoot) : undefined;
  const records = await readAcceptedIndexerMainAuthorResultRecords(projectRoot);
  const envelopes = await readCurrentIndexerPostAuthorEnvelopesForResults({ projectRoot,
    allow_pending: true,
    results: records.map((record) => ({ author_workset_digest: record.accepted_record.workset_digest,
      primary_result_digest: record.accepted_record.result_digest })) });
  const pages = reuseCommandValue(`delivery-pages:${indexerProtocolDigest({ records, envelopes })}`, () => records.flatMap((record, index) => {
    const result = indexerArtifactResultSchema.parse(record.artifact_result);
    const plan = record.validation.page_plan as { priority?: number; delivery_boundary?: boolean } | undefined;
    const effective = materializeIndexerEffectiveArtifactSet({ artifact_result: result,
      post_author_envelope: envelopes[index] ?? null });
    return effective.artifacts.map((artifact, artifactIndex) => ({
      ref: indexerLayoutArtifactRef(result.logical_unit.logical_unit_ref, artifact),
      artifact_id: artifact.artifact_id, result_digest: result.output_digest,
      workset_digest: record.accepted_record.workset_digest,
      content_digest: deliveryPageContentDigest(artifact, result),
      boundary: plan?.delivery_boundary === true && artifactIndex === effective.artifacts.length - 1, priority: plan?.priority ?? index,
    }));
  }));
  // Link availability is mutable filesystem state and must always be checked.
  return pages.map(page => ({ ...page, content_digest: deliveryLinkDigest(projectRoot, page.content_digest, delivery?.link_targets?.[page.ref]) }));
}

function assertDeliveryLinksComplete(projectRoot: string, state: IndexerDeliveryState, pages: readonly DeliveryPage[]): void {
  const missing = [...new Set(pages.flatMap((page) => state.link_targets?.[page.ref] ?? []))]
    .filter((path) => !existsSync(join(projectRoot, path)));
  if (missing.length > 0) throw new TypeError(`Knowledge link targets remain unavailable after all pages were delivered: ${missing.join(", ")}. Revise the referring page through Context before completing the lifecycle.`);
}

async function finishDeliveryIfReady(projectRoot: string, state: IndexerDeliveryState): Promise<void> {
  // Catalog-only Results and deferred composition must also reach a terminal
  // state before final cleanup. This uses the same Composer Route and store.
  const { resolveCurrentIndexerComposerBatch } = await import("./indexerCurrentComposer.js");
  if (await resolveCurrentIndexerComposerBatch(projectRoot)) return;
  const pages = await acceptedDeliveryPages(projectRoot);
  if (pages.some((page) => state.delivered[page.ref] !== page.content_digest)) return;
  assertDeliveryLinksComplete(projectRoot, state, pages);
  if (!await finishPartitionStream(projectRoot) && await resumePartitionStream(projectRoot)) return;
  await clearCompletedLifecycle(projectRoot);
}

export function recordIndexerDeliveryLinks(projectRoot: string, targets: Record<string, string[]>, currentPaths: ReadonlySet<string>) {
  return withProjectWriteLock(projectRoot, "record-page-delivery-links", async () => {
    const state = await readIndexerDelivery(projectRoot);
    if (state === undefined) return;
    const base = new Map((await acceptedDeliveryPages(projectRoot, false)).map((page) => [page.ref, page.content_digest]));
    state.link_targets = { ...state.link_targets, ...targets };
    for (const page of state.current) {
      const digest = base.get(page.ref);
      if (digest !== undefined) page.content_digest = deliveryLinkDigest(projectRoot, digest, state.link_targets[page.ref], currentPaths);
    }
    await save(projectRoot, state);
  });
}

async function prepareIndexerDeliveryUnlocked(projectRoot: string, requestedEarly = false, preview = false): Promise<IndexerDeliveryState | undefined> {
  const previous = await readIndexerDelivery(projectRoot);
  if (previous?.current.length) return previous;
  const ledger = await currentLedger(projectRoot);
  if (ledger?.entries[0]?.stage !== "author" || !ledger.entries.some((entry) => entry.state === "accepted")) return undefined;
  const pages = await acceptedDeliveryPages(projectRoot);
  const stream = await readPartitionStream(projectRoot);
  const current = selectDeliveryPages({ pages,
    ...(stream?.phase === "author" ? { waveSize: Math.max(1, stream.active_bindings.length) } : {}),
    delivered: previous?.delivered ?? {}, allAuthorsAccepted: ledger.entries.every((entry) => entry.state === "accepted"), requestedEarly: requestedEarly || previous?.early_requested === true });
  if (current.length === 0) {
    if (preview) return undefined;
    if (pages.length === 0 && ledger.entries.every(entry => entry.state === "accepted") && await readPartitionStream(projectRoot)) {
      await finishDeliveryIfReady(projectRoot, previous ?? { delivered: {}, current: [], paths: [] });
      return undefined;
    }
    if (previous !== undefined && ledger.entries.every((entry) => entry.state === "accepted") &&
        pages.every((page) => previous.delivered[page.ref] === page.content_digest)) {
      await finishDeliveryIfReady(projectRoot, previous);
    }
    return undefined;
  }
  const state = { delivered: previous?.delivered ?? {}, current, paths: previous?.paths ?? [],
    ...(previous?.link_targets === undefined ? {} : { link_targets: previous.link_targets }) };
  if (!preview) await save(projectRoot, state);
  return state;
}

/** Commit delivery only after all configured package builds have succeeded.
 * A failed build retains the same active page set and accepted author results. */
async function completeIndexerDeliveryUnlocked(projectRoot: string, paths: string[]): Promise<void> {
  const state = await readIndexerDelivery(projectRoot);
  if (state?.partial && state.closed) {
    const delivered = new Set(state.partial.refs);
    if (state.partial.kind === "indexer") {
      for (const page of state.current) if (delivered.has(page.ref)) state.delivered[page.ref] = page.content_digest;
      state.current = state.current.filter(page => !delivered.has(page.ref));
    }
    delete state.partial;
    state.closed = false;
    state.paths = paths;
    await save(projectRoot, state);
    // Keep the current compile and remaining Candidate ledger for Review/repair.
    return;
  }
  if (state === undefined || state.current.length === 0 || !state.closed) return;
  for (const page of state.current) state.delivered[page.ref] = page.content_digest;
  state.current = [];
  state.closed = false;
  state.paths = paths;
  await save(projectRoot, state);
  const ledger = await currentLedger(projectRoot);
  const allAccepted = ledger?.entries.every((entry) => entry.stage === "author" && entry.state === "accepted") === true;
  const pages = await acceptedDeliveryPages(projectRoot);
  const remaining = pages.some((page) => state.delivered[page.ref] !== page.content_digest);
  if (allAccepted && !remaining) {
    await finishDeliveryIfReady(projectRoot, state);
    return;
  }
  // These are current-batch projections, never accepted author/source state.
  for (const path of ["finalization", "candidate-compile"]) await rm(join(projectRoot, ".tmp", "context-runtime", "indexer", path), { recursive: true, force: true });
}

async function closeIndexerDeliveryUnlocked(projectRoot: string): Promise<boolean> {
  const state = await readIndexerDelivery(projectRoot);
  if (state?.partial) { await save(projectRoot, { ...state, closed: true }); return true; }
  if (!state?.current.length) return false;
  const decisions = await readRejectedDecisions(projectRoot);
  const omitted = new Set((await readCandidateRecords(projectRoot)).filter((candidate) =>
    candidate.status === "rejected" && decisions.get(candidate.candidate_id) === candidate.fingerprint
  ).flatMap((candidate) => candidate.indexer_candidate?.artifact_ref ?? []));
  if (state.current.some((page) => omitted.has(page.ref))) {
    // Omitted pages do not publish links. Keep the source/result unchanged and
    // settle their original content so future link delivery cannot reopen them.
    const pages = new Map((await acceptedDeliveryPages(projectRoot, false)).map((page) => [page.ref, page]));
    for (const page of state.current) if (omitted.has(page.ref)) {
      if (state.link_targets) delete state.link_targets[page.ref];
      const original = pages.get(page.ref);
      if (original) page.content_digest = original.content_digest;
    }
  }
  await save(projectRoot, { ...state, closed: true });
  // An entirely omitted batch changes no package content. Advance its resolved
  // scope here because the Graph correctly skips an unchanged/empty build.
  if (state.current.every((page) => omitted.has(page.ref))) {
    await completeIndexerDeliveryUnlocked(projectRoot, state.paths);
  }
  return true;
}

/** Revision invalidates the current projection, not accepted peers or delivered pages. */
async function resetIndexerDeliveryProjectionUnlocked(projectRoot: string, resumeCurrent: boolean): Promise<void> {
  if (resumeCurrent) await interruptDeliveryCadence(projectRoot);
  const state = await readIndexerDelivery(projectRoot);
  if (state !== undefined) delete state.partial;
  if (state !== undefined) await save(projectRoot, { ...state, current: [], closed: false,
    // A repaired delivery must return to Review after its Author finishes,
    // even when the batch was smaller than the normal delivery threshold.
    ...(resumeCurrent && state.current.length > 0 ? { early_requested: true } : {}),
  });
}

async function requestIndexerEarlyDeliveryUnlocked(projectRoot: string): Promise<void> {
  const state = await readIndexerDelivery(projectRoot) ?? { delivered: {}, current: [], paths: [] };
  const partial = await selectPartialDelivery(projectRoot, state.current.length ? new Set(state.current.map(page => page.ref)) : undefined);
  if (partial) { await save(projectRoot, { ...state, partial, closed: false }); return; }
  if ((await readCandidateRecords(projectRoot)).some(candidate => candidate.status === "draft")) return;
  const ledger = await currentLedger(projectRoot);
  if (ledger?.entries[0]?.stage !== "author") {
    throw new TypeError("Early delivery requires a prepared Author stage; continue the current Context route first.");
  }
  // An existing delivery already fulfills this request. Do not carry a second
  // early checkpoint into the next production batch when the user retries.
  if (state.current.length > 0) return;
  await save(projectRoot, { ...state, early_requested: true });
}

export function prepareIndexerDelivery(projectRoot: string, requestedEarly = false) {
  return withProjectWriteLock(projectRoot, "prepare-page-delivery", () => prepareIndexerDeliveryUnlocked(projectRoot, requestedEarly));
}
export function previewIndexerDelivery(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "preview-page-delivery", () => prepareIndexerDeliveryUnlocked(projectRoot, false, true));
}
export function completeIndexerDelivery(projectRoot: string, paths: string[]) {
  return withProjectWriteLock(projectRoot, "complete-page-delivery", () => completeIndexerDeliveryUnlocked(projectRoot, paths));
}
export function closeIndexerDelivery(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "close-page-delivery", () => closeIndexerDeliveryUnlocked(projectRoot));
}
export function resetIndexerDeliveryProjection(projectRoot: string, resumeCurrent = false) {
  return withProjectWriteLock(projectRoot, "revise-page-delivery", () => resetIndexerDeliveryProjectionUnlocked(projectRoot, resumeCurrent));
}
export function requestIndexerEarlyDelivery(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "request-page-delivery", () => requestIndexerEarlyDeliveryUnlocked(projectRoot));
}

/** Read-only page identities for progress across planning/delivery waves. */
export { acceptedDeliveryPages as readAcceptedIndexerDeliveryPages };
