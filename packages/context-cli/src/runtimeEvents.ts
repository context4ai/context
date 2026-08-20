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
import {
  isContextDebugEnabled,
  recordRuntimeTelemetryDelivery,
} from "./project/debugTrace.js";
import {
  acknowledgeRuntimeEventOutbox,
  appendRuntimeEventOutbox,
  readRuntimeEventOutbox,
  runtimeEventOutboxPath,
  type RuntimeEventOutboxEntry,
} from "./runtimeEventOutbox.js";

export const CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA = "context.runtime-event-batch.v1" as const;
export const CONTEXT_RUNTIME_EVENT_SINK_SCHEMA = "context.runtime-event-sink.v1" as const;
export const CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA = "context.runtime-event-delivery-result.v1" as const;
export const CONTEXT_RUNTIME_EVENT_SINK_DESCRIPTION_SCHEMA = "context.runtime-event-sink-description.v1" as const;
export const CONTEXT_RUNTIME_EVENT_DELIVERY_PLAN_SCHEMA = "context.runtime-event-delivery-plan.v1" as const;
export const CONTEXT_WORKSPACE_ACTIVE_THROTTLE_MS = 60 * 60 * 1_000;
export const CONTEXT_RUNTIME_EVENT_BATCH_MAX = 50;

const RUNTIME_EVENT_STATE_SCHEMA = "context.runtime-event-state.v1" as const;
const RUNTIME_EVENT_STATE_FILE = "runtime-event-state.json";
const RUNTIME_EVENT_SINK_DESCRIPTION_TIMEOUT_MS = 2_000;
const RUNTIME_EVENT_SINK_DESCRIPTION_MAX_BYTES = 16 * 1024;

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
  describe_args?: string[];
}

export interface ContextRuntimeEventSinkDescription {
  schema: typeof CONTEXT_RUNTIME_EVENT_SINK_DESCRIPTION_SCHEMA;
  transport: "http" | "https";
  method: "POST";
  destination: string;
  target_destination?: string;
  input_schema: typeof CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA;
  data_policy: string;
}

export interface ContextRuntimeEventDeliveryPlan {
  schema: typeof CONTEXT_RUNTIME_EVENT_DELIVERY_PLAN_SCHEMA;
  status: "disabled" | "empty" | "pending";
  outbox: {
    path: string;
    encoding: "jsonl-at-rest; json-batch-on-delivery";
    event_count: number;
    event_kinds: ContextRuntimeEventKind[];
    context_versions: string[];
    property_keys: string[];
  };
  sink?: {
    transport: "command";
    command: string;
    args: string[];
    description?: ContextRuntimeEventSinkDescription;
  };
  flush_command?: "context logs flush --format json";
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
) => Promise<RuntimeEventSinkResult>;

export type RuntimeEventSinkStatus = "sent" | "skipped" | "failed";

export interface RuntimeEventSinkResult {
  schema: typeof CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA;
  status: RuntimeEventSinkStatus;
  reason?: string;
  duration_ms?: number;
  event_count?: number;
  http_status?: number;
  code?: number;
  accepted?: number;
  rejected?: number;
  error_code?: string;
}

export interface RuntimeEventFlushResult {
  status: "disabled" | "empty" | "sent" | "pending";
  pending_count: number;
  attempted_count: number;
  sent_count: number;
  last_result?: RuntimeEventSinkResult;
}

export interface RuntimeEventPendingAgentHint {
  reason_code: "runtime-events-delivery-pending";
  severity: "action-required";
  pending_count: number;
  requires_network_access: true;
  plan_command: "context logs plan --format json";
  command: "context logs flush --format json";
  message: string;
}

export interface ContextRuntimeEventDeliveryObservation {
  configured: boolean;
  pending_count: number;
  pending_kinds: ContextRuntimeEventKind[];
}

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
  const describeArgs = value.describe_args;
  if (
    describeArgs !== undefined &&
    (!Array.isArray(describeArgs) || !describeArgs.every((arg) => typeof arg === "string"))
  ) return null;
  return {
    schema: CONTEXT_RUNTIME_EVENT_SINK_SCHEMA,
    transport: "command",
    command: value.command,
    args: [...value.args],
    ...(describeArgs === undefined ? {} : { describe_args: [...describeArgs] }),
  };
}

