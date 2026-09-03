import { formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  type CaptureFileRunResult,
  isCaptureFileRunResult,
} from "./documentCapture.js";
import {
  type CaptureLarkRunResult,
  isCaptureLarkRunResult,
} from "./documentCaptureLark.js";

export type ProjectRunFormat = "text" | "json";

interface RunOutputPlan {
  phase: {
    id: string;
    kind: string;
    reads: string[];
    writes: string[];
  };
}

export function errorView(error: unknown): { name: string; message: string; code?: string; stack?: string; detail?: Record<string, unknown> } {
  if (error instanceof ContextError) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
    };
  }
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return {
      name: error.name,
      message: error.message,
      ...(code !== undefined ? { code } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

export function resultSummary(result: unknown): Record<string, unknown> | undefined {
  if (result === undefined) return undefined;
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
}

function nextActionCommand(value: unknown): string | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  if ("command" in value && typeof value.command === "string") return value.command;
  return "message" in value && typeof value.message === "string" ? value.message : undefined;
}

function runSuccessBaseBody(input: { plan: RunOutputPlan; logPath: string }): string[] {
  return [
    `reads: ${input.plan.phase.reads.length > 0 ? input.plan.phase.reads.join(", ") : "none"}`,
    `writes: ${input.plan.phase.writes.length > 0 ? input.plan.phase.writes.join(", ") : "none"}`,
    `log: ${input.logPath}`,
  ];
}

function appendCaptureFileRunBody(body: string[], result: CaptureFileRunResult): void {
  const nextAction = nextActionCommand(result.next_action);
  body.push(
    `source: file:${result.source.name}`,
    `include: ${result.source.include.join(", ")}`,
    `documents: ${result.documents.length}`,
    `snapshot: ${result.snapshot.manifest}`,
    `snapshot hash: ${result.snapshot.snapshot_hash}`,
    `changed: ${result.snapshot.changed ? "yes" : "no"}`,
  );
  if (nextAction !== undefined) body.push(`next action: ${nextAction}`);
  for (const document of result.documents.slice(0, 8)) {
    body.push(`document ${document.path}: ${document.title} (${document.line_count} line(s))`);
  }
}

function appendCaptureLarkRunBody(body: string[], result: CaptureLarkRunResult): void {
  const nextAction = nextActionCommand(result.next_action);
  body.push(
    `source: lark:${result.source.name}`,
    `identity: ${result.source.identity}`,
    `documents: ${result.documents.length}`,
    `assets: ${result.assets.length}`,
    `snapshot: ${result.snapshot.manifest}`,
    `snapshot hash: ${result.snapshot.snapshot_hash}`,
    `changed: ${result.snapshot.changed ? "yes" : "no"}`,
  );
  if (nextAction !== undefined) body.push(`next action: ${nextAction}`);
  for (const document of result.documents.slice(0, 8)) {
    body.push(`document ${document.path}: ${document.title} (${document.line_count} line(s))`);
  }
}

function appendRunResultBody(body: string[], result: unknown): void {
  if (isCaptureFileRunResult(result)) appendCaptureFileRunBody(body, result);
  if (isCaptureLarkRunResult(result)) appendCaptureLarkRunBody(body, result);
  if (result !== null && typeof result === "object" && !Array.isArray(result) &&
    "kind" in result && (result.kind === "semantic.rules.view.result" || result.kind === "diagnostics.view.result") &&
    "next_action" in result && result.next_action !== null && typeof result.next_action === "object" && !Array.isArray(result.next_action)) {
    const nextCommand = nextActionCommand(result.next_action);
    if (nextCommand !== undefined) body.push(`next action: ${nextCommand}`);
  }
}

export function writeRunSuccess(input: {
  plan: RunOutputPlan;
  result: unknown;
  logPath: string;
  format: ProjectRunFormat;
  verbose?: boolean;
}): void {
  if (input.format === "json") {
    const result = compactJsonResult(input.result, input.verbose === true);
    process.stdout.write(`${JSON.stringify(input.verbose === true ? {
      result,
      ...input.plan,
      log: input.logPath,
    } : {
      result,
      phase: {
        id: input.plan.phase.id,
        kind: input.plan.phase.kind,
      },
      log: input.logPath,
    }, null, 2)}\n`);
    return;
  }

  const body = runSuccessBaseBody(input);
  appendRunResultBody(body, input.result);
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "ran",
    subject: input.plan.phase.id,
    headline: input.plan.phase.kind,
    body,
  }));
}

function compactDiagnostics(record: Record<string, unknown>): void {
  if (!Array.isArray(record.diagnostics) || record.diagnostics.length <= 25) return;
  const diagnostics = record.diagnostics.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item)
  ).sort((left, right) => {
    const rank = (severity: unknown): number => severity === "error" ? 0 : severity === "warning" ? 1 : 2;
    return rank(left.severity) - rank(right.severity);
  });
  record.diagnostics = diagnostics.slice(0, 25);
  record.diagnostics_summary = {
    total: diagnostics.length,
    returned: Math.min(25, diagnostics.length),
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length,
    truncated: diagnostics.length > 25,
    continuation: record.diagnostics_view,
  };
}

function compactJsonResult(result: unknown, verbose: boolean): unknown {
  if (verbose || result === null || typeof result !== "object" || Array.isArray(result)) return result;
  const record = { ...(result as Record<string, unknown>) };
  compactDiagnostics(record);
  return record;
}
