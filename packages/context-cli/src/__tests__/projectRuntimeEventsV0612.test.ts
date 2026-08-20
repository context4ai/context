import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
  CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA,
  CONTEXT_RUNTIME_EVENT_SINK_SCHEMA,
  createContextRuntimeEventDeliveryPlan,
  runtimeEventPendingAgentHint,
  parseContextRuntimeEventSink,
  queueContextRuntimeEvent,
  withContextRuntimeEventDelivery,
  type ContextRuntimeEventBatch,
  type ContextRuntimeEventSink,
} from "../runtimeEvents.js";
import { readRuntimeEventOutbox, runtimeEventOutboxPath } from "../runtimeEventOutbox.js";

const sink: ContextRuntimeEventSink = {
  schema: CONTEXT_RUNTIME_EVENT_SINK_SCHEMA,
  transport: "command",
  command: "example-event-sink",
  args: ["--ingest"],
};

function sentResult(eventCount: number) {
  return {
    schema: CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA,
    status: "sent" as const,
    event_count: eventCount,
    accepted: eventCount,
    rejected: 0,
  };
}

function failedResult(eventCount: number) {
  return {
    schema: CONTEXT_RUNTIME_EVENT_DELIVERY_RESULT_SCHEMA,
    status: "failed" as const,
    reason: "network_error",
    event_count: eventCount,
  };
}

