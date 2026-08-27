import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  CodeIndexUnitPlan,
  CustomCodeCandidateDraft,
  ExtractCustomPhaseDefinition,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readApprovedCodegraphPages } from "./codegraphApproved.js";
import {
  extractPhaseSourceFingerprint,
  readExtractSourceFingerprints,
  removeCandidateSnapshot,
  writeCodeCandidateSnapshot,
  writeExtractSourceFingerprint,
  writeExtractSourceSymbolIndex,
} from "./extractCandidateArtifacts.js";
import { mergeCandidates } from "./extractCandidateBuild.js";
import type {
  ExtractCustomPhasePreview,
  ExtractionIndexUnitPreview,
  ExtractSourceSymbolIndexEntry,
  ExtractTsRunResult,
  SourceSelection,
} from "./extractCandidateTypes.js";
import {
  readCandidateRecords,
  writeCandidateRecords,
} from "./candidateLedger.js";
import {
  candidateFromCustom,
  customInputError,
  type BuiltCustomCandidate,
} from "./customCandidateDraft.js";
import { applyCustomUnitCoverage } from "./customExtractPreview.js";
import {
  applyCustomInspectionInventory,
  assertCustomInventoryCoversSourceBaseline,
} from "./customExtractInventory.js";
import { selectRepoSourcesForExtraction } from "./extractSourceSelection.js";
import { applyIndexUnitAdvisoryRisks } from "./extractionIndexUnitRisks.js";
import { readRejectedDecisions, writeRejectedDecisions } from "./reviewDecisions.js";
import {
  probeStructuralCapabilities,
  probesForIndexUnit,
} from "./structuralCapabilityProbes.js";
import { withProjectWriteLock } from "./writeLock.js";

const CUSTOM_PHASE_MANIFEST = ".tmp/context-runtime/extract/custom-phase-candidates.json";
const EXTRACTION_WARNING_PAGE_COUNT = 100;
const EXTRACTION_BLOCK_PAGE_COUNT = 300;

export interface ExtractCustomPreparedRun {
  kind: "context.extract-custom-prepared.v1";
  phaseId: string;
  fingerprint: ReturnType<typeof extractPhaseSourceFingerprint>;
  sources: SourceSelection[];
  built: BuiltCustomCandidate[];
  preview: ExtractCustomPhasePreview;
}

function scaleForPages(pages: number): ExtractionIndexUnitPreview["scale"] {
  if (pages > EXTRACTION_BLOCK_PAGE_COUNT) return "blocked";
  if (pages > EXTRACTION_WARNING_PAGE_COUNT) return "warning";
  return "normal";
}

function previewForPlan(unit: CodeIndexUnitPlan): ExtractionIndexUnitPreview {
  return {
    id: unit.id,
    inputSources: [...unit.inputSources],
    outputOwner: unit.outputOwner,
    moduleType: unit.moduleType,
    moduleTypes: [...(unit.moduleTypes ?? [unit.moduleType])],
    facets: [...(unit.facets ?? [])],
    moduleTypeEvidence: [...(unit.moduleTypeEvidence ?? [])],
    documents: [...(unit.documents ?? [])],
    outputProfile: unit.outputProfile,
    capability: unit.capability,
    plan: "declared",
    responsibility: unit.responsibility,
    entries: [...unit.entries],
    protocols: [...unit.protocols],
    exclusions: [...unit.exclusions],
    lifecycle: unit.lifecycle ?? "authoritative",
    ...(unit.sourceOfTruth === undefined ? {} : { sourceOfTruth: unit.sourceOfTruth }),
    currentPageCount: 0,
    projectedPageCount: 0,
    candidateEstimate: 0,
    changes: { added: 0, updated: 0, removed: 0, unchanged: 0, exact: false },
    scale: "normal",
    visibility: { exported: 0, internal: 0 },
    candidateKinds: {},
    topDirectories: [],
    contentBytes: { total: 0, max: 0, sampled: false, topPages: [] },
    inventory: {
      basis: "evidence-only",
      eligibleFiles: 0,
      analyzedFiles: 0,
      eligibleFileTargets: [],
      analyzedFileTargets: [],
      eligibleLoc: 0,
      analyzedLoc: 0,
      documentsDiscovered: 0,
      documentsRead: 0,
      documentTargets: [],
      rootDocumentTargets: [],
      readDocumentTargets: [],
      referencedDocumentTargets: [],
      symbolsDiscovered: 0,
      symbolsAnalyzed: 0,
      targetSymbols: 0,
      exportedSymbols: 0,
      targetSymbolIdentities: [],
      exportedTargetIdentities: [],
      entryTargets: [...unit.entries],
      protocolTargets: [...unit.protocols],
      boundaryTargets: [
        ...unit.entries.map((identity) => ({ kind: "entry" as const, identity })),
        ...unit.protocols.map((identity) => ({ kind: "operation" as const, identity })),
      ],
      coveredBoundaryTargets: [],
      identityGroups: [],
      chainCandidates: [],
      chainCandidateDecisions: [],
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [...unit.exclusions],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    },
    risks: [],
  };
}

