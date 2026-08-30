import { resolve } from "node:path";
import { DEFAULT_PATH_FILTER, Visibility, type PathFilterConfig } from "@c4a/core";
import type { ExtractTsPhaseDefinition } from "@c4a/context";
import {
  runRepositoryExtraction,
  type RepositoryEntrySelection,
  type RepositoryExtractionResult,
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
  ExtractTsPreparedRun,
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
import { readCandidateRecords, CANDIDATE_LEDGER_FILE, writeCandidateRecords } from "./candidateLedger.js";
import { readRejectedDecisions, writeRejectedDecisions } from "./reviewDecisions.js";
import { withProjectWriteLock } from "./writeLock.js";
import { isCodeIndexCollection } from "./codeIndexCollection.js";
import {
  declaredIndexUnitPreview,
  EXTRACTION_BLOCK_PAGE_COUNT,
  finalizeIndexUnit,
  incrementPreviewDirectory,
  inferredIndexUnit,
  recordPreviewPage,
} from "./extractTsPreview.js";
import {
  assertReadyExtractionSources,
  assertSingleModuleSourceBoundaries,
  selectRepoSources,
} from "./extractSourceSelection.js";
import {
  inspectCodeIndexDocuments,
  markdownPathsFromEvidence,
} from "./codeIndexDocumentInventory.js";
import {
  candidateBelongsToSourceScope,
  readExtractPhaseCandidateOwnership,
  writeExtractPhaseCandidateOwnership,
} from "./extractPhaseCandidateOwnership.js";

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

export async function prepareExtractTsPhase(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition;
  materialize?: boolean;
}): Promise<ExtractTsPreparedRun> {
  const selectedSources = await selectRepoSources({
    projectRoot: input.projectRoot,
    phase: input.phase,
    materialize: input.materialize === true,
  });
  assertReadyExtractionSources(selectedSources);
  await assertSingleModuleSourceBoundaries({
    projectRoot: input.projectRoot,
    sources: selectedSources,
  });

  const sources: ExtractTsPhasePreview["sources"] = [];
  const agentHints: ExtractAgentHint[] = [];
  const knowledgePathExamples: ExtractTsPhasePreview["knowledgePathExamples"] = [];
  const allCandidates: CandidateDraft[] = [];
  const snapshots: SourceSymbolSnapshot[] = [];
  const sourceSymbolIndex: ExtractSourceSymbolIndexEntry[] = [];
  const moduleErrorsForRun: ExtractTsRunResult["moduleErrors"] = [];
  const relationships: ExtractTsRunResult["relationships"] = {
    mode: "source-backed-ast",
    detected: 0,
    emitted: 0,
    omitted: { external: 0, endpointNotSelected: 0, ambiguousEndpoint: 0 },
  };
  const phaseIndexUnits = input.phase.indexUnits ?? [];
  const indexUnitById = new Map(phaseIndexUnits.map((unit) => [
    unit.id,
    declaredIndexUnitPreview(unit, input.phase.indexPlan ?? "inferred"),
  ]));
  const extractedSources: Array<{
    source: SourceSelection;
    extraction: RepositoryExtractionResult;
  }> = [];
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
    extractedSources.push({ source, extraction });
    const modules = await Promise.all(extraction.results.map(async (result) => {
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
      const matchingUnits = phaseIndexUnits.filter((unit) =>
        unit.inputSources.includes(source.record.name)
      );
      const unit = matchingUnits[0] === undefined
        ? (() => {
            const inferred = indexUnitById.get(source.record.name) ?? inferredIndexUnit({
              phase: input.phase,
              sourceName: source.record.name,
            });
            indexUnitById.set(inferred.id, inferred);
            return inferred;
          })()
        : indexUnitById.get(matchingUnits[0].id)!;
      if (matchingUnits.length > 1 && !unit.risks.includes("ownership-ambiguous")) {
        unit.risks.push("ownership-ambiguous");
      }
      unit.projectedPageCount += candidateEstimate;
      unit.visibility.exported += selectedSymbols.filter(
        (symbol) => symbol.visibility === Visibility.Exported,
      ).length;
      unit.visibility.internal += selectedSymbols.filter(
        (symbol) => symbol.visibility !== Visibility.Exported,
      ).length;
      for (const [kind, count] of Object.entries(candidateKinds)) {
        unit.candidateKinds[kind] = (unit.candidateKinds[kind] ?? 0) + count;
      }
      if (input.phase.mode === "scan" && !unit.risks.includes("full-scan")) unit.risks.push("full-scan");
      if (!input.phase.exportedOnly && !unit.risks.includes("internal-symbols")) unit.risks.push("internal-symbols");
      const analyzedPaths = new Set(result.extraction.files.map((file) => file.path.replaceAll("\\", "/")));
      const moduleFiles = result.module.files.map((file) => file.replaceAll("\\", "/"));
      const excludedFiles = (result.module.excludedFiles ?? []).map((file) => file.replaceAll("\\", "/"));
      const unanalyzedFiles = moduleFiles.filter((file) => !analyzedPaths.has(file));
      const documentInventory = await inspectCodeIndexDocuments({
        moduleRoot: resolve(repoPath, result.module.path),
        modulePrefix: result.module.path,
        declaredDocuments: [
          ...unit.documents,
          ...markdownPathsFromEvidence(unit.moduleTypeEvidence),
        ],
      });
      unit.inventory.eligibleFiles += result.module.fileCount;
      unit.inventory.analyzedFiles += result.extraction.stats.files;
      unit.inventory.eligibleFileTargets.push(...moduleFiles);
      unit.inventory.analyzedFileTargets.push(...[...analyzedPaths]);
      unit.inventory.excludedFileTargets.push(...excludedFiles);
      if (excludedFiles.length > 0) {
        unit.inventory.excludedReasons.push("matched code include but excluded by the configured code path filter");
      }
      unit.inventory.eligibleLoc += result.module.totalLines;
      unit.inventory.analyzedLoc += result.extraction.stats.lines;
      unit.inventory.documentsDiscovered += documentInventory.documentTargets.length;
      unit.inventory.documentsRead += documentInventory.readDocumentTargets.length;
      unit.inventory.documentTargets.push(...documentInventory.documentTargets);
      unit.inventory.rootDocumentTargets.push(...documentInventory.rootDocumentTargets);
      unit.inventory.readDocumentTargets.push(...documentInventory.readDocumentTargets);
      unit.inventory.symbolsDiscovered += result.extraction.symbols.length;
      unit.inventory.symbolsAnalyzed += result.extraction.symbols.length;
      unit.inventory.targetSymbols += selectedSymbols.length;
      unit.inventory.exportedSymbols += exportedSymbols;
      unit.inventory.targetSymbolIdentities.push(...selectedSymbols.map((symbol) => symbol.name));
      unit.inventory.exportedTargetIdentities.push(...selectedSymbols
        .filter((symbol) => symbol.visibility === Visibility.Exported)
        .map((symbol) => symbol.name));
      const resolvedEntries = result.entryDetection.entries.map((entry) => entry.path);
      unit.inventory.entryTargets.push(...resolvedEntries);
      unit.inventory.boundaryTargets.push(...resolvedEntries.map((identity) => ({
        kind: "entry" as const,
        identity,
      })));
      unit.inventory.coveredBoundaryTargets.push(...resolvedEntries.map((identity) => ({
        kind: "entry" as const,
        identity,
      })));
      unit.inventory.parserSkippedFiles += unanalyzedFiles.length;
      if (unanalyzedFiles.length > 0) {
        unit.inventory.parserSkippedFileTargets.push(...unanalyzedFiles);
      }
      const sampledSymbols = selectedSymbols.slice(0, EXTRACTION_BLOCK_PAGE_COUNT + 1);
      let sampledBytes = 0;
      for (const symbol of sampledSymbols) {
        const markdown = applyMarkdownTransforms(renderSymbolMarkdown(symbol), input.phase);
        const bytes = Buffer.byteLength(markdown, "utf8");
        sampledBytes += bytes;
        unit.contentBytes.max = Math.max(unit.contentBytes.max, bytes);
        recordPreviewPage(unit, symbol.file, bytes);
        incrementPreviewDirectory(unit, symbol.file);
        if (
          /(?:^|\/)(?:generated|gen|dist|vendor|vendored)(?:\/|$)|\.generated\./iu.test(symbol.file) &&
          !unit.risks.includes("generated-source-risk")
        ) unit.risks.push("generated-source-risk");
        if ((symbol.initializer?.length ?? 0) > 256 && !unit.risks.includes("implementation-body-risk")) {
          unit.risks.push("implementation-body-risk");
        }
      }
      for (const symbol of selectedSymbols.slice(sampledSymbols.length)) incrementPreviewDirectory(unit, symbol.file);
      if (sampledSymbols.length < selectedSymbols.length) {
        unit.contentBytes.sampled = true;
        unit.contentBytes.total += Math.round(
          (sampledBytes / Math.max(1, sampledSymbols.length)) * selectedSymbols.length,
        );
      } else {
        unit.contentBytes.total += sampledBytes;
      }
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
        entryFiles: resolvedEntries.sort(),
        totalLines: result.module.totalLines,
        symbols: result.extraction.symbols.length,
        exportedSymbols,
        internalSymbols: result.extraction.symbols.length - exportedSymbols,
        candidateKinds,
        relations: result.extraction.relations.length,
        candidateEstimate,
      };
    }));
    const moduleErrors = extraction.moduleErrors.map((error) => {
      const hint = moduleErrorHint({
        sourceName: source.record.name,
        modulePath: error.module_path,
        error: error.error,
      });
      agentHints.push(hint);
      moduleErrorsForRun.push({
        source: source.record.name,
        module_path: error.module_path,
        error: error.error,
      });
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

  const indexUnits = [...indexUnitById.values()].map(finalizeIndexUnit)
    .sort((left, right) => left.id.localeCompare(right.id));
  const previewBlocked = indexUnits.some((unit) =>
    unit.plan === "inferred" ||
    unit.scale === "blocked" ||
    unit.capability === "material-required" ||
    unit.risks.includes("ownership-ambiguous")
  );
  if (!previewBlocked) {
    for (const { source, extraction } of extractedSources) {
      const sourceBuild = makeCandidates({
        phase: input.phase,
        extraction,
        source: source.record,
      });
      allCandidates.push(...sourceBuild.candidates);
      relationships.detected += sourceBuild.relationships.detected;
      relationships.emitted += sourceBuild.relationships.emitted;
      relationships.omitted.external += sourceBuild.relationships.omitted.external;
      relationships.omitted.endpointNotSelected += sourceBuild.relationships.omitted.endpointNotSelected;
      relationships.omitted.ambiguousEndpoint += sourceBuild.relationships.omitted.ambiguousEndpoint;
      for (const candidate of sourceBuild.candidates.slice(0, Math.max(0, 8 - knowledgePathExamples.length))) {
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
      const candidateBySourceRef = new Map(sourceBuild.candidates.map((candidate) => [
        candidate.source_refs[0],
        candidate,
      ]));
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
            markdown: sourceBuild.markdownByCandidateId.get(candidate.candidate_id) ?? (() => {
              throw new Error(`missing rendered markdown for candidate ${candidate.candidate_id}`);
            })(),
          });
        }
      }
    }
  }

  const previousOwned = (await readExtractPhaseCandidateOwnership(input.projectRoot)).phases[input.phase.id];
  const phaseCandidateIds = new Set([
    ...(previousOwned?.candidateIds ?? []),
    ...allCandidates.map((candidate) => candidate.candidate_id),
  ]);
  const approvedPages = (await readApprovedCodegraphPages({
    projectRoot: input.projectRoot,
    sourceNames: new Set(selectedSources.map((source) => source.record.name)),
  })).filter((page) => previousOwned === undefined || phaseCandidateIds.has(page.candidateId));
  for (const unit of indexUnits) {
    const current = approvedPages.filter((page) => unit.inputSources.includes(page.sourceName));
    const candidates = allCandidates.filter((candidate) => candidate.source_refs.some((ref) =>
      unit.inputSources.some((source) => ref.startsWith(`repo:${source}#`))
    ));
    unit.currentPageCount = current.length;
    if (previewBlocked) {
      unit.changes = {
        added: Math.max(0, unit.projectedPageCount - current.length),
        updated: 0,
        removed: Math.max(0, current.length - unit.projectedPageCount),
        unchanged: Math.min(current.length, unit.projectedPageCount),
        exact: false,
      };
      continue;
    }
    const currentById = new Map(current.map((page) => [page.candidateId, page]));
    const candidateIds = new Set(candidates.map((candidate) => candidate.candidate_id));
    unit.changes = {
      added: candidates.filter((candidate) => !currentById.has(candidate.candidate_id)).length,
      updated: candidates.filter((candidate) => {
        const page = currentById.get(candidate.candidate_id);
        return page !== undefined && page.candidateFingerprint !== candidate.fingerprint;
      }).length,
      removed: current.filter((page) => !candidateIds.has(page.candidateId)).length,
      unchanged: candidates.filter((candidate) =>
        currentById.get(candidate.candidate_id)?.candidateFingerprint === candidate.fingerprint
      ).length,
      exact: true,
    };
  }
  const preview: ExtractTsPhasePreview = {
    kind: "context.extraction-phase-preview.v1",
    phaseKind: "phase.extract.ts",
    phaseId: input.phase.id,
    collection: input.phase.collection,
    include: [...input.phase.include],
    mode: input.phase.mode,
    ...(input.phase.entries !== undefined ? { entries: [...input.phase.entries] } : {}),
    exportedOnly: input.phase.exportedOnly,
    indexUnits,
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
  return {
    kind: "context.extract-ts-prepared.v1",
    phaseId: input.phase.id,
    fingerprint: extractPhaseSourceFingerprint({ phase: input.phase, sources: selectedSources }),
    sources: selectedSources,
    candidates: allCandidates,
    snapshots,
    symbolIndex: sourceSymbolIndex,
    modules: totalModules,
    extractedSymbols: totalSymbols,
    relationships,
    moduleErrors: moduleErrorsForRun,
    agent_hints: agentHints,
    preview,
  };
}

