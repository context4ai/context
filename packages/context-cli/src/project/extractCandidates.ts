import { resolve } from "node:path";
import { DEFAULT_PATH_FILTER, Visibility, type PathFilterConfig } from "@c4a/core";
import type {
  ExtractCustomPhaseDefinition,
  ExtractTsPhaseDefinition,
  RepoProjectSourceDefinition,
} from "@c4a/context";
import {
  detectModuleBoundaries,
  runRepositoryExtraction,
  type ModuleBoundaryResult,
  type RepositoryEntrySelection,
} from "@c4a/extract";
import { TypeScriptPlugin } from "@c4a/extract-ts";
import {
  canonicalSourceRef,
  extractPhaseSourceFingerprint,
  removeCandidateSnapshot,
  readExtractSourceFingerprints,
  readExtractSourceSymbolIndex,
  symbolShapeDigest,
  writeCandidateSnapshot,
  writeCodeCandidateSnapshot,
  writeExtractSourceFingerprint,
  writeExtractSourceSymbolIndex,
} from "./extractCandidateArtifacts.js";
import {
  applyMarkdownTransforms,
  knowledgePath,
  knowledgeTreeFromExamples,
  makeCandidates,
  manifestVersion,
  mergeCandidates,
  renderSymbolMarkdown,
  removalCandidate,
} from "./extractCandidateBuild.js";
import { readApprovedCodegraphPages } from "./codegraphApproved.js";
import { closeProjectWorkspace, readProjectCloseStatus } from "./close.js";
import { applyReviewDecisions } from "./reviewApply.js";
import { candidateIdsHash } from "./reviewShared.js";
import { verifyProjectWorkspace } from "./verify.js";
import type {
  CandidateDraft,
  ExtractAgentHint,
  ExtractTsPhasePreview,
  ExtractTsRunResult,
  SourceSelection,
  SourceSymbolSnapshot,
  ExtractPhaseSourceFingerprintFile,
  ExtractPhaseSourceFingerprintRecord,
  ExtractSourceSymbolIndexEntry,
  ExtractSourceSymbolIndexFile,
} from "./extractCandidateTypes.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  diagnoseRepoSource,
  ensureRepoSource,
  listRepoSources,
} from "./repoSources.js";
import { readCandidateRecords, CANDIDATE_LEDGER_FILE, writeCandidateRecords } from "./candidateLedger.js";
import { readRejectedDecisions, writeRejectedDecisions } from "./reviewDecisions.js";
import { withProjectWriteLock } from "./writeLock.js";

export {
  extractPhaseSourceFingerprint,
  readExtractSourceFingerprints,
  readExtractSourceSymbolIndex,
};
export type {
  ExtractAgentHint,
  ExtractPhaseSourceFingerprintFile,
  ExtractPhaseSourceFingerprintRecord,
  ExtractSourceSymbolIndexEntry,
  ExtractSourceSymbolIndexFile,
  ExtractTsPhasePreview,
  ExtractTsRunResult,
};

function phasePathFilter(phase: ExtractTsPhaseDefinition): PathFilterConfig {
  return {
    ...DEFAULT_PATH_FILTER,
    code: {
      ...DEFAULT_PATH_FILTER.code,
      include: [...phase.include],
    },
  };
}

function phaseEntrySelection(phase: ExtractTsPhaseDefinition): RepositoryEntrySelection {
  if (phase.mode === "scan") return { mode: "scan" };
  if (phase.entries !== undefined) return { mode: "configured", entries: phase.entries };
  return { mode: "auto" };
}

function moduleErrorHint(input: {
  sourceName: string;
  modulePath: string;
  error: string;
}): ExtractAgentHint {
  return {
    code: "extract-module-error",
    severity: "warning",
    message: `Module ${input.sourceName}:${input.modulePath} was skipped: ${input.error}`,
    command: `context source inspect ${input.sourceName}`,
  };
}

