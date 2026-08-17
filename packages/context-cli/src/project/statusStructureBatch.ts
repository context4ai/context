import type {
  ActiveStructuresStatus,
  PendingStructureTarget,
  UnclassifiedDocumentTarget,
} from "./statusTypes.js";

export interface StructureBatchStatus {
  state: "empty" | "awaiting-classification" | "awaiting-configuration" | "awaiting-structure" | "structures-active" | "complete";
  sourceCount: number;
  slotCount: number;
  slots: Array<{
    sourceKey: string;
    collection?: string;
    stage: "unclassified" | "configuration-required" | "structure-pending" | "structure-active";
    nextCommand?: string;
    configurationGaps?: Array<"compile" | "review">;
    structureDigest?: string;
  }>;
}

export function structureBatchStatus(input: {
  activeStructures: ActiveStructuresStatus;
  unclassifiedTargets: readonly UnclassifiedDocumentTarget[];
  pendingTargets: readonly PendingStructureTarget[];
}): StructureBatchStatus {
  const unclassified = input.unclassifiedTargets.map((target) => ({
    sourceKey: target.sourceKey,
    stage: "unclassified" as const,
    nextCommand: target.command,
  }));
  const pending = input.pendingTargets.map((target) => ({
    sourceKey: target.sourceKey,
    collection: target.collection,
    stage: target.configurationGaps.length > 0 ? "configuration-required" as const : "structure-pending" as const,
    ...(target.configurationGaps.length > 0 ? { configurationGaps: target.configurationGaps } : {}),
    ...(target.configurationGaps.length === 0 ? { nextCommand: target.command } : {}),
  }));
  const pendingKeys = new Set(pending.map((slot) => `${slot.sourceKey}\u0000${slot.collection}`));
  const active = input.activeStructures.slots
    .filter((slot) => !pendingKeys.has(`${slot.sourceKey}\u0000${slot.collection}`))
    .map((slot) => ({
      sourceKey: slot.sourceKey,
      collection: slot.collection,
      stage: "structure-active" as const,
      structureDigest: slot.structureDigest,
    }));
  const slots = [...unclassified, ...pending, ...active];
  return {
    state: unclassified.length > 0
      ? "awaiting-classification"
      : pending.some((slot) => slot.stage === "configuration-required")
        ? "awaiting-configuration"
        : pending.length > 0
          ? "awaiting-structure"
          : active.length > 0
            ? "structures-active"
            : "empty",
    sourceCount: new Set(slots.map((slot) => slot.sourceKey)).size,
    slotCount: slots.length,
    slots,
  };
}
