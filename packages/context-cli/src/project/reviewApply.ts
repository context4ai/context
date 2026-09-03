import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  indexerProtocolDigest,
  type IndexerProjectFileTarget,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  isSafeKnowledgeTargetPath,
  readCandidateRecords,
  candidateRecordsContent,
  CANDIDATE_LEDGER_FILE,
  type CandidateRecord,
} from "./candidateLedger.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { withProjectWriteLock } from "./writeLock.js";
import { renderApprovedIndexerMarkdown } from "./reviewApplyIndexer.js";
import {
  assertProjectIndexerCandidateInCompileIndex,
  loadProjectIndexerCandidateCompileIndex,
  type ProjectIndexerCandidateCompileIndex,
} from "./indexerCandidateCompileActions.js";
import {
  readRejectedDecisions,
  rejectedDecisionsContent,
  REVIEW_DECISIONS_FILE,
} from "./reviewDecisions.js";
import {
  type DurableMultiFileFailureInjector,
  recoverDurableMultiFileTransactions,
  runDurableMultiFileTransaction,
} from "./durableMultiFileTransaction.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import {
  assertSafeEntityId,
  buildApprovedPageViewRefIndex,
  candidateIdsHash,
  candidateSetHash,
  findApprovedPageForViewRef,
  readReviewCandidateSnapshot,
  type ApplyReviewDecisionsResult,
  type ApprovedPageViewRefIndex,
  type ReviewDecision,
  type ReviewPayload,
  type ReviewStatus,
} from "./reviewShared.js";

interface PreparedApprovedPage {
  id: string;
  relPath: string;
  existing?: string;
  content: string;
  changed: boolean;
}

function existingTimestamp(markdown: string | undefined): string | undefined {
  if (markdown === undefined) return undefined;
  const match = /^timestamp:\s*"?([^"\n]+)"?\s*$/mu.exec(markdown);
  return match?.[1];
}