function parseContextRuntimeEventSinkDescription(
  value: string,
): ContextRuntimeEventSinkDescription | undefined {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    if (!isRecord(parsed)) return undefined;
    if (
      parsed.schema !== CONTEXT_RUNTIME_EVENT_SINK_DESCRIPTION_SCHEMA ||
      (parsed.transport !== "http" && parsed.transport !== "https") ||
      parsed.method !== "POST" ||
      typeof parsed.destination !== "string" ||
      parsed.input_schema !== CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA ||
      typeof parsed.data_policy !== "string"
    ) return undefined;
    const destination = new URL(parsed.destination);
    if (`${destination.protocol.slice(0, -1)}` !== parsed.transport) return undefined;
    const targetDestination = parsed.target_destination;
    if (targetDestination !== undefined) {
      if (typeof targetDestination !== "string") return undefined;
      const target = new URL(targetDestination);
      if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
    }
    return {
      schema: CONTEXT_RUNTIME_EVENT_SINK_DESCRIPTION_SCHEMA,
      transport: parsed.transport,
      method: "POST",
      destination: destination.toString(),
      ...(targetDestination === undefined
        ? {}
        : { target_destination: new URL(targetDestination).toString() }),
      input_schema: CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
      data_policy: parsed.data_policy.slice(0, 500),
    };
  } catch {
    return undefined;
  }
}

async function describeRuntimeEventSink(
  sink: ContextRuntimeEventSink,
  cwd: string,
): Promise<ContextRuntimeEventSinkDescription | undefined> {
  if (sink.describe_args === undefined) return undefined;
  const describeArgs = [...sink.describe_args];
  return new Promise((resolveDescription) => {
    let output = "";
    let settled = false;
    const finish = (value?: ContextRuntimeEventSinkDescription): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveDescription(value);
    };
    const timer = setTimeout(() => {
      child?.kill();
      finish();
    }, RUNTIME_EVENT_SINK_DESCRIPTION_TIMEOUT_MS);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const spawned = spawn(sink.command, describeArgs, {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      child = spawned;
      spawned.stdout?.setEncoding("utf8");
      spawned.stdout?.on("data", (chunk: string) => {
        if (Buffer.byteLength(output, "utf8") + Buffer.byteLength(chunk, "utf8") > RUNTIME_EVENT_SINK_DESCRIPTION_MAX_BYTES) {
          child?.kill();
          finish();
          return;
        }
        output += chunk;
      });
      spawned.once("error", () => finish());
      spawned.once("exit", (code) => finish(
        code === 0 ? parseContextRuntimeEventSinkDescription(output) : undefined,
      ));
    } catch {
      finish();
    }
  });
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

function parseSinkDeliveryResponse(value: string): RuntimeEventSinkResult | undefined {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    if (!isRecord(parsed) || parsed.schema !== CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA) {
      return undefined;
    }
    const status = parsed.status;
    if (status !== "sent" && status !== "skipped" && status !== "failed") {
      return undefined;
    }
    const result: RuntimeEventSinkResult = {
      schema: CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA,
      status,
    };
    for (const key of [
      "duration_ms",
      "event_count",
      "http_status",
      "code",
      "accepted",
      "rejected",
    ] as const) {
      const candidate = parsed[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) result[key] = candidate;
    }
    if (typeof parsed.reason === "string") result.reason = parsed.reason.slice(0, 200);
    if (typeof parsed.error_code === "string") result.error_code = parsed.error_code.slice(0, 100);
    return result;
  } catch {
    return undefined;
  }
}

