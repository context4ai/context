import type { PhaseDefinition } from "@c4a/context";
import { resolveDocumentPhaseSource, type DocumentPhaseDefinition } from "./documentRun.js";

export interface ResolvedDocumentPhase {
  phaseId: string;
  kind: DocumentPhaseDefinition["kind"];
  sourceKey: string;
  collection?: string;
}

export interface DeclarationGraphRow {
  sourceKey: string;
  collection: string;
  capture: "declared" | "missing";
  align: "declared";
  compile: "declared" | "missing";
  review: "declared" | "covered-by-all" | "missing";
  gaps: Array<"capture" | "compile" | "review">;
  suggestions: string[];
}

export interface DeclarationGraph {
  rows: DeclarationGraphRow[];
  gaps: string[];
  unresolvedPhases: Array<{ phaseId: string; reason: string }>;
  resolvedPhases: ResolvedDocumentPhase[];
}

export interface StructureCompileResolution {
  state: "resolved" | "missing" | "ambiguous";
  requestedSourceKeys: string[];
  requestedCollections: string[];
  requestedTargets: Array<{
    sourceKey: string;
    collections: string[];
    phaseCollection?: string;
  }>;
  matches: Array<{ phaseId: string; sourceKey: string; collection: string; command: string }>;
  missingCollections: string[];
  ambiguousCollections: string[];
}

export interface StructureLifecycleTarget {
  sourceKey: string;
  collections: string[];
  phaseCollection?: string;
}

