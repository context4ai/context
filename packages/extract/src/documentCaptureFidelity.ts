export interface DocumentCaptureFidelityIssue {
  severity: "warning" | "error";
  impact: "evidence" | "projection";
  code: string;
  block_type: string;
  count: number;
  reason: string;
}

export interface DocumentCaptureFidelityReport {
  status: "complete" | "warning" | "error";
  evidence_status: "complete" | "error";
  projection_status: "complete" | "generic" | "warning" | "error";
  discovered: Record<string, number>;
  converted: Record<string, number>;
  skipped: Array<{
    block_type: string;
    count: number;
    reason: string;
  }>;
  issues: DocumentCaptureFidelityIssue[];
}

export const DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE = "document.resource.source-missing";
export const DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE = "document.resource.permission-denied";

export function isNonBlockingDocumentResourceFailureReasonCode(code: string | undefined): boolean {
  return code === DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE ||
    code === DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE;
}

export interface DocumentResourceMaterializationItem {
  kind: string;
  locator: string;
  status: "materialized" | "reference-only" | "failed";
  required: boolean;
  asset_paths: string[];
  reason_code?: string;
  reason?: string;
}

export interface DocumentResourceMaterializationReport {
  status: "complete" | "warning" | "error";
  discovered: Record<string, number>;
  materialized: Record<string, number>;
  reference_only: Record<string, number>;
  failed: Record<string, number>;
  items: DocumentResourceMaterializationItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function resourceAssetPath(value: unknown, field: string): string {
  const path = requiredString(value, field);
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || /^[a-zA-Z]:/u.test(path)) {
    throw new TypeError(`${field} must be a POSIX relative path`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new TypeError(`${field} must not contain empty, dot, or parent segments`);
  }
  return path;
}

function counts(value: unknown, field: string): Record<string, number> {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.trim().length === 0 || !Number.isInteger(item) || (item as number) < 0) {
      throw new TypeError(`${field}.${key} must be a non-negative integer`);
    }
    result[key] = item as number;
  }
  return result;
}

function skippedReasons(
  value: unknown,
  field: string,
): DocumentCaptureFidelityReport["skipped"] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`${field}[${index}] must be an object`);
    if (!Number.isInteger(item.count) || (item.count as number) < 1) {
      throw new TypeError(`${field}[${index}] must include block_type, positive count, and reason`);
    }
    return {
      block_type: requiredString(item.block_type, `${field}[${index}].block_type`),
      count: item.count as number,
      reason: requiredString(item.reason, `${field}[${index}].reason`),
    };
  });
}

function fidelityIssues(value: unknown, field: string): DocumentCaptureFidelityIssue[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`${field}[${index}] must be an object`);
    if ((item.severity !== "warning" && item.severity !== "error") ||
      !Number.isInteger(item.count) || (item.count as number) < 1) {
      throw new TypeError(`${field}[${index}] must include severity, code, block_type, positive count, and reason`);
    }
    return {
      severity: item.severity,
      impact: item.impact === "evidence" || item.impact === "projection"
        ? item.impact
        : item.severity === "error"
          ? "evidence"
          : "projection",
      code: requiredString(item.code, `${field}[${index}].code`),
      block_type: requiredString(item.block_type, `${field}[${index}].block_type`),
      count: item.count as number,
      reason: requiredString(item.reason, `${field}[${index}].reason`),
    };
  });
}

