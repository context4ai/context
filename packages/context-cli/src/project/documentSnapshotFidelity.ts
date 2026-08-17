import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DocumentCaptureFidelityReport,
  DocumentResourceMaterializationReport,
  DocumentSnapshotManifest,
} from "@c4a/extract";
import { computeDocumentContentHash, isNonBlockingDocumentResourceFailureReasonCode } from "@c4a/extract";
import {
  captureReportMaterialization,
  parseLarkCaptureReport,
  type LarkCaptureReport,
} from "../lib/larkCaptureReport.js";

export interface DocumentSnapshotFidelityState {
  report?: DocumentCaptureFidelityReport;
  resourceMaterialization?: DocumentResourceMaterializationReport;
  blocking: string[];
  warnings: string[];
}

export function readDocumentSnapshotCaptureReport(input: {
  projectRoot: string;
  materializedAt: string;
  manifest: DocumentSnapshotManifest;
}): LarkCaptureReport | undefined {
  const summary = input.manifest.metadata?.capture?.report;
  if (summary === undefined) return undefined;
  const asset = input.manifest.assets?.find((candidate) => candidate.path === summary.path);
  if (asset === undefined || asset.role !== "audit" || asset.content_hash === undefined) {
    throw new TypeError(`snapshot capture report is not registered as a hashed audit asset: ${summary.path}`);
  }
  const bytes = readFileSync(join(input.projectRoot, input.materializedAt, summary.path));
  if (computeDocumentContentHash(bytes) !== asset.content_hash) {
    throw new TypeError(`snapshot capture report hash does not match manifest: ${summary.path}`);
  }
  const captureReport = parseLarkCaptureReport(JSON.parse(bytes.toString("utf8")) as unknown);
  if (captureReport.fidelity.status !== summary.fidelityStatus ||
    captureReport.fidelity.evidence_status !== summary.evidenceStatus ||
    captureReport.fidelity.projection_status !== summary.projectionStatus ||
    captureReport.resource_materialization.status !== summary.resourceStatus) {
    throw new TypeError(`snapshot capture report summary does not match report: ${summary.path}`);
  }
  return captureReport;
}

export function documentSnapshotFidelityState(
  manifest: DocumentSnapshotManifest,
  captureReport?: LarkCaptureReport,
): DocumentSnapshotFidelityState {
  const report = captureReport?.fidelity ?? manifest.metadata?.capture?.fidelity;
  const resources = captureReport === undefined
    ? manifest.metadata?.capture?.resourceMaterialization
    : captureReportMaterialization(captureReport);
  if (report === undefined && resources === undefined) return { blocking: [], warnings: [] };
  const render = (predicate: (issue: DocumentCaptureFidelityReport["issues"][number]) => boolean) => (report?.issues ?? [])
    .filter(predicate)
    .map((issue) => `${issue.code}: ${issue.block_type} × ${issue.count}: ${issue.reason}`);
  return {
    ...(report !== undefined ? { report } : {}),
    ...(resources !== undefined ? { resourceMaterialization: resources } : {}),
    blocking: [
      ...(report === undefined ? [] : render((issue) => issue.impact === "evidence" && issue.severity === "error")),
      ...(resources?.items ?? [])
        .filter((item) =>
          item.status === "failed" &&
          item.required &&
          !isNonBlockingDocumentResourceFailureReasonCode(item.reason_code)
        )
        .map((item) => `lark.capture.resource-materialization-failed: ${item.kind}: ${item.reason ?? item.locator}`),
    ],
    warnings: [
      ...(report === undefined ? [] : render((issue) => issue.impact === "projection" || issue.severity === "warning")),
      ...(resources?.items ?? [])
        .filter((item) =>
          item.status === "failed" &&
          (!item.required || isNonBlockingDocumentResourceFailureReasonCode(item.reason_code))
        )
        .map((item) => `${item.reason_code ?? "lark.capture.resource-materialization-warning"}: ${item.kind}: ${item.reason ?? item.locator}`),
    ],
  };
}
