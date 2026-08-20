import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ContextRuntimeEvent } from "./runtimeEvents.js";

const OUTBOX_EVENT_SCHEMA = "context.runtime-event-outbox.event.v1" as const;
const OUTBOX_ACK_SCHEMA = "context.runtime-event-outbox.ack.v1" as const;
const OUTBOX_RELATIVE_PATH = join(".tmp", "context-runtime", "logs", "outbox.jsonl");
const OUTBOX_LOCK_STALE_MS = 30_000;
const OUTBOX_LOCK_RETRY_MS = 10;
const OUTBOX_LOCK_RETRIES = 100;

interface RuntimeEventOutboxEventRecord {
  schema: typeof OUTBOX_EVENT_SCHEMA;
  context_version: string;
  event: ContextRuntimeEvent;
}

export interface RuntimeEventOutboxEntry {
  contextVersion: string;
  event: ContextRuntimeEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEvent(value: unknown): ContextRuntimeEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.event_id !== "string" ||
    typeof value.event_time !== "number" ||
    !Number.isFinite(value.event_time) ||
    typeof value.kind !== "string" ||
    !isRecord(value.properties)
  ) {
    return null;
  }
  return {
    event_id: value.event_id,
    event_time: value.event_time,
    kind: value.kind as ContextRuntimeEvent["kind"],
    properties: value.properties as ContextRuntimeEvent["properties"],
  };
}

export function runtimeEventOutboxPath(projectRoot: string): string {
  return join(projectRoot, OUTBOX_RELATIVE_PATH);
}

function readRuntimeEventOutboxFile(path: string): RuntimeEventOutboxEntry[] {
  if (!existsSync(path)) return [];
  const pending = new Map<string, RuntimeEventOutboxEntry>();
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      if (parsed.schema === OUTBOX_EVENT_SCHEMA) {
        if (typeof parsed.context_version !== "string") continue;
        const event = parseEvent(parsed.event);
        if (event === null) continue;
        pending.set(event.event_id, {
          contextVersion: parsed.context_version,
          event,
        });
        continue;
      }
      if (
        parsed.schema === OUTBOX_ACK_SCHEMA &&
        Array.isArray(parsed.event_ids) &&
        parsed.event_ids.every((eventId) => typeof eventId === "string")
      ) {
        for (const eventId of parsed.event_ids) pending.delete(eventId);
      }
    }
  } catch {
    return [];
  }
  return [...pending.values()];
}

export function readRuntimeEventOutbox(projectRoot: string): RuntimeEventOutboxEntry[] {
  return readRuntimeEventOutboxFile(runtimeEventOutboxPath(projectRoot));
}

function sleepSync(durationMs: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, durationMs);
}

function withOutboxLock<T>(projectRoot: string, work: (path: string) => T): T {
  const path = runtimeEventOutboxPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let lockFd: number | undefined;
  for (let attempt = 0; attempt < OUTBOX_LOCK_RETRIES; attempt++) {
    try {
      lockFd = openSync(lockPath, "wx");
      break;
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs >= OUTBOX_LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      sleepSync(OUTBOX_LOCK_RETRY_MS);
    }
  }
  if (lockFd === undefined) {
    throw new Error("runtime event outbox is busy");
  }
  try {
    return work(path);
  } finally {
    closeSync(lockFd);
    try {
      unlinkSync(lockPath);
    } catch {
      // A stale-lock recovery may already have removed the lock.
    }
  }
}

function writePendingOutbox(
  path: string,
  entries: readonly RuntimeEventOutboxEntry[],
): void {
  if (entries.length === 0) {
    try {
      unlinkSync(path);
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
      if (code !== "ENOENT") throw error;
    }
    return;
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const records: RuntimeEventOutboxEventRecord[] = entries.map((entry) => ({
    schema: OUTBOX_EVENT_SCHEMA,
    context_version: entry.contextVersion,
    event: entry.event,
  }));
  writeFileSync(
    temporaryPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  renameSync(temporaryPath, path);
}

export function appendRuntimeEventOutbox(
  projectRoot: string,
  contextVersion: string,
  events: ContextRuntimeEvent[],
): void {
  if (events.length === 0) return;
  withOutboxLock(projectRoot, (path) => {
    const pending = readRuntimeEventOutboxFile(path);
    const knownIds = new Set(pending.map((entry) => entry.event.event_id));
    for (const event of events) {
      if (knownIds.has(event.event_id)) continue;
      pending.push({ contextVersion, event });
      knownIds.add(event.event_id);
    }
    writePendingOutbox(path, pending);
  });
}

export function acknowledgeRuntimeEventOutbox(
  projectRoot: string,
  eventIds: string[],
): void {
  if (eventIds.length === 0) return;
  const acknowledged = new Set(eventIds);
  withOutboxLock(projectRoot, (path) => {
    writePendingOutbox(
      path,
      readRuntimeEventOutboxFile(path).filter(
        (entry) => !acknowledged.has(entry.event.event_id),
      ),
    );
  });
}
