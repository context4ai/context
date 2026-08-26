import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { AlignPayload } from "./proseAlignTypes.js";
import { STRUCTURE_FILE } from "./proseCompileConstants.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { parseFrontmatterLoose, isDeprecatedApprovedMarkdown } from "./verifyFrontmatter.js";
import { isKnowledgeAssetPath, walkApprovedMarkdown } from "./verifyProjectFiles.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  activeStructureSlots,
  readStructureSnapshotPayload,
} from "./proseStructureStore.js";
import { readSourceStatus } from "./statusReaders.js";
import { workspaceRouteReevaluation } from "./workflow/workflowReceipt.js";
import {
  approvedStructureSourceInputKey,
  readApprovedStructureSourceInputs,
} from "./approvedStructureInputs.js";
import { readReviewPathIdentityConflicts } from "./reviewIdentityConflicts.js";
import {
  hydrateApprovedKnowledgeMarkdown,
  readApprovedKnowledgeMetadataIndex,
} from "./approvedKnowledgeMetadata.js";

export interface ProseCompileBatchProgress {
  collection: string;
  structureDigest: string;
  structureDigests: string[];
  missingStructureDigests: string[];
  plannedViewRefs: string[];
  draftViewRefs: string[];
  approvedViewRefs: string[];
  rejectedViewRefs: string[];
  staleViewRefs: string[];
  staleSourceKeys: string[];
  remainingViewRefs: string[];
  /** Sources whose current confirmed structure still has draft or uncompiled views. */
  replacementSourceKeys?: string[];
  nextViewRef?: string;
  nextSourceKeys?: string[];
  nextCollection?: string;
  nextPhaseCollection?: string;
  nextStructureCollections?: string[];
  readyForReview: boolean;
  complete: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string | undefined {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

async function readConfirmedStructure(projectRoot: string): Promise<AlignPayload | undefined> {
  const path = join(projectRoot, STRUCTURE_FILE);
  if (!existsSync(path)) return undefined;
  const parsed = YAML.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.lifecycle)) return undefined;
  if (parsed.lifecycle.state !== "confirmed" && parsed.lifecycle.state !== "frozen") return undefined;
  const structureDigest = stringField(parsed.lifecycle, "structure_digest");
  if (!Array.isArray(parsed.views) || structureDigest === undefined) return undefined;
  return { ...parsed, structure_digest: structureDigest } as unknown as AlignPayload;
}

interface ApprovedViewRef {
  viewRef: string;
  structureDigest?: string;
}

async function readCurrentSnapshotHashes(projectRoot: string): Promise<Map<string, string>> {
  const { documentSources } = await readSourceStatus(projectRoot);
  return new Map(documentSources.flatMap((source) =>
    source.snapshotReady && source.snapshotHash !== undefined
      ? [[`${source.type}:${source.name}`, source.snapshotHash] as const]
      : []
  ));
}

async function approvedViewRefs(
  projectRoot: string,
  planned: ReadonlySet<string>,
): Promise<ApprovedViewRef[]> {
  const approved: ApprovedViewRef[] = [];
  const metadata = await readApprovedKnowledgeMetadataIndex(projectRoot);
  for (const file of await walkApprovedMarkdown(join(projectRoot, "knowledge"))) {
    if (isKnowledgeAssetPath(file.relPath)) continue;
    const rawContent = await readFile(file.absPath, "utf8");
    if (isDeprecatedApprovedMarkdown(rawContent)) continue;
    const content = hydrateApprovedKnowledgeMarkdown({
      content: rawContent,
      relPath: file.relPath,
      metadata,
    });
    const frontmatter = parseFrontmatterLoose(content);
    const viewRef = stringField(frontmatter, "view_ref");
    if (viewRef === undefined || !planned.has(viewRef)) continue;
    const structureDigest = stringField(frontmatter, "structure_digest");
    approved.push({
      viewRef,
      ...(structureDigest === undefined ? {} : { structureDigest }),
    });
  }
  return approved;
}

async function compatibleApprovedViewRefs(input: {
  projectRoot: string;
  structure: AlignPayload;
  approved: readonly ApprovedViewRef[];
}): Promise<Set<string>> {
  const approvedInputs = new Map(
    (await readApprovedStructureSourceInputs(input.projectRoot)).map((item) => [
      approvedStructureSourceInputKey(item),
      item.snapshot_hash,
    ]),
  );
  return new Set(input.approved.flatMap((item) => {
    if (item.structureDigest === input.structure.structure_digest) return [item.viewRef];
    const view = input.structure.views.find((candidate) => candidate.view_ref === item.viewRef);
    if (view === undefined) return [];
    const snapshotHashes = input.structure.sources.map((source) =>
      approvedInputs.get(approvedStructureSourceInputKey({
        source,
        collection: view.collection,
      }))
    );
    const hasRecordedInput = snapshotHashes.some((value) => value !== undefined);
    const inputsCurrent = snapshotHashes.every((value) =>
      value === input.structure.evidence_snapshot_hash
    );
    return inputsCurrent || (!hasRecordedInput && item.structureDigest === undefined)
      ? [item.viewRef]
      : [];
  }));
}

