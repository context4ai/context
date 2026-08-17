import type { AlignDiagnostic, DiagnosticSeverity } from "./proseAlignTypes.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function stringOrNullValue(record: Record<string, unknown>, field: string): string | null | undefined {
  const value = record[field];
  if (value === null) return null;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function diagnostic(
  severity: DiagnosticSeverity,
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

export function reportUnknownFields(
  record: Record<string, unknown>,
  allowedFields: readonly string[],
  fieldPrefix: string,
  diagnostics: AlignDiagnostic[],
): void {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(record)) {
    if (allowed.has(field)) continue;
    diagnostics.push(diagnostic(
      "error",
      "schema.unknown_field",
      "schema",
      `Unknown field is not allowed: ${field}.`,
      `${fieldPrefix}.${field}`,
    ));
  }
}

export function parseStringArray(value: unknown, field: string, diagnostics: AlignDiagnostic[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("error", "schema.string_array", "schema", "Field must be an array of non-empty strings.", field));
    return [];
  }
  const items: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === "string" && item.trim().length > 0) {
      items.push(item.trim());
      continue;
    }
    diagnostics.push(diagnostic("error", "schema.string_array_item", "schema", "Array item must be a non-empty string.", `${field}[${index}]`));
  }
  return items;
}

export function parseOptionalString(value: unknown, field: string, diagnostics: AlignDiagnostic[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  diagnostics.push(diagnostic("error", "schema.string", "schema", "Field must be a non-empty string when present.", field));
  return undefined;
}