function inferredCustomUnit(input: {
  module: string;
  sources: readonly string[];
}): ExtractionIndexUnitPreview {
  return {
    id: input.module,
    inputSources: [...input.sources].sort(),
    outputOwner: input.module,
    moduleType: "unknown",
    moduleTypes: ["unknown"],
    facets: [],
    moduleTypeEvidence: [],
    documents: [],
    outputProfile: "module-map",
    capability: "project-adapter",
    plan: "inferred",
    responsibility: "Index the source-backed knowledge emitted by the project adapter.",
    entries: [],
    protocols: [],
    exclusions: [],
    lifecycle: "authoritative",
    currentPageCount: 0,
    projectedPageCount: 0,
    candidateEstimate: 0,
    changes: { added: 0, updated: 0, removed: 0, unchanged: 0, exact: false },
    scale: "normal",
    visibility: { exported: 0, internal: 0 },
    candidateKinds: {},
    topDirectories: [],
    contentBytes: { total: 0, max: 0, sampled: false, topPages: [] },
    inventory: {
      basis: "evidence-only",
      eligibleFiles: 0,
      analyzedFiles: 0,
      eligibleFileTargets: [],
      analyzedFileTargets: [],
      eligibleLoc: 0,
      analyzedLoc: 0,
      documentsDiscovered: 0,
      documentsRead: 0,
      documentTargets: [],
      rootDocumentTargets: [],
      readDocumentTargets: [],
      referencedDocumentTargets: [],
      symbolsDiscovered: 0,
      symbolsAnalyzed: 0,
      targetSymbols: 0,
      exportedSymbols: 0,
      targetSymbolIdentities: [],
      exportedTargetIdentities: [],
      entryTargets: [],
      protocolTargets: [],
      boundaryTargets: [],
      coveredBoundaryTargets: [],
      identityGroups: [],
      chainCandidates: [],
      chainCandidateDecisions: [],
      excludedFiles: 0,
      excludedFileTargets: [],
      excludedReasons: [],
      parserSkippedFiles: 0,
      parserSkippedFileTargets: [],
    },
    risks: ["index-plan-inferred"],
  };
}

function incrementCustomDirectory(unit: ExtractionIndexUnitPreview, path: string): void {
  const segments = path.replaceAll("\\", "/").split("/");
  const directory = segments.length > 1 ? segments.slice(0, -1).join("/") : ".";
  const existing = unit.topDirectories.find((item) => item.path === directory);
  if (existing === undefined) unit.topDirectories.push({ path: directory, count: 1 });
  else existing.count += 1;
}

