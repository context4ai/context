import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";

export const CONTEXT_DEBUG_EVENT_SCHEMA = "context.debug.event.v1";
export const CONTEXT_DEBUG_REPLAY_SCHEMA = "context.debug.replay.v1";
export const CONTEXT_DEBUG_ROOT = join(".tmp", "context-runtime", "debug");
export const CONTEXT_DEBUG_EVENTS = join(CONTEXT_DEBUG_ROOT, "events.jsonl");
export const CONTEXT_DEBUG_STATE = join(CONTEXT_DEBUG_ROOT, "state.json");
export const CONTEXT_DEBUG_REPLAY = join(CONTEXT_DEBUG_ROOT, "replay.json");

type DebugEventKind =
  | "debug.enabled"
  | "debug.disabled"
  | "cli.invoked"
  | "cli.completed"
  | "agent-graph.evaluated"
  | "workflow.action-started"
  | "workflow.action-completed"
  | "workflow.scope-opened"
  | "workflow.scope-closed"
  | "workflow.stopped"
  | "performance.measurement"
  | "runtime.telemetry";

interface DebugInvocationContext {
  invocationId: string;
  parentInvocationId?: string;
  projectRoot: string;
}

interface DebugGraphState {
  revision: string;
  status: string;
  routeId?: string;
  node?: string;
  reasonCode?: string;
}

interface DebugState {
  schema: "context.debug.state.v1";
  traceId: string;
  nextSequence: number;
  enabledAt: string;
  lastGraph?: DebugGraphState;
}

export interface ContextDebugEvent {
  schema: typeof CONTEXT_DEBUG_EVENT_SCHEMA;
  trace_id: string;
  sequence: number;
  at: string;
  kind: DebugEventKind;
  invocation_id?: string;
  parent_invocation_id?: string;
  data: Record<string, unknown>;
}

const invocationStorage = new AsyncLocalStorage<DebugInvocationContext>();
const SENSITIVE_OPTION = /^(--(?:auth|authorization|password|secret|token|otp|cookie|api-key))(?:=|$)/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function debugPaths(projectRoot: string) {
  return {
    root: join(projectRoot, CONTEXT_DEBUG_ROOT),
    events: join(projectRoot, CONTEXT_DEBUG_EVENTS),
    state: join(projectRoot, CONTEXT_DEBUG_STATE),
    replay: join(projectRoot, CONTEXT_DEBUG_REPLAY),
    lock: join(projectRoot, CONTEXT_DEBUG_ROOT, ".write.lock"),
  };
}

function packageContext(projectRoot: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.context)) return null;
    return parsed.context;
  } catch {
    return null;
  }
}

export function isContextDebugEnabled(projectRoot: string): boolean {
  return packageContext(projectRoot)?.debug === true;
}

function findDebugProjectRoot(startDir: string): string | null {
  let current = resolve(startDir);
  const filesystemRoot = parse(current).root;
  while (true) {
    if (packageContext(current)?.project === true) return current;
    if (current === filesystemRoot) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function sanitizeArgv(argv: readonly string[]): string[] {
  const result: string[] = [];
  let redactNext = false;
  for (const token of argv.slice(2)) {
    if (redactNext) {
      result.push("<redacted>");
      redactNext = false;
      continue;
    }
    const match = token.match(SENSITIVE_OPTION);
    if (match === null) {
      result.push(token);
      continue;
    }
    const option = match[1]!;
    result.push(token.includes("=") ? `${option}=<redacted>` : option);
    redactNext = !token.includes("=");
  }
  return result;
}

async function readDebugState(path: string): Promise<DebugState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      !isRecord(parsed) || parsed.schema !== "context.debug.state.v1" ||
      typeof parsed.traceId !== "string" || typeof parsed.nextSequence !== "number" ||
      typeof parsed.enabledAt !== "string"
    ) return null;
    return parsed as unknown as DebugState;
  } catch {
    return null;
  }
}

async function acquireDebugLock(lockPath: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      await mkdir(lockPath);
      return async () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  throw new Error("Context debug trace lock remained busy for two seconds.");
}