describe("Context runtime events", () => {
  test("accepts only the package-owned command sink contract", () => {
    expect(parseContextRuntimeEventSink(sink)).toEqual(sink);
    expect(parseContextRuntimeEventSink({
      ...sink,
      describe_args: ["--describe"],
    })).toEqual({
      ...sink,
      describe_args: ["--describe"],
    });
    expect(parseContextRuntimeEventSink({ ...sink, describe_args: [42] })).toBeNull();
    expect(parseContextRuntimeEventSink({ ...sink, transport: "http" })).toBeNull();
    expect(parseContextRuntimeEventSink({ ...sink, args: ["ok", 42] })).toBeNull();
    expect(parseContextRuntimeEventSink({ ...sink, command: "" })).toBeNull();
  });

  test("batches successful events by their resolved workspace root", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-runtime-events-"));
    const workspaceOne = join(root, "one");
    const workspaceTwo = join(root, "two");
    mkdirSync(workspaceOne);
    mkdirSync(workspaceTwo);
    const delivered: Array<{ batch: ContextRuntimeEventBatch; cwd: string }> = [];
    try {
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: workspaceOne,
          kind: "workspace.active",
          properties: { workflow_status: "actionable" },
        });
        queueContextRuntimeEvent({
          cwd: workspaceOne,
          kind: "knowledge.closed",
          properties: { node_count: 3 },
        });
        queueContextRuntimeEvent({
          cwd: workspaceTwo,
          kind: "workspace.initialized",
          properties: { init_mode: "new" },
        });
      }, {
        contextVersion: "1.2.3",
        sink,
        dispatch: async (_sink, batch, cwd) => {
          delivered.push({ batch, cwd });
          return sentResult(batch.events.length);
        },
      });

      delivered.sort((left, right) => left.cwd.localeCompare(right.cwd));
      expect(delivered).toHaveLength(2);
      expect(delivered[0]?.cwd).toBe(workspaceOne);
      expect(delivered[0]?.batch).toMatchObject({
        schema: CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
        context_version: "1.2.3",
        events: [
          { kind: "workspace.active", properties: { workflow_status: "actionable" } },
          { kind: "knowledge.closed", properties: { node_count: 3 } },
        ],
      });
      expect(delivered[1]?.cwd).toBe(workspaceTwo);
      expect(delivered[1]?.batch.events[0]).toMatchObject({
        kind: "workspace.initialized",
        properties: { init_mode: "new" },
      });
      for (const item of delivered) {
        for (const event of item.batch.events) {
          expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/u);
          expect(event.event_time).toBeGreaterThan(0);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does nothing outside an active package-configured delivery scope", () => {
    expect(() => queueContextRuntimeEvent({
      cwd: "/workspace/one",
      kind: "workspace.active",
    })).not.toThrow();
  });

  test("describes a disabled community delivery plan without creating an outbox", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-runtime-events-"));
    try {
      const plan = createContextRuntimeEventDeliveryPlan(root, null);
      expect(plan).toMatchObject({
        schema: "context.runtime-event-delivery-plan.v1",
        status: "disabled",
        outbox: {
          path: runtimeEventOutboxPath(root),
          event_count: 0,
          event_kinds: [],
        },
      });
      expect(existsSync(runtimeEventOutboxPath(root))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("throttles the same workspace status for one hour but sends status changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-runtime-events-"));
    const delivered: ContextRuntimeEventBatch[] = [];
    const runStatus = async (workflowStatus: "actionable" | "complete"): Promise<void> => {
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: root,
          kind: "workspace.active",
          properties: { workflow_status: workflowStatus },
        });
      }, {
        contextVersion: "1.2.3",
        sink,
        dispatch: async (_sink, batch) => {
          delivered.push(batch);
          return sentResult(batch.events.length);
        },
      });
    };

    try {
      await runStatus("actionable");
      await runStatus("actionable");
      writeFileSync(join(root, ".tmp", "context-runtime", "runtime-event-state.json"), JSON.stringify({
        schema: "context.runtime-event-state.v1",
        workspace_active: {
          workflow_status: "actionable",
          delivered_at: Date.now() - 60 * 60 * 1_000 - 1,
        },
      }));
      await runStatus("actionable");
      await runStatus("complete");

      expect(delivered).toHaveLength(3);
      expect(delivered.map((batch) => batch.events[0]?.properties.workflow_status)).toEqual([
        "actionable",
        "actionable",
        "complete",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not retry a pending outbox when the repeated status is throttled", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-runtime-events-"));
    let attempts = 0;
    const runStatus = async (): Promise<void> => {
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: root,
          kind: "workspace.active",
          properties: { workflow_status: "actionable" },
        });
      }, {
        contextVersion: "1.2.3",
        sink,
        dispatch: async (_sink, batch) => {
          attempts += 1;
          return failedResult(batch.events.length);
        },
      });
    };

    try {
      await runStatus();
      await runStatus();
      expect(attempts).toBe(1);
      expect(readRuntimeEventOutbox(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("waits for the sink and persists a redacted delivery receipt in debug mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-runtime-events-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      context: { project: true, debug: true },
    }));
    const debugSink: ContextRuntimeEventSink = {
      schema: CONTEXT_RUNTIME_EVENT_SINK_SCHEMA,
      transport: "command",
      command: process.execPath,
      args: ["-e", [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', chunk => { input += chunk; });",
        "process.stdin.on('end', () => setTimeout(() => {",
        "  const batch = JSON.parse(input);",
        "  process.stdout.write(JSON.stringify({",
        "    schema: 'context.runtime-event-delivery-result.v1',",
        "    status: 'sent', duration_ms: 60, event_count: batch.events.length,",
        "    http_status: 200, code: 0, accepted: batch.events.length, rejected: 0,",
        "    private_payload: 'must-not-be-persisted'",
        "  }));",
        "}, 60));",
      ].join("\n")],
    };

    try {
      const startedAt = Date.now();
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: root,
          kind: "package.build.completed",
          properties: { package_count: 1 },
        });
      }, {
        contextVersion: "1.2.3",
        sink: debugSink,
      });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);

      const events = readFileSync(
        join(root, ".tmp", "context-runtime", "debug", "events.jsonl"),
        "utf8",
      ).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      const telemetry = events.find((event) => event.kind === "runtime.telemetry");
      expect(telemetry).toMatchObject({
        kind: "runtime.telemetry",
        data: {
          status: "sent",
          event_count: 1,
          event_kinds: ["package.build.completed"],
          exit_code: 0,
          response: {
            schema: "context.runtime-event-delivery-result.v1",
            status: "sent",
            http_status: 200,
            code: 0,
            accepted: 1,
            rejected: 0,
          },
        },
      });
      expect(JSON.stringify(telemetry)).not.toContain("private_payload");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps silent failures queued and sends the accumulated outbox at build", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-runtime-events-"));
    const delivered: ContextRuntimeEventBatch[] = [];
    let fail = true;
    const dispatch = async (_sink: ContextRuntimeEventSink, batch: ContextRuntimeEventBatch) => {
      delivered.push(batch);
      return fail ? failedResult(batch.events.length) : sentResult(batch.events.length);
    };

    try {
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: root,
          kind: "workspace.initialized",
          properties: { init_mode: "new" },
        });
      }, { contextVersion: "1.2.3", sink, dispatch });

      expect(readRuntimeEventOutbox(root)).toHaveLength(1);
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: root,
          kind: "knowledge.closed",
          properties: { node_count: 3 },
        });
      }, { contextVersion: "1.2.3", sink, dispatch });

      expect(delivered.at(-1)?.events.map((event) => event.kind)).toEqual([
        "workspace.initialized",
        "knowledge.closed",
      ]);
      expect(readRuntimeEventOutbox(root)).toHaveLength(2);

      fail = false;
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: root,
          kind: "package.build.completed",
          properties: { package_count: 1 },
        });
      }, { contextVersion: "1.2.3", sink, dispatch });

      expect(delivered.at(-1)?.events.map((event) => event.kind)).toEqual([
        "workspace.initialized",
        "knowledge.closed",
        "package.build.completed",
      ]);
      expect(readRuntimeEventOutbox(root)).toHaveLength(0);
      expect(existsSync(runtimeEventOutboxPath(root))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not create an outbox when no sink is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-runtime-events-"));
    try {
      await withContextRuntimeEventDelivery(async () => {
        queueContextRuntimeEvent({
          cwd: root,
          kind: "package.build.completed",
          properties: { package_count: 1 },
        });
      }, { sink: null });
      expect(existsSync(runtimeEventOutboxPath(root))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns an action-required network hint only while events remain pending", () => {
    expect(runtimeEventPendingAgentHint({
      status: "pending",
      pending_count: 2,
      attempted_count: 2,
      sent_count: 0,
      last_result: failedResult(2),
    })).toEqual({
      reason_code: "runtime-events-delivery-pending",
      severity: "action-required",
      pending_count: 2,
      requires_network_access: true,
      plan_command: "context logs plan --format json",
      command: "context logs flush --format json",
      message: "Runtime logs are queued locally. Read the fixed delivery plan, request network access with its audit details, and run only its flush command before handing off the completed step.",
    });
    expect(runtimeEventPendingAgentHint({
      status: "sent",
      pending_count: 0,
      attempted_count: 2,
      sent_count: 2,
    })).toBeUndefined();
  });
});
