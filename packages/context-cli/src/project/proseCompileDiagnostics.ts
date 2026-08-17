import type { AlignDiagnostic } from "./proseAlignTypes.js";

export function compileDiagnostic(
  severity: AlignDiagnostic["severity"],
  code: string,
  family: string,
  message: string,
  field?: string,
  extra: Partial<AlignDiagnostic> = {},
): AlignDiagnostic {
  return {
    severity,
    code,
    family,
    message,
    ...(field !== undefined ? { field } : {}),
    ...extra,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