async function appendEvent(
  projectRoot: string,
  kind: DebugEventKind,
  data: Record<string, unknown>,
  options: { force?: boolean; graphState?: DebugGraphState } = {},
): Promise<ContextDebugEvent | null> {
  if (options.force !== true && !isContextDebugEnabled(projectRoot)) return null;
  const paths = debugPaths(projectRoot);
  try {
    await mkdir(paths.root, { recursive: true });
    const release = await acquireDebugLock(paths.lock);
    try {
      const now = new Date().toISOString();
      const state = await readDebugState(paths.state) ?? {
        schema: "context.debug.state.v1" as const,
        traceId: randomUUID(),
        nextSequence: 1,
        enabledAt: now,
      };
      const previousGraph = state.lastGraph;
      const eventData = options.graphState === undefined
        ? data
        : {
            ...data,
            ...(previousGraph === undefined ? {} : { previous: previousGraph }),
            transition: {
              changed: previousGraph === undefined ||
                previousGraph.revision !== options.graphState.revision ||
                previousGraph.status !== options.graphState.status ||
                previousGraph.routeId !== options.graphState.routeId ||
                previousGraph.node !== options.graphState.node,
            },
          };
      const invocation = invocationStorage.getStore();
      const event: ContextDebugEvent = {
        schema: CONTEXT_DEBUG_EVENT_SCHEMA,
        trace_id: state.traceId,
        sequence: state.nextSequence,
        at: now,
        kind,
        ...(invocation === undefined ? {} : { invocation_id: invocation.invocationId }),
        ...(invocation?.parentInvocationId === undefined
          ? {}
          : { parent_invocation_id: invocation.parentInvocationId }),
        data: eventData,
      };
      await appendFile(paths.events, `${JSON.stringify(event)}\n`, "utf8");
      const nextState: DebugState = {
        ...state,
        nextSequence: state.nextSequence + 1,
        ...(options.graphState === undefined ? {} : { lastGraph: options.graphState }),
      };
      await atomicWriteFile(paths.state, `${JSON.stringify(nextState, null, 2)}\n`);
      return event;
    } finally {
      await release();
    }
  } catch {
    // Debugging is observational. Recorder failures must never change the
    // command, workflow route, gate, or exit status being observed.
    return null;
  }
}

