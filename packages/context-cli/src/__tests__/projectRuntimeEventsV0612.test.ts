import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
  CONTEXT_RUNTIME_EVENT_SINK_SCHEMA,
  parseContextRuntimeEventSink,
  queueContextRuntimeEvent,
  withContextRuntimeEventDelivery,
  type ContextRuntimeEventBatch,
  type ContextRuntimeEventSink,
} from "../runtimeEvents.js";

const sink: ContextRuntimeEventSink = {
  schema: CONTEXT_RUNTIME_EVENT_SINK_SCHEMA,
  transport: "command",
  command: "example-event-sink",
  args: ["--ingest"],
};

describe("Context runtime events", () => {
  test("accepts only the package-owned command sink contract", () => {
    expect(parseContextRuntimeEventSink(sink)).toEqual(sink);
    expect(parseContextRuntimeEventSink({ ...sink, transport: "http" })).toBeNull();
    expect(parseContextRuntimeEventSink({ ...sink, args: ["ok", 42] })).toBeNull();
    expect(parseContextRuntimeEventSink({ ...sink, command: "" })).toBeNull();
  });

  test("batches successful events by their resolved workspace root", async () => {
    const delivered: Array<{ batch: ContextRuntimeEventBatch; cwd: string }> = [];
    await withContextRuntimeEventDelivery(async () => {
      queueContextRuntimeEvent({
        cwd: "/workspace/one",
        kind: "workspace.active",
        properties: { workflow_status: "actionable" },
      });
      queueContextRuntimeEvent({
        cwd: "/workspace/one",
        kind: "knowledge.closed",
        properties: { node_count: 3 },
      });
      queueContextRuntimeEvent({
        cwd: "/workspace/two",
        kind: "workspace.initialized",
        properties: { init_mode: "new" },
      });
    }, {
      contextVersion: "1.2.3",
      forceDelivery: true,
      sink,
      dispatch: async (_sink, batch, cwd) => {
        delivered.push({ batch, cwd });
      },
    });

    delivered.sort((left, right) => left.cwd.localeCompare(right.cwd));
    expect(delivered).toHaveLength(2);
    expect(delivered[0]?.cwd).toBe("/workspace/one");
    expect(delivered[0]?.batch).toMatchObject({
      schema: CONTEXT_RUNTIME_EVENT_BATCH_SCHEMA,
      context_version: "1.2.3",
      events: [
        { kind: "workspace.active", properties: { workflow_status: "actionable" } },
        { kind: "knowledge.closed", properties: { node_count: 3 } },
      ],
    });
    expect(delivered[1]?.cwd).toBe("/workspace/two");
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
  });

  test("does nothing outside an active package-configured delivery scope", () => {
    expect(() => queueContextRuntimeEvent({
      cwd: "/workspace/one",
      kind: "workspace.active",
    })).not.toThrow();
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
        forceDelivery: true,
        sink,
        dispatch: async (_sink, batch) => {
          delivered.push(batch);
          return true;
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

  test("throttles a repeated status after a failed delivery attempt", async () => {
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
        forceDelivery: true,
        sink,
        dispatch: async () => {
          attempts += 1;
          return false;
        },
      });
    };

    try {
      await runStatus();
      await runStatus();
      expect(attempts).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
