import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateArticleStructureEntries } from "@c4a/context";
import { prepareApprovedRevision, readApprovedRevision, requestDigest, type ApprovedRevision } from "./approvedRevision.js";
import { candidateRecordsContent, readCandidateRecords, CANDIDATE_LEDGER_FILE, type CandidateRecord } from "./candidateLedger.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { revisionStoragePath } from "./maintenanceStorage.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";

export interface JoinTarget { path: string; instruction: string; regenerate?: boolean }
export type JoinableBatch = { joinable: true; request: ApprovedRevision } | { joinable: false; reason: string };

function batchCandidates(request: ApprovedRevision): CandidateRecord[] {
  return [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])];
}

/** A maintenance request may join the active revision batch, including one
 * prepared from a source update, until Review approves any of its pages. */
export async function joinableRevisionBatch(root: string): Promise<JoinableBatch> {
  const request = await readApprovedRevision(root);
  if (!request) return { joinable: false, reason: "no-active-batch" };
  const rows = new Set((await readCandidateRecords(root)).map(row => row.candidate_id));
  // Approval applies a page and removes its Candidate; the batch is then closed.
  // Checked first: a mechanical fix after approval is not a concurrent edit.
  if (request.build_pending || batchCandidates(request).some(candidate => !rows.has(candidate.candidate_id))) {
    return { joinable: false, reason: "batch-approved" };
  }
  if (request.refresh_sources) return { joinable: false, reason: "source-adjustment-pending" };
  const { approvedRevisionRecovery } = await import("./approvedRevisionRecovery.js");
  if (await approvedRevisionRecovery(root, request)) return { joinable: false, reason: "merge-recovery-pending" };
  return { joinable: true, request };
}

const added = (base: string, instruction: string) => `${base}\n\nAdditional request: ${instruction.trim()}`;

/** Start a reopened page from its latest draft and citations, not from the
 * approved page; only its Candidate identity and approval eligibility end. */
function draftTarget(candidate: CandidateRecord): NonNullable<ApprovedRevision["pending_targets"]>[number]["target"] {
  return { path: candidate.path, article_id: candidate.article_id, collection: candidate.collection,
    markdown: candidate.body, source_refs: candidate.source_refs, visibility: candidate.visibility,
    sections: candidate.indexer_candidate.sections.map(section => ({ id: section.section_key, references: section.references })),
    base_digest: candidate.approved_revision!.base_digest,
    ...(candidate.approved_revision!.previous_path ? { previous_path: candidate.approved_revision!.previous_path } : {}) };
}

/** Caller holds the workspace lock and has checked joinability. Pages already
 * drafted in this batch return to the queue from their latest draft; other
 * pages and their drafts are unchanged. */
