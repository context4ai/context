import {
  parseDocumentCaptureFidelity,
  parseDocumentResourceMaterialization,
  type DocumentCaptureFidelityReport,
  type DocumentResourceMaterializationItem,
  type DocumentResourceMaterializationReport,
} from "@c4a/extract";
import type { LarkExternalResource } from "./larkDocxXml.js";
import type { LarkResourceMaterializationReport } from "./larkResourceMaterialization.js";

export const LARK_CAPTURE_REPORT_SCHEMA_VERSION = "context.lark-capture-report.v1";

export interface LarkCaptureReportResource extends DocumentResourceMaterializationItem {
  title?: string;
  attributes: Record<string, string>;
}

/** Something that changed who can read the document during this capture (e.g. a viewer was added). */
export interface LarkAccessEvent {
  kind: string;
  message: string;
  app_id?: string;
  /** True when the event changed who can read the document upstream (not for failed attempts). */
  changed_access?: boolean;
}

/** Which identity read the document, recorded so later status checks need not re-run capture. */
export interface LarkCaptureAccess {
  identity: "user" | "bot";
  /** Set when the requested bot could not read the document and the user identity read it instead. */
  fallback?: { from: "bot"; cause: string };
  events?: LarkAccessEvent[];
}

export interface LarkCaptureReport {
  schema_version: typeof LARK_CAPTURE_REPORT_SCHEMA_VERSION;
  fidelity: DocumentCaptureFidelityReport;
  resource_materialization: Omit<DocumentResourceMaterializationReport, "items">;
  resources: LarkCaptureReportResource[];
  /** Absent in reports written before 0.7.98. */
  access?: LarkCaptureAccess;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new TypeError(`${field}.${key} must be a string`);
    result[key] = item;
  }
  return result;
}

function resourceKey(resource: Pick<LarkExternalResource, "kind" | "locator">): string {
  return `${resource.kind}\0${resource.locator}`;
}

function materializationSummary(
  report: DocumentResourceMaterializationReport,
): Omit<DocumentResourceMaterializationReport, "items"> {
  return {
    status: report.status,
    discovered: report.discovered,
    materialized: report.materialized,
    reference_only: report.reference_only,
    failed: report.failed,
  };
}

function materializationItem(resource: LarkCaptureReportResource): DocumentResourceMaterializationItem {
  return {
    kind: resource.kind,
    locator: resource.locator,
    status: resource.status,
    required: resource.required,
    asset_paths: resource.asset_paths,
    ...(resource.reason_code === undefined ? {} : { reason_code: resource.reason_code }),
    ...(resource.reason === undefined ? {} : { reason: resource.reason }),
  };
}

export function createLarkCaptureReport(input: {
  fidelity: DocumentCaptureFidelityReport;
  resourceMaterialization: LarkResourceMaterializationReport;
  resources: readonly LarkExternalResource[];
  access?: LarkCaptureAccess;
}): LarkCaptureReport {
  const descriptors = new Map(input.resources.map((resource) => [resourceKey(resource), resource]));
  return {
    schema_version: LARK_CAPTURE_REPORT_SCHEMA_VERSION,
    fidelity: input.fidelity,
    resource_materialization: materializationSummary(input.resourceMaterialization),
    resources: input.resourceMaterialization.items.map((item) => {
      const descriptor = descriptors.get(resourceKey(item));
      return {
        ...item,
        ...(descriptor?.title === undefined ? {} : { title: descriptor.title }),
        attributes: descriptor?.attributes ?? {},
      };
    }),
    ...(input.access === undefined ? {} : { access: input.access }),
  };
}

