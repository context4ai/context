import { revisionStoragePath } from "./maintenanceStorage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest, loadIndexerRegistry, type IndexerProjectFileTarget } from "@c4a/context";
import { readApprovedRevision, requestDigest, currentApprovedRevisionTarget } from "./approvedRevision.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { captureProcessedScopes, currentScopeSourceVersion } from "./processedScopeStorage.js";
import { CANDIDATE_LEDGER_FILE, readCandidateRecords, candidateRecordsContent } from "./candidateLedger.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";

/** Caller holds the workspace lock. The current request itself retains the
 * explicitly selected acquisition scope; there is no second task or ledger. */
export async function adjustLocalRevisionSources(root: string, input: {
  scopes: Array<{ source_ref: string; requirement_ref?: string | undefined; module_refs?: string[] | undefined }>;
  instruction: string; refresh?: boolean | undefined;
}) {
  const { readMaintenance } = await import("./maintenanceStorage.js");
  const { currentLedger } = await import("./indexerMainRunStoreRecords.js");
  if ((await readMaintenance(root)).active && await currentLedger(root)) throw new TypeError("Finish or cancel the active maintenance draft before adjusting shared source inputs through the production task's task adjust route. The original ledger still uses those fixed inputs.");
  const revision = await readApprovedRevision(root);
  const update = revision ? undefined : await readKnowledgeUpdate(root);
  const current = revision ?? update;
  if (!current) throw new TypeError("No local update is active.");
  const selected = [...new Set(input.scopes.map((scope) => scope.source_ref))];
  const bound = revision ? [...revision.target.source_refs, ...(revision.processed_scopes ?? []).map((scope) => scope.source_ref)]
    : update!.scopes.map((scope) => scope.source_ref);
  const { registry } = await loadIndexerRegistry(root);
  const additions = input.scopes.filter((scope) => !bound.includes(scope.source_ref));
  for (const scope of additions) {
    const requirement = registry.requirements.find((item) => item.id === scope.requirement_ref);
    const targets = requirement && [...requirement.target_scope.targets, ...requirement.evidence_source_scope.targets];
    if (!targets?.some((target) => target.source_ref === scope.source_ref) || !targets.some((target) => bound.includes(target.source_ref))) {
      throw new TypeError("A new same-task source requires its explicit requirement_ref and a confirmed scope connecting it to this task; no independent task is inferred.");
    }
  }
  if (input.refresh && (!current.refresh_sources || indexerProtocolDigest([...current.refresh_sources].sort()) !== indexerProtocolDigest([...selected].sort()))) {
    throw new TypeError("No matching acquisition adjustment exists. Run task adjust without refresh first.");
  }
  const raw = await readFile(join(root, await revisionStoragePath(root)), "utf8");
  let next: Record<string, unknown>;
  const discardIds = new Set<string>();
  if (!input.refresh) {
    next = { ...current, refresh_sources: selected };
  } else {
    const oldScopes = [...(revision?.processed_scopes ?? update?.scopes ?? []),
      ...await Promise.all(additions.map(async (scope) => ({ requirement_ref: scope.requirement_ref!, source_ref: scope.source_ref,
        ...(scope.module_refs?.length ? { module_refs: scope.module_refs } : {}), processed_version: await currentScopeSourceVersion(root, scope.source_ref) })))];
    const scopes = await captureProcessedScopes(root, await Promise.all(oldScopes.map(async (scope) => {
      if (!selected.includes(scope.source_ref)) return scope;
      const boundaries = input.scopes.filter((item) => item.source_ref === scope.source_ref && item.module_refs !== undefined &&
        (item.requirement_ref === undefined || item.requirement_ref === scope.requirement_ref));
      const wholeSource = boundaries.some((item) => item.module_refs!.length === 0);
      const { module_refs: _modules, ...sourceScope } = scope;
      void _modules;
      return { ...(wholeSource ? sourceScope : scope),
        ...(!wholeSource && boundaries.length ? { module_refs: [...new Set(boundaries.flatMap((item) => item.module_refs!))] } : {}),
        processed_version: await currentScopeSourceVersion(root, scope.source_ref) };
    })));
    const ids = new Set(scopes.map((scope) => scope.requirement_ref));
    const requirements = registry.requirements.filter((item) => ids.has(item.id));
    if (revision) {
      const affected = additions.length > 0 || revision.target.source_refs.some((ref) => selected.some((source) => ref === source || ref.startsWith(`${source}#`) || ref.startsWith(`${source}/`)));
      const currentTarget = affected ? await currentApprovedRevisionTarget(root, revision) : revision.target;
      const { refresh_sources: _refresh, candidate, ...rest } = revision;
      void _refresh;
      // A scope baseline covers already delivered pages too. Revisit every
      // approved source-bound page after changing its fixed input, without
      // replacing approved prose or introducing per-page version records.
      const changedSources = selected.filter((source) =>
        (revision.processed_scopes ?? []).some((old) => old.source_ref === source &&
          scopes.some((scope) => scope.source_ref === source && scope.processed_version !== old.processed_version)));
      const pending = [...(revision.pending_targets ?? [])];
      const known = new Set([revision.target.path, ...pending.map((item) => item.path)]);
      const structure = await readKnowledgeStructure(root);
      for (const view of Array.isArray(structure.parsed?.views) ? structure.parsed.views : []) {
        if (!view || typeof view !== "object" || typeof view.path !== "string" || known.has(view.path)) continue;
        if (!Array.isArray(view.sources) || !view.sources.some((ref: unknown) => typeof ref === "string" &&
          changedSources.some((source) => ref === source || ref.startsWith(`${source}#`) || ref.startsWith(`${source}/`)))) continue;
        pending.push({ path: view.path, instruction: `Reassess the current approved page against the adjusted source. Preserve its text if unaffected.\n${input.instruction}` });
        known.add(view.path);
      }
      const keptBatch = (revision.batch_candidates ?? []).filter((item) => {
        if (!item.source_refs.some((ref) => selected.some((source) => ref === source || ref.startsWith(`${source}#`) || ref.startsWith(`${source}/`)))) return true;
        discardIds.add(item.candidate_id);
        if (!known.has(item.path)) {
          pending.push({ path: item.path, instruction: `${item.review.reason}\n${input.instruction}`,
            ...(item.approved_revision?.base_digest === null ? { create: { path: item.path, title: item.review.title,
              source_refs: item.source_refs, instruction: input.instruction } } : {}) });
          known.add(item.path);
        }
        return false;
      });
      const { prepareRevisionProgramBlocks } = await import("./approvedRevisionPrograms.js");
      const programBlocks = affected ? await prepareRevisionProgramBlocks(root, revision.target.source_refs, scopes.filter((scope) => selected.includes(scope.source_ref))) : revision.program_blocks;
      const payload = { ...rest, ...(programBlocks ? { program_blocks: programBlocks } : {}), review_ready: false, batch_candidates: keptBatch, pending_targets: pending, ...(revision.processed_scopes || additions.length ? { processed_scopes: scopes, requirements } : {}),
        target: affected ? { ...currentTarget, markdown: candidate?.body ?? currentTarget.markdown, source_refs: [...new Set([...currentTarget.source_refs, ...additions.map((scope) => scope.source_ref)])] } : revision.target,
        instruction: affected ? `${revision.instruction}\n\n${input.instruction}` : revision.instruction };
      next = { ...payload, revision: requestDigest(payload), ...(!affected && candidate ? { candidate } : {}) };
      if (affected && candidate) discardIds.add(candidate.candidate_id);
    } else {
      const { refresh_sources: _refresh, revision: _revision, structure_proposal: _proposal, ...rest } = update!;
      void _refresh; void _revision; void _proposal;
      const payload = { ...rest, scopes, requirements, changes: [rest.changes, input.instruction].filter(Boolean).join("\n\n") };
      next = { ...payload, revision: indexerProtocolDigest(payload) };
    }
  }
  if (update && !input.refresh) {
    const { revision: _revision, ...payload } = next; void _revision;
    next.revision = indexerProtocolDigest(payload);
  }
  const content = `${JSON.stringify(next)}\n`;
  const targets: IndexerProjectFileTarget[] = [{ path: await revisionStoragePath(root), operation: "write",
    base_digest: durableContentDigest(raw), target_digest: durableContentDigest(content), content }];
  if (discardIds.size > 0) {
    const ledger = await readFile(join(root, CANDIDATE_LEDGER_FILE), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined; throw error;
    });
    if (ledger !== undefined) {
      const kept = candidateRecordsContent((await readCandidateRecords(root)).filter((item) => !discardIds.has(item.candidate_id)));
      targets.push(kept === undefined ? { path: CANDIDATE_LEDGER_FILE, operation: "delete", base_digest: durableContentDigest(ledger), target_digest: null }
        : { path: CANDIDATE_LEDGER_FILE, operation: "write", base_digest: durableContentDigest(ledger), target_digest: durableContentDigest(kept), content: kept });
    }
  }
  await runDurableMultiFileTransaction({ projectRoot: root, kind: "adjust-local-update", proposal_digest: indexerProtocolDigest(targets), targets });
  return { action: input.refresh ? "adjusted" : "acquisition-authorized", source_refs: selected,
    retained_pending_pages: revision?.pending_targets?.length ?? update?.candidates.length ?? 0,
    next: input.refresh ? "context status --format json" : "Acquire/import only the selected inputs, then repeat context task adjust with the same scope and instruction plus refresh: true. Keep current approved pages and queued work." };
}
