import type { DocumentSourceType, PhaseDefinition } from "@c4a/context";

export interface DocumentPhaseCommandSource {
  type: DocumentSourceType;
  id?: string;
  name: string;
  snapshotReady?: boolean;
}

function parseDocumentPhaseId(input: {
  phaseId: string;
  verb: "align" | "compile";
}): { sourceType?: DocumentSourceType; sourceName: string; collection: string } | undefined {
  const neutral = new RegExp(`^${input.verb}:source:([^:]+):(.+)$`, "u").exec(input.phaseId);
  if (neutral !== null) {
    const sourceName = neutral[1];
    const collection = neutral[2];
    return sourceName === undefined || collection === undefined ? undefined : { sourceName, collection };
  }
  const typed = new RegExp(`^${input.verb}:(file|lark):([^:]+):(.+)$`, "u").exec(input.phaseId);
  if (typed === null) return undefined;
  const sourceType = typed[1] as DocumentSourceType | undefined;
  const sourceName = typed[2];
  const collection = typed[3];
  return sourceType === undefined || sourceName === undefined || collection === undefined
    ? undefined
    : { sourceType, sourceName, collection };
}

function sourceMatchesPhase(input: {
  source: DocumentPhaseCommandSource;
  sourceName: string;
  sourceType?: DocumentSourceType;
  requireSnapshotReady: boolean;
}): boolean {
  if (input.requireSnapshotReady && input.source.snapshotReady !== true) return false;
  if (input.sourceType !== undefined && input.source.type !== input.sourceType) return false;
  return input.source.name === input.sourceName || input.source.id === input.sourceName;
}

export function documentPhaseCommand(input: {
  phaseId: string;
  verb: "align" | "compile";
  documentSources: readonly DocumentPhaseCommandSource[];
  suffix: string;
  requireSnapshotReady?: boolean;
}): string | undefined {
  const parsed = parseDocumentPhaseId({ phaseId: input.phaseId, verb: input.verb });
  if (parsed === undefined) return undefined;
  const requireSnapshotReady = input.requireSnapshotReady ?? true;
  const source = input.documentSources.find((entry) =>
    sourceMatchesPhase({
      source: entry,
      sourceName: parsed.sourceName,
      ...(parsed.sourceType !== undefined ? { sourceType: parsed.sourceType } : {}),
      requireSnapshotReady,
    })
  );
  if (source === undefined) return undefined;
  const phaseId = `${input.verb}:${source.type}:${source.name}:${parsed.collection}`;
  return `context run ${phaseId}${input.suffix}`;
}

export function uniqueDocumentPhaseCommand(input: {
  phases: readonly PhaseDefinition[];
  kind: "phase.align.prose" | "phase.compile.prose";
  verb: "align" | "compile";
  documentSources: readonly DocumentPhaseCommandSource[];
  suffix: string;
  requireSnapshotReady?: boolean;
}): string | undefined {
  const commands = [...new Set(input.phases
    .filter((phase) => phase.kind === input.kind)
    .flatMap((phase) => {
      const command = documentPhaseCommand({
        phaseId: phase.id,
        verb: input.verb,
        documentSources: input.documentSources,
        suffix: input.suffix,
        ...(input.requireSnapshotReady !== undefined ? { requireSnapshotReady: input.requireSnapshotReady } : {}),
      });
      return command === undefined ? [] : [command];
    }))];
  return commands.length === 1 ? commands[0] : undefined;
}