function dispatchCommand(
  sink: ContextRuntimeEventSink,
  batch: ContextRuntimeEventBatch,
  cwd: string,
): Promise<RuntimeEventSinkResult> {
  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const debug = isContextDebugEnabled(cwd);
    let sinkResult = "";
    const finish = (
      delivered: boolean,
      detail: Record<string, unknown>,
    ): void => {
      if (settled) return;
      settled = true;
      void (async () => {
        const response = parseSinkDeliveryResponse(sinkResult);
        const result: RuntimeEventSinkResult = response ?? {
          schema: CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA,
          status: delivered ? "sent" : "failed",
          reason: delivered ? "sink_exit_success" : "sink_process_error",
          event_count: batch.events.length,
        };
        if (debug) {
          await recordRuntimeTelemetryDelivery({
            projectRoot: cwd,
            data: {
              status: result.status,
              duration_ms: Date.now() - startedAt,
              event_count: batch.events.length,
              event_kinds: batch.events.map((event) => event.kind),
              ...detail,
              ...(response === undefined ? {} : { response }),
            },
          });
        }
        resolve(result);
      })();
    };
    try {
      const child = spawn(sink.command, sink.args, {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
      });
      if (child.stdout !== null) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (Buffer.byteLength(sinkResult, "utf8") < 64 * 1024) {
            sinkResult += chunk;
          }
        });
      }
      const childStdin = child.stdin;
      if (childStdin === null) {
        child.kill();
        finish(false, {
          transport: "command",
          error: "event sink stdin was unavailable",
        });
        return;
      }
      child.once("error", (error) => finish(false, {
        transport: "command",
        error: error.message,
      }));
      child.once("exit", (code, signal) => finish(code === 0, {
        transport: "command",
        exit_code: code,
        signal,
      }));
      childStdin.once("error", () => {
        child.kill();
        finish(false, {
          transport: "command",
          error: "event sink closed stdin before consuming the batch",
        });
      });
      childStdin.end(JSON.stringify(batch));
    } catch (error) {
      finish(false, {
        transport: "command",
        error: error instanceof Error ? error.message : String(error),
      });
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
  pending: RuntimeEventOutboxEntry[],
): ContextRuntimeEvent[] {
  return events.filter((event) => {
    if (event.kind !== "workspace.active") return true;
    if (!shouldDeliverWorkspaceActive(event, state)) return false;
    const workflowStatus = event.properties.workflow_status;
    return !pending.some((entry) => (
      entry.event.kind === "workspace.active" &&
      entry.event.properties.workflow_status === workflowStatus &&
      event.event_time - entry.event.event_time < CONTEXT_WORKSPACE_ACTIVE_THROTTLE_MS
    ));
  });
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

async function flushRuntimeEventOutbox(input: {
  cwd: string;
  sink: ContextRuntimeEventSink;
  dispatch: RuntimeEventDispatch;
}): Promise<RuntimeEventFlushResult> {
  let pending = readRuntimeEventOutbox(input.cwd);
  if (pending.length === 0) {
    return { status: "empty", pending_count: 0, attempted_count: 0, sent_count: 0 };
  }
  let attemptedCount = 0;
  let sentCount = 0;
  let lastResult: RuntimeEventSinkResult | undefined;
  while (pending.length > 0) {
    const contextVersion = pending[0]?.contextVersion;
    if (contextVersion === undefined) break;
    const chunk = pending
      .filter((entry) => entry.contextVersion === contextVersion)
      .slice(0, CONTEXT_RUNTIME_EVENT_BATCH_MAX);
    const events = chunk.map((entry) => entry.event);
    attemptedCount += events.length;
    lastResult = await input.dispatch(input.sink, {
      schema: CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
      context_version: contextVersion,
      events,
    }, input.cwd);
    if (lastResult.status !== "sent") {
      return {
        status: "pending",
        pending_count: pending.length,
        attempted_count: attemptedCount,
        sent_count: sentCount,
        last_result: lastResult,
      };
    }
    acknowledgeRuntimeEventOutbox(input.cwd, events.map((event) => event.event_id));
    persistDeliveredWorkspaceActive(input.cwd, events);
    sentCount += events.length;
    pending = readRuntimeEventOutbox(input.cwd);
  }
  return {
    status: "sent",
    pending_count: 0,
    attempted_count: attemptedCount,
    sent_count: sentCount,
    ...(lastResult === undefined ? {} : { last_result: lastResult }),
  };
}

async function enqueueAndFlushRuntimeEvents(
  scope: RuntimeEventScope,
  cwd: string,
  events: ContextRuntimeEvent[],
): Promise<RuntimeEventFlushResult> {
  try {
    const pending = readRuntimeEventOutbox(cwd);
    const selectedEvents = selectRuntimeEventsForDelivery(
      events,
      readRuntimeEventState(cwd),
      pending,
    );
    if (selectedEvents.length === 0) {
      return pending.length === 0
        ? { status: "empty", pending_count: 0, attempted_count: 0, sent_count: 0 }
        : {
            status: "pending",
            pending_count: pending.length,
            attempted_count: 0,
            sent_count: 0,
          };
    }
    appendRuntimeEventOutbox(cwd, scope.contextVersion, selectedEvents);
    return await flushRuntimeEventOutbox({
      cwd,
      sink: scope.sink,
      dispatch: scope.dispatch,
    });
  } catch {
    return {
      status: "pending",
      pending_count: readRuntimeEventOutbox(cwd).length,
      attempted_count: 0,
      sent_count: 0,
    };
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
      await enqueueAndFlushRuntimeEvents(scope, cwd, events);
    } catch {
      // Runtime telemetry must never affect the command result.
    }
  }));
}

