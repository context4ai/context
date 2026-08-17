import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  type CompileProsePhaseDefinition,
  type DocumentSourceType,
} from "@c4a/context";
import { parseSpanSourceRef } from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { resolveProseSourceRef } from "./documentEvidenceIndex.js";
import {
  isReservedKnowledgeIndexPath,
  isSafeKnowledgeTargetPath,
  readCandidateRecords,
  writeCandidateRecords,
  type CandidateRecord,
} from "./candidateLedger.js";
import { currentCompileStructureDigest } from "./proseCompileStructure.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { verbatimBodyMatchesSpanHash } from "./verifySourceRefs.js";
import { withProjectWriteLock } from "./writeLock.js";
import {
  projectKnowledgeAssets,
  removeOrphanKnowledgeAssets,
  type PreparedKnowledgeAsset,
} from "./knowledgeAssets.js";
import { renderApprovedCodegraphMarkdown } from "./reviewApplyCodegraph.js";
import { renderApprovedProseMarkdown } from "./reviewApplyProse.js";
import { readRejectedDecisions, writeRejectedDecisions } from "./reviewDecisions.js";
import { assertProseCompileBatchReadyForReview } from "./proseCompileBatch.js";
import { archiveActiveStructure, currentStructureSlotDigest } from "./proseStructureStore.js";
export { cleanApprovedBody } from "./reviewApplyCodegraph.js";
import {
  assertSafeEntityId,
  candidateIdsHash,
  candidateSetHash,
  findApprovedPageForViewRef,
  currentProseCandidateEvidence,
  parseCanonicalProseRef,
  readReviewCandidateSnapshot,
  removeCandidateSnapshot,
  type ApplyReviewDecisionsResult,
  type CandidateSnapshot,
  type ParsedCanonicalProseRef,
  type ReviewDecision,
  type ReviewPayload,
  type ReviewStatus,
} from "./reviewShared.js";

interface PreparedApprovedPage {
  id: string;
  relPath: string;
  absPath: string;
  content: string;
  changed: boolean;
  assets: PreparedKnowledgeAsset[];
}

function existingTimestamp(markdown: string | undefined): string | undefined {
  if (markdown === undefined) return undefined;
  const match = /^timestamp:\s*"?([^"\n]+)"?\s*$/mu.exec(markdown);
  return match?.[1];
}

function rerunCompileProseCommand(record: CandidateRecord): string {
  const { sourceType, sourceName } = proseSourceInfo(record);
  return `context run compile:${sourceType}:${sourceName}:${record.collection}`;
}

function isProseCandidate(record: CandidateRecord): boolean {
  return record.candidate_type === "prose-align";
}

function proseSourceInfo(record: CandidateRecord): {
  sourceType: DocumentSourceType;
  sourceName: string;
} {
  const parsedProseRef = record.source_refs
    .map((ref) => parseCanonicalProseRef(ref))
    .find((parsed): parsed is ParsedCanonicalProseRef => parsed !== null);
  return {
    sourceType: record.source?.type ?? parsedProseRef?.sourceType ?? "file",
    sourceName: record.source?.name ?? parsedProseRef?.sourceName ?? record.module,
  };
}

function compilePhaseForCandidate(record: CandidateRecord): CompileProsePhaseDefinition {
  const source = proseSourceInfo(record);
  return {
    kind: "phase.compile.prose",
    id: `compile:${source.sourceType}:${source.sourceName}:${record.collection}`,
    reads: [],
    writes: [],
    source: {
      kind: "source.ref",
      type: source.sourceType,
      name: source.sourceName,
      materializedAt: `sources/${source.sourceType}/${source.sourceName}`,
    },
    sourceType: source.sourceType,
    collection: record.collection as CompileProsePhaseDefinition["collection"],
    schemaVersion: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  };
}

