import { describe, expect, test } from "bun:test";
import { writeRunSuccess } from "../project/runOutput.js";

function rendered(result: unknown, verbose = false): Record<string, unknown> {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    writeRunSuccess({ plan: { phase: { id: "capture:lark:guide", kind: "phase.capture.lark", reads: [], writes: [] } },
      result, logPath: ".tmp/run.json", format: "json", verbose });
    return JSON.parse(chunks.join("")) as Record<string, unknown>;
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe("run result diagnostic budgets", () => {
  test("retains string diagnostics and prioritizes late capture warnings within the budget", () => {
    const diagnostics = Array.from({ length: 26 }, (_, index) => `info: captured item ${index}`);
    diagnostics.push("warning: preview retained instead of original", "error: evidence missing");
    const result = rendered({ kind: "document.capture.lark.result", diagnostics }).result as Record<string, unknown>;
    expect(result.diagnostics).toHaveLength(25);
    expect((result.diagnostics as unknown[]).slice(0, 2)).toEqual([
      "error: evidence missing", "warning: preview retained instead of original",
    ]);
    expect(result.diagnostics_summary).toMatchObject({ total: 28, returned: 25, errors: 1, warnings: 1,
      info: 26, unclassified: 0, truncated: true });
    expect(diagnostics[0]).toBe("info: captured item 0");
  });

  test("keeps mixed diagnostics and preserves the complete verbose payload", () => {
    const diagnostics: unknown[] = [{ severity: "warning", reason_code: "resource.preview" },
      "failed: resource remains unavailable", ...Array.from({ length: 25 }, (_, index) => ({ severity: "info", index }))];
    const compacted = rendered({ diagnostics, diagnostics_view: "capture-report.json" }).result as Record<string, unknown>;
    expect(compacted.diagnostics as unknown[]).toContain("failed: resource remains unavailable");
    expect(compacted.diagnostics_summary).toMatchObject({ total: 27, warnings: 1, info: 25,
      unclassified: 1, continuation: "capture-report.json", truncated: true });
    expect(rendered({ diagnostics }, true).result).toEqual({ diagnostics });
  });
});
