import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CustomCodeCandidateDraft,
  CustomCodeEvidence,
  ExtractCustomPhaseDefinition,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { candidateIdFromCollectionNodeRef, viewRefFromCollectionNodeRef } from "./candidateIdentity.js";
import { readApprovedCodegraphPages } from "./codegraphApproved.js";
import {
  extractPhaseSourceFingerprint,
  readExtractSourceFingerprints,
  removeCandidateSnapshot,
  stableHash,
  writeCodeCandidateSnapshot,
  writeExtractSourceFingerprint,
  writeExtractSourceSymbolIndex,
} from "./extractCandidateArtifacts.js";
import { mergeCandidates } from "./extractCandidateBuild.js";
import type { CandidateDraft, ExtractSourceSymbolIndexEntry, ExtractTsRunResult } from "./extractCandidateTypes.js";
import { assertSafeEntityId } from "./entityId.js";
import {
  knowledgeTargetPathForNode,
  readCandidateRecords,
  writeCandidateRecords,
} from "./candidateLedger.js";
import { selectRepoSourcesForExtraction } from "./extractCandidates.js";
import { readRejectedDecisions, writeRejectedDecisions } from "./reviewDecisions.js";
import { withProjectWriteLock } from "./writeLock.js";

const CUSTOM_PHASE_MANIFEST = ".tmp/context-runtime/extract/custom-phase-candidates.json";

interface CustomPhaseCandidateManifest {
  version: 2;
  phases: Record<string, {
    candidateIds: string[];
    symbols: ExtractSourceSymbolIndexEntry[];
  }>;
}

function customInputError(phaseId: string, message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, `custom extraction '${phaseId}' returned invalid candidates: ${message}`, {
    category: ErrorCategory.UserInputInvalid,
    code: "custom-extraction-result-invalid",
    phaseId,
    ...detail,
    next: "Fix the extractCustom result shape and rerun the phase.",
  });
}

function nonEmpty(value: string, field: string, phaseId: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw customInputError(phaseId, `${field} must be a non-empty string`, { field });
  return trimmed;
}

function validateEvidence(input: {
  phaseId: string;
  evidence: CustomCodeEvidence;
  sourceNames: ReadonlySet<string>;
  field: string;
}): CustomCodeEvidence {
  const source = nonEmpty(input.evidence.source, `${input.field}.source`, input.phaseId);
  const file = nonEmpty(input.evidence.file, `${input.field}.file`, input.phaseId).replaceAll("\\", "/");
  const symbol = nonEmpty(input.evidence.symbol, `${input.field}.symbol`, input.phaseId);
  const kind = nonEmpty(input.evidence.kind, `${input.field}.kind`, input.phaseId);
  const digest = nonEmpty(input.evidence.digest, `${input.field}.digest`, input.phaseId).toLowerCase();
  if (!input.sourceNames.has(source)) {
    throw customInputError(input.phaseId, `${input.field}.source is outside the phase source scope`, {
      field: `${input.field}.source`,
      source,
      available_sources: [...input.sourceNames],
    });
  }
  if (
    file.startsWith("/") ||
    file.split("/").some((part) => part.length === 0 || part === "." || part === "..") ||
    symbol.includes(":") || symbol.includes("@") ||
    kind.includes(":") || kind.includes("@") ||
    !/^[a-f0-9]{8,64}$/u.test(digest)
  ) {
    throw customInputError(input.phaseId, `${input.field} cannot form a canonical code source_ref`, {
      field: input.field,
      evidence: input.evidence,
    });
  }
  if (input.evidence.line !== undefined && (!Number.isInteger(input.evidence.line) || input.evidence.line < 1)) {
    throw customInputError(input.phaseId, `${input.field}.line must be a positive integer`, {
      field: `${input.field}.line`,
    });
  }
  return {
    source,
    file,
    symbol,
    kind,
    digest,
    ...(input.evidence.line !== undefined ? { line: input.evidence.line } : {}),
  };
}

function sourceRef(evidence: CustomCodeEvidence): string {
  return `repo:${evidence.source}#symbol:${evidence.file}:${evidence.symbol}:${evidence.kind}@${evidence.digest}`;
}