async function assertProseCandidateCurrentStructure(input: {
  projectRoot: string;
  record: CandidateRecord;
}): Promise<void> {
  if (!isProseCandidate(input.record)) return;
  if (input.record.structure_digest === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `prose-align candidate is not bound to a confirmed structure: ${input.record.candidate_id}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      next: `Rerun ${rerunCompileProseCommand(input.record)} against the current confirmed structure before approving.`,
    });
  }
  const source = proseSourceInfo(input.record);
  const sourceKey = `${source.sourceType}:${source.sourceName}`;
  let slotDigest = await currentStructureSlotDigest(input.projectRoot, sourceKey, input.record.collection);
  if (slotDigest === undefined) {
    await archiveActiveStructure(input.projectRoot);
    slotDigest = await currentStructureSlotDigest(input.projectRoot, sourceKey, input.record.collection);
  }
  if (slotDigest === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `prose-align candidate structure snapshot is missing: ${input.record.candidate_id}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      source: sourceKey,
      collection: input.record.collection,
      structure_digest: input.record.structure_digest,
      next: `Rerun context run align:${source.sourceType}:${source.sourceName}:${input.record.collection}, confirm the structure, and retry Review. Reuse existing decisions only if the regenerated structure digest and candidate fingerprints are unchanged.`,
    });
  }
  if (slotDigest !== input.record.structure_digest) {
    throw new ContextError(ExitCode.WorkspaceStateError, `prose-align candidate structure slot is stale: ${input.record.candidate_id}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      source: sourceKey,
      collection: input.record.collection,
      expected_structure_digest: slotDigest,
      actual_structure_digest: input.record.structure_digest,
      next: `Rerun ${rerunCompileProseCommand(input.record)} against the current confirmed structure before approving.`,
    });
  }
  const currentDigest = await currentCompileStructureDigest({
    projectRoot: input.projectRoot,
    phase: compilePhaseForCandidate(input.record),
    structureDigest: input.record.structure_digest,
  });
  if (currentDigest !== input.record.structure_digest) {
    throw new ContextError(ExitCode.WorkspaceStateError, `prose-align candidate structure is stale: ${input.record.candidate_id}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      expected_structure_digest: currentDigest,
      actual_structure_digest: input.record.structure_digest,
      next: `Rerun ${rerunCompileProseCommand(input.record)} against the current confirmed structure before approving.`,
    });
  }
}

function renderApprovedMarkdown(input: {
  record: CandidateRecord;
  snapshot: CandidateSnapshot;
  timestamp: string;
}): string {
  if (input.record.candidate_type === "prose-align") {
    return renderApprovedProseMarkdown(input);
  }
  return renderApprovedCodegraphMarkdown(input);
}

function assertProseCandidateVerbatimHashes(record: CandidateRecord): void {
  if (record.candidate_type !== "prose-align") return;
  for (const section of record.sections ?? []) {
    const mode = section.content_mode ?? "verbatim";
    if (mode !== "verbatim") continue;
    if (section.body === undefined) continue;
    const parsed = parseSpanSourceRef(section.source_ref);
    if (parsed === null || !verbatimBodyMatchesSpanHash(section.body, parsed.span_hash)) {
      throw new ContextError(ExitCode.WorkspaceStateError, `verbatim candidate body does not match source_ref hash: ${record.candidate_id}#${section.id}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        candidate_id: record.candidate_id,
        section_id: section.id,
        source_ref: section.source_ref,
        next: `Rerun ${rerunCompileProseCommand(record)} so the CLI rematerializes verbatim section bodies from source evidence.`,
      });
    }
  }
}

async function assertProseCandidateExactCurrentRefs(input: {
  projectRoot: string;
  record: CandidateRecord;
}): Promise<void> {
  if (input.record.candidate_type !== "prose-align") return;
  const evidence = await currentProseCandidateEvidence(input.projectRoot, input.record);
  if (evidence === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `candidate snapshot is missing or stale: ${input.record.candidate_id}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      next: `Rerun ${rerunCompileProseCommand(input.record)} against the current snapshot.`,
    });
  }
  const refsBySection = input.record.sections === undefined || input.record.sections.length === 0
    ? [["candidate", input.record.source_refs] as const]
    : input.record.sections.map((section) => [
        section.id,
        [...new Set([section.source_ref, ...(section.source_refs ?? [])])],
      ] as const);
  for (const [sectionId, refs] of refsBySection) {
    if (refs.length === 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, `prose candidate section has no source_ref: ${input.record.candidate_id}#${sectionId}`, {
        category: ErrorCategory.SchemaInvalid,
        candidate_id: input.record.candidate_id,
        section_id: sectionId,
        next: `Rerun ${rerunCompileProseCommand(input.record)} so every section is bound to current source evidence.`,
      });
    }
    for (const sourceRef of refs) {
      if (parseCanonicalProseRef(sourceRef) === null) {
        throw new ContextError(ExitCode.WorkspaceStateError, `unsupported prose candidate source_ref: ${sourceRef}`, {
          category: ErrorCategory.SchemaInvalid,
          candidate_id: input.record.candidate_id,
          section_id: sectionId,
          source_ref: sourceRef,
          next: `Rerun ${rerunCompileProseCommand(input.record)} so the CLI rematerializes candidate evidence.`,
        });
      }
      const resolved = await resolveProseSourceRef({
        projectRoot: input.projectRoot,
        index: evidence.indexResult.index,
        sourceRef,
        snapshotMarkdownCache: evidence.indexResult.snapshotMarkdownCache,
      });
      if (resolved === null || resolved.status !== "exact") {
        throw new ContextError(ExitCode.WorkspaceStateError, `prose candidate source_ref is not exact against current snapshot: ${input.record.candidate_id}#${sectionId}`, {
          category: ErrorCategory.WorkspaceStateInvalid,
          candidate_id: input.record.candidate_id,
          section_id: sectionId,
          source_ref: sourceRef,
          status: resolved?.status ?? "unresolved",
          next: `Rerun ${rerunCompileProseCommand(input.record)} so the candidate is regenerated from current exact source evidence.`,
        });
      }
    }
  }
}