function parseAccess(value: unknown): LarkCaptureAccess | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || (value.identity !== "user" && value.identity !== "bot")) {
    throw new TypeError("Lark capture report access.identity must be user or bot");
  }
  const fallback = value.fallback;
  if (fallback !== undefined && (!isRecord(fallback) || fallback.from !== "bot" || typeof fallback.cause !== "string")) {
    throw new TypeError("Lark capture report access.fallback must name the bot and a cause");
  }
  if (value.events !== undefined && !Array.isArray(value.events)) throw new TypeError("Lark capture report access.events must be an array");
  const events = (value.events as unknown[] | undefined)?.map((event, index) => {
    if (!isRecord(event) || typeof event.kind !== "string" || typeof event.message !== "string" ||
        (event.app_id !== undefined && typeof event.app_id !== "string") ||
        (event.changed_access !== undefined && typeof event.changed_access !== "boolean")) {
      throw new TypeError(`Lark capture report access.events[${index}] must have kind and message`);
    }
    return { kind: event.kind, message: event.message,
      ...(event.app_id === undefined ? {} : { app_id: event.app_id as string }),
      ...(event.changed_access === undefined ? {} : { changed_access: event.changed_access as boolean }) };
  });
  return {
    identity: value.identity,
    ...(fallback === undefined ? {} : { fallback: { from: "bot" as const, cause: fallback.cause as string } }),
    ...(events === undefined ? {} : { events }),
  };
}

export function parseLarkCaptureReport(value: unknown): LarkCaptureReport {
  if (!isRecord(value)) throw new TypeError("Lark capture report must be an object");
  if (value.schema_version !== LARK_CAPTURE_REPORT_SCHEMA_VERSION) {
    throw new TypeError(`Lark capture report schema_version must be ${LARK_CAPTURE_REPORT_SCHEMA_VERSION}`);
  }
  const fidelity = parseDocumentCaptureFidelity(value.fidelity, "Lark capture report fidelity");
  if (fidelity === undefined) throw new TypeError("Lark capture report fidelity is required");
  if (!isRecord(value.resource_materialization)) {
    throw new TypeError("Lark capture report resource_materialization must be an object");
  }
  if (!Array.isArray(value.resources)) throw new TypeError("Lark capture report resources must be an array");
  const enriched = value.resources.map((resource, index) => {
    if (!isRecord(resource)) throw new TypeError(`Lark capture report resources[${index}] must be an object`);
    const title = resource.title === undefined
      ? undefined
      : typeof resource.title === "string" && resource.title.trim().length > 0
        ? resource.title.trim()
        : (() => {
            throw new TypeError(`Lark capture report resources[${index}].title must be a non-empty string`);
          })();
    return {
      raw: resource,
      ...(title === undefined ? {} : { title }),
      attributes: stringRecord(resource.attributes, `Lark capture report resources[${index}].attributes`),
    };
  });
  const materialization = parseDocumentResourceMaterialization({
    ...value.resource_materialization,
    items: enriched.map(({ raw }) => raw),
  }, "Lark capture report resource_materialization");
  if (materialization === undefined) {
    throw new TypeError("Lark capture report resource_materialization is required");
  }
  const access = parseAccess(value.access);
  return {
    schema_version: LARK_CAPTURE_REPORT_SCHEMA_VERSION,
    fidelity,
    resource_materialization: materializationSummary(materialization),
    resources: materialization.items.map((item, index) => ({
      ...item,
      ...(enriched[index]?.title === undefined ? {} : { title: enriched[index].title }),
      attributes: enriched[index]?.attributes ?? {},
    })),
    ...(access === undefined ? {} : { access }),
  };
}

export function captureReportMaterialization(report: LarkCaptureReport): DocumentResourceMaterializationReport {
  return {
    ...report.resource_materialization,
    items: report.resources.map(materializationItem),
  };
}

/** Whether two captures recorded the same access facts (identity, fallback and events). */
export function sameLarkAccess(left: LarkCaptureAccess, right: LarkCaptureAccess): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Shared with status: an identity fallback and access changes stay visible after capture. */
export function larkAccessDiagnostics(access: LarkCaptureAccess | undefined): string[] {
  return [
    ...(access?.fallback === undefined ? [] : [
      `warning: lark.capture.identity-fallback: the bot could not read this document (${access.fallback.cause}), so it was read as the user. `
      + "Content only that user can see is now in the snapshot, and later bot captures may not be able to read it; "
      + "ask the document's owner to share it with the bot",
    ]),
    ...(access?.events ?? []).map(event => `info: lark.capture.${event.kind}: ${event.message}`),
  ];
}
