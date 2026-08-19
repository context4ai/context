import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA = "context.runtime-event-batch.v1" as const;
export const CONTEXT_RUNTIME_EVENT_SINK_SCHEMA = "context.runtime-event-sink.v1" as const;

export type ContextRuntimeEventKind =
  | "workspace.active"
  | "workspace.initialized"
  | "knowledge.closed"
  | "package.build.completed";

export type ContextRuntimeEventProperty = string | number | boolean | null | string[];

export interface ContextRuntimeEvent {
  event_id: string;
  event_time: number;
  kind: ContextRuntimeEventKind;
  properties: Record<string, ContextRuntimeEventProperty>;
}

export interface ContextRuntimeEventBatch {
  schema: typeof CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA;
  context_version: string;
  events: ContextRuntimeEvent[];
}

export interface ContextRuntimeEventSink {
  schema: typeof CONTEXT_RUNTIME_EVENT_SINK_SCHEMA;
  transport: "command";
  command: string;
  args: string[];
}

interface QueuedRuntimeEvent {
  cwd: string;
  event: ContextRuntimeEvent;
}

interface RuntimeEventScope {
  contextVersion: string;
  dispatch: RuntimeEventDispatch;
  events: QueuedRuntimeEvent[];
  sink: ContextRuntimeEventSink;
}

type RuntimeEventDispatch = (
  sink: ContextRuntimeEventSink,
  batch: ContextRuntimeEventBatch,
  cwd: string,
) => Promise<void>;

export interface RuntimeEventDeliveryOptions {
  contextVersion?: string;
  dispatch?: RuntimeEventDispatch;
  sink?: ContextRuntimeEventSink | null;
}

let activeScope: RuntimeEventScope | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseContextRuntimeEventSink(value: unknown): ContextRuntimeEventSink | null {
  if (!isRecord(value)) return null;
  if (value.schema !== CONTEXT_RUNTIME_EVENT_SINK_SCHEMA || value.transport !== "command") return null;
  if (typeof value.command !== "string" || value.command.trim().length === 0) return null;
  if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) return null;
  return {
    schema: CONTEXT_RUNTIME_EVENT_SINK_SCHEMA,
    transport: "command",
    command: value.command,
    args: [...value.args],
  };
}

function readRuntimePackageMetadata(): {
  contextVersion: string;
  sink: ContextRuntimeEventSink | null;
} {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let index = 0; index < 8; index++) {
      const packagePath = join(dir, "package.json");
      if (existsSync(packagePath)) {
        const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
        if (isRecord(parsed)) {
          return {
            contextVersion: typeof parsed.version === "string" ? parsed.version : "unknown",
            sink: parseContextRuntimeEventSink(parsed.contextRuntimeEventSink),
          };
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Runtime telemetry must never affect the command result.
  }
  return { contextVersion: "unknown", sink: null };
}

function dispatchCommand(
  sink: ContextRuntimeEventSink,
  batch: ContextRuntimeEventBatch,
  cwd: string,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    };
    try {
      const child = spawn(sink.command, sink.args, {
        cwd,
        detached: true,
        env: process.env,
        shell: false,
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.once("error", finish);
      child.stdin.once("error", finish);
      child.stdin.end(JSON.stringify(batch), finish);
      child.unref();
      timer = setTimeout(finish, 250);
      timer.unref();
    } catch {
      finish();
    }
  });
}

async function flushRuntimeEvents(scope: RuntimeEventScope): Promise<void> {
  const grouped = new Map<string, ContextRuntimeEvent[]>();
  for (const queued of scope.events) {
    const events = grouped.get(queued.cwd) ?? [];
    events.push(queued.event);
    grouped.set(queued.cwd, events);
  }
  await Promise.all([...grouped.entries()].map(async ([cwd, events]) => {
    try {
      await scope.dispatch(scope.sink, {
        schema: CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
        context_version: scope.contextVersion,
        events,
      }, cwd);
    } catch {
      // Runtime telemetry must never affect the command result.
    }
  }));
}

export function queueContextRuntimeEvent(input: {
  cwd: string;
  kind: ContextRuntimeEventKind;
  properties?: Record<string, ContextRuntimeEventProperty>;
}): void {
  if (activeScope === undefined) return;
  activeScope.events.push({
    cwd: input.cwd,
    event: {
      event_id: randomUUID(),
      event_time: Date.now(),
      kind: input.kind,
      properties: input.properties ?? {},
    },
  });
}

export async function withContextRuntimeEventDelivery<T>(
  work: () => Promise<T>,
  options: RuntimeEventDeliveryOptions = {},
): Promise<T> {
  if (activeScope !== undefined || process.env.CONTEXT_RUNTIME_EVENTS_DISABLED === "1") {
    return work();
  }
  const metadata = readRuntimePackageMetadata();
  const sink = options.sink === undefined ? metadata.sink : options.sink;
  if (sink === null) return work();
  const scope: RuntimeEventScope = {
    contextVersion: options.contextVersion ?? metadata.contextVersion,
    dispatch: options.dispatch ?? dispatchCommand,
    events: [],
    sink,
  };
  activeScope = scope;
  try {
    return await work();
  } finally {
    activeScope = undefined;
    await flushRuntimeEvents(scope);
  }
}