function finalizeCustomUnit(unit: ExtractionIndexUnitPreview): ExtractionIndexUnitPreview {
  unit.scale = scaleForPages(unit.projectedPageCount);
  unit.candidateEstimate = unit.projectedPageCount;
  unit.topDirectories.sort((left, right) => right.count - left.count || left.path.localeCompare(right.path));
  unit.topDirectories.splice(5);
  unit.contentBytes.topPages.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  unit.contentBytes.topPages.splice(5);
  unit.inventory.targetSymbolIdentities = [...new Set(unit.inventory.targetSymbolIdentities)].sort();
  unit.inventory.exportedTargetIdentities = [...new Set(unit.inventory.exportedTargetIdentities)].sort();
  unit.inventory.eligibleFileTargets = [...new Set(unit.inventory.eligibleFileTargets)].sort();
  unit.inventory.analyzedFileTargets = [...new Set(unit.inventory.analyzedFileTargets)].sort();
  unit.inventory.excludedFileTargets = [...new Set(unit.inventory.excludedFileTargets)].sort();
  unit.inventory.parserSkippedFileTargets = [...new Set(unit.inventory.parserSkippedFileTargets)].sort();
  unit.inventory.documentTargets = [...new Set(unit.inventory.documentTargets)].sort();
  unit.inventory.rootDocumentTargets = [...new Set(unit.inventory.rootDocumentTargets)].sort();
  unit.inventory.readDocumentTargets = [...new Set(unit.inventory.readDocumentTargets)].sort();
  unit.inventory.referencedDocumentTargets = [...new Set(unit.inventory.referencedDocumentTargets)].sort();
  unit.inventory.entryTargets = [...new Set(unit.inventory.entryTargets)].sort();
  unit.inventory.protocolTargets = [...new Set(unit.inventory.protocolTargets)].sort();
  unit.inventory.boundaryTargets = [...new Map(unit.inventory.boundaryTargets.map((target) => [
    `${target.kind}:${target.identity}`,
    target,
  ])).values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.identity.localeCompare(right.identity));
  unit.inventory.coveredBoundaryTargets = [...new Map(unit.inventory.coveredBoundaryTargets.map((target) => [
    `${target.kind}:${target.identity}`,
    target,
  ])).values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.identity.localeCompare(right.identity));
  applyIndexUnitAdvisoryRisks(unit, { customAggregate: true });
  if (unit.scale === "warning") unit.risks.push("page-count-warning");
  if (unit.scale === "blocked") unit.risks.push("page-count-limit-exceeded");
  unit.risks = [...new Set(unit.risks)].sort();
  return unit;
}

interface CustomPhaseCandidateManifest {
  version: 2;
  phases: Record<string, {
    candidateIds: string[];
    symbols: ExtractSourceSymbolIndexEntry[];
  }>;
}

function isCandidateIterable(value: unknown): value is
  | Iterable<CustomCodeCandidateDraft>
  | AsyncIterable<CustomCodeCandidateDraft> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return typeof candidate[Symbol.iterator] === "function" ||
    typeof candidate[Symbol.asyncIterator] === "function";
}

