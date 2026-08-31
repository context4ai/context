import {
  loadIndexerRegistry,
  validateFinalizedIndexerRegistry,
  type PhaseDefinition,
} from "@c4a/context";
import { uniqueDocumentPhaseCommand } from "./documentPhaseCommands.js";
import { resolveDocumentPhaseSource } from "./documentRun.js";
import {
  resolveStructureCompileRoute,
  type DeclarationGraph,
  type StructureCompileResolution,
  type StructureLifecycleTarget,
} from "./declarationGraph.js";
import { LARK_DOCUMENT_NORMALIZER_VERSION } from "./documentCaptureContract.js";
import type { ProseCompileBatchProgress } from "./proseCompileBatch.js";
import { activeStructureGroups } from "./statusStructures.js";
import type { StructureDraftStatus } from "./statusReaders.js";
import type {
  ActiveStructuresStatus,
  AlignPhaseResolution,
  DocumentSourceStatus,
} from "./statusTypes.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";

export function resolutionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readIndexerWorkflowRegistryStatus(projectRoot: string): Promise<{
  state: "missing" | "pending" | "current" | "invalid";
  sourceRefs: string[];
  diagnostic?: string;
}> {
  try {
    const loaded = await loadIndexerRegistry(projectRoot);
    const sourceRefs = [...new Set(loaded.registry.requirements.flatMap((requirement) => [
      ...requirement.target_scope.targets.map((target) => target.source_ref),
      ...requirement.evidence_source_scope.targets.map((target) => target.source_ref),
    ]))].sort();
    try {
      validateFinalizedIndexerRegistry(loaded.registry);
      return { state: "current", sourceRefs };
    } catch (error) {
      return {
        state: "pending",
        sourceRefs,
        diagnostic: resolutionErrorMessage(error),
      };
    }
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) {
      return { state: "missing", sourceRefs: [] };
    }
    return {
      state: "invalid",
      sourceRefs: [],
      diagnostic: resolutionErrorMessage(error),
    };
  }
}

export async function resolveAlignPhaseRouting(input: {
  projectRoot: string;
  phases: readonly PhaseDefinition[];
  requestedSourceKeys: readonly string[];
  requestedCollections: readonly string[];
  requestedTargets?: readonly { sourceKey: string; collection: string }[];
  requestedGroups?: readonly StructureLifecycleTarget[];
}): Promise<AlignPhaseResolution | undefined> {
  if (input.requestedSourceKeys.length === 0 && input.requestedCollections.length === 0) return undefined;
  const checked: AlignPhaseResolution["checked"] = [];
  const matches: AlignPhaseResolution["matches"] = [];
  const requestedGroups = input.requestedGroups === undefined
    ? (input.requestedTargets === undefined
        ? input.requestedSourceKeys.flatMap((sourceKey) =>
            input.requestedCollections.map((collection) => ({
              sourceKey,
              collections: [collection],
              phaseCollection: collection,
            }))
          )
        : input.requestedTargets.map((target) => ({
            sourceKey: target.sourceKey,
            collections: [target.collection],
            phaseCollection: target.collection,
          })))
    : [...input.requestedGroups];
  const requestedTargets = requestedGroups.flatMap((target) =>
    (target.phaseCollection === undefined ? target.collections : [target.phaseCollection])
      .map((collection) => ({ sourceKey: target.sourceKey, collection }))
  );
  for (const phase of input.phases) {
    if (phase.kind !== "phase.align.prose") continue;
    const declaredSourceKey = phase.source.name;
    try {
      const resolved = await resolveDocumentPhaseSource({ projectRoot: input.projectRoot, phase });
      const sourceKey = `${resolved.sourceType}:${resolved.sourceName}`;
      const sourceMatches = input.requestedSourceKeys.length === 0 || input.requestedSourceKeys.includes(sourceKey);
      const collectionMatches = input.requestedCollections.length === 0 || input.requestedCollections.includes(phase.collection);
      const matched = requestedGroups.length === 0
        ? sourceMatches && collectionMatches
        : requestedGroups.some((target) =>
            target.sourceKey === sourceKey &&
            (target.phaseCollection === undefined
              ? target.collections.includes(phase.collection)
              : target.phaseCollection === phase.collection)
          );
      const command = `context run align:${resolved.sourceType}:${resolved.sourceName}:${phase.collection}`;
      checked.push({
        phaseId: phase.id,
        declaredSourceKey,
        sourceKey,
        collection: phase.collection,
        matched,
        ...(!sourceMatches
          ? { reason: `resolved source ${sourceKey} is not referenced by requested structure targets` }
          : !collectionMatches
            ? { reason: `collection ${phase.collection} is not present in requested structure targets` }
            : !matched
              ? { reason: `source and collection pair ${sourceKey}:${phase.collection} is not an active structure target` }
              : {}),
      });
      if (matched) matches.push({ phaseId: phase.id, sourceKey, collection: phase.collection, command });
    } catch (error) {
      checked.push({
        phaseId: phase.id,
        declaredSourceKey,
        collection: phase.collection,
        matched: false,
        reason: resolutionErrorMessage(error),
      });
    }
  }
  const matchCounts = requestedGroups.map((target) => matches.filter((match) =>
    match.sourceKey === target.sourceKey &&
    (target.phaseCollection === undefined
      ? target.collections.includes(match.collection)
      : target.phaseCollection === match.collection)
  ).length);
  const hasMissing = matchCounts.some((count) => count === 0);
  const hasAmbiguous = matchCounts.some((count) => count > 1);
  return {
    state: hasAmbiguous
      ? "ambiguous"
      : hasMissing || matches.length === 0
        ? "unresolved"
        : matches.length === 1 ? "resolved" : "resolved-multiple",
    requestedSourceKeys: [...input.requestedSourceKeys],
    requestedCollections: [...input.requestedCollections],
    requestedTargets,
    matches,
    checked,
  };
}