export async function readProseCompileBatchProgress(input: {
  projectRoot: string;
  collection?: string;
  structure?: AlignPayload;
  recompileViewRefs?: ReadonlySet<string>;
  currentSnapshotHashes?: ReadonlyMap<string, string>;
}): Promise<ProseCompileBatchProgress | undefined> {
  const currentSnapshotHashes = input.currentSnapshotHashes ?? await readCurrentSnapshotHashes(input.projectRoot);
  const allRows = await readCandidateRecords(input.projectRoot);
  if (input.structure !== undefined) {
    return progressForStructure({ ...input, currentSnapshotHashes, structure: input.structure, allRows });
  }
  const active = await readConfirmedStructure(input.projectRoot);
  const proseRows = allRows.filter((row) =>
    row.candidate_type === "prose-align" &&
    (input.collection === undefined || row.collection === input.collection)
  );
  const activeSlots = await activeStructureSlots(input.projectRoot, input.collection);
  const activeDigests = new Set(activeSlots.map((slot) => slot.structureDigest));
  const requestedDigests = [...new Set([
    ...activeDigests,
    ...proseRows
      .map((row) => row.structure_digest)
      .filter((digest): digest is string => digest !== undefined),
  ])];
  const structures = new Map<string, AlignPayload>();
  if (active !== undefined) structures.set(active.structure_digest, active);
  for (const structureDigest of requestedDigests) {
    if (structures.has(structureDigest)) continue;
    const snapshot = await readStructureSnapshotPayload(input.projectRoot, structureDigest);
    if (snapshot !== undefined) structures.set(structureDigest, snapshot);
  }
  const progresses = (await Promise.all([...structures.values()].map((structure) => {
    const supersededDraftExists = activeDigests.has(structure.structure_digest) && proseRows.some((row) =>
      row.status === "draft" &&
      row.structure_digest !== structure.structure_digest &&
      row.source !== undefined &&
      structure.sources.includes(`${row.source.type}:${row.source.name}`) &&
      structure.views.some((view) => view.collection === row.collection)
    );
    const recompileViewRefs = new Set(input.recompileViewRefs ?? []);
    if (supersededDraftExists) {
      for (const view of structure.views) {
        if (input.collection === undefined || view.collection === input.collection) {
          recompileViewRefs.add(view.view_ref);
        }
      }
    }
    return progressForStructure({
      ...input,
      currentSnapshotHashes,
      structure,
      allRows,
      recompileViewRefs,
    });
  }))).filter((progress): progress is ProseCompileBatchProgress => progress !== undefined);
  const missingStructureDigests = requestedDigests.filter((digest) => !structures.has(digest));
  if (progresses.length === 0 && proseRows.length === 0) return undefined;
  return mergeBatchProgress({
    collection: input.collection ?? "all",
    progresses,
    missingStructureDigests,
    missingRows: proseRows.filter((row) =>
      row.structure_digest !== undefined && missingStructureDigests.includes(row.structure_digest)
    ),
  });
}