async function prepareApprovedPage(input: {
  projectRoot: string;
  record: CandidateRecord;
  now: string;
}): Promise<PreparedApprovedPage> {
  const reservedCodegraphIndex = input.record.candidate_type === "code-symbol" &&
    isReservedKnowledgeIndexPath(input.record.path);
  if (!isSafeKnowledgeTargetPath(input.record.collection, input.record.path) || reservedCodegraphIndex) {
    throw new ContextError(ExitCode.WorkspaceStateError, `candidate path is not valid: ${input.record.path}`, {
      category: ErrorCategory.SchemaInvalid,
      candidate_id: input.record.candidate_id,
      path: input.record.path,
      ...(reservedCodegraphIndex ? { reason_code: "candidate/reserved-index-path" } : {}),
      next: isProseCandidate(input.record)
        ? "Rerun compileProse from the confirmed structure."
        : "Rerun the extract phase before applying approve.",
    });
  }
  const snapshot = await readReviewCandidateSnapshot(input.projectRoot, input.record);
  if (snapshot === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `candidate snapshot is missing or stale: ${input.record.candidate_id}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      next: isProseCandidate(input.record)
        ? `Restore the staged committed document snapshot or rerun ${rerunCompileProseCommand(input.record)} against the current snapshot.`
        : "Rerun the extract phase before applying approve.",
    });
  }
  await assertProseCandidateCurrentStructure({ projectRoot: input.projectRoot, record: input.record });
  assertProseCandidateVerbatimHashes(input.record);
  await assertProseCandidateExactCurrentRefs({ projectRoot: input.projectRoot, record: input.record });
  let relPath: string;
  if (input.record.candidate_type !== "prose-align") {
    assertSafeEntityId(input.record.node_ref);
  }
  relPath = join("knowledge", input.record.path);
  const existingView = findApprovedPageForViewRef(input.projectRoot, input.record.view_ref);
  if (existingView !== undefined && existingView.relPath !== relPath) {
    throw new ContextError(ExitCode.WorkspaceStateError, `approved page already exists for view_ref at a different path: ${input.record.view_ref}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      view_ref: input.record.view_ref,
      current_path: existingView.relPath,
      candidate_path: relPath,
      next: "Resolve the approved page path migration explicitly before approving this candidate.",
    });
  }
  const absPath = join(input.projectRoot, relPath);
  const existing = existsSync(absPath) ? await readFile(absPath, "utf8") : undefined;
  if (existing !== undefined) {
    const frontmatter = parseFrontmatterLoose(existing);
    const existingViewRef = typeof frontmatter.view_ref === "string" ? frontmatter.view_ref : undefined;
    const existingNodeRef = typeof frontmatter.node_ref === "string" ? frontmatter.node_ref : undefined;
    if (existingViewRef !== input.record.view_ref || existingNodeRef !== input.record.node_ref) {
      throw new ContextError(ExitCode.WorkspaceStateError, `candidate target path already contains a different approved view: ${relPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        candidate_id: input.record.candidate_id,
        path: relPath,
        existing_view_ref: existingViewRef,
        existing_node_ref: existingNodeRef,
        candidate_view_ref: input.record.view_ref,
        candidate_node_ref: input.record.node_ref,
        next: "Resolve the approved page path conflict explicitly before approving this candidate.",
      });
    }
  }
  const stableTimestamp = existingTimestamp(existing) ?? input.now;
  const stableContent = renderApprovedMarkdown({
    record: input.record,
    snapshot,
    timestamp: stableTimestamp,
  });
  const projectResources = async (content: string): Promise<{ content: string; assets: PreparedKnowledgeAsset[] }> => {
    if (input.record.candidate_type !== "prose-align") return { content, assets: [] };
    const evidence = await currentProseCandidateEvidence(input.projectRoot, input.record);
    if (evidence === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, `candidate resource evidence is missing or stale: ${input.record.candidate_id}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        candidate_id: input.record.candidate_id,
        next: `Rerun ${rerunCompileProseCommand(input.record)} against the current source snapshot.`,
      });
    }
    return projectKnowledgeAssets({
      projectRoot: input.projectRoot,
      pageRelPath: relPath,
      content,
      sourceMaterializedAt: evidence.indexResult.index.materialized_at,
      documentPath: evidence.parsed.documentPath,
      manifest: evidence.indexResult.manifest,
    });
  };
  const stableProjection = await projectResources(stableContent);
  if (existing === stableProjection.content) {
    return {
      id: input.record.candidate_id,
      relPath,
      absPath,
      content: stableProjection.content,
      changed: false,
      assets: stableProjection.assets,
    };
  }
  const nextContent = renderApprovedMarkdown({
    record: input.record,
    snapshot,
    timestamp: input.now,
  });
  const nextProjection = await projectResources(nextContent);
  return {
    id: input.record.candidate_id,
    relPath,
    absPath,
    content: nextProjection.content,
    changed: true,
    assets: nextProjection.assets,
  };
}

