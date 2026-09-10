import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalIndexerJson } from "@c4a/context";
import { prepareApprovedRevision, type ApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { selectDeliveryPages } from "./indexerDelivery.js";
import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import { compactApprovedKnowledgeMarkdown, ensureApprovedKnowledgePresentation } from "./approvedKnowledgeMetadata.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { canonicalizeApprovedKnowledgeAssetPair } from "./knowledgeAssetRepair.js";

/** Author pages individually, but use the existing delivery selector to decide
 * when the complete pages enter one Review/close/build batch. */
export async function prepareRevisionBatchContinuation(root: string, request: ApprovedRevision, batch: CandidateRecord[]) {
  const [next, ...remaining] = request.pending_targets ?? [];
  if (!next) return undefined;
  const pages = batch.map((candidate, index) => ({ ref: candidate.view_ref, artifact_id: candidate.view_ref,
    result_digest: candidate.fingerprint, workset_digest: candidate.structure_digest,
    content_digest: candidate.fingerprint, priority: index,
    boundary: index === batch.length - 1 && next.path.split("/")[0] !== candidate.collection }));
  const delivered = Object.fromEntries(batch.filter((candidate) => candidate.approved_revision?.base_digest)
    .map((candidate) => [candidate.view_ref, candidate.approved_revision!.base_digest!]));
  const structure = await readKnowledgeStructure(root);
  const hasPriorDelivery = Array.isArray(structure.parsed?.views) && structure.parsed.views.length > 0;
  if (selectDeliveryPages({ pages, delivered, hasPriorDelivery, allAuthorsAccepted: false }).length > 0) return undefined;
  const prepared = await prepareApprovedRevision({ projectRoot: root, replace_current: true, persist: false,
    selector: next.path, instruction: next.instruction, pending_targets: remaining, batch_candidates: batch,
    ...(next.knowledge_rebinding ? { knowledge_rebinding: next.knowledge_rebinding } : {}),
    ...(next.regenerate ? { regenerate: true } : {}),
    ...(next.target ? { target: next.target } : {}),
    ...(next.create ? { create: next.create } : {}), ...(next.supporting_sources ? { supporting_sources: next.supporting_sources } : {}),
    ...(request.requirements ? { requirements: request.requirements } : {}),
    ...(request.processed_scopes ? { processed_scopes: request.processed_scopes } : {}) });
  return prepared.request;
}

/** Compare the same approved representation that close produces, including
 * source-image relocation. Real content changes are still not equivalent. */
export async function approvedRevisionCandidateApplied(root: string, candidate: CandidateRecord, applied: string | undefined, closed = false): Promise<boolean> {
  if (applied === undefined) return false;
  if (!closed && applied === candidate.body) return true;
  const expected = compactApprovedKnowledgeMarkdown(ensureApprovedKnowledgePresentation(candidate.body));
  if (expected === applied) return true;
  const pair = await canonicalizeApprovedKnowledgeAssetPair({ projectRoot: root,
    pageRelPath: `knowledge/${candidate.path}`, expectedContent: expected, approvedContent: applied,
    sourceLocators: candidate.source_refs });
  return pair.expectedContent === pair.approvedContent;
}

export async function observeApprovedRevisionBatch(root: string, request: ApprovedRevision) {
  const expected = [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])];
  if (!request.review_ready && !request.candidate) return { state: "missing" as const, candidates: [], revision_pending: true };
  const rows = await readCandidateRecords(root);
  const candidates: CandidateRecord[] = [];
  for (const original of expected) {
    const candidate = rows.find((row) => row.candidate_id === original.candidate_id);
    const revision = original.approved_revision!;
    const bytes = await readFile(join(root, "knowledge", revision.previous_path ?? original.path), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined; throw error;
    });
    if (!candidate) {
      const applied = await readFile(join(root, "knowledge", original.path), "utf8").catch(() => undefined);
      if (await approvedRevisionCandidateApplied(root, original, applied)) continue;
      return { state: "stale" as const, candidates: [], revision_pending: true, diagnostic: "Revision batch Candidate is missing" };
    }
    if ((bytes === undefined ? null : durableContentDigest(bytes)) !== revision.base_digest ||
      canonicalIndexerJson({ ...candidate, status: "draft", updated: original.updated }) !== canonicalIndexerJson(original)) {
      return { state: "stale" as const, candidates: [], revision_pending: true, diagnostic: "Revision batch page or Candidate changed outside its compile" };
    }
    candidates.push(candidate);
  }
  if (rows.some((row) => !expected.some((item) => row.candidate_id === item.candidate_id))) {
    return { state: "stale" as const, candidates: [], revision_pending: true, diagnostic: "Candidate is outside the active revision batch" };
  }
  return { state: "current" as const, candidates,
    ...(candidates.some((candidate) => candidate.status === "rejected") ? { revision_pending: true } : {}) };
}