async function selectRepoSourcesForDefinition(input: {
  projectRoot: string;
  source: RepoProjectSourceDefinition;
  materialize: boolean;
}): Promise<SourceSelection[]> {
  if (input.source.kind === "source.repo") {
    const status = input.materialize
      ? await ensureRepoSource({ projectRoot: input.projectRoot, source: input.source })
      : await diagnoseRepoSource({ projectRoot: input.projectRoot, source: input.source });
    return [{ record: input.source, status }];
  }

  const records = await listRepoSources(input.projectRoot);
  const selected = input.source.kind === "source.collection"
    ? records
    : (() => {
        const requestedSource = input.source;
        return records.filter((source) => source.name === requestedSource.name || source.id === requestedSource.name);
      })();

  if (input.source.kind === "source.collection" && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, "no repo sources are registered for extraction", {
      category: ErrorCategory.SourceNotFound,
      sourceType: input.source.type,
      code: "repo-source-registration-required",
      next: "context status --format json",
    });
  }

  if (input.source.kind === "source.ref" && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `repo source is not registered: ${input.source.name}`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: input.source.name,
    });
  }

  return Promise.all(selected.map(async (record) => ({
    record,
    status: input.materialize
      ? await ensureRepoSource({ projectRoot: input.projectRoot, source: record })
      : await diagnoseRepoSource({ projectRoot: input.projectRoot, source: record }),
  })));
}

export async function selectRepoSourcesForExtraction(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition;
  materialize: boolean;
}): Promise<SourceSelection[]> {
  const definitions = input.phase.kind === "phase.extract.ts"
    ? [input.phase.source]
    : input.phase.sources;
  const selected = (await Promise.all(definitions.map((source) => selectRepoSourcesForDefinition({
    projectRoot: input.projectRoot,
    source,
    materialize: input.materialize,
  })))).flat();
  return [...new Map(selected.map((source) => [source.record.name, source])).values()]
    .sort((left, right) => left.record.name.localeCompare(right.record.name));
}

export async function selectRepoSources(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition;
  materialize: boolean;
}): Promise<SourceSelection[]> {
  return selectRepoSourcesForExtraction(input);
}

function assertReadySources(sources: readonly SourceSelection[]): void {
  const notReady = sources.filter((source) => !source.status.ready);
  if (notReady.length > 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, "repo source is not ready for extraction", {
      category: ErrorCategory.WorkspaceStateInvalid,
      sources: notReady.map((source) => ({
        name: source.record.name,
        diagnostics: source.status.diagnostics,
        agent_hints: source.status.agent_hints,
      })),
    });
  }
}

async function inspectSourceModules(input: {
  projectRoot: string;
  source: SourceSelection;
}): Promise<{
  source: SourceSelection;
  modules: ModuleBoundaryResult[];
}> {
  const repoPath = resolve(input.projectRoot, input.source.status.materializedAt);
  return {
    source: input.source,
    modules: await detectModuleBoundaries(
      repoPath,
      input.source.status.head ?? input.source.status.ref,
      DEFAULT_PATH_FILTER,
    ),
  };
}

async function assertSingleModuleSourceBoundaries(input: {
  projectRoot: string;
  sources: readonly SourceSelection[];
}): Promise<void> {
  const inspections = await Promise.all(input.sources.map((source) => inspectSourceModules({
    projectRoot: input.projectRoot,
    source,
  })));
  const ambiguous = inspections.filter((inspection) => inspection.modules.length > 1);
  if (ambiguous.length === 0) return;

  throw new ContextError(
    ExitCode.UserError,
    "repo source contains multiple code modules; register the intended package or subdirectory as its own source before extraction",
    {
      category: ErrorCategory.UserInputInvalid,
      code: "extract-source-scope-ambiguous",
      sources: ambiguous.map((inspection) => ({
        name: inspection.source.record.name,
        materializedAt: inspection.source.status.materializedAt,
        modules: inspection.modules.map((module) => ({
          name: module.name,
          path: module.path,
        })),
      })),
      next: "context status --format json",
    },
  );
}