async function updateDebugSetting(projectRoot: string, enabled: boolean): Promise<void> {
  const packagePath = join(projectRoot, "package.json");
  const parsed = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.context) || parsed.context.project !== true) {
    throw new Error("package.json is not a Context project.");
  }
  if (enabled) parsed.context.debug = true;
  else delete parsed.context.debug;
  await atomicWriteFile(packagePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

export async function enableContextDebug(projectRoot: string, source: "init" | "command"): Promise<void> {
  await updateDebugSetting(projectRoot, true);
  await appendEvent(projectRoot, "debug.enabled", { source }, { force: true });
}

export async function disableContextDebug(projectRoot: string): Promise<void> {
  await appendEvent(projectRoot, "debug.disabled", { source: "command" }, { force: true });
  await updateDebugSetting(projectRoot, false);
}

export async function initializeContextDebug(projectRoot: string): Promise<void> {
  await appendEvent(projectRoot, "debug.enabled", { source: "init" }, { force: true });
}

export function currentDebugInvocationId(): string | undefined {
  return invocationStorage.getStore()?.invocationId;
}

export function debugChildEnvironment(): NodeJS.ProcessEnv {
  const invocationId = currentDebugInvocationId();
  return invocationId === undefined ? {} : { CONTEXT_DEBUG_PARENT_INVOCATION_ID: invocationId };
}

export async function withDebugCliInvocation<T>(
  argv: readonly string[],
  action: () => Promise<T>,
): Promise<T> {
  const projectRoot = findDebugProjectRoot(process.cwd());
  if (projectRoot === null || !isContextDebugEnabled(projectRoot)) return action();
  const invocation: DebugInvocationContext = {
    invocationId: randomUUID(),
    projectRoot,
    ...(process.env.CONTEXT_DEBUG_PARENT_INVOCATION_ID === undefined
      ? {}
      : { parentInvocationId: process.env.CONTEXT_DEBUG_PARENT_INVOCATION_ID }),
  };
  const started = Date.now();
  return invocationStorage.run(invocation, async () => {
    await appendEvent(projectRoot, "cli.invoked", {
      argv: sanitizeArgv(argv),
    });
    try {
      const result = await action();
      await appendEvent(projectRoot, "cli.completed", {
        duration_ms: Date.now() - started,
        outcome: "success",
      }, { force: true });
      return result;
    } catch (error) {
      await appendEvent(projectRoot, "cli.completed", {
        duration_ms: Date.now() - started,
        outcome: "error",
        error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      }, { force: true });
      throw error;
    }
  });
}

export async function recordAgentGraphEvaluation(input: {
  projectRoot: string;
  revision: string;
  status: string;
  route?: { id: string; node: string; reasonCode: string; availability: string; command?: string };
  alternatives: Array<{ id: string; node: string; reasonCode: string; availability: string }>;
}): Promise<void> {
  if (!isContextDebugEnabled(input.projectRoot)) return;
  const current: DebugGraphState = {
    revision: input.revision,
    status: input.status,
    ...(input.route === undefined
      ? {}
      : { routeId: input.route.id, node: input.route.node, reasonCode: input.route.reasonCode }),
  };
  await appendEvent(input.projectRoot, "agent-graph.evaluated", {
    graph: { provider: "c4a/context", graph: "workspace", entry: "context" },
    current,
    ...(input.route === undefined ? {} : { selected_route: input.route }),
    alternatives: input.alternatives,
  }, { graphState: current });
}

export async function recordWorkflowAction(input: {
  projectRoot: string;
  phase: "started" | "completed";
  step: Record<string, unknown>;
}): Promise<void> {
  await appendEvent(
    input.projectRoot,
    input.phase === "started" ? "workflow.action-started" : "workflow.action-completed",
    input.step,
  );
}

export async function recordWorkflowExecutionScope(input: {
  projectRoot: string;
  phase: "opened" | "closed";
  data: Record<string, unknown>;
}): Promise<void> {
  await appendEvent(
    input.projectRoot,
    input.phase === "opened" ? "workflow.scope-opened" : "workflow.scope-closed",
    input.data,
  );
}

export async function recordRuntimeTelemetryDelivery(input: {
  projectRoot: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await appendEvent(input.projectRoot, "runtime.telemetry", input.data);
}

export async function recordWorkflowStop(projectRoot: string, data: Record<string, unknown>): Promise<void> {
  await appendEvent(projectRoot, "workflow.stopped", data);
}

export async function recordContextDebugPerformance(input: {
  projectRoot: string;
  operation: string;
  durationMs: number;
  outcome: "success" | "error";
  counters?: Readonly<Record<string, number>>;
  data?: Readonly<Record<string, unknown>>;
}): Promise<void> {
  await appendEvent(input.projectRoot, "performance.measurement", {
    operation: input.operation,
    duration_ms: Math.max(0, Math.round(input.durationMs * 1_000) / 1_000),
    outcome: input.outcome,
    ...(input.counters === undefined ? {} : { counters: input.counters }),
    ...(input.data === undefined ? {} : { detail: input.data }),
  });
}

export async function measureContextDebugOperation<T>(input: {
  projectRoot: string;
  operation: string;
  counters?: Readonly<Record<string, number>>;
  data?: Readonly<Record<string, unknown>>;
}, action: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await action();
    await recordContextDebugPerformance({
      ...input,
      durationMs: performance.now() - started,
      outcome: "success",
    });
    return result;
  } catch (error) {
    await recordContextDebugPerformance({
      ...input,
      durationMs: performance.now() - started,
      outcome: "error",
      data: {
        ...input.data,
        error_name: error instanceof Error ? error.name : "unknown",
      },
    });
    throw error;
  }
}

async function readEvents(projectRoot: string): Promise<ContextDebugEvent[]> {
  try {
    const content = await readFile(debugPaths(projectRoot).events, "utf8");
    return content.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as ContextDebugEvent;
        return parsed.schema === CONTEXT_DEBUG_EVENT_SCHEMA ? [parsed] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function resolveReplayPath(projectRoot: string, output?: string): string {
  const absolute = resolve(projectRoot, output ?? CONTEXT_DEBUG_REPLAY);
  const tmpRoot = resolve(projectRoot, ".tmp");
  const rel = relative(tmpRoot, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Context debug replay output must be a file below the workspace .tmp directory.");
  }
  return absolute;
}

export async function contextDebugStatus(projectRoot: string): Promise<Record<string, unknown>> {
  const events = await readEvents(projectRoot);
  const counts = events.reduce<Record<string, number>>((result, event) => {
    result[event.kind] = (result[event.kind] ?? 0) + 1;
    return result;
  }, {});
  const state = await readDebugState(debugPaths(projectRoot).state);
  return {
    protocol: "context.debug.status.v1",
    enabled: isContextDebugEnabled(projectRoot),
    trace_id: state?.traceId,
    event_count: events.length,
    counts,
    paths: {
      events: CONTEXT_DEBUG_EVENTS,
      state: CONTEXT_DEBUG_STATE,
      replay: CONTEXT_DEBUG_REPLAY,
    },
  };
}

export async function exportContextDebugReplay(
  projectRoot: string,
  output?: string,
): Promise<Record<string, unknown>> {
  const events = await readEvents(projectRoot);
  const transitions = events.filter((event) =>
    event.kind === "agent-graph.evaluated" &&
    isRecord(event.data.transition) && event.data.transition.changed === true
  ).map((event) => ({
    sequence: event.sequence,
    at: event.at,
    invocation_id: event.invocation_id,
    previous: event.data.previous,
    current: event.data.current,
    selected_route: event.data.selected_route,
  }));
  const replay = {
    schema: CONTEXT_DEBUG_REPLAY_SCHEMA,
    generated_at: new Date().toISOString(),
    trace_id: events[0]?.trace_id,
    events,
    transitions,
  };
  const outputPath = resolveReplayPath(projectRoot, output);
  await atomicWriteFile(outputPath, `${JSON.stringify(replay, null, 2)}\n`);
  return {
    protocol: "context.debug.export.v1",
    output: relative(projectRoot, outputPath),
    event_count: events.length,
    transition_count: transitions.length,
    trace_id: events[0]?.trace_id,
  };
}