async function writePreparedApprovedPage(page: PreparedApprovedPage): Promise<void> {
  for (const asset of page.assets) {
    await mkdir(dirname(asset.absPath), { recursive: true });
    await writeFile(asset.absPath, asset.bytes);
  }
  if (page.changed) {
    await mkdir(dirname(page.absPath), { recursive: true });
    await writeFile(page.absPath, page.content, "utf8");
  }
}

function expandReviewPayload(payload: ReviewPayload, rows: readonly CandidateRecord[]): ReviewDecision[] {
  const scopedRows = payload.scope?.kind === "all"
    ? rows.filter((row) => row.status === "draft")
    : payload.collection !== undefined
      ? rows.filter((row) => row.collection === payload.collection && row.status === "draft")
      : [];
  const scopedIds = scopedRows.map((row) => row.candidate_id).sort();

  if (payload.scope === undefined) {
    throw new ContextError(ExitCode.UserError, "review payload requires an explicit scope from the current review gate", {
      category: ErrorCategory.UserInputInvalid,
      next: payload.collection === undefined
        ? "Rerun context review html --all --format json and copy a fresh scoped payload."
        : `Rerun context review html ${payload.collection} --format json and copy a fresh scoped payload.`,
    });
  }

  const actualHash = candidateIdsHash(scopedIds);
  const actualCandidatesHash = candidateSetHash(scopedRows);
  const visibleIds = payload.scope.visible_candidate_ids;
  if (payload.scope.kind === "all" && visibleIds === undefined) {
    throw new ContextError(ExitCode.UserError, "all-scope review payload requires scope.visible_candidate_ids", {
      category: ErrorCategory.UserInputInvalid,
      expected: {
        count: scopedIds.length,
        ids_sha256: actualHash,
        visible_candidate_ids: scopedIds,
      },
      next: "Rerun context review html --all --format json and copy a fresh scoped payload.",
    });
  }
  const visibleMismatch = visibleIds !== undefined &&
    (visibleIds.length !== scopedIds.length || visibleIds.some((id, index) => id !== scopedIds[index]));
  const candidateSetMismatch = payload.scope.candidates_sha256 !== undefined &&
    payload.scope.candidates_sha256 !== actualCandidatesHash;
  if (payload.scope.count !== scopedIds.length || payload.scope.ids_sha256 !== actualHash || visibleMismatch || candidateSetMismatch) {
    const scopeLabel = payload.scope.kind === "all" ? "--all" : payload.collection ?? payload.scope.collection ?? "<collection>";
    throw new ContextError(ExitCode.WorkspaceStateError, "review payload is stale for the current draft candidates", {
      category: ErrorCategory.WorkspaceStateInvalid,
      expected: payload.scope,
      actual: {
        count: scopedIds.length,
        ids_sha256: actualHash,
        candidates_sha256: actualCandidatesHash,
        visible_candidate_ids: scopedIds,
      },
      next: `Rerun context review html ${scopeLabel} and copy a fresh payload.`,
    });
  }

  if (payload.default === undefined) {
    const scopedSet = new Set(scopedIds);
    for (const decision of payload.decisions) {
      if (!scopedSet.has(decision.candidate_id)) {
        throw new ContextError(ExitCode.UserError, `review payload decision is outside scoped draft candidates: ${decision.candidate_id}`, {
          category: ErrorCategory.UserInputInvalid,
          candidate_id: decision.candidate_id,
        });
      }
    }
    return payload.decisions;
  }
  if (payload.scope?.kind !== "all" && payload.collection === undefined) {
    throw new ContextError(ExitCode.UserError, "compact review payload requires collection or all scope", {
      category: ErrorCategory.UserInputInvalid,
    });
  }

  const overrides = new Map<string, ReviewStatus>();
  for (const decision of payload.decisions) {
    if (overrides.has(decision.candidate_id)) {
      throw new ContextError(ExitCode.UserError, `duplicate review decision candidate_id: ${decision.candidate_id}`, {
        category: ErrorCategory.UserInputInvalid,
        candidate_id: decision.candidate_id,
        next: "Keep exactly one exception line per candidate id.",
      });
    }
    if (!scopedIds.includes(decision.candidate_id)) {
      const scopeLabel = payload.scope?.kind === "all" ? "all" : payload.collection;
      throw new ContextError(ExitCode.UserError, `review payload decision is outside ${scopeLabel} draft scope: ${decision.candidate_id}`, {
        category: ErrorCategory.UserInputInvalid,
        candidate_id: decision.candidate_id,
      });
    }
    overrides.set(decision.candidate_id, decision.status);
  }

  return scopedIds.map((candidateId) => ({
    candidate_id: candidateId,
    status: overrides.get(candidateId) ?? (payload.default as ReviewStatus),
  }));
}