export async function previewExtractTsPhase(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition;
}): Promise<ExtractTsPhasePreview> {
  const selectedSources = await selectRepoSources({
    projectRoot: input.projectRoot,
    phase: input.phase,
    materialize: false,
  });
  assertReadySources(selectedSources);
  await assertSingleModuleSourceBoundaries({
    projectRoot: input.projectRoot,
    sources: selectedSources,
  });

  const sources: ExtractTsPhasePreview["sources"] = [];
  const agentHints: ExtractAgentHint[] = [];
  const knowledgePathExamples: ExtractTsPhasePreview["knowledgePathExamples"] = [];
  let totalModules = 0;
  let totalFiles = 0;
  let totalAnalyzedFiles = 0;
  let totalSkippedFiles = 0;
  let totalSymbols = 0;
  let totalRelations = 0;
  let totalCandidateEstimate = 0;
  let totalModuleErrors = 0;

  for (const source of selectedSources) {
    const repoPath = resolve(input.projectRoot, source.status.materializedAt);
    const extraction = await runRepositoryExtraction({
      repoPath,
      commitHash: source.status.head ?? source.status.ref,
      pathFilter: phasePathFilter(input.phase),
      entrySelection: phaseEntrySelection(input.phase),
      plugins: [new TypeScriptPlugin()],
    });
    const { candidates } = makeCandidates({
      phase: input.phase,
      extraction,
      source: source.record,
    });
    for (const candidate of candidates.slice(0, Math.max(0, 8 - knowledgePathExamples.length))) {
      knowledgePathExamples.push({
        id: candidate.candidate_id,
        title: candidate.review.title,
        kind: candidate.kind,
        source: source.record.name,
        module: candidate.module,
        path: knowledgePath(input.phase.collection, candidate),
        source_ref: candidate.source_refs[0] ?? "",
      });
    }
    const modules = extraction.results.map((result) => {
      const version = manifestVersion(result.sourceInfo.manifests);
      const selectedSymbols = result.extraction.symbols.filter((symbol) =>
        !input.phase.exportedOnly || symbol.visibility === Visibility.Exported
      );
      const candidateKinds = selectedSymbols.reduce<Record<string, number>>((counts, symbol) => {
        counts[symbol.kind] = (counts[symbol.kind] ?? 0) + 1;
        return counts;
      }, {});
      const exportedSymbols = result.extraction.symbols.filter(
        (symbol) => symbol.visibility === Visibility.Exported,
      ).length;
      const candidateEstimate = selectedSymbols.length;
      totalModules += 1;
      totalFiles += result.module.fileCount;
      totalAnalyzedFiles += result.extraction.stats.files;
      const skippedFiles = Math.max(0, result.module.fileCount - result.extraction.stats.files);
      totalSkippedFiles += skippedFiles;
      totalSymbols += result.extraction.symbols.length;
      totalRelations += result.extraction.relations.length;
      totalCandidateEstimate += candidateEstimate;
      return {
        name: result.module.name,
        path: result.module.path,
        ...(version !== undefined ? { version } : {}),
        files: result.module.fileCount,
        discoveredFiles: result.module.fileCount,
        analyzedFiles: result.extraction.stats.files,
        skippedFiles,
        skippedReasons: skippedFiles > 0
          ? ["not reachable from the selected export entries"]
          : [],
        entryFiles: result.entryDetection.entries.map((entry) => entry.path).sort(),
        totalLines: result.module.totalLines,
        symbols: result.extraction.symbols.length,
        exportedSymbols,
        internalSymbols: result.extraction.symbols.length - exportedSymbols,
        candidateKinds,
        relations: result.extraction.relations.length,
        candidateEstimate,
      };
    });
    const moduleErrors = extraction.moduleErrors.map((error) => {
      const hint = moduleErrorHint({
        sourceName: source.record.name,
        modulePath: error.module_path,
        error: error.error,
      });
      agentHints.push(hint);
      return {
        module_path: error.module_path,
        error: error.error,
      };
    });
    totalModuleErrors += moduleErrors.length;
    sources.push({
      name: source.record.name,
      ref: source.record.git.ref,
      ...(source.status.head !== undefined ? { head: source.status.head } : {}),
      scopeHash: source.status.scopeHash ?? "unknown",
      materializedAt: source.status.materializedAt,
      modules,
      moduleErrors,
    });
  }

  return {
    phaseId: input.phase.id,
    collection: input.phase.collection,
    include: [...input.phase.include],
    mode: input.phase.mode,
    ...(input.phase.entries !== undefined ? { entries: [...input.phase.entries] } : {}),
    exportedOnly: input.phase.exportedOnly,
    knowledgeTree: knowledgeTreeFromExamples(input.phase.collection, knowledgePathExamples),
    knowledgePathExamples,
    sources,
    totals: {
      sources: selectedSources.length,
      modules: totalModules,
      files: totalFiles,
      discoveredFiles: totalFiles,
      analyzedFiles: totalAnalyzedFiles,
      skippedFiles: totalSkippedFiles,
      symbols: totalSymbols,
      relations: totalRelations,
      candidateEstimate: totalCandidateEstimate,
      moduleErrors: totalModuleErrors,
    },
    agent_hints: agentHints,
  };
}

