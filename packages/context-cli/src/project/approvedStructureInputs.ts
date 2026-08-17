import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { KNOWLEDGE_COLLECTIONS } from "@c4a/context";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { activeStructureSlots, readStructureSnapshotPayload } from "./proseStructureStore.js";

export const APPROVED_STRUCTURE_FILE = join("knowledge", "structure.yaml");

export interface ApprovedStructureSourceInput {
  source: string;
  collection: string;
  snapshot_hash: string;
}

const COLLECTIONS = new Set<string>(KNOWLEDGE_COLLECTIONS);
const SNAPSHOT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidSourceInputs(reason: string): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, `${APPROVED_STRUCTURE_FILE} source_inputs are invalid`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    path: APPROVED_STRUCTURE_FILE,
    reason,
  });
}

function sourceInputKey(input: Pick<ApprovedStructureSourceInput, "source" | "collection">): string {
  return `${input.source}\u0000${input.collection}`;
}

function sortedSourceInputs(
  values: Iterable<ApprovedStructureSourceInput>,
): ApprovedStructureSourceInput[] {
  return [...values].sort((left, right) =>
    left.source.localeCompare(right.source) || left.collection.localeCompare(right.collection)
  );
}

export function parseApprovedStructureSourceInputs(
  structure: Record<string, unknown>,
): ApprovedStructureSourceInput[] {
  if (structure.source_inputs === undefined) return [];
  if (!isRecord(structure.source_inputs)) {
    throw invalidSourceInputs("source_inputs must be an object when present");
  }
  const inputs = new Map<string, ApprovedStructureSourceInput>();
  for (const [source, collections] of Object.entries(structure.source_inputs)) {
    if (source.trim().length === 0) throw invalidSourceInputs("source_inputs source key must not be empty");
    if (!isRecord(collections)) {
      throw invalidSourceInputs(`source_inputs.${source} must be an object`);
    }
    for (const [collection, snapshotHash] of Object.entries(collections)) {
      if (!COLLECTIONS.has(collection)) {
        throw invalidSourceInputs(`source_inputs.${source} collection is invalid: ${collection}`);
      }
      if (typeof snapshotHash !== "string" || !SNAPSHOT_HASH_PATTERN.test(snapshotHash)) {
        throw invalidSourceInputs(`source_inputs.${source}.${collection} snapshot hash is invalid`);
      }
      const input = { source, collection, snapshot_hash: snapshotHash };
      inputs.set(sourceInputKey(input), input);
    }
  }
  return sortedSourceInputs(inputs.values());
}

export function approvedStructureSourceInputsRecord(
  inputs: readonly ApprovedStructureSourceInput[],
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const input of sortedSourceInputs(inputs)) {
    result[input.source] ??= {};
    result[input.source]![input.collection] = input.snapshot_hash;
  }
  return result;
}

export async function readApprovedStructureSourceInputs(
  projectRoot: string,
): Promise<ApprovedStructureSourceInput[]> {
  const path = join(projectRoot, APPROVED_STRUCTURE_FILE);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = YAML.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  return parseApprovedStructureSourceInputs(parsed);
}

export async function mergedApprovedStructureSourceInputs(
  projectRoot: string,
): Promise<ApprovedStructureSourceInput[]> {
  const inputs = new Map<string, ApprovedStructureSourceInput>(
    (await readApprovedStructureSourceInputs(projectRoot)).map((input) => [sourceInputKey(input), input]),
  );
  for (const slot of await activeStructureSlots(projectRoot)) {
    const snapshot = await readStructureSnapshotPayload(projectRoot, slot.structureDigest);
    if (snapshot === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, "active structure snapshot is missing", {
        category: ErrorCategory.WorkspaceStateInvalid,
        source: slot.source,
        collection: slot.collection,
        structure_digest: slot.structureDigest,
      });
    }
    inputs.set(sourceInputKey(slot), {
      source: slot.source,
      collection: slot.collection,
      snapshot_hash: snapshot.evidence_snapshot_hash,
    });
  }
  return sortedSourceInputs(inputs.values());
}

export function approvedStructureSourceInputKey(
  input: Pick<ApprovedStructureSourceInput, "source" | "collection">,
): string {
  return sourceInputKey(input);
}