export async function applyReviewDecisions(input: {
  projectRoot: string;
  payload: ReviewPayload;
}): Promise<ApplyReviewDecisionsResult> {
  const now = new Date().toISOString();
  return withProjectWriteLock(input.projectRoot, "extract-candidates", async () => {
    const rows = await readCandidateRecords(input.projectRoot);
    const rejectedDecisions = await readRejectedDecisions(input.projectRoot);
    const proseCollections = [...new Set(rows
      .filter((row) =>
        row.status === "draft" &&
        row.candidate_type === "prose-align" &&
        (input.payload.collection === undefined || row.collection === input.payload.collection)
      )
      .map((row) => row.collection))];
    const nextRows = [...rows];
    const decisions = expandReviewPayload(input.payload, rows);
    await assertProseCompileBatchReadyForReview({
      projectRoot: input.projectRoot,
      collections: proseCollections,
    });
    const seenDecisionIds = new Set<string>();
    const seenApprovedIds = new Map<string, string>();
    const pagesToWrite: PreparedApprovedPage[] = [];
    const pagesToRemove: string[] = [];
    const snapshotsToRemove = new Set<string>();
    const pages: string[] = [];
    let approved = 0;
    let rejected = 0;
    let unchanged = 0;
    let materialized = 0;
    let removed = 0;
    let candidateFileUpdated = false;
    let decisionsUpdated = false;

    for (const decision of decisions) {
      assertSafeEntityId(decision.candidate_id);
      if (seenDecisionIds.has(decision.candidate_id)) {
        throw new ContextError(ExitCode.UserError, `duplicate review decision candidate_id: ${decision.candidate_id}`, {
          category: ErrorCategory.UserInputInvalid,
          candidate_id: decision.candidate_id,
          next: "Keep exactly one decision per candidate id.",
        });
      }
      seenDecisionIds.add(decision.candidate_id);
      const index = nextRows.findIndex((row) => row.candidate_id === decision.candidate_id);
      const row = index >= 0 ? nextRows[index] : undefined;
      if (decision.status === "approved") {
        if (row === undefined) {
          throw new ContextError(ExitCode.WorkspaceStateError, `candidate is not available for approval: ${decision.candidate_id}`, {
            category: ErrorCategory.WorkspaceStateInvalid,
            candidate_id: decision.candidate_id,
            next: "Rerun review list/html and apply a current candidate_id.",
          });
        }
        if (row.status !== "draft") {
          throw new ContextError(ExitCode.WorkspaceStateError, `candidate is not a draft and cannot be approved: ${decision.candidate_id}`, {
            category: ErrorCategory.WorkspaceStateInvalid,
            candidate_id: decision.candidate_id,
            status: row.status,
            next: "The durable rejection remains until the candidate fingerprint changes. Review the changed draft before approving it.",
          });
        }
        const approvedRef = row.view_ref;
        assertSafeEntityId(approvedRef);
        const previousCandidate = seenApprovedIds.get(approvedRef);
        if (previousCandidate !== undefined) {
          throw new ContextError(ExitCode.UserError, `multiple approved review decisions target the same knowledge page: ${approvedRef}`, {
            category: ErrorCategory.UserInputInvalid,
            approved_ref: approvedRef,
            candidate_ids: [previousCandidate, row.candidate_id],
            next: "Approve only one current candidate per approved knowledge view; reject or restage the older draft first.",
          });
        }
        seenApprovedIds.set(approvedRef, row.candidate_id);
        if (rejectedDecisions.delete(row.candidate_id)) decisionsUpdated = true;
        if (row.collection === "codegraph" && row.change === "remove") {
          const existingPage = findApprovedPageForViewRef(input.projectRoot, row.view_ref);
          if (existingPage === undefined) {
            throw new ContextError(ExitCode.WorkspaceStateError, `approved codegraph page is missing for removal: ${row.view_ref}`, {
              category: ErrorCategory.WorkspaceStateInvalid,
              candidate_id: row.candidate_id,
              next: "Rerun the codegraph extraction to refresh the deletion delta.",
            });
          }
          pagesToRemove.push(existingPage.path);
          pages.push(existingPage.relPath);
          nextRows.splice(index, 1);
          snapshotsToRemove.add(row.candidate_id);
          candidateFileUpdated = true;
          approved++;
          removed++;
          continue;
        }
        const page = await prepareApprovedPage({ projectRoot: input.projectRoot, record: row, now });
        pagesToWrite.push(page);
        pages.push(page.relPath);
        if (page.changed) materialized++;
        else unchanged++;
        nextRows.splice(index, 1);
        snapshotsToRemove.add(row.candidate_id);
        candidateFileUpdated = true;
        approved++;
        continue;
      }

      if (row === undefined) {
        throw new ContextError(ExitCode.WorkspaceStateError, `candidate is not available for rejection: ${decision.candidate_id}`, {
          category: ErrorCategory.WorkspaceStateInvalid,
          candidate_id: decision.candidate_id,
        });
      }
      if (row.status === "rejected") {
        unchanged++;
      } else {
        nextRows[index] = { ...row, status: "rejected", updated: now };
        snapshotsToRemove.add(row.candidate_id);
        candidateFileUpdated = true;
        rejected++;
      }
      if (rejectedDecisions.get(row.candidate_id) !== row.fingerprint) {
        rejectedDecisions.set(row.candidate_id, row.fingerprint);
        decisionsUpdated = true;
      }
    }

    for (const page of pagesToWrite) {
      await writePreparedApprovedPage(page);
    }
    await Promise.all(pagesToRemove.map((path) => rm(path, { force: true })));
    if (candidateFileUpdated) {
      await writeCandidateRecords(input.projectRoot, nextRows);
    }
    if (decisionsUpdated) {
      await writeRejectedDecisions(input.projectRoot, rejectedDecisions);
    }
    await Promise.all([...snapshotsToRemove].map((id) => removeCandidateSnapshot(input.projectRoot, id)));
    await removeOrphanKnowledgeAssets(input.projectRoot);
    return {
      applied: decisions.length,
      approved,
      rejected,
      unchanged,
      materialized,
      removed,
      candidateFileUpdated,
      pages,
    };
  });
}
