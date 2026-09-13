import type { PhaseDefinition } from "@c4a/context";
import type { DocumentSourceStatus } from "./statusTypes.js";

export function pendingDocumentCaptureCommands(input: {
  phases: readonly PhaseDefinition[];
  documentSources: readonly DocumentSourceStatus[];
}): { phaseIds: string[]; commands: string[]; missingSources: DocumentSourceStatus[] } {
  const pendingSources = input.documentSources.filter((source) =>
    !source.snapshotReady
  );
  const phaseIds: string[] = [];
  const missingSources: DocumentSourceStatus[] = [];
  for (const source of pendingSources) {
    const expectedKind = source.type === "file" ? "phase.capture.file" : "phase.capture.lark";
    const expectedIds = new Set([
      `capture:${source.type}:${source.name}`,
      ...(source.id === undefined ? [] : [`capture:${source.type}:${source.id}`]),
    ]);
    const matchingPhase = input.phases.find((phase) =>
      phase.kind === expectedKind && expectedIds.has(phase.id)
    );
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
