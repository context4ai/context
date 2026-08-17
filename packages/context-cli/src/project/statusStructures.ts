import type { StructureLifecycleTarget } from "./declarationGraph.js";
import {
  activeStructureSlots,
  readStructureSnapshotPayload,
} from "./proseStructureStore.js";
import type { StructureDraftStatus } from "./statusReaders.js";
import type { ActiveStructuresStatus } from "./statusTypes.js";

export function structureTargets(
  structure: StructureDraftStatus,
): Array<{ sourceKey: string; collection: string }> {
  return (structure.sourceKeys ?? []).flatMap((sourceKey) =>
    (structure.collections ?? []).map((collection) => ({ sourceKey, collection }))
  );
}

export function stagedStructureGroups(
  structure: StructureDraftStatus,
): StructureLifecycleTarget[] {
  const collections = structure.collections ?? [];
  return (structure.sourceKeys ?? []).map((sourceKey) => ({
    sourceKey,
    collections,
    ...(structure.phaseCollection === undefined
      ? {}
      : { phaseCollection: structure.phaseCollection }),
  }));
}

export function activeStructureGroups(
  structures: ActiveStructuresStatus,
): StructureLifecycleTarget[] {
  const groups = new Map<string, StructureLifecycleTarget>();
  for (const slot of structures.slots.filter((candidate) => candidate.snapshotCurrent)) {
    const key = `${slot.sourceKey}\u0000${slot.structureDigest}`;
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        sourceKey: slot.sourceKey,
        collections: [slot.collection],
        ...(slot.phaseCollection === undefined
          ? {}
          : { phaseCollection: slot.phaseCollection }),
      });
      continue;
    }
    if (!current.collections.includes(slot.collection)) current.collections.push(slot.collection);
    if (current.phaseCollection === undefined && slot.phaseCollection !== undefined) {
      current.phaseCollection = slot.phaseCollection;
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    collections: [...group.collections].sort(),
  }));
}

export async function readActiveStructuresStatus(
  projectRoot: string,
  currentSnapshotHashes: ReadonlyMap<string, string>,
): Promise<ActiveStructuresStatus> {
  try {
    const slots = await activeStructureSlots(projectRoot);
    if (slots.length === 0) {
      return {
        state: "missing",
        count: 0,
        slotCount: 0,
        sourceKeys: [],
        collections: [],
        structureDigests: [],
        slots: [],
        diagnostics: [],
      };
    }
    const snapshots = new Map<string, Awaited<ReturnType<typeof readStructureSnapshotPayload>>>();
    for (const digest of [...new Set(slots.map((slot) => slot.structureDigest))]) {
      snapshots.set(digest, await readStructureSnapshotPayload(projectRoot, digest));
    }
    const statusSlots = slots.map((slot) => {
      const snapshot = snapshots.get(slot.structureDigest);
      const evidenceSnapshotHash = snapshot?.evidence_snapshot_hash;
      const currentSnapshotHash = currentSnapshotHashes.get(slot.source);
      return {
        sourceKey: slot.source,
        collection: slot.collection,
        structureDigest: slot.structureDigest,
        snapshotReady: snapshot !== undefined,
        snapshotCurrent: snapshot !== undefined &&
          evidenceSnapshotHash !== undefined &&
          currentSnapshotHash !== undefined &&
          evidenceSnapshotHash === currentSnapshotHash,
        ...(evidenceSnapshotHash === undefined ? {} : { evidenceSnapshotHash }),
        ...(currentSnapshotHash === undefined ? {} : { currentSnapshotHash }),
        ...(snapshot?.lifecycle.phase_collection === undefined
          ? {}
          : { phaseCollection: snapshot.lifecycle.phase_collection }),
      };
    });
    const missing = statusSlots.filter((slot) => !slot.snapshotReady);
    return {
      state: missing.length === 0 ? "ready" : "invalid",
      count: snapshots.size,
      slotCount: statusSlots.length,
      sourceKeys: [...new Set(statusSlots.map((slot) => slot.sourceKey))].sort(),
      collections: [...new Set(statusSlots.map((slot) => slot.collection))].sort(),
      structureDigests: [...new Set(statusSlots.map((slot) => slot.structureDigest))].sort(),
      slots: statusSlots,
      diagnostics: missing.map((slot) =>
        `active structure snapshot is missing: ${slot.structureDigest} (${slot.sourceKey}:${slot.collection})`
      ),
    };
  } catch (error) {
    return {
      state: "invalid",
      count: 0,
      slotCount: 0,
      sourceKeys: [],
      collections: [],
      structureDigests: [],
      slots: [],
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}
