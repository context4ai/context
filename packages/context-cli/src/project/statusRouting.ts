import {
  loadIndexerRegistry,
  validateFinalizedIndexerRegistry,
  type PhaseDefinition,
} from "@c4a/context";
import type { DocumentSourceStatus } from "./statusTypes.js";

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
      return { state: "pending", sourceRefs, diagnostic: resolutionErrorMessage(error) };
    }
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) {
      return { state: "missing", sourceRefs: [] };
    }
    return { state: "invalid", sourceRefs: [], diagnostic: resolutionErrorMessage(error) };
  }
}

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