function candidateFromCustom(input: {
  phase: ExtractCustomPhaseDefinition;
  draft: CustomCodeCandidateDraft;
  index: number;
  sourceNames: ReadonlySet<string>;
}): { candidate: CandidateDraft; markdown: string; primary: CustomCodeEvidence; symbols: ExtractSourceSymbolIndexEntry[] } {
  const field = `candidates[${input.index}]`;
  const nodeRef = nonEmpty(input.draft.nodeRef, `${field}.nodeRef`, input.phase.id);
  assertSafeEntityId(nodeRef);
  if (!Array.isArray(input.draft.evidence) || input.draft.evidence.length === 0) {
    throw customInputError(input.phase.id, `${field}.evidence must contain at least one source-backed symbol`, { field: `${field}.evidence` });
  }
  const evidence = input.draft.evidence.map((item, index) => validateEvidence({
    phaseId: input.phase.id,
    evidence: item,
    sourceNames: input.sourceNames,
    field: `${field}.evidence[${index}]`,
  }));
  const allEvidence = [...evidence];
  const sourceRefs = [...new Set(evidence.map(sourceRef))].sort();
  const codeEdges = (input.draft.edges ?? []).map((edge, edgeIndex) => {
    if (
      edge === null || typeof edge !== "object" ||
      (edge.type !== "contains" && edge.type !== "depends_on") ||
      !Array.isArray(edge.evidence) || edge.evidence.length === 0
    ) {
      throw customInputError(input.phase.id, `${field}.edges[${edgeIndex}] must have a supported type and source-backed evidence`, {
        field: `${field}.edges[${edgeIndex}]`,
      });
    }
    const edgeEvidence = edge.evidence.map((item, evidenceIndex) => validateEvidence({
      phaseId: input.phase.id,
      evidence: item,
      sourceNames: input.sourceNames,
      field: `${field}.edges[${edgeIndex}].evidence[${evidenceIndex}]`,
    }));
    allEvidence.push(...edgeEvidence);
    const from = nonEmpty(edge.from, `${field}.edges[${edgeIndex}].from`, input.phase.id);
    const to = nonEmpty(edge.to, `${field}.edges[${edgeIndex}].to`, input.phase.id);
    if (from !== nodeRef) {
      throw customInputError(input.phase.id, `${field}.edges[${edgeIndex}].from must equal nodeRef`, {
        field: `${field}.edges[${edgeIndex}].from`,
        expected: nodeRef,
      });
    }
    return {
      type: edge.type,
      from,
      to,
      source_refs: [...new Set(edgeEvidence.map(sourceRef))].sort(),
      relation_type: nonEmpty(edge.relationType, `${field}.edges[${edgeIndex}].relationType`, input.phase.id),
    };
  });
  const review = input.draft.review;
  if (review === null || typeof review !== "object" || !Array.isArray(review.signals) || review.signals.length === 0) {
    throw customInputError(input.phase.id, `${field}.review.signals must contain at least one signal`, { field: `${field}.review.signals` });
  }
  const candidateId = candidateIdFromCollectionNodeRef(input.phase.collection, nodeRef);
  const viewRef = viewRefFromCollectionNodeRef(input.phase.collection, nodeRef);
  const markdown = nonEmpty(input.draft.markdown, `${field}.markdown`, input.phase.id);
  const candidate: CandidateDraft = {
    candidate_id: candidateId,
    node_ref: nodeRef,
    view_ref: viewRef,
    collection: input.phase.collection,
    status: "draft",
    candidate_type: "code-symbol",
    change: "add",
    kind: nonEmpty(input.draft.kind, `${field}.kind`, input.phase.id),
    visibility: nonEmpty(input.draft.visibility, `${field}.visibility`, input.phase.id),
    module: nonEmpty(input.draft.module, `${field}.module`, input.phase.id),
    path: knowledgeTargetPathForNode(input.phase.collection, nodeRef),
    source_refs: sourceRefs,
    ...(codeEdges.length > 0 ? { code_edges: codeEdges } : {}),
    fingerprint: stableHash({
      candidate_id: candidateId,
      node_ref: nodeRef,
      view_ref: viewRef,
      collection: input.phase.collection,
      kind: input.draft.kind,
      visibility: input.draft.visibility,
      module: input.draft.module,
      source_refs: sourceRefs,
      code_edges: codeEdges,
      markdown,
    }),
    review: {
      title: nonEmpty(review.title, `${field}.review.title`, input.phase.id),
      summary: nonEmpty(review.summary, `${field}.review.summary`, input.phase.id),
      ...(review.behaviorSummary !== undefined
        ? { behavior_summary: nonEmpty(review.behaviorSummary, `${field}.review.behaviorSummary`, input.phase.id) }
        : {}),
      ...(review.edgeSummary !== undefined
        ? { edge_summary: nonEmpty(review.edgeSummary, `${field}.review.edgeSummary`, input.phase.id) }
        : {}),
      signals: review.signals.map((signal, index) => nonEmpty(signal, `${field}.review.signals[${index}]`, input.phase.id)),
      reason: nonEmpty(review.reason, `${field}.review.reason`, input.phase.id),
    },
  };
  return {
    candidate,
    markdown,
    primary: evidence[0]!,
    symbols: allEvidence.map((item) => ({
      source: item.source,
      file: item.file,
      name: item.symbol,
      kind: item.kind,
      digest: item.digest,
    })),
  };
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
}): Promise<ExtractTsRunResult> {
  const selectedSources = await selectRepoSourcesForExtraction({
    projectRoot: input.projectRoot,
    phase: input.phase,
    materialize: true,
  });
  const notReady = selectedSources.filter((source) => !source.status.ready);
  if (notReady.length > 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, "repo source is not ready for custom extraction", {
      category: ErrorCategory.WorkspaceStateInvalid,
      sources: notReady.map((source) => source.record.name),
      next: "Resolve the source diagnostics and rerun the custom extraction phase.",
    });
  }
  const phaseFingerprint = extractPhaseSourceFingerprint({ phase: input.phase, sources: selectedSources });
  const previousFingerprint = (await readExtractSourceFingerprints(input.projectRoot)).phases[input.phase.id];
  const sourceState = previousFingerprint === undefined
    ? "first-run" as const
    : previousFingerprint.fingerprint === phaseFingerprint.fingerprint
      ? "unchanged" as const
      : "changed" as const;
  const output = await input.phase.extract({ projectRoot: input.projectRoot, runId: input.runId });
  if (output === null || typeof output !== "object" || !Array.isArray(output.candidates)) {
    throw customInputError(input.phase.id, "extract must return { candidates: [...] }");
  }
  const sourceNames = new Set(selectedSources.map((source) => source.record.name));
  const built = output.candidates.map((draft, index) => candidateFromCustom({
    phase: input.phase,
    draft,
    index,
    sourceNames,
  }));
  const duplicateIds = built.map((item) => item.candidate.candidate_id).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw customInputError(input.phase.id, "candidate nodeRef values must be unique", {
      duplicate_candidate_ids: [...new Set(duplicateIds)].sort(),
    });
  }

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
      mode: "source-backed-ast",
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
          kind: "continue-codegraph-batch",
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