async function progressForStructure(input: {
  projectRoot: string;
  collection?: string;
  structure: AlignPayload;
  allRows: Awaited<ReturnType<typeof readCandidateRecords>>;
  recompileViewRefs?: ReadonlySet<string>;
  currentSnapshotHashes: ReadonlyMap<string, string>;
}): Promise<ProseCompileBatchProgress | undefined> {
  const structure = input.structure;
  const plannedViewRefs = structure.views
    .filter((view) => input.collection === undefined || view.collection === input.collection)
    .map((view) => view.view_ref);
  if (plannedViewRefs.length === 0) return undefined;

  const planned = new Set(plannedViewRefs);
  const rows = input.allRows.filter((row) =>
    row.candidate_type === "prose-align" &&
    (input.collection === undefined || row.collection === input.collection) &&
    row.structure_digest === structure.structure_digest &&
    planned.has(row.view_ref)
  );
  const currentRows = rows.filter((row) => {
    if (row.source?.snapshot_hash === undefined) return false;
    const sourceKey = `${row.source.type}:${row.source.name}`;
    return row.source.snapshot_hash === structure.evidence_snapshot_hash &&
      row.source.snapshot_hash === input.currentSnapshotHashes.get(sourceKey);
  });
  const currentRowSet = new Set(currentRows);
  const staleRows = rows.filter((row) => !currentRowSet.has(row));
  const drafts = new Set(currentRows.filter((row) => row.status === "draft").map((row) => row.view_ref));
  const rejected = new Set(currentRows.filter((row) => row.status === "rejected").map((row) => row.view_ref));
  const approvedRows = await approvedViewRefs(input.projectRoot, planned);
  const approved = new Set(await compatibleApprovedViewRefs({
    projectRoot: input.projectRoot,
    structure,
    approved: approvedRows,
  }));
  const prepared = new Set([
    ...drafts,
    ...[...approved].filter((viewRef) => !input.recompileViewRefs?.has(viewRef)),
    ...rejected,
  ]);
  const remainingViewRefs = plannedViewRefs.filter((viewRef) => !prepared.has(viewRef));
  const nextViewRef = remainingViewRefs[0];
  const nextView = nextViewRef === undefined
    ? undefined
    : structure.views.find((view) => view.view_ref === nextViewRef);
  return {
    collection: input.collection ?? "all",
    structureDigest: structure.structure_digest,
    structureDigests: [structure.structure_digest],
    missingStructureDigests: [],
    plannedViewRefs,
    draftViewRefs: plannedViewRefs.filter((viewRef) => drafts.has(viewRef)),
    approvedViewRefs: plannedViewRefs.filter((viewRef) => approved.has(viewRef)),
    rejectedViewRefs: plannedViewRefs.filter((viewRef) => rejected.has(viewRef)),
    staleViewRefs: unique(staleRows.map((row) => row.view_ref)),
    staleSourceKeys: unique(staleRows.flatMap((row) =>
      row.source === undefined ? [] : [`${row.source.type}:${row.source.name}`]
    )),
    remainingViewRefs,
    replacementSourceKeys: drafts.size > 0 || remainingViewRefs.length > 0
      ? [...structure.sources]
      : [],
    ...(nextViewRef !== undefined ? { nextViewRef } : {}),
    ...(nextViewRef !== undefined ? { nextSourceKeys: [...structure.sources] } : {}),
    ...(nextView !== undefined ? { nextCollection: nextView.collection } : {}),
    ...(nextViewRef !== undefined && structure.lifecycle.phase_collection !== undefined
      ? { nextPhaseCollection: structure.lifecycle.phase_collection }
      : {}),
    ...(nextViewRef !== undefined
      ? { nextStructureCollections: unique(structure.views.map((view) => view.collection)) }
      : {}),
    readyForReview: remainingViewRefs.length === 0 && drafts.size > 0,
    complete: remainingViewRefs.length === 0 && drafts.size === 0,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function mergeBatchProgress(input: {
  collection: string;
  progresses: readonly ProseCompileBatchProgress[];
  missingStructureDigests: string[];
  missingRows: Awaited<ReturnType<typeof readCandidateRecords>>;
}): ProseCompileBatchProgress {
  const plannedViewRefs = unique([
    ...input.progresses.flatMap((progress) => progress.plannedViewRefs),
    ...input.missingRows.map((row) => row.view_ref),
  ]);
  const draftViewRefs = unique([
    ...input.progresses.flatMap((progress) => progress.draftViewRefs),
    ...input.missingRows.filter((row) => row.status === "draft").map((row) => row.view_ref),
  ]);
  const approvedViewRefs = unique(input.progresses.flatMap((progress) => progress.approvedViewRefs));
  const rejectedViewRefs = unique([
    ...input.progresses.flatMap((progress) => progress.rejectedViewRefs),
    ...input.missingRows.filter((row) => row.status === "rejected").map((row) => row.view_ref),
  ]);
  const staleViewRefs = unique(input.progresses.flatMap((progress) => progress.staleViewRefs));
  const staleSourceKeys = unique(input.progresses.flatMap((progress) => progress.staleSourceKeys));
  const remainingViewRefs = unique(input.progresses.flatMap((progress) => progress.remainingViewRefs));
  const replacementSourceKeys = unique(
    input.progresses.flatMap((progress) => progress.replacementSourceKeys ?? []),
  );
  const structureDigests = unique([
    ...input.progresses.flatMap((progress) => progress.structureDigests),
    ...input.missingStructureDigests,
  ]);
  const nextProgress = input.progresses.find((progress) => progress.nextViewRef !== undefined);
  const nextViewRef = nextProgress?.nextViewRef;
  return {
    collection: input.collection,
    structureDigest: structureDigests.length === 1 ? structureDigests[0]! : "multiple",
    structureDigests,
    missingStructureDigests: input.missingStructureDigests,
    plannedViewRefs,
    draftViewRefs,
    approvedViewRefs,
    rejectedViewRefs,
    staleViewRefs,
    staleSourceKeys,
    remainingViewRefs,
    replacementSourceKeys,
    ...(nextViewRef !== undefined ? { nextViewRef } : {}),
    ...(nextProgress?.nextSourceKeys !== undefined ? { nextSourceKeys: nextProgress.nextSourceKeys } : {}),
    ...(nextProgress?.nextCollection !== undefined ? { nextCollection: nextProgress.nextCollection } : {}),
    ...(nextProgress?.nextPhaseCollection !== undefined
      ? { nextPhaseCollection: nextProgress.nextPhaseCollection }
      : {}),
    ...(nextProgress?.nextStructureCollections !== undefined
      ? { nextStructureCollections: nextProgress.nextStructureCollections }
      : {}),
    readyForReview: input.missingStructureDigests.length === 0 && remainingViewRefs.length === 0 && draftViewRefs.length > 0,
    complete: input.missingStructureDigests.length === 0 &&
      remainingViewRefs.length === 0 &&
      draftViewRefs.length === 0,
  };
}

export async function assertProseCompileBatchReadyForReview(input: {
  projectRoot: string;
  collections: readonly string[];
}): Promise<void> {
  const currentSnapshotHashes = await readCurrentSnapshotHashes(input.projectRoot);
  for (const collection of input.collections) {
    const progress = await readProseCompileBatchProgress({
      projectRoot: input.projectRoot,
      collection,
      currentSnapshotHashes,
    });
    if (progress !== undefined && progress.missingStructureDigests.length > 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, "review is blocked because candidate structure snapshots are missing", {
        category: ErrorCategory.WorkspaceStateInvalid,
        collection,
        missing_structure_digests: progress.missingStructureDigests,
        next: "Rerun alignProse and confirm each affected source structure. Reuse existing decisions only when the regenerated structure digest and candidate fingerprints are unchanged.",
      });
    }
    if (progress !== undefined && progress.staleViewRefs.length > 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, "review is blocked because prose candidates target an older source snapshot", {
        category: ErrorCategory.WorkspaceStateInvalid,
        collection,
        stale_views: progress.staleViewRefs,
        stale_sources: progress.staleSourceKeys,
        next: "Run context status --format json and follow the returned align/compile recovery route before reusing Review decisions.",
      });
    }
    if (progress === undefined || progress.remainingViewRefs.length === 0) continue;
    const nextViewRef = progress.nextViewRef!;
    throw new ContextError(ExitCode.WorkspaceStateError, "review is blocked until the confirmed compile batch is prepared", {
      category: ErrorCategory.WorkspaceStateInvalid,
      collection,
      planned: progress.plannedViewRefs.length,
      prepared: progress.plannedViewRefs.length - progress.remainingViewRefs.length,
      remaining: progress.remainingViewRefs,
      next: `Continue compile for ${nextViewRef}, then open one Review after every planned view is prepared. Run context status --format json for the exact command.`,
    });
  }

  const identityConflicts = await readReviewPathIdentityConflicts(input.projectRoot);
  const conflicts = identityConflicts.conflicts.filter((conflict) =>
    input.collections.includes(conflict.collection)
  );
  if (conflicts.length > 0) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "review is blocked because candidate paths conflict with approved knowledge identities",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        code: "review-path-identity-conflict",
        count: conflicts.length,
        source_keys: [...new Set(conflicts.map((conflict) => conflict.sourceKey))].sort(),
        conflicts,
        next: "Run context status --format json and follow the identity-coordination route. Preserve the approved identity and path before Review; an explicit identity or path migration requires separate authorization.",
      },
    );
  }
}

export function proseCompileBatchNextAction(input: {
  phaseId: string;
  progress: ProseCompileBatchProgress;
}): Record<string, unknown> {
  if (input.progress.nextViewRef !== undefined) {
    return {
      kind: "reevaluate_workspace",
      command: "context status --format json",
      message: `Route the remaining ${input.progress.remainingViewRefs.length} view(s) to their owning compile phase.`,
      batch: {
        planned: input.progress.plannedViewRefs.length,
        prepared: input.progress.plannedViewRefs.length - input.progress.remainingViewRefs.length,
        remaining: input.progress.remainingViewRefs.length,
      },
    };
  }
  return {
    ...workspaceRouteReevaluation(input.phaseId),
    batch: {
      planned: input.progress.plannedViewRefs.length,
      draft: input.progress.draftViewRefs.length,
      approved: input.progress.approvedViewRefs.length,
      rejected: input.progress.rejectedViewRefs.length,
    },
  };
}