function isDocumentPhase(phase: PhaseDefinition): phase is DocumentPhaseDefinition {
  return phase.kind === "phase.capture.file" ||
    phase.kind === "phase.capture.lark" ||
    phase.kind === "phase.align.prose" ||
    phase.kind === "phase.compile.prose";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceExpression(sourceKey: string): string {
  const separator = sourceKey.indexOf(":");
  const type = separator < 0 ? "file" : sourceKey.slice(0, separator);
  const name = separator < 0 ? sourceKey : sourceKey.slice(separator + 1);
  return `source("${name}", { type: "${type}" })`;
}

export async function inspectDeclarationGraph(input: {
  projectRoot: string;
  phases: readonly PhaseDefinition[];
}): Promise<DeclarationGraph> {
  const resolvedPhases: ResolvedDocumentPhase[] = [];
  const unresolvedPhases: DeclarationGraph["unresolvedPhases"] = [];
  for (const phase of input.phases) {
    if (!isDocumentPhase(phase)) continue;
    try {
      const resolved = await resolveDocumentPhaseSource({ projectRoot: input.projectRoot, phase });
      resolvedPhases.push({
        phaseId: phase.id,
        kind: phase.kind,
        sourceKey: `${resolved.sourceType}:${resolved.sourceName}`,
        ...(phase.kind === "phase.align.prose" || phase.kind === "phase.compile.prose"
          ? { collection: phase.collection }
          : {}),
      });
    } catch (error) {
      unresolvedPhases.push({ phaseId: phase.id, reason: errorMessage(error) });
    }
  }

  const reviewPhases = input.phases.filter((phase) => phase.kind === "phase.review.validity");
  const reviewAll = reviewPhases.some((phase) => phase.scope.kind === "all");
  const reviewCollections = new Set<string>(reviewPhases.flatMap((phase) =>
    phase.scope.kind === "collection" ? [phase.scope.collection] : []
  ));
  const captureSources = new Set(resolvedPhases
    .filter((phase) => phase.kind === "phase.capture.file" || phase.kind === "phase.capture.lark")
    .map((phase) => phase.sourceKey));
  const compileKeys = new Set(resolvedPhases
    .filter((phase) => phase.kind === "phase.compile.prose")
    .map((phase) => `${phase.sourceKey}\u0000${phase.collection}`));
  const alignRoutes = resolvedPhases.filter((phase) => phase.kind === "phase.align.prose" && phase.collection !== undefined);
  const rows = alignRoutes.map((phase): DeclarationGraphRow => {
    const capture = captureSources.has(phase.sourceKey) ? "declared" : "missing";
    const compile = compileKeys.has(`${phase.sourceKey}\u0000${phase.collection}`) ? "declared" : "missing";
    const review = reviewCollections.has(phase.collection!)
      ? "declared"
      : reviewAll
        ? "covered-by-all"
        : "missing";
    const gaps: DeclarationGraphRow["gaps"] = [
      ...(capture === "missing" ? ["capture" as const] : []),
      ...(compile === "missing" ? ["compile" as const] : []),
      ...(review === "missing" ? ["review" as const] : []),
    ];
    const source = sourceExpression(phase.sourceKey);
    return {
      sourceKey: phase.sourceKey,
      collection: phase.collection!,
      capture,
      align: "declared",
      compile,
      review,
      gaps,
      suggestions: [
        ...(compile === "missing"
          ? [`compileProse({ source: ${source}, collection: "${phase.collection}" })`]
          : []),
        ...(review === "missing"
          ? [`reviewValidity({ collection: "${phase.collection}" }) or reviewValidity({ scope: "all" })`]
          : []),
      ],
    };
  });
  return {
    rows,
    gaps: rows.flatMap((row) => row.gaps.map((gap) => `${row.sourceKey}:${row.collection}:${gap}`)),
    unresolvedPhases,
    resolvedPhases,
  };
}

export function resolveStructureCompileRoute(input: {
  graph: DeclarationGraph;
  sourceKeys: readonly string[];
  collections: readonly string[];
  targets?: readonly StructureLifecycleTarget[];
}): StructureCompileResolution {
  const requestedTargets = input.targets === undefined
    ? input.sourceKeys.flatMap((sourceKey) =>
        input.collections.map((collection) => ({
          sourceKey,
          collections: [collection],
          phaseCollection: collection,
        }))
      )
    : [...input.targets];
  const compilePhases = input.graph.resolvedPhases.filter((phase) =>
    phase.kind === "phase.compile.prose" &&
    phase.collection !== undefined &&
    requestedTargets.some((target) =>
      target.sourceKey === phase.sourceKey &&
      (target.phaseCollection === undefined
        ? target.collections.includes(phase.collection!)
        : target.phaseCollection === phase.collection)
    )
  );
  const matches = compilePhases.map((phase) => ({
    phaseId: phase.phaseId,
    sourceKey: phase.sourceKey,
    collection: phase.collection!,
    command: `context run compile:${phase.sourceKey}:${phase.collection}`,
  }));
  const matchCount = (target: StructureLifecycleTarget): number => matches.filter((match) =>
    match.sourceKey === target.sourceKey &&
    (target.phaseCollection === undefined
      ? target.collections.includes(match.collection)
      : target.phaseCollection === match.collection)
  ).length;
  const missingTargets = requestedTargets.filter((target) => matchCount(target) === 0);
  const ambiguousTargets = requestedTargets.filter((target) => matchCount(target) > 1);
  const missingCollections = [...new Set(missingTargets.flatMap((target) =>
    target.phaseCollection === undefined ? target.collections : [target.phaseCollection]
  ))];
  const ambiguousCollections = [...new Set(ambiguousTargets.flatMap((target) =>
    target.phaseCollection === undefined ? target.collections : [target.phaseCollection]
  ))];
  return {
    state: ambiguousTargets.length > 0 ? "ambiguous" : missingTargets.length > 0 ? "missing" : "resolved",
    requestedSourceKeys: [...new Set(requestedTargets.map((target) => target.sourceKey))],
    requestedCollections: [...new Set(requestedTargets.flatMap((target) =>
      target.phaseCollection === undefined ? target.collections : [target.phaseCollection]
    ))],
    requestedTargets,
    matches,
    missingCollections,
    ambiguousCollections,
  };
}
