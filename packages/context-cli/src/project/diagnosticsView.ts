import type { AlignDiagnostic } from "./proseAlignTypes.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export interface DiagnosticsViewResult extends Record<string, unknown> {
  kind: "diagnostics.view.result";
  diagnostics_summary: Record<string, unknown>;
  diagnostics: AlignDiagnostic[];
  next_action: Record<string, unknown>;
}

function integerOption(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw new ContextError(ExitCode.UserError, `${name} must be a non-negative integer`, {
    category: ErrorCategory.UserInputInvalid,
    value,
  });
}

export function diagnosticsSummary(diagnostics: readonly AlignDiagnostic[]): Record<string, number> {
  return {
    total: diagnostics.length,
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length,
  };
}

export function diagnosticsView(input: {
  diagnostics: readonly AlignDiagnostic[];
  baseCommand: string;
  pageToken?: string;
  pageSize?: string;
}): DiagnosticsViewResult {
  const pageSize = Math.min(100, Math.max(1, integerOption(input.pageSize, 25, "--page-size")));
  const offset = integerOption(input.pageToken, 0, "--page-token");
  const diagnostics = [...input.diagnostics].sort((left, right) => {
    const rank = { error: 0, warning: 1, info: 2 } as const;
    return rank[left.severity] - rank[right.severity];
  });
  const page = diagnostics.slice(offset, offset + pageSize);
  if (offset >= diagnostics.length && diagnostics.length > 0) {
    throw new ContextError(ExitCode.UserError, "--page-token is beyond diagnostics", {
      category: ErrorCategory.UserInputInvalid,
      offset,
      total: diagnostics.length,
      next: `${input.baseCommand} --page-size ${pageSize} --format json`,
    });
  }
  const nextOffset = offset + page.length < diagnostics.length ? offset + page.length : undefined;
  return {
    kind: "diagnostics.view.result",
    diagnostics_summary: {
      ...diagnosticsSummary(diagnostics),
      returned: page.length,
      offset,
      truncated: nextOffset !== undefined,
    },
    diagnostics: page,
    next_action: nextOffset === undefined
      ? { kind: "diagnostics_complete", message: "All diagnostics have been returned." }
      : {
          kind: "read_next_diagnostics_page",
          command: `${input.baseCommand} --page-token ${nextOffset} --page-size ${pageSize} --format json`,
        },
  };
}
