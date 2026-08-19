import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA = "context.runtime-event-batch.v1" as const;
export const CONTEXT_RUNTIME_EVENT_SINK_SCHEMA = "context.runtime-event-sink.v1" as const;
export const CONTEXT_RUNTIME_EVENT_DELIVERY_TIMEOUT_MS = 3_000;
export const CONTEXT_WORKSPACE_ACTIVE_THROTTLE_MS = 60 * 60 * 1_000;

const RUNTIME_EVENT_STATE_SCHEMA = "context.runtime-event-state.v1" as const;
const RUNTIME_EVENT_STATE_FILE = "runtime-event-state.json";

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
) => Promise<boolean | void>;

interface RuntimeEventState {
  schema: typeof RUNTIME_EVENT_STATE_SCHEMA;
  workspace_active?: {
    workflow_status: string;
    delivered_at: number;
  };
}

export interface RuntimeEventDeliveryOptions {
  contextVersion?: string;
  dispatch?: RuntimeEventDispatch;
  forceDelivery?: boolean;
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
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (delivered: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(delivered);
    };
    try {
      const child = spawn(sink.command, sink.args, {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.once("error", () => finish(false));
      child.once("exit", (code) => finish(code === 0));
      child.stdin.once("error", () => {
        child.kill();
        finish(false);
      });
      child.stdin.end(JSON.stringify(batch));
      timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, CONTEXT_RUNTIME_EVENT_DELIVERY_TIMEOUT_MS);
    } catch {
      finish(false);
    }
  });
}

function runtimeEventStatePath(cwd: string): string {
  return join(cwd, ".tmp", "context-runtime", RUNTIME_EVENT_STATE_FILE);
}

function readRuntimeEventState(cwd: string): RuntimeEventState | null {
  try {
    const parsed = JSON.parse(readFileSync(runtimeEventStatePath(cwd), "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schema !== RUNTIME_EVENT_STATE_SCHEMA) return null;
    const active = parsed.workspace_active;
    if (active === undefined) return { schema: RUNTIME_EVENT_STATE_SCHEMA };
    if (
      !isRecord(active) ||
      typeof active.workflow_status !== "string" ||
      typeof active.delivered_at !== "number" ||
      !Number.isFinite(active.delivered_at)
    ) {
      return null;
    }
    return {
      schema: RUNTIME_EVENT_STATE_SCHEMA,
      workspace_active: {
        workflow_status: active.workflow_status,
        delivered_at: active.delivered_at,
      },
    };
  } catch {
    return null;
  }
}

function shouldDeliverWorkspaceActive(
  event: ContextRuntimeEvent,
  state: RuntimeEventState | null,
): boolean {
  const workflowStatus = event.properties.workflow_status;
  if (typeof workflowStatus !== "string") return true;
  const previous = state?.workspace_active;
  if (previous === undefined || previous.workflow_status !== workflowStatus) return true;
  return event.event_time - previous.delivered_at >= CONTEXT_WORKSPACE_ACTIVE_THROTTLE_MS;
}

function selectRuntimeEventsForDelivery(
  events: ContextRuntimeEvent[],
  state: RuntimeEventState | null,
): ContextRuntimeEvent[] {
  return events.filter((event) => (
    event.kind !== "workspace.active" || shouldDeliverWorkspaceActive(event, state)
  ));
}

function persistDeliveredWorkspaceActive(cwd: string, events: ContextRuntimeEvent[]): void {
  const delivered = [...events].reverse().find((event) => event.kind === "workspace.active");
  const workflowStatus = delivered?.properties.workflow_status;
  if (delivered === undefined || typeof workflowStatus !== "string") return;
  try {
    const statePath = runtimeEventStatePath(cwd);
    const stateDir = dirname(statePath);
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify({
      schema: RUNTIME_EVENT_STATE_SCHEMA,
      workspace_active: {
        workflow_status: workflowStatus,
        delivered_at: delivered.event_time,
      },
    })}\n`, "utf8");
    renameSync(temporaryPath, statePath);
  } catch {
    // Throttle persistence is best-effort and must never affect the command.
  }
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
      const selectedEvents = selectRuntimeEventsForDelivery(
        events,
        readRuntimeEventState(cwd),
      );
      if (selectedEvents.length === 0) return;
      try {
        await scope.dispatch(scope.sink, {
          schema: CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
          context_version: scope.contextVersion,
          events: selectedEvents,
        }, cwd);
      } finally {
        persistDeliveredWorkspaceActive(cwd, selectedEvents);
      }
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
  if (
    activeScope !== undefined ||
    (process.env.CONTEXT_RUNTIME_EVENTS_DISABLED === "1" && options.forceDelivery !== true)
  ) {
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