export async function previewExtractTsPhase(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition;
}): Promise<ExtractTsPhasePreview> {
  return (await prepareExtractTsPhase(input)).preview;
}

export async function runExtractTsPhase(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition;
  runId: string;
  autoPromote?: boolean;
  prepared?: ExtractTsPreparedRun;
}): Promise<ExtractTsRunResult> {
  const prepared = input.prepared ?? await prepareExtractTsPhase({
    projectRoot: input.projectRoot,
    phase: input.phase,
    materialize: true,
  });
  if (prepared.phaseId !== input.phase.id) {
    throw new ContextError(ExitCode.WorkspaceStateError, "extraction preview does not match the requested phase", {
      category: ErrorCategory.WorkspaceStateInvalid,
      code: "extract-preview-phase-mismatch",
      expected: input.phase.id,
      actual: prepared.phaseId,
    });
  }
  const planUnits = prepared.preview.indexUnits.filter((unit) => unit.plan === "inferred");
  const classificationUnits = prepared.preview.indexUnits.filter((unit) =>
    unit.risks.includes("module-classification-required")
  );
  const blockedUnits = prepared.preview.indexUnits.filter((unit) => unit.scale === "blocked");
  const capabilityUnits = prepared.preview.indexUnits.filter((unit) => unit.capability === "material-required");
  const ownershipUnits = prepared.preview.indexUnits.filter((unit) => unit.risks.includes("ownership-ambiguous"));
  const blockedBy = planUnits.length > 0
    ? { code: "extract-plan-required", units: planUnits }
    : classificationUnits.length > 0
      ? { code: "extract-plan-required", units: classificationUnits }
    : blockedUnits.length > 0
      ? { code: "extract-scale-limit-exceeded", units: blockedUnits }
      : capabilityUnits.length > 0
      ? { code: "extract-capability-required", units: capabilityUnits }
      : ownershipUnits.length > 0
        ? { code: "extract-ownership-required", units: ownershipUnits }
        : undefined;
  if (blockedBy !== undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, "code extraction preview requires an index plan revision before candidates can be written", {
      category: ErrorCategory.WorkspaceStateInvalid,
      code: blockedBy.code,
      limit: EXTRACTION_BLOCK_PAGE_COUNT,
      units: blockedBy.units,
      next: "Revise the extraction index plan in src/index.ts, then run context status --format json.",
    });
  }
  const selectedSources = prepared.sources;
  const sourceFingerprint = prepared.fingerprint;
  const previousFingerprint = (await readExtractSourceFingerprints(input.projectRoot)).phases[input.phase.id];
  const sourceState = previousFingerprint === undefined
    ? "first-run" as const
    : previousFingerprint.fingerprint === sourceFingerprint.fingerprint
      ? "unchanged" as const
      : "changed" as const;

  const now = new Date().toISOString();
  const allCandidates = [...prepared.candidates];
  const snapshots = prepared.snapshots;
  const sourceSymbolIndex = prepared.symbolIndex;
  const moduleErrors = prepared.moduleErrors;
  const agentHints = prepared.agent_hints;
  const modules = prepared.modules;
  const extractedSymbols = prepared.extractedSymbols;
  const relationships = prepared.relationships;

  const sourceNames = new Set(selectedSources.map((source) => source.record.name));
  const ownership = await readExtractPhaseCandidateOwnership(input.projectRoot);
  const previousOwned = ownership.phases[input.phase.id];
  const generatedCandidateIds = new Set(allCandidates.map((candidate) => candidate.candidate_id));
  const phaseCandidateIds = new Set([
    ...(previousOwned?.candidateIds ?? []),
    ...generatedCandidateIds,
  ]);
  const approvedPages = (await readApprovedCodegraphPages({ projectRoot: input.projectRoot, sourceNames }))
    .filter((page) => previousOwned === undefined || phaseCandidateIds.has(page.candidateId));
  const approvedById = new Map(approvedPages.map((page) => [page.candidateId, page]));
  const removalCandidates = approvedPages
    .filter((page) => !generatedCandidateIds.has(page.candidateId))
    .map(removalCandidate);
  allCandidates.push(...removalCandidates);
  const lifecycleCandidateIds = new Set(allCandidates.map((candidate) => candidate.candidate_id));
  const merged = await withProjectWriteLock(input.projectRoot, "extract-candidates", async () => {
    const manifest = await readExtractPhaseCandidateOwnership(input.projectRoot);
    const ownedBeforeRun = manifest.phases[input.phase.id];
    const previousOwnedIds = new Set(ownedBeforeRun?.candidateIds ?? []);
    const recordedIds = new Set(Object.values(manifest.phases)
      .flatMap((phaseOwnership) => phaseOwnership.candidateIds));
    const currentRows = await readCandidateRecords(input.projectRoot);
    const staleOwnedRows = currentRows.filter((row) =>
      !lifecycleCandidateIds.has(row.candidate_id) && (
        previousOwnedIds.has(row.candidate_id) || (
          !recordedIds.has(row.candidate_id) &&
          row.collection === input.phase.collection &&
          candidateBelongsToSourceScope(row.source_refs, sourceNames)
        )
      )
    );
    const staleOwnedIds = new Set(staleOwnedRows.map((row) => row.candidate_id));
    const existing = ownedBeforeRun === undefined
      ? currentRows
      : currentRows.filter((row) =>
          !staleOwnedIds.has(row.candidate_id)
        );
    for (const row of staleOwnedRows) await removeCandidateSnapshot(input.projectRoot, row.candidate_id);
    const rejectedDecisions = await readRejectedDecisions(input.projectRoot);
    for (const row of staleOwnedRows) rejectedDecisions.delete(row.candidate_id);
    const mergeResult = mergeCandidates({
      existing,
      candidates: allCandidates,
      approvedById,
      rejectedDecisions,
      sourceNames: ownedBeforeRun === undefined ? sourceNames : new Set(),
      collection: input.phase.collection,
      now,
    });
    for (const candidateId of mergeResult.decisionsToRemove) rejectedDecisions.delete(candidateId);
    await writeCandidateRecords(input.projectRoot, mergeResult.rows);
    if (mergeResult.decisionsToRemove.length > 0 || staleOwnedRows.length > 0) {
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
      sourceNames: ownedBeforeRun === undefined ? sourceNames : new Set(),
      symbols: sourceSymbolIndex,
      removeSymbols: ownedBeforeRun?.symbols ?? [],
    });
    await writeExtractPhaseCandidateOwnership({
      projectRoot: input.projectRoot,
      manifest,
      phaseId: input.phase.id,
      candidateIds: [...lifecycleCandidateIds],
      symbols: sourceSymbolIndex,
    });
    return { ...mergeResult, removed: mergeResult.removed + staleOwnedRows.length };
  });

  const codegraphRows = (await readCandidateRecords(input.projectRoot))
    .filter((row) => isCodeIndexCollection(row.collection) && row.status === "draft");
  const selectedRows = codegraphRows.filter((row) => row.source_refs.some((ref) =>
    [...sourceNames].some((sourceName) => ref.startsWith(`repo:${sourceName}#`))
  ));
  let autoPromotion: ExtractTsRunResult["autoPromotion"];
  if (input.autoPromote === true) {
    if (selectedRows.length !== codegraphRows.length) {
      throw new ContextError(ExitCode.WorkspaceStateError, "code-index auto-promotion cannot include drafts from another source scope", {
        category: ErrorCategory.WorkspaceStateInvalid,
        phaseId: input.phase.id,
        unrelated_candidates: codegraphRows
          .filter((row) => !selectedRows.includes(row))
          .map((row) => row.candidate_id),
        next: "Review or reject the unrelated code-index drafts before rerunning --auto-promote.",
      });
    }
    const ids = selectedRows.map((row) => row.candidate_id).sort();
    const applied = ids.length === 0
      ? { applied: 0, approved: 0, rejected: 0, unchanged: 0, materialized: 0, removed: 0, candidateFileUpdated: false, pages: [] }
      : await applyReviewDecisions({
          projectRoot: input.projectRoot,
          payload: {
            collection: input.phase.collection,
            default: "approved",
            decisions: [],
            scope: { kind: "collection", collection: input.phase.collection, count: ids.length, ids_sha256: candidateIdsHash(ids) },
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
      throw new ContextError(ExitCode.WorkspaceStateError, "code-index auto-promotion failed project verification", {
        category: ErrorCategory.WorkspaceStateInvalid,
        phaseId: input.phase.id,
        issues: verified.issues,
        next: "Fix the reported deterministic verification errors, then rerun the code-index phase with --auto-promote.",
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
          kind: "continue-code-index-batch",
          command: "context status --format json",
          message: sourceState === "first-run"
            ? "This module produced first-run candidates. Context status will continue any remaining extract phases before opening one batch Review."
            : "This module produced code-index deltas. Context status will continue any remaining extract phases before opening one batch Review; unchanged approved symbols were preserved.",
        }
      : {
          kind: "continue-automatically",
          command: "context status --format json",
          message: input.autoPromote === true
            ? "Code-index deltas were automatically applied and verified; no human review gate remains."
            : "No code-index delta requires review; continue automatically.",
        },
    ...(autoPromotion !== undefined ? { autoPromotion } : {}),
    moduleErrors,
    agent_hints: agentHints,
    candidateFile: CANDIDATE_LEDGER_FILE,
  };
}