async function prepareApprovedPage(input: {
  projectRoot: string;
  record: CandidateRecord;
  now: string;
  approvedPageIndex: ApprovedPageViewRefIndex;
  indexerCompileIndex: ProjectIndexerCandidateCompileIndex;
}): Promise<PreparedApprovedPage> {
  assertProjectIndexerCandidateInCompileIndex({
    index: input.indexerCompileIndex,
    record: input.record,
  });
  if (!isSafeKnowledgeTargetPath(input.record.collection, input.record.path)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `candidate path is not valid: ${input.record.path}`, {
      category: ErrorCategory.SchemaInvalid,
      candidate_id: input.record.candidate_id,
      path: input.record.path,
      next: "Rerun the current Indexer Candidate compile before approval.",
    });
  }
  if (await readReviewCandidateSnapshot(input.projectRoot, input.record) === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `candidate snapshot is missing or stale: ${input.record.candidate_id}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      candidate_id: input.record.candidate_id,
      next: "Rerun the current Indexer Candidate compile before approval.",
    });
  }
  assertSafeEntityId(input.record.node_ref);
  assertSafeEntityId(input.record.view_ref);
  const relPath = join("knowledge", input.record.path);
  const existingView = findApprovedPageForViewRef(
    input.record.view_ref,
    input.approvedPageIndex,
  );
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
    const frontmatter = input.approvedPageIndex.byRelPath.get(relPath)?.frontmatter ??
      parseFrontmatterLoose(existing);
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
  const stableContent = renderApprovedIndexerMarkdown({
    record: input.record,
    timestamp: existingTimestamp(existing) ?? input.now,
  });
  if (existing === stableContent) {
    return {
      id: input.record.candidate_id,
      relPath,
      ...(existing === undefined ? {} : { existing }),
      content: stableContent,
      changed: false,
    };
  }
  return {
    id: input.record.candidate_id,
    relPath,
    ...(existing === undefined ? {} : { existing }),
    content: renderApprovedIndexerMarkdown({
      record: input.record,
      timestamp: input.now,
    }),
    changed: true,
  };
}

async function readProjectFileMaybe(
  projectRoot: string,
  relPath: string,
): Promise<string | undefined> {
  try {
    return await readFile(join(projectRoot, relPath), "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function reviewFileTarget(input: {
  path: string;
  baseContent?: string | undefined;
  targetContent?: string | undefined;
}): IndexerProjectFileTarget | undefined {
  if (input.baseContent === input.targetContent) return undefined;
  if (input.targetContent === undefined) {
    if (input.baseContent === undefined) return undefined;
    return {
      path: input.path,
      operation: "delete",
      base_digest: durableContentDigest(input.baseContent),
      target_digest: null,
    };
  }
  return {
    path: input.path,
    operation: "write",
    base_digest: input.baseContent === undefined
      ? null
      : durableContentDigest(input.baseContent),
    target_digest: durableContentDigest(input.targetContent),
    content: input.targetContent,
  };
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
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<ApplyReviewDecisionsResult> {
  const now = new Date().toISOString();
  return withProjectWriteLock(input.projectRoot, "extract-candidates", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const candidateLedgerBase = await readProjectFileMaybe(
      input.projectRoot,
      CANDIDATE_LEDGER_FILE,
    );
    const rejectedDecisionsBase = await readProjectFileMaybe(
      input.projectRoot,
      REVIEW_DECISIONS_FILE,
    );
    const rows = await readCandidateRecords(input.projectRoot);
    const rejectedDecisions = await readRejectedDecisions(input.projectRoot);
    const nextRows = [...rows];
    const decisions = expandReviewPayload(input.payload, rows);
    const approvesAnyCandidate = decisions.some((decision) =>
      decision.status === "approved"
    );
    const indexerCompileIndex = approvesAnyCandidate
      ? await loadProjectIndexerCandidateCompileIndex(input.projectRoot)
      : undefined;
    const approvedPageIndex: ApprovedPageViewRefIndex = approvesAnyCandidate
      ? await buildApprovedPageViewRefIndex(input.projectRoot)
      : {
          byViewRef: new Map(),
          byRelPath: new Map(),
          assetReferencesByRelPath: new Map(),
        };
    const seenDecisionIds = new Set<string>();
    const seenApprovedIds = new Map<string, string>();
    const seenApprovedPaths = new Map<string, string>();
    const pagesToWrite: PreparedApprovedPage[] = [];
    const pages: string[] = [];
    let approved = 0;
    let rejected = 0;
    let unchanged = 0;
    let materialized = 0;
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
        if (indexerCompileIndex === undefined) throw new TypeError("Indexer Candidate compile index is missing");
        assertProjectIndexerCandidateInCompileIndex({
          index: indexerCompileIndex,
          record: row,
        });
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
        const approvedPath = join("knowledge", row.path);
        const previousPathCandidate = seenApprovedPaths.get(approvedPath);
        if (previousPathCandidate !== undefined) {
          throw new ContextError(ExitCode.UserError, `multiple approved review decisions target the same knowledge path: ${approvedPath}`, {
            category: ErrorCategory.UserInputInvalid,
            path: approvedPath,
            candidate_ids: [previousPathCandidate, row.candidate_id],
            next: "Approve only one current candidate per knowledge path.",
          });
        }
        seenApprovedPaths.set(approvedPath, row.candidate_id);
        if (rejectedDecisions.delete(row.candidate_id)) decisionsUpdated = true;
        const page = await prepareApprovedPage({
          projectRoot: input.projectRoot,
          record: row,
          now,
          approvedPageIndex,
          indexerCompileIndex,
        });
        pagesToWrite.push(page);
        pages.push(page.relPath);
        if (page.changed) materialized++;
        else unchanged++;
        nextRows.splice(index, 1);
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
        candidateFileUpdated = true;
        rejected++;
      }
      if (rejectedDecisions.get(row.candidate_id) !== row.fingerprint) {
        rejectedDecisions.set(row.candidate_id, row.fingerprint);
        decisionsUpdated = true;
      }
    }

    const targets = [
      ...pagesToWrite
        .filter((page) => page.changed)
        .map((page) => reviewFileTarget({
          path: page.relPath,
          baseContent: page.existing,
          targetContent: page.content,
        })),
      ...(candidateFileUpdated
        ? [reviewFileTarget({
            path: CANDIDATE_LEDGER_FILE,
            baseContent: candidateLedgerBase,
            targetContent: candidateRecordsContent(nextRows),
          })]
        : []),
      ...(decisionsUpdated
        ? [reviewFileTarget({
            path: REVIEW_DECISIONS_FILE,
            baseContent: rejectedDecisionsBase,
            targetContent: rejectedDecisionsContent(rejectedDecisions),
          })]
        : []),
    ].filter((target): target is IndexerProjectFileTarget => target !== undefined)
      .sort((left, right) => left.path.localeCompare(right.path));
    if (targets.length > 0) {
      await runDurableMultiFileTransaction({
        projectRoot: input.projectRoot,
        kind: "apply-indexer-review",
        proposal_digest: indexerProtocolDigest({
          decisions: [...decisions]
            .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id)),
          targets: targets.map((target) => ({
            path: target.path,
            operation: target.operation,
            target_digest: target.target_digest,
          })),
        }),
        targets,
        ...(input.inject_failure === undefined
          ? {}
          : { inject_failure: input.inject_failure }),
      });
    }
    return {
      applied: decisions.length,
      approved,
      rejected,
      unchanged,
      materialized,
      removed: 0,
      candidateFileUpdated,
      pages,
    };
  });
}