export function alignStatusCommand(input: {
  hasCapturedSources: boolean;
  stagedAlignCommand?: string;
  phases: readonly PhaseDefinition[];
  documentSources: readonly DocumentSourceStatus[];
  suffix: string;
}): string | undefined {
  if (!input.hasCapturedSources) return undefined;
  if (input.stagedAlignCommand !== undefined) return `${input.stagedAlignCommand}${input.suffix}`;
  return uniqueDocumentPhaseCommand({
    phases: input.phases,
    kind: "phase.align.prose",
    verb: "align",
    documentSources: input.documentSources,
    suffix: input.suffix,
  });
}

export function compileStatusRouting(input: {
  structure: StructureDraftStatus;
  activeStructures: ActiveStructuresStatus;
  graph: DeclarationGraph;
  compileBatch?: ProseCompileBatchProgress;
  hasCapturedSources: boolean;
}): {
  resolution?: StructureCompileResolution;
  command?: string;
} {
  const sourceKeys = input.compileBatch?.nextSourceKeys ?? input.structure.sourceKeys ?? [];
  const collections = input.compileBatch?.nextStructureCollections ?? input.structure.collections ?? [];
  if (sourceKeys.length === 0 || collections.length === 0) return {};
  const phaseCollection = input.compileBatch?.nextPhaseCollection ?? input.structure.phaseCollection;
  const activeGroups = activeStructureGroups(input.activeStructures);
  const targets = sourceKeys.map((sourceKey) => {
    const matchingActive = activeGroups.find((group) =>
      group.sourceKey === sourceKey &&
      collections.every((collection) => group.collections.includes(collection))
    );
    return {
      sourceKey,
      collections,
      ...(phaseCollection !== undefined
        ? { phaseCollection }
        : matchingActive?.phaseCollection !== undefined
          ? { phaseCollection: matchingActive.phaseCollection }
          : {}),
    };
  });
  const resolution = resolveStructureCompileRoute({
    graph: input.graph,
    sourceKeys,
    collections,
    targets,
  });
  if (!input.hasCapturedSources || input.compileBatch?.nextViewRef === undefined) return { resolution };
  const match = resolution.state === "resolved" && resolution.matches.length === 1
    ? resolution.matches[0]
    : undefined;
  return {
    resolution,
    ...(match !== undefined
      ? { command: `${match.command} --stage --format json` }
      : {}),
  };
}

export function resourcePlaceholderRepairTargets(
  issues: readonly ProjectVerifyIssue[],
): { sourceKeys: string[]; viewRefs: string[] } {
  const relevant = issues.filter((issue) =>
    issue.severity === "error" && issue.code === "approved-resource-placeholder-unresolved"
  );
  return {
    sourceKeys: [...new Set(relevant.flatMap((issue) => issue.source_keys ?? []))].sort(),
    viewRefs: [...new Set(relevant.flatMap((issue) => issue.view_ref === undefined ? [] : [issue.view_ref]))].sort(),
  };
}

export function pendingDocumentCaptureCommands(input: {
  phases: readonly PhaseDefinition[];
  documentSources: readonly DocumentSourceStatus[];
  recaptureSourceKeys?: readonly string[];
}): { phaseIds: string[]; commands: string[]; missingSources: DocumentSourceStatus[] } {
  const recaptureSourceKeys = new Set(input.recaptureSourceKeys ?? []);
  const pendingSources = input.documentSources.filter((source) =>
    !source.snapshotReady || (
      recaptureSourceKeys.has(`${source.type}:${source.name}`) &&
      source.type === "lark" &&
      source.normalizerVersion !== LARK_DOCUMENT_NORMALIZER_VERSION
    )
  );
  const phaseIds: string[] = [];
  const missingSources: DocumentSourceStatus[] = [];
  for (const source of pendingSources) {
    const expectedKind = source.type === "file" ? "phase.capture.file" : "phase.capture.lark";
    const expectedIds = new Set([
      `capture:${source.type}:${source.name}`,
      ...(source.id === undefined ? [] : [`capture:${source.type}:${source.id}`]),
    ]);
    const matchingPhase = input.phases.find((phase) => {
      if (phase.kind !== expectedKind) return false;
      return expectedIds.has(phase.id);
    });
    if (matchingPhase !== undefined) phaseIds.push(matchingPhase.id);
    else missingSources.push(source);
  }
  const uniquePhaseIds = [...new Set(phaseIds)];
  return {
    phaseIds: uniquePhaseIds,
    commands: uniquePhaseIds.map((phaseId) => `context run ${phaseId}`),
    missingSources,
  };
}