export async function prepareExtractCustomPhase(input: {
  projectRoot: string;
  phase: ExtractCustomPhaseDefinition;
  runId: string;
  materialize?: boolean;
}): Promise<ExtractCustomPreparedRun> {
  const selectedSources = await selectRepoSourcesForExtraction({
    projectRoot: input.projectRoot,
    phase: input.phase,
    materialize: input.materialize === true,
  });
  const notReady = selectedSources.filter((source) => !source.status.ready);
  if (notReady.length > 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, "repo source is not ready for custom extraction", {
      category: ErrorCategory.WorkspaceStateInvalid,
      sources: notReady.map((source) => source.record.name),
      next: "Resolve the source diagnostics and rerun the custom extraction preview.",
    });
  }
  const phaseFingerprint = extractPhaseSourceFingerprint({ phase: input.phase, sources: selectedSources });
  const structuralProbes = await probeStructuralCapabilities({
    projectRoot: input.projectRoot,
    sources: selectedSources,
  });
  const inspectionResult = input.phase.inspect === undefined
    ? undefined
    : await input.phase.inspect({
        projectRoot: input.projectRoot,
        sources: selectedSources.map((source) => ({
          name: source.record.name,
          materializedAt: source.status.materializedAt,
          absolutePath: resolve(input.projectRoot, source.status.materializedAt),
        })),
      });
  const inspection = inspectionResult === undefined
    ? { findings: [], capabilityGaps: [], inventories: [], structuralProbes }
    : {
        findings: [...inspectionResult.findings],
        capabilityGaps: [...(inspectionResult.capabilityGaps ?? [])],
        inventories: [...(inspectionResult.inventories ?? [])],
        structuralProbes,
      };
  const output = await input.phase.extract({
    projectRoot: input.projectRoot,
    runId: input.runId,
    sources: selectedSources.map((source) => ({
      name: source.record.name,
      materializedAt: source.status.materializedAt,
      absolutePath: resolve(input.projectRoot, source.status.materializedAt),
    })),
  });
  if (output === null || typeof output !== "object" || !isCandidateIterable(output.candidates)) {
    throw customInputError(input.phase.id, "extract must return { candidates: iterable }");
  }
  const sourceNames = new Set(selectedSources.map((source) => source.record.name));
  const phaseIndexUnits = input.phase.indexUnits ?? [];
  const units = new Map(phaseIndexUnits.map((unit) => [unit.id, previewForPlan(unit)]));
  for (const finding of inspection.findings) {
    if (!units.has(finding.indexUnitId) || !sourceNames.has(finding.source)) {
      throw customInputError(input.phase.id, "inspection findings must reference a declared index unit and source", {
        finding,
      });
    }
  }
  for (const gap of inspection.capabilityGaps) {
    const unit = units.get(gap.indexUnitId);
    if (unit === undefined) {
      throw customInputError(input.phase.id, "inspection capability gaps must reference a declared index unit", {
        capability_gap: gap,
      });
    }
    unit.capability = "material-required";
  }
  for (const inventory of inspection.inventories) {
    const unit = units.get(inventory.indexUnitId);
    if (unit === undefined) {
      throw customInputError(input.phase.id, "inspection inventories must reference a declared index unit", {
        inventory,
      });
    }
    applyCustomInspectionInventory({ unit, inventory, phaseId: input.phase.id });
    await assertCustomInventoryCoversSourceBaseline({
      unit,
      inventory,
      phaseId: input.phase.id,
      sources: selectedSources.map((source) => ({
        name: source.record.name,
        absolutePath: resolve(input.projectRoot, source.status.materializedAt),
      })),
    });
  }
  const built: BuiltCustomCandidate[] = [];
  const candidateIds = new Set<string>();
  let candidateCount = 0;
  let evidenceCount = 0;
  let relationCount = 0;
  const legacyPreview = Array.isArray(output.candidates);
  for await (const draft of output.candidates) {
    const item = candidateFromCustom({
      phase: input.phase,
      draft,
      index: candidateCount,
      sourceNames,
    });
    candidateCount += 1;
    evidenceCount += item.symbols.length;
    relationCount += item.candidate.code_edges?.length ?? 0;
    if (candidateIds.has(item.candidate.candidate_id)) {
      throw customInputError(input.phase.id, "candidate nodeRef values must be unique", {
        duplicate_candidate_ids: [item.candidate.candidate_id],
      });
    }
    candidateIds.add(item.candidate.candidate_id);
    const module = item.candidate.module;
    const matches = phaseIndexUnits.filter((unit) =>
      unit.id === module || unit.outputOwner === module
    );
    const evidenceSources = [...new Set(item.symbols.map((symbol) => symbol.source))];
    const unit = matches[0] === undefined
      ? (() => {
          const inferred = units.get(module) ?? inferredCustomUnit({ module, sources: evidenceSources });
          if (phaseIndexUnits.length > 0 && !inferred.risks.includes("ownership-ambiguous")) {
            inferred.risks.push("ownership-ambiguous");
          }
          units.set(module, inferred);
          return inferred;
        })()
      : units.get(matches[0].id)!;
    if (matches.length > 1 && !unit.risks.includes("ownership-ambiguous")) {
      unit.risks.push("ownership-ambiguous");
    }
    if (legacyPreview && !unit.risks.includes("legacy-preview")) unit.risks.push("legacy-preview");
    unit.projectedPageCount += 1;
    if (item.candidate.visibility === "exported") unit.visibility.exported += 1;
    else unit.visibility.internal += 1;
    unit.candidateKinds[item.candidate.kind] = (unit.candidateKinds[item.candidate.kind] ?? 0) + 1;
    const bytes = Buffer.byteLength(item.markdown, "utf8");
    unit.contentBytes.total += bytes;
    unit.contentBytes.max = Math.max(unit.contentBytes.max, bytes);
    unit.contentBytes.topPages.push({ path: item.candidate.path, bytes });
    incrementCustomDirectory(unit, item.candidate.path);
    if (unit.projectedPageCount <= EXTRACTION_BLOCK_PAGE_COUNT + 1) built.push(item);
  }
  for (const unit of units.values()) {
    const requiredProbes = probesForIndexUnit({
      probes: structuralProbes,
      inputSources: unit.inputSources,
      outputProfile: unit.outputProfile,
    });
    const unitCandidates = built
      .filter((item) => item.candidate.module === unit.id || item.candidate.module === unit.outputOwner);
    const uniqueFiles = [...new Set(unitCandidates.flatMap((item) => item.symbols.map((symbol) => symbol.file)))];
    const uniqueSymbols = [...new Set(unitCandidates.flatMap((item) => item.symbols.map((symbol) =>
      `${symbol.file}:${symbol.name}:${symbol.kind}`
    )))];
    const exportedSymbols = new Set(unitCandidates
      .filter((item) => item.candidate.visibility === "exported")
      .flatMap((item) => item.symbols.map((symbol) => `${symbol.file}:${symbol.name}:${symbol.kind}`)));
    const evidenceIdentities = [
      ...uniqueFiles,
      ...unitCandidates.flatMap((item) => item.symbols.map((symbol) => symbol.name)),
    ].map((identity) => identity.replaceAll("\\", "/").replace(/^\.\//u, "").toLowerCase());
    unit.inventory.coveredBoundaryTargets.push(...unit.inventory.boundaryTargets.filter((target) => {
      const identity = target.identity.replaceAll("\\", "/").replace(/^\.\//u, "").toLowerCase();
      return evidenceIdentities.some((candidate) =>
        candidate === identity || candidate.endsWith(`/${identity}`) || identity.endsWith(`/${candidate}`)
      );
    }));
    if (unit.inventory.basis === "evidence-only") {
      unit.inventory.eligibleFiles = uniqueFiles.length;
      unit.inventory.analyzedFiles = uniqueFiles.length;
      unit.inventory.eligibleFileTargets = [...uniqueFiles];
      unit.inventory.analyzedFileTargets = [...uniqueFiles];
      unit.inventory.symbolsDiscovered = uniqueSymbols.length;
      unit.inventory.symbolsAnalyzed = uniqueSymbols.length;
      unit.inventory.targetSymbols = uniqueSymbols.length;
      unit.inventory.exportedSymbols = exportedSymbols.size;
      unit.inventory.targetSymbolIdentities = uniqueSymbols.map((identity) => identity.split(":").at(-2) ?? identity);
      unit.inventory.exportedTargetIdentities = [...exportedSymbols].map((identity) => identity.split(":").at(-2) ?? identity);
      unit.inventory.documentsDiscovered = uniqueFiles.filter((file) => /\.mdx?$/iu.test(file)).length;
      unit.inventory.documentsRead = unit.inventory.documentsDiscovered;
      unit.inventory.documentTargets = uniqueFiles.filter((file) => /\.mdx?$/iu.test(file));
      unit.inventory.rootDocumentTargets = unit.inventory.documentTargets.filter((file) =>
        /(?:^|\/)(?:readme|agents|contributing|architecture|developing|development)(?:\.[^/.]+)?\.mdx?$/iu.test(file)
      );
      unit.inventory.readDocumentTargets = [...unit.inventory.documentTargets];
      unit.inventory.referencedDocumentTargets = [...unit.inventory.documentTargets];
      if (!unit.risks.includes("inventory-evidence-only")) unit.risks.push("inventory-evidence-only");
    }
    applyCustomUnitCoverage({ unit, candidates: unitCandidates, requiredProbes });
  }
  const indexUnits = [...units.values()].map(finalizeCustomUnit)
    .sort((left, right) => left.id.localeCompare(right.id));
  const approvedPages = await readApprovedCodegraphPages({
    projectRoot: input.projectRoot,
    sourceNames,
  });
  for (const unit of indexUnits) {
    const current = approvedPages.filter((page) =>
      unit.inputSources.includes(page.sourceName) &&
      (page.module === unit.id || page.module === unit.outputOwner)
    );
    const candidates = built.filter((item) =>
      item.candidate.module === unit.id || item.candidate.module === unit.outputOwner
    ).map((item) => item.candidate);
    const currentById = new Map(current.map((page) => [page.candidateId, page]));
    const unitCandidateIds = new Set(candidates.map((candidate) => candidate.candidate_id));
    unit.currentPageCount = current.length;
    if (unit.scale === "blocked") {
      unit.changes = {
        added: Math.max(0, unit.projectedPageCount - current.length),
        updated: 0,
        removed: Math.max(0, current.length - unit.projectedPageCount),
        unchanged: Math.min(current.length, unit.projectedPageCount),
        exact: false,
      };
      continue;
    }
    unit.changes = {
      added: candidates.filter((candidate) => !currentById.has(candidate.candidate_id)).length,
      updated: candidates.filter((candidate) => {
        const page = currentById.get(candidate.candidate_id);
        return page !== undefined && page.candidateFingerprint !== candidate.fingerprint;
      }).length,
      removed: current.filter((page) => !unitCandidateIds.has(page.candidateId)).length,
      unchanged: candidates.filter((candidate) =>
        currentById.get(candidate.candidate_id)?.candidateFingerprint === candidate.fingerprint
      ).length,
      exact: true,
    };
  }
  const preview: ExtractCustomPhasePreview = {
    kind: "context.extraction-phase-preview.v1",
    phaseKind: "phase.extract.custom",
    phaseId: input.phase.id,
    collection: input.phase.collection,
    indexUnits,
    sources: selectedSources.map((source) => ({
      name: source.record.name,
      ref: source.record.git.ref,
      ...(source.status.head !== undefined ? { head: source.status.head } : {}),
      scopeHash: source.status.scopeHash ?? "unknown",
      materializedAt: source.status.materializedAt,
    })),
    inspection,
    totals: {
      sources: selectedSources.length,
      candidates: candidateCount,
      evidence: evidenceCount,
      relations: relationCount,
      contentBytes: indexUnits.reduce((sum, unit) => sum + unit.contentBytes.total, 0),
    },
    agent_hints: [],
  };
  return {
    kind: "context.extract-custom-prepared.v1",
    phaseId: input.phase.id,
    fingerprint: phaseFingerprint,
    sources: selectedSources,
    built,
    preview,
  };
}

export async function previewExtractCustomPhase(input: {
  projectRoot: string;
  phase: ExtractCustomPhaseDefinition;
  runId: string;
}): Promise<ExtractCustomPhasePreview> {
  return (await prepareExtractCustomPhase(input)).preview;
}

async function readManifest(projectRoot: string): Promise<CustomPhaseCandidateManifest> {
  const path = join(projectRoot, CUSTOM_PHASE_MANIFEST);
  if (!existsSync(path)) return { version: 2, phases: {} };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as CustomPhaseCandidateManifest;
    return parsed.version === 2 && parsed.phases !== null && typeof parsed.phases === "object"
      ? parsed
      : { version: 2, phases: {} };
  } catch {
    return { version: 2, phases: {} };
  }
}

export async function runExtractCustomPhase(input: {
  projectRoot: string;
  phase: ExtractCustomPhaseDefinition;
  runId: string;
  prepared?: ExtractCustomPreparedRun;
}): Promise<ExtractTsRunResult> {
  const prepared = input.prepared ?? await prepareExtractCustomPhase({
    projectRoot: input.projectRoot,
    phase: input.phase,
    runId: input.runId,
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
    throw new ContextError(ExitCode.WorkspaceStateError, "custom extraction preview requires an index plan revision before candidates can be written", {
      category: ErrorCategory.WorkspaceStateInvalid,
      code: blockedBy.code,
      limit: EXTRACTION_BLOCK_PAGE_COUNT,
      units: blockedBy.units,
      next: "Revise the extraction index plan in src/index.ts, then run context status --format json.",
    });
  }
  const selectedSources = prepared.sources;
  const phaseFingerprint = prepared.fingerprint;
  const previousFingerprint = (await readExtractSourceFingerprints(input.projectRoot)).phases[input.phase.id];
  const sourceState = previousFingerprint === undefined
    ? "first-run" as const
    : previousFingerprint.fingerprint === phaseFingerprint.fingerprint
      ? "unchanged" as const
      : "changed" as const;
  const sourceNames = new Set(selectedSources.map((source) => source.record.name));
  const built = prepared.built;

  const now = new Date().toISOString();
  const candidateIds = new Set(built.map((item) => item.candidate.candidate_id));
  const approvedPages = await readApprovedCodegraphPages({ projectRoot: input.projectRoot, sourceNames });
  const approvedById = new Map(approvedPages
    .filter((page) => candidateIds.has(page.candidateId))
    .map((page) => [page.candidateId, page]));
  const merged = await withProjectWriteLock(input.projectRoot, "extract-custom-candidates", async () => {
    const manifest = await readManifest(input.projectRoot);
    const previousOwned = manifest.phases[input.phase.id];
    const previousOwnedIds = new Set(previousOwned?.candidateIds ?? []);
    const existing = (await readCandidateRecords(input.projectRoot)).filter((row) =>
      !previousOwnedIds.has(row.candidate_id) || candidateIds.has(row.candidate_id)
    );
    for (const staleId of previousOwnedIds) {
      if (!candidateIds.has(staleId)) await removeCandidateSnapshot(input.projectRoot, staleId);
    }
    const rejectedDecisions = await readRejectedDecisions(input.projectRoot);
    const mergeResult = mergeCandidates({
      existing,
      candidates: built.map((item) => item.candidate),
      approvedById,
      rejectedDecisions,
      sourceNames: new Set(),
      collection: input.phase.collection,
      now,
    });
    for (const candidateId of mergeResult.decisionsToRemove) rejectedDecisions.delete(candidateId);
    await writeCandidateRecords(input.projectRoot, mergeResult.rows);
    if (mergeResult.decisionsToRemove.length > 0) await writeRejectedDecisions(input.projectRoot, rejectedDecisions);
    await Promise.all(mergeResult.snapshotCleanupIds.map((id) => removeCandidateSnapshot(input.projectRoot, id)));
    const skipped = new Set([...mergeResult.skippedApprovedIds, ...mergeResult.skippedRejectedIds]);
    for (const item of built) {
      if (skipped.has(item.candidate.candidate_id)) continue;
      await writeCodeCandidateSnapshot({
        projectRoot: input.projectRoot,
        candidate: item.candidate,
        sourceName: item.primary.source,
        symbol: {
          name: item.primary.symbol,
          kind: item.primary.kind,
          visibility: item.candidate.visibility,
          file: item.primary.file,
          line: item.primary.line ?? 1,
        },
        markdown: item.markdown,
        runId: input.runId,
        phaseFingerprint,
      });
    }
    await writeExtractSourceFingerprint({ projectRoot: input.projectRoot, record: phaseFingerprint });
    await writeExtractSourceSymbolIndex({
      projectRoot: input.projectRoot,
      phaseFingerprint,
      sourceNames: new Set(),
      symbols: built.flatMap((item) => item.symbols),
      removeSymbols: previousOwned?.symbols ?? [],
    });
    await atomicWriteFile(join(input.projectRoot, CUSTOM_PHASE_MANIFEST), `${JSON.stringify({
      version: 2,
      phases: {
        ...manifest.phases,
        [input.phase.id]: {
          candidateIds: [...candidateIds].sort(),
          symbols: built.flatMap((item) => item.symbols),
        },
      },
    }, null, 2)}\n`);
    return mergeResult;
  });

  const pending = (await readCandidateRecords(input.projectRoot)).filter((row) =>
    row.status === "draft" && candidateIds.has(row.candidate_id)
  ).length;
  return {
    phaseId: input.phase.id,
    collection: input.phase.collection,
    sources: [...sourceNames].sort(),
    modules: 0,
    extractedSymbols: built.flatMap((item) => item.symbols).length,
    relationships: {
      mode: "source-backed-explicit",
      detected: built.reduce((sum, item) => sum + (item.candidate.code_edges?.length ?? 0), 0),
      emitted: built.reduce((sum, item) => sum + (item.candidate.code_edges?.length ?? 0), 0),
      omitted: { external: 0, endpointNotSelected: 0, ambiguousEndpoint: 0 },
    },
    candidates: {
      produced: built.length,
      added: merged.added,
      updated: merged.updated,
      unchanged: merged.unchanged,
      removed: merged.removed,
      skippedApproved: merged.skippedApproved,
      skippedRejected: merged.skippedRejected,
    },
    changes: {
      added: merged.added,
      updated: merged.updated,
      removed: merged.removed,
      unchangedApproved: merged.skippedApproved,
    },
    review: { required: pending > 0, pendingCandidates: pending },
    execution: { policy: "review", sourceState },
    next_action: pending > 0
      ? {
          kind: "continue-code-index-batch",
          command: "context status --format json",
          message: "Custom code extraction produced source-backed candidates. Context status will finish the extraction batch before opening one Review.",
        }
      : {
          kind: "continue-automatically",
          command: "context status --format json",
          message: "Custom code extraction produced no candidate delta that requires Review.",
        },
    moduleErrors: [],
    agent_hints: [],
    candidateFile: ".tmp/context-runtime/lifecycle/candidates.jsonl",
  };
}
