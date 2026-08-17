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

export interface LarkCaptureReport {
  schema_version: typeof LARK_CAPTURE_REPORT_SCHEMA_VERSION;
  fidelity: DocumentCaptureFidelityReport;
  resource_materialization: Omit<DocumentResourceMaterializationReport, "items">;
  resources: LarkCaptureReportResource[];
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
  return {
    schema_version: LARK_CAPTURE_REPORT_SCHEMA_VERSION,
    fidelity,
    resource_materialization: materializationSummary(materialization),
    resources: materialization.items.map((item, index) => ({
      ...item,
      ...(enriched[index]?.title === undefined ? {} : { title: enriched[index].title }),
      attributes: enriched[index]?.attributes ?? {},
    })),
  };
}

export function captureReportMaterialization(report: LarkCaptureReport): DocumentResourceMaterializationReport {
  return {
    ...report.resource_materialization,
    items: report.resources.map(materializationItem),
  };
}