export async function joinRevisionBatch(root: string, request: ApprovedRevision, targets: readonly JoinTarget[],
  options: { retire?: NonNullable<ApprovedRevision["retirements"]>[number] } = {}) {
  const articles = validateArticleStructureEntries((await readKnowledgeStructure(root)).parsed?.articles ?? []);
  const batch = batchCandidates(request);
  let instruction = request.instruction;
  // A page retired in this batch drops its own unfinished draft or queued work.
  const retired = new Set(options.retire?.targets.map(target => target.path) ?? []);
  let pending = (request.pending_targets ?? []).filter(item => !retired.has(item.path));
  const dropped = new Set(batch.filter(candidate => retired.has(candidate.path)).map(candidate => candidate.candidate_id));
  const inProgress = !request.candidate && !request.review_ready && !retired.has(request.target.path);
  const joined: Array<{ path: string; placement: "current-page" | "queued-page" | "reopened-draft" | "added-page" }> = [];
  for (const target of targets) {
    const path = target.path.replace(/^\.\//u, "").replace(/^knowledge\//u, "");
    if (retired.has(path) || request.retirements?.some(value => value.targets.some(item => item.path === path))) {
      throw new TypeError(`This page is retired in the current batch: ${target.path}`);
    }
    const drafted = batch.find(candidate => candidate.path === path && !dropped.has(candidate.candidate_id));
    const queued = pending.findIndex(item => item.path === path);
    if (inProgress && request.target.path === path && !drafted) {
      instruction = added(instruction, target.instruction);
      joined.push({ path, placement: "current-page" });
    } else if (queued >= 0) {
      pending[queued] = { ...pending[queued]!, instruction: added(pending[queued]!.instruction, target.instruction),
        ...(target.regenerate ? { regenerate: true } : {}) };
      joined.push({ path, placement: "queued-page" });
    } else if (drafted) {
      dropped.add(drafted.candidate_id);
      pending.push({ path, instruction: added(drafted.review.reason, target.instruction), target: draftTarget(drafted),
        ...(target.regenerate ? { regenerate: true } : {}) });
      joined.push({ path, placement: "reopened-draft" });
    } else {
      if (!articles.some(article => article.path === path)) throw new TypeError(`Only approved pages can join the current batch: ${target.path}`);
      pending.push({ path, instruction: target.instruction.trim(), ...(target.regenerate ? { regenerate: true } : {}) });
      joined.push({ path, placement: "added-page" });
    }
  }
  const kept = batch.filter(candidate => !dropped.has(candidate.candidate_id));
  const { candidate: _candidate, review_ready: _ready, batch_candidates: _batch, ...rest } = request;
  void _candidate; void _ready; void _batch;
  const retirements = options.retire ? [...request.retirements ?? [], options.retire] : request.retirements;
  let next: ApprovedRevision;
  if (inProgress) {
    const payload = { ...rest, instruction, pending_targets: pending, batch_candidates: kept, ...(retirements ? { retirements } : {}) };
    next = { ...payload, revision: requestDigest(payload) };
  } else if (pending.length === 0) {
    // Nothing left to write: the remaining drafts wait for Review, as after an
    // unchanged final page.
    if (kept.length === 0) throw new TypeError("The batch would contain no page besides the retired ones. Finish or cancel this batch, then retire the page on its own.");
    const payload = { ...rest, pending_targets: [], batch_candidates: kept, review_ready: true, ...(retirements ? { retirements } : {}) };
    next = { ...payload, revision: requestDigest(payload) };
  } else {
    // Every page was drafted: start the first queued page now, as a batch
    // continuation does, keeping the remaining drafts in the batch.
    const [first, ...remaining] = pending;
    pending = remaining;
    const prepared = await prepareApprovedRevision({ projectRoot: root, replace_current: true, persist: false,
      selector: first!.path, instruction: first!.instruction, pending_targets: remaining, batch_candidates: kept,
      ...(first!.regenerate ? { regenerate: true } : {}),
      ...(first!.target ? { target: first!.target } : {}),
      ...(first!.create ? { create: first!.create } : {}), ...(first!.supporting_sources ? { supporting_sources: first!.supporting_sources } : {}),
      ...(retirements ? { retirements } : {}),
      ...(request.requirements ? { requirements: request.requirements } : {}),
      ...(request.processed_scopes ? { processed_scopes: request.processed_scopes } : {}) });
    next = prepared.request;
  }
  const storage = await revisionStoragePath(root);
  const current = await readFile(join(root, storage), "utf8");
  const content = `${JSON.stringify(next)}\n`;
  const ledger = await readFile(join(root, CANDIDATE_LEDGER_FILE), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined; throw error;
  });
  const rows = (await readCandidateRecords(root)).filter(row => !dropped.has(row.candidate_id));
  const ledgerContent = candidateRecordsContent(rows);
  await runDurableMultiFileTransaction({ projectRoot: root, kind: "join-revision-batch", proposal_digest: next.revision, targets: [
    { path: storage, operation: "write" as const, base_digest: durableContentDigest(current), target_digest: durableContentDigest(content), content },
    ...(ledger === undefined || dropped.size === 0 ? [] : [ledgerContent === undefined
      ? { path: CANDIDATE_LEDGER_FILE, operation: "delete" as const, base_digest: durableContentDigest(ledger), target_digest: null }
      : { path: CANDIDATE_LEDGER_FILE, operation: "write" as const, base_digest: durableContentDigest(ledger), target_digest: durableContentDigest(ledgerContent), content: ledgerContent }]),
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
  return { joined, revision: next.revision, current_page: next.target.path };
}
