import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { normalizeAlignPayloadForWrite, parseAlignPayload } from "./proseAlignPayloadParse.js";
import type { AlignPayload } from "./proseAlignTypes.js";
import { STRUCTURE_FILE } from "./proseCompileConstants.js";
import { STRUCTURE_SLOT_FILE, STRUCTURE_SNAPSHOT_ROOT } from "./lifecyclePaths.js";

const STRUCTURE_SLOT_SCHEMA_VERSION = "context.structure-slots.v1";
const STRUCTURE_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/u;

interface StructureSlot {
  source: string;
  collection: string;
  structure_digest: string;
}

export interface ActiveStructureSlot {
  source: string;
  collection: string;
  structureDigest: string;
}

function snapshotPath(projectRoot: string, structureDigest: string): string {
  const match = STRUCTURE_DIGEST_PATTERN.exec(structureDigest);
  if (match?.[1] === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `structure digest is invalid: ${structureDigest}`, {
      category: ErrorCategory.SchemaInvalid,
      structure_digest: structureDigest,
    });
  }
  return join(projectRoot, STRUCTURE_SNAPSHOT_ROOT, `${match[1]}.yaml`);
}

function normalizedSnapshot(payload: AlignPayload): Record<string, unknown> {
  const { user_or_agent_hints: _hints, ...body } = payload;
  void _hints;
  return normalizeAlignPayloadForWrite({
    ...body,
    lifecycle: {
      state: "confirmed",
      ...(payload.lifecycle.phase_collection === undefined
        ? {}
        : { phase_collection: payload.lifecycle.phase_collection }),
      confirmed_by: "structure-snapshot",
      confirmed_at: "structure-snapshot",
      structure_digest: payload.structure_digest,
    },
  });
}

async function readSlots(projectRoot: string): Promise<StructureSlot[]> {
  const path = join(projectRoot, STRUCTURE_SLOT_FILE);
  if (!existsSync(path)) return [];
  const parsed = YAML.parse(await readFile(path, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ContextError(ExitCode.WorkspaceStateError, "structure slot index must be a YAML object", {
      category: ErrorCategory.WorkspaceStateInvalid,
      path,
    });
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema_version !== STRUCTURE_SLOT_SCHEMA_VERSION || !Array.isArray(record.slots)) {
    throw new ContextError(ExitCode.WorkspaceStateError, "structure slot index schema is invalid", {
      category: ErrorCategory.WorkspaceStateInvalid,
      path,
      expected_schema_version: STRUCTURE_SLOT_SCHEMA_VERSION,
    });
  }
  return record.slots.map((slot, index): StructureSlot => {
    if (slot === null || typeof slot !== "object" || Array.isArray(slot)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure slot entry is invalid", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path,
        slot_index: index,
      });
    }
    const item = slot as Partial<StructureSlot>;
    if (!(typeof item.source === "string" &&
      typeof item.collection === "string" &&
      typeof item.structure_digest === "string" &&
      STRUCTURE_DIGEST_PATTERN.test(item.structure_digest))) {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure slot entry fields are invalid", {
        category: ErrorCategory.WorkspaceStateInvalid,
        path,
        slot_index: index,
      });
    }
    return item as StructureSlot;
  });
}

async function updateSlots(projectRoot: string, payload: AlignPayload): Promise<void> {
  const current = await readSlots(projectRoot);
  const collections = [...new Set(payload.views.map((view) => view.collection))];
  const replacements = new Map<string, StructureSlot>(payload.sources.flatMap((source) =>
    collections.map((collection) => [`${source}\u0000${collection}`, {
      source,
      collection,
      structure_digest: payload.structure_digest,
    }] as const)
  ));
  const slots = [
    ...current.filter((slot) => !replacements.has(`${slot.source}\u0000${slot.collection}`)),
    ...replacements.values(),
  ].sort((left, right) => left.source.localeCompare(right.source) || left.collection.localeCompare(right.collection));
  const path = join(projectRoot, STRUCTURE_SLOT_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, YAML.stringify({ schema_version: STRUCTURE_SLOT_SCHEMA_VERSION, slots }), "utf8");
}

