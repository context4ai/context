import { readFile } from "node:fs/promises";
import { writeIncrementalCacheAtomic } from "./cache.js";
import {
  INCREMENTAL_SCHEMA_VERSION,
  type IncrementalSourceClassification,
  type IncrementalUnknownInput,
  type IncrementalPendingSummary,
  type IncrementalState,
} from "./types.js";

export type ReadIncrementalStateStatus = "ready" | "empty" | "unknown";

export interface ReadIncrementalStateResult {
  status: ReadIncrementalStateStatus;
  state: IncrementalState;
  reason?: string;
}

export function createEmptyIncrementalState(now: Date = new Date()): IncrementalState {
  return {
    schema_version: INCREMENTAL_SCHEMA_VERSION,
    updated_at: now.toISOString(),
    source_classifications: [],
    pending_align: { status: "none", count: 0 },
    pending_compile: { status: "none", count: 0 },
    unknown_inputs: [],
  };
}

export function createUnknownIncrementalState(input: {
  reason: string;
  scope?: string;
  summary?: Record<string, unknown>;
  now?: Date;
}): IncrementalState {
  const now = input.now ?? new Date();
  const state: IncrementalState = {
    schema_version: INCREMENTAL_SCHEMA_VERSION,
    updated_at: now.toISOString(),
    source_classifications: [],
    pending_align: { status: "unknown", count: 0, reason: input.reason },
    pending_compile: { status: "unknown", count: 0, reason: input.reason },
    unknown_inputs: [
      {
        scope: input.scope ?? "incremental-cache",
        reason: input.reason,
        detected_at: now.toISOString(),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
      },
    ],
  };
  return state;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPendingSummary(value: unknown): value is IncrementalPendingSummary {
  if (!isObject(value)) return false;
  return (value.status === "none" || value.status === "pending" || value.status === "unknown") &&
    typeof value.count === "number" &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.sources === undefined || (Array.isArray(value.sources) && value.sources.every((item) => typeof item === "string"))) &&
    (value.nodes === undefined || (Array.isArray(value.nodes) && value.nodes.every((item) => typeof item === "string")));
}

function isIncrementalState(value: unknown): value is IncrementalState {
  if (!isObject(value)) return false;
  const state = value;
  return state.schema_version === INCREMENTAL_SCHEMA_VERSION &&
    typeof state.updated_at === "string" &&
    Array.isArray(state.source_classifications) &&
    isPendingSummary(state.pending_align) &&
    isPendingSummary(state.pending_compile) &&
    Array.isArray(state.unknown_inputs);
}

export async function readIncrementalState(statePath: string): Promise<ReadIncrementalStateResult> {
  let raw: string;
  try {
    raw = await readFile(statePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: "empty", state: createEmptyIncrementalState(), reason: "state-missing" };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "unknown",
      state: createUnknownIncrementalState({ reason: "state-json-invalid" }),
      reason: "state-json-invalid",
    };
  }

  if (!isIncrementalState(parsed)) {
    return {
      status: "unknown",
      state: createUnknownIncrementalState({ reason: "state-schema-mismatch" }),
      reason: "state-schema-mismatch",
    };
  }

  return { status: "ready", state: parsed };
}

export async function writeIncrementalState(statePath: string, state: IncrementalState): Promise<void> {
  await writeIncrementalCacheAtomic(statePath, state);
}

function shouldResetPendingBase(current: ReadIncrementalStateResult): boolean {
  return current.status !== "ready" ||
    current.state.unknown_inputs.some((item) =>
      item.scope === "incremental-cache" && item.reason.startsWith("state-"),
    );
}

export async function writePendingAlignState(input: {
  statePath: string;
  classifications: IncrementalSourceClassification[];
  structuralChangeCount: number;
  unknownInputs?: IncrementalUnknownInput[];
  now?: Date;
}): Promise<IncrementalState> {
  const now = input.now ?? new Date();
  const current = await readIncrementalState(input.statePath);
  const base = shouldResetPendingBase(current) ? createEmptyIncrementalState(now) : current.state;
  const unknownInputs = input.unknownInputs ?? [];
  const pendingSources = input.classifications
    .filter((item) => item.status === "structure_changed" || item.status === "new_source" || item.status === "unknown")
    .map((item) => item.source_id);
  const pendingAlign: IncrementalPendingSummary = unknownInputs.length > 0
    ? { status: "unknown", count: unknownInputs.length, reason: "align-baseline-unknown", sources: pendingSources }
    : input.structuralChangeCount > 0
      ? { status: "pending", count: input.structuralChangeCount, sources: pendingSources }
      : { status: "none", count: 0 };
  const state: IncrementalState = {
    ...base,
    schema_version: INCREMENTAL_SCHEMA_VERSION,
    updated_at: now.toISOString(),
    source_classifications: input.classifications,
    pending_align: pendingAlign,
    unknown_inputs: [
      ...base.unknown_inputs.filter((item) => item.scope !== "align-structure"),
      ...unknownInputs,
    ],
  };
  await writeIncrementalState(input.statePath, state);
  return state;
}

export async function clearPendingAlignState(input: {
  statePath: string;
  now?: Date;
}): Promise<IncrementalState> {
  const now = input.now ?? new Date();
  const current = await readIncrementalState(input.statePath);
  const base = shouldResetPendingBase(current) ? createEmptyIncrementalState(now) : current.state;
  const state: IncrementalState = {
    ...base,
    schema_version: INCREMENTAL_SCHEMA_VERSION,
    updated_at: now.toISOString(),
    pending_align: { status: "none", count: 0 },
    unknown_inputs: base.unknown_inputs.filter((item) => item.scope !== "align-structure"),
  };
  await writeIncrementalState(input.statePath, state);
  return state;
}

export async function writePendingCompileState(input: {
  statePath: string;
  changedNodeCount: number;
  changedNodes?: string[];
  unknownInputs?: IncrementalUnknownInput[];
  now?: Date;
}): Promise<IncrementalState> {
  const now = input.now ?? new Date();
  const current = await readIncrementalState(input.statePath);
  const base = shouldResetPendingBase(current) ? createEmptyIncrementalState(now) : current.state;
  const unknownInputs = input.unknownInputs ?? [];
  const changedNodes = input.changedNodes ?? [];
  const pendingCompile: IncrementalPendingSummary = unknownInputs.length > 0
    ? { status: "unknown", count: unknownInputs.length, reason: "compile-baseline-unknown", nodes: changedNodes }
    : input.changedNodeCount > 0
      ? { status: "pending", count: input.changedNodeCount, nodes: changedNodes }
      : { status: "none", count: 0 };
  const state: IncrementalState = {
    ...base,
    schema_version: INCREMENTAL_SCHEMA_VERSION,
    updated_at: now.toISOString(),
    pending_compile: pendingCompile,
    unknown_inputs: [
      ...base.unknown_inputs.filter((item) => item.scope !== "compile-changes"),
      ...unknownInputs,
    ],
  };
  await writeIncrementalState(input.statePath, state);
  return state;
}