export async function runExtractTsPhase(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition;
  runId: string;
  autoPromote?: boolean;
}): Promise<ExtractTsRunResult> {
  const selectedSources = await selectRepoSources({
    projectRoot: input.projectRoot,
    phase: input.phase,
    materialize: true,
  });
  assertReadySources(selectedSources);
  await assertSingleModuleSourceBoundaries({
    projectRoot: input.projectRoot,
    sources: selectedSources,
  });
  const sourceFingerprint = extractPhaseSourceFingerprint({
    phase: input.phase,
    sources: selectedSources,
  });
  const previousFingerprint = (await readExtractSourceFingerprints(input.projectRoot)).phases[input.phase.id];
  const sourceState = previousFingerprint === undefined
    ? "first-run" as const
    : previousFingerprint.fingerprint === sourceFingerprint.fingerprint
      ? "unchanged" as const
      : "changed" as const;

  const now = new Date().toISOString();
  const allCandidates: CandidateDraft[] = [];
  const snapshots: SourceSymbolSnapshot[] = [];
  const sourceSymbolIndex: ExtractSourceSymbolIndexEntry[] = [];
  const moduleErrors: ExtractTsRunResult["moduleErrors"] = [];
  const agentHints: ExtractAgentHint[] = [];
  let modules = 0;
  let extractedSymbols = 0;
  const relationships: ExtractTsRunResult["relationships"] = {
    mode: "source-backed-ast",
    detected: 0,
    emitted: 0,
    omitted: {
      external: 0,
      endpointNotSelected: 0,
      ambiguousEndpoint: 0,
    },
  };

  for (const source of selectedSources) {
    const repoPath = resolve(input.projectRoot, source.status.materializedAt);
    const extraction = await runRepositoryExtraction({
      repoPath,
      commitHash: source.status.head ?? source.status.ref,
      pathFilter: phasePathFilter(input.phase),
      entrySelection: phaseEntrySelection(input.phase),
      plugins: [new TypeScriptPlugin()],
    });
    modules += extraction.results.length;
    for (const error of extraction.moduleErrors) {
      moduleErrors.push({
        source: source.record.name,
        module_path: error.module_path,
        error: error.error,
      });
      agentHints.push(moduleErrorHint({
        sourceName: source.record.name,
        modulePath: error.module_path,
        error: error.error,
      }));
    }
    for (const result of extraction.results) {
      extractedSymbols += result.extraction.symbols.length;
    }
    const sourceBuild = makeCandidates({
      phase: input.phase,
      extraction,
      source: source.record,
    });
    const sourceCandidates = sourceBuild.candidates;
    relationships.detected += sourceBuild.relationships.detected;
    relationships.emitted += sourceBuild.relationships.emitted;
    relationships.omitted.external += sourceBuild.relationships.omitted.external;
    relationships.omitted.endpointNotSelected +=
      sourceBuild.relationships.omitted.endpointNotSelected;
    relationships.omitted.ambiguousEndpoint +=
      sourceBuild.relationships.omitted.ambiguousEndpoint;
    allCandidates.push(...sourceCandidates);

    const candidateBySourceRef = new Map(sourceCandidates.map((candidate) => [candidate.source_refs[0], candidate]));
    for (const result of extraction.results) {
      for (const symbol of result.extraction.symbols) {
        const candidate = candidateBySourceRef.get(canonicalSourceRef(source.record.name, symbol));
        if (!candidate) continue;
        sourceSymbolIndex.push({
          source: source.record.name,
          file: symbol.file,
          name: symbol.name,
          kind: symbol.kind,
          digest: symbolShapeDigest(symbol),
        });
        snapshots.push({
          candidate,
          source: source.record,
          symbol,
          markdown: applyMarkdownTransforms(renderSymbolMarkdown(symbol), input.phase),
        });
      }
    }
  }

  const sourceNames = new Set(selectedSources.map((source) => source.record.name));
  const approvedPages = await readApprovedCodegraphPages({ projectRoot: input.projectRoot, sourceNames });
  const approvedById = new Map(approvedPages.map((page) => [page.candidateId, page]));
  const currentCandidateIds = new Set(allCandidates.map((candidate) => candidate.candidate_id));
  const removalCandidates = approvedPages
    .filter((page) => !currentCandidateIds.has(page.candidateId))
    .map(removalCandidate);
  allCandidates.push(...removalCandidates);
  const merged = await withProjectWriteLock(input.projectRoot, "extract-candidates", async () => {
    const existing = await readCandidateRecords(input.projectRoot);
    const rejectedDecisions = await readRejectedDecisions(input.projectRoot);
    const mergeResult = mergeCandidates({
      existing,
      candidates: allCandidates,
      approvedById,
      rejectedDecisions,
      sourceNames,
      collection: input.phase.collection,
      now,
    });
    for (const candidateId of mergeResult.decisionsToRemove) rejectedDecisions.delete(candidateId);
    await writeCandidateRecords(input.projectRoot, mergeResult.rows);
    if (mergeResult.decisionsToRemove.length > 0) {
      await writeRejectedDecisions(input.projectRoot, rejectedDecisions);
    }
    await Promise.all(mergeResult.snapshotCleanupIds.map((id) => removeCandidateSnapshot(input.projectRoot, id)));
    const skippedSnapshotIds = new Set([
      ...mergeResult.skippedApprovedIds,
      ...mergeResult.skippedRejectedIds,
    ]);
    for (const snapshot of snapshots) {
      if (skippedSnapshotIds.has(snapshot.candidate.candidate_id)) continue;
      await writeCandidateSnapshot({
        projectRoot: input.projectRoot,
        candidate: snapshot.candidate,
        source: snapshot.source,
        symbol: snapshot.symbol,
        markdown: snapshot.markdown,
        runId: input.runId,
        phaseFingerprint: sourceFingerprint,
      });
    }
    for (const candidate of removalCandidates) {
      await writeCodeCandidateSnapshot({
        projectRoot: input.projectRoot,
        candidate,
        sourceName: candidate.source_refs[0]?.slice(5).split("#", 1)[0] ?? "unknown",
        markdown: `# Remove ${candidate.review.title}\n\nThe approved symbol is no longer present in the current code extraction.\n`,
        runId: input.runId,
        phaseFingerprint: sourceFingerprint,
      });
    }
    await writeExtractSourceFingerprint({
      projectRoot: input.projectRoot,
      record: sourceFingerprint,
    });
    await writeExtractSourceSymbolIndex({
      projectRoot: input.projectRoot,
      phaseFingerprint: sourceFingerprint,
      sourceNames,
      symbols: sourceSymbolIndex,
    });
    return mergeResult;
  });

  const codegraphRows = (await readCandidateRecords(input.projectRoot))
    .filter((row) => row.collection === "codegraph" && row.status === "draft");
  const selectedRows = codegraphRows.filter((row) => row.source_refs.some((ref) =>
    [...sourceNames].some((sourceName) => ref.startsWith(`repo:${sourceName}#`))
  ));
  let autoPromotion: ExtractTsRunResult["autoPromotion"];
  if (input.autoPromote === true) {
    if (selectedRows.length !== codegraphRows.length) {
      throw new ContextError(ExitCode.WorkspaceStateError, "codegraph auto-promotion cannot include drafts from another source scope", {
        category: ErrorCategory.WorkspaceStateInvalid,
        phaseId: input.phase.id,
        unrelated_candidates: codegraphRows
          .filter((row) => !selectedRows.includes(row))
          .map((row) => row.candidate_id),
        next: "Review or reject the unrelated codegraph drafts before rerunning --auto-promote.",
      });
    }
    const ids = selectedRows.map((row) => row.candidate_id).sort();
    const applied = ids.length === 0
      ? { applied: 0, approved: 0, rejected: 0, unchanged: 0, materialized: 0, removed: 0, candidateFileUpdated: false, pages: [] }
      : await applyReviewDecisions({
          projectRoot: input.projectRoot,
          payload: {
            collection: "codegraph",
            default: "approved",
            decisions: [],
            scope: { kind: "collection", collection: "codegraph", count: ids.length, ids_sha256: candidateIdsHash(ids) },
          },
        });
    const closeStatus = await readProjectCloseStatus(input.projectRoot);
    let close: NonNullable<ExtractTsRunResult["autoPromotion"]>["close"] = "not-required";
    if (closeStatus.inputHash !== undefined) {
      if (closeStatus.state === "ready") {
        close = "current";
      } else {
        await closeProjectWorkspace(input.projectRoot);
        close = "refreshed";
      }
    }
    const verified = await verifyProjectWorkspace(input.projectRoot);
    if (!verified.ok) {
      throw new ContextError(ExitCode.WorkspaceStateError, "codegraph auto-promotion failed project verification", {
        category: ErrorCategory.WorkspaceStateInvalid,
        phaseId: input.phase.id,
        issues: verified.issues,
        next: "Fix the reported deterministic verification errors, then rerun the codegraph phase with --auto-promote.",
      });
    }
    autoPromotion = {
      applied: applied.approved,
      materialized: applied.materialized,
      removed: applied.removed,
      close,
      verify: "passed",
    };
  }

  const pendingCandidates = input.autoPromote === true ? 0 : selectedRows.length;
  const changeCounts = {
    added: allCandidates.filter((candidate) => !approvedById.has(candidate.candidate_id) && candidate.change !== "remove").length,
    updated: allCandidates.filter((candidate) => approvedById.has(candidate.candidate_id) && candidate.change !== "remove" && approvedById.get(candidate.candidate_id)?.candidateFingerprint !== candidate.fingerprint).length,
    removed: removalCandidates.length,
    unchangedApproved: merged.skippedApproved,
  };

  return {
    phaseId: input.phase.id,
    collection: input.phase.collection,
    sources: [...sourceNames],
    modules,
    extractedSymbols,
    relationships,
    candidates: {
      produced: allCandidates.length,
      added: merged.added,
      updated: merged.updated,
      unchanged: merged.unchanged,
      removed: merged.removed,
      skippedApproved: merged.skippedApproved,
      skippedRejected: merged.skippedRejected,
    },
    changes: changeCounts,
    review: {
      required: pendingCandidates > 0,
      pendingCandidates,
    },
    execution: {
      policy: input.autoPromote === true ? "auto-promote" : "review",
      sourceState,
    },
    next_action: pendingCandidates > 0
      ? {
          kind: "continue-codegraph-batch",
          command: "context status --format json",
          message: sourceState === "first-run"
            ? "This module produced first-run candidates. Context status will continue any remaining extract phases before opening one batch Review."
            : "This module produced codegraph deltas. Context status will continue any remaining extract phases before opening one batch Review; unchanged approved symbols were preserved.",
        }
      : {
          kind: "continue-automatically",
          command: "context status --format json",
          message: input.autoPromote === true
            ? "Codegraph deltas were automatically applied and verified; no human review gate remains."
            : "No codegraph delta requires review; continue automatically.",
        },
    ...(autoPromotion !== undefined ? { autoPromotion } : {}),
    moduleErrors,
    agent_hints: agentHints,
    candidateFile: CANDIDATE_LEDGER_FILE,
  };
}