export async function writeStructureSnapshot(projectRoot: string, payload: AlignPayload): Promise<string> {
  const path = snapshotPath(projectRoot, payload.structure_digest);
  const normalized = normalizedSnapshot(payload);
  const parsed = parseAlignPayload(normalized).payload;
  if (parsed?.structure_digest !== payload.structure_digest) {
    throw new ContextError(ExitCode.WorkspaceStateError, "structure snapshot digest does not match its content", {
      category: ErrorCategory.WorkspaceStateInvalid,
      structure_digest: payload.structure_digest,
      computed_structure_digest: parsed?.structure_digest,
    });
  }
  const content = YAML.stringify(normalized);
  if (existsSync(path)) {
    const current = await readFile(path, "utf8");
    const existing = parseAlignPayload(YAML.parse(current) as unknown).payload;
    if (existing?.structure_digest !== payload.structure_digest) {
      throw new ContextError(ExitCode.WorkspaceStateError, "structure snapshot digest collision", {
        category: ErrorCategory.WorkspaceStateInvalid,
        structure_digest: payload.structure_digest,
        path,
      });
    }
    if (
      existing.lifecycle.phase_collection === undefined &&
      parsed.lifecycle.phase_collection !== undefined
    ) {
      await writeFile(path, content, "utf8");
    }
    await updateSlots(projectRoot, payload);
    return path;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  await updateSlots(projectRoot, payload);
  return path;
}

export async function readStructureSnapshot(
  projectRoot: string,
  structureDigest: string,
): Promise<unknown | null> {
  const path = snapshotPath(projectRoot, structureDigest);
  if (!existsSync(path)) return null;
  try {
    return YAML.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContextError(ExitCode.WorkspaceStateError, `structure snapshot is invalid: ${structureDigest}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      structure_digest: structureDigest,
      path,
      reason: message,
    });
  }
}

export async function readStructureSnapshotPayload(
  projectRoot: string,
  structureDigest: string,
): Promise<AlignPayload | undefined> {
  const parsed = await readStructureSnapshot(projectRoot, structureDigest);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const lifecycle = record.lifecycle;
  if (lifecycle === null || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return undefined;
  if ((lifecycle as Record<string, unknown>).structure_digest !== structureDigest || !Array.isArray(record.views)) {
    return undefined;
  }
  return { ...record, structure_digest: structureDigest } as unknown as AlignPayload;
}

export async function archiveActiveStructure(projectRoot: string): Promise<string | null> {
  const path = join(projectRoot, STRUCTURE_FILE);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = YAML.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const lifecycle = record.lifecycle;
  if (lifecycle === null || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return null;
  const state = (lifecycle as Record<string, unknown>).state;
  const structureDigest = (lifecycle as Record<string, unknown>).structure_digest;
  if ((state !== "confirmed" && state !== "frozen") || typeof structureDigest !== "string") return null;
  const payload = {
    ...record,
    structure_digest: structureDigest,
  } as unknown as AlignPayload;
  return writeStructureSnapshot(projectRoot, payload);
}

export function structureSnapshotRelativePath(structureDigest: string): string {
  const match = STRUCTURE_DIGEST_PATTERN.exec(structureDigest);
  if (match?.[1] === undefined) return STRUCTURE_SNAPSHOT_ROOT;
  return join(STRUCTURE_SNAPSHOT_ROOT, `${match[1]}.yaml`);
}

export async function currentStructureSlotDigest(
  projectRoot: string,
  source: string,
  collection: string,
): Promise<string | undefined> {
  return (await readSlots(projectRoot)).find((slot) =>
    slot.source === source && slot.collection === collection
  )?.structure_digest;
}

export async function activeStructureSlotDigests(
  projectRoot: string,
  collection?: string,
): Promise<string[]> {
  return [...new Set((await activeStructureSlots(projectRoot, collection))
    .map((slot) => slot.structureDigest))];
}

export async function activeStructureSlots(
  projectRoot: string,
  collection?: string,
): Promise<ActiveStructureSlot[]> {
  return (await readSlots(projectRoot))
    .filter((slot) => collection === undefined || slot.collection === collection)
    .map((slot) => ({
      source: slot.source,
      collection: slot.collection,
      structureDigest: slot.structure_digest,
    }));
}