export async function flushQueuedContextRuntimeEvents(
  cwd: string,
): Promise<RuntimeEventFlushResult> {
  if (activeScope === undefined) {
    return { status: "disabled", pending_count: 0, attempted_count: 0, sent_count: 0 };
  }
  const scope = activeScope;
  const events = scope.events
    .filter((queued) => queued.cwd === cwd)
    .map((queued) => queued.event);
  scope.events = scope.events.filter((queued) => queued.cwd !== cwd);
  return enqueueAndFlushRuntimeEvents(scope, cwd, events);
}

export async function flushConfiguredContextRuntimeEvents(
  cwd: string,
): Promise<RuntimeEventFlushResult> {
  const metadata = readRuntimePackageMetadata();
  if (metadata.sink === null) {
    return { status: "disabled", pending_count: 0, attempted_count: 0, sent_count: 0 };
  }
  return flushRuntimeEventOutbox({
    cwd,
    sink: metadata.sink,
    dispatch: dispatchCommand,
  });
}

export function observeContextRuntimeEventDelivery(
  cwd: string,
): ContextRuntimeEventDeliveryObservation {
  const metadata = readRuntimePackageMetadata();
  if (metadata.sink === null) {
    return { configured: false, pending_count: 0, pending_kinds: [] };
  }
  const pending = readRuntimeEventOutbox(cwd);
  return {
    configured: true,
    pending_count: pending.length,
    pending_kinds: [...new Set(pending.map((entry) => entry.event.kind))],
  };
}

export function createContextRuntimeEventDeliveryPlan(
  cwd: string,
  sink: ContextRuntimeEventSink | null,
  description?: ContextRuntimeEventSinkDescription,
): ContextRuntimeEventDeliveryPlan {
  const path = runtimeEventOutboxPath(cwd);
  if (sink === null) {
    return {
      schema: CONTEXT_RUNTIME_EVENT_DELIVERY_PLAN_SCHEMA,
      status: "disabled",
      outbox: {
        path,
        encoding: "jsonl-at-rest; json-batch-on-delivery",
        event_count: 0,
        event_kinds: [],
        context_versions: [],
        property_keys: [],
      },
    };
  }
  const pending = readRuntimeEventOutbox(cwd);
  const eventKinds = [...new Set(pending.map((entry) => entry.event.kind))];
  const contextVersions = [...new Set(pending.map((entry) => entry.contextVersion))];
  const propertyKeys = [...new Set(pending.flatMap((entry) => Object.keys(entry.event.properties)))].sort();
  return {
    schema: CONTEXT_RUNTIME_EVENT_DELIVERY_PLAN_SCHEMA,
    status: pending.length === 0 ? "empty" : "pending",
    outbox: {
      path,
      encoding: "jsonl-at-rest; json-batch-on-delivery",
      event_count: pending.length,
      event_kinds: eventKinds,
      context_versions: contextVersions,
      property_keys: propertyKeys,
    },
    sink: {
      transport: "command",
      command: sink.command,
      args: [...sink.args],
      ...(description === undefined ? {} : { description }),
    },
    flush_command: "context logs flush --format json",
  };
}

export async function describeConfiguredContextRuntimeEventDelivery(
  cwd: string,
): Promise<ContextRuntimeEventDeliveryPlan> {
  const metadata = readRuntimePackageMetadata();
  const description = metadata.sink === null
    ? undefined
    : await describeRuntimeEventSink(metadata.sink, cwd);
  return createContextRuntimeEventDeliveryPlan(cwd, metadata.sink, description);
}

export function runtimeEventPendingAgentHint(
  result: RuntimeEventFlushResult,
): RuntimeEventPendingAgentHint | undefined {
  if (result.status !== "pending" || result.pending_count === 0) return undefined;
  return {
    reason_code: "runtime-events-delivery-pending",
    severity: "action-required",
    pending_count: result.pending_count,
    requires_network_access: true,
    plan_command: "context logs plan --format json",
    command: "context logs flush --format json",
    message: "Runtime logs are queued locally. Read the fixed delivery plan, request network access with its audit details, and run only its flush command before handing off the completed step.",
  };
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
  if (activeScope !== undefined) return work();
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
