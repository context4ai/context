import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import { hydrateApprovedKnowledgeMarkdown, readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { approvedRevisionCandidateApplied } from "./approvedRevisionBatch.js";
import { pendingAfterReopen, requestDigest, targetBytes, type ApprovedRevision } from "./approvedRevision.js";

/** Observe changed approved bytes without writing or accepting them. A merge
 * is authored against these exact bytes and still passes the ordinary Review. */
export async function approvedRevisionRecovery(root: string, request: ApprovedRevision | undefined): Promise<{ request: ApprovedRevision; deleted: boolean } | undefined> {
  if (!request) return undefined;
  const batch = [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])];
  const rows = await readCandidateRecords(root);
  const targets: Array<{ candidate?: CandidateRecord; target: ApprovedRevision["target"] }> = batch.map(candidate => ({ candidate, target: {
    path: candidate.path, node_ref: candidate.node_ref, view_ref: candidate.view_ref,
    collection: candidate.collection, markdown: candidate.body, source_refs: candidate.source_refs,
    base_digest: candidate.approved_revision!.base_digest,
    ...(candidate.approved_revision!.previous_path ? { previous_path: candidate.approved_revision!.previous_path } : {}),
  } }));
  if (!targets.some(item => item.target.path === request.target.path)) targets.push({ target: request.target });
  for (const { candidate, target } of targets) {
    let bytes: string | undefined;
    try { bytes = await targetBytes(root, target.previous_path ?? target.path); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const actual = bytes === undefined ? null : durableContentDigest(bytes);
    if (actual === target.base_digest) continue;
    if (candidate && !rows.some(row => row.candidate_id === candidate.candidate_id) &&
      await approvedRevisionCandidateApplied(root, candidate, bytes)) continue;
    const markdown = bytes === undefined ? target.markdown : hydrateApprovedKnowledgeMarkdown({
      content: bytes, relPath: target.previous_path ?? target.path,
      metadata: await readApprovedKnowledgeMetadataIndex(root),
    });
    const { candidate: _candidate, review_ready: _ready, program_blocks: _blocks, ...previous } = request;
    void _candidate; void _ready; void _blocks;
    const payload = { ...previous,
      target: { ...target, markdown, base_digest: actual },
      instruction: candidate?.review.reason ?? request.instruction,
      pending_targets: pendingAfterReopen(request, target.path),
      batch_candidates: batch.filter(item => item.path !== target.path),
      merge_context: { approved_markdown: bytes ?? null,
        draft_markdown: candidate?.body ?? request.target.markdown },
      ...(target.path === request.target.path && request.program_blocks ? { program_blocks: request.program_blocks } : {}),
    };
    return { request: { ...payload, revision: requestDigest(payload) }, deleted: bytes === undefined };
  }
  return undefined;
}