export function parseDocumentCaptureFidelity(
  value: unknown,
  field: string,
): DocumentCaptureFidelityReport | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  if (value.status !== "complete" && value.status !== "warning" && value.status !== "error") {
    throw new TypeError(`${field}.status must be complete, warning, or error`);
  }
  const discovered = counts(value.discovered, `${field}.discovered`);
  const converted = counts(value.converted, `${field}.converted`);
  const skipped = skippedReasons(value.skipped, `${field}.skipped`);
  const issues = fidelityIssues(value.issues, `${field}.issues`);
  const countedBlockTypes = new Set([
    ...Object.keys(discovered),
    ...Object.keys(converted),
    ...skipped.map((item) => item.block_type),
  ]);
  for (const blockType of countedBlockTypes) {
    const discoveredCount = discovered[blockType] ?? 0;
    const skippedCount = skipped
      .filter((item) => item.block_type === blockType)
      .reduce((sum, item) => sum + item.count, 0);
    if ((converted[blockType] ?? 0) + skippedCount !== discoveredCount) {
      throw new TypeError(`${field} does not close for ${blockType}: discovered ${discoveredCount}, converted ${converted[blockType] ?? 0}, skipped ${skippedCount}`);
    }
  }
  const evidenceStatus: DocumentCaptureFidelityReport["evidence_status"] = issues.some(
    (issue) => issue.impact === "evidence" && issue.severity === "error",
  )
    ? "error"
    : "complete";
  const projectionIssues = issues.filter((issue) => issue.impact === "projection");
  const inferredProjectionStatus: DocumentCaptureFidelityReport["projection_status"] = projectionIssues.some(
    (issue) => issue.severity === "error",
  )
    ? "error"
    : projectionIssues.some((issue) => issue.code === "lark.capture.generic-projection")
      ? "generic"
      : projectionIssues.length > 0
        ? "warning"
        : "complete";
  const projectionStatus = value.projection_status === "complete" ||
    value.projection_status === "generic" ||
    value.projection_status === "warning" ||
    value.projection_status === "error"
    ? value.projection_status
    : inferredProjectionStatus;
  const status: DocumentCaptureFidelityReport["status"] = evidenceStatus === "error" || projectionStatus === "error"
    ? "error"
    : issues.length > 0
      ? "warning"
      : "complete";
  if (value.status !== status) {
    throw new TypeError(`${field}.status must be ${status} for its issues`);
  }
  if (value.evidence_status !== undefined && value.evidence_status !== evidenceStatus) {
    throw new TypeError(`${field}.evidence_status must be ${evidenceStatus} for its issues`);
  }
  if (value.projection_status !== undefined && value.projection_status !== inferredProjectionStatus) {
    throw new TypeError(`${field}.projection_status must be ${inferredProjectionStatus} for its issues`);
  }
  return {
    status,
    evidence_status: evidenceStatus,
    projection_status: projectionStatus,
    discovered,
    converted,
    skipped,
    issues,
  };
}

export function parseDocumentResourceMaterialization(
  value: unknown,
  field: string,
): DocumentResourceMaterializationReport | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  if (value.status !== "complete" && value.status !== "warning" && value.status !== "error") {
    throw new TypeError(`${field}.status must be complete, warning, or error`);
  }
  const discovered = counts(value.discovered, `${field}.discovered`);
  const materialized = counts(value.materialized, `${field}.materialized`);
  const referenceOnly = counts(value.reference_only, `${field}.reference_only`);
  const failed = counts(value.failed, `${field}.failed`);
  if (!Array.isArray(value.items)) throw new TypeError(`${field}.items must be an array`);
  const items = value.items.map((item, index): DocumentResourceMaterializationItem => {
    if (!isRecord(item)) throw new TypeError(`${field}.items[${index}] must be an object`);
    if (item.status !== "materialized" && item.status !== "reference-only" && item.status !== "failed") {
      throw new TypeError(`${field}.items[${index}].status is invalid`);
    }
    if (typeof item.required !== "boolean" || !Array.isArray(item.asset_paths) ||
      item.asset_paths.some((path) => typeof path !== "string" || path.trim().length === 0)) {
      throw new TypeError(`${field}.items[${index}] must include required and asset_paths`);
    }
    const reasonCode = item.reason_code === undefined
      ? undefined
      : requiredString(item.reason_code, `${field}.items[${index}].reason_code`);
    const reason = item.reason === undefined ? undefined : requiredString(item.reason, `${field}.items[${index}].reason`);
    return {
      kind: requiredString(item.kind, `${field}.items[${index}].kind`),
      locator: requiredString(item.locator, `${field}.items[${index}].locator`),
      status: item.status,
      required: item.required,
      asset_paths: item.asset_paths.map((path, pathIndex) => resourceAssetPath(path, `${field}.items[${index}].asset_paths[${pathIndex}]`)),
      ...(reasonCode !== undefined ? { reason_code: reasonCode } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
  });
  const expectedStatus = items.some((item) =>
    item.status === "failed" &&
    item.required &&
    !isNonBlockingDocumentResourceFailureReasonCode(item.reason_code)
  )
    ? "error"
    : items.some((item) => item.status === "failed") || items.some(
      (item) => item.status === "reference-only" && item.kind === "poll" && item.reason?.includes("absent") === true,
    )
      ? "warning"
      : "complete";
  if (value.status !== expectedStatus) throw new TypeError(`${field}.status must be ${expectedStatus} for its items`);
  const expected = (status?: DocumentResourceMaterializationItem["status"]): Record<string, number> => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (status !== undefined && item.status !== status) continue;
      map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    }
    return Object.fromEntries([...map].sort(([left], [right]) => left.localeCompare(right)));
  };
  for (const [name, actual, wanted] of [
    ["discovered", discovered, expected()],
    ["materialized", materialized, expected("materialized")],
    ["reference_only", referenceOnly, expected("reference-only")],
    ["failed", failed, expected("failed")],
  ] as const) {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new TypeError(`${field}.${name} does not match items`);
  }
  return { status: value.status, discovered, materialized, reference_only: referenceOnly, failed, items };
}
