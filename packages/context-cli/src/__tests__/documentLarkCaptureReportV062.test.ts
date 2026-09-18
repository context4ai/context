import { describe, expect, test } from "bun:test";
import {
  captureReportMaterialization,
  createLarkCaptureReport,
  parseLarkCaptureReport,
} from "../lib/larkCaptureReport.js";

describe("0.6.2 compact Lark capture report", () => {
  test("consolidates resource descriptors and materialization state without losing audit fields", () => {
    const report = createLarkCaptureReport({
      fidelity: {
        status: "complete",
        evidence_status: "complete",
        projection_status: "complete",
        discovered: { image: 1 },
        converted: { image: 1 },
        skipped: [],
        issues: [],
      },
      resourceMaterialization: {
        status: "complete",
        discovered: { image: 1 },
        materialized: { image: 1 },
        reference_only: {},
        failed: {},
        items: [{
          kind: "image",
          locator: "lark:image:resource-token",
          status: "materialized",
          required: true,
          asset_paths: ["materialized/image/example.png"],
        }],
      },
      resources: [{
        kind: "image",
        locator: "lark:image:resource-token",
        title: "Example",
        attributes: { width: "640", height: "480" },
      }],
    });

    const parsed = parseLarkCaptureReport(JSON.parse(JSON.stringify(report)) as unknown);
    expect(parsed.resources[0]).toMatchObject({
      kind: "image",
      locator: "lark:image:resource-token",
      title: "Example",
      attributes: { width: "640", height: "480" },
      status: "materialized",
      asset_paths: ["materialized/image/example.png"],
    });
    expect(captureReportMaterialization(parsed)).toEqual({
      status: "complete",
      discovered: { image: 1 },
      materialized: { image: 1 },
      reference_only: {},
      failed: {},
      items: [{
        kind: "image",
        locator: "lark:image:resource-token",
        status: "materialized",
        required: true,
        asset_paths: ["materialized/image/example.png"],
      }],
    });
  });

  test("rejects resource summaries that do not close against consolidated resources", () => {
    const report = createLarkCaptureReport({
      fidelity: {
        status: "complete",
        evidence_status: "complete",
        projection_status: "complete",
        discovered: {},
        converted: {},
        skipped: [],
        issues: [],
      },
      resourceMaterialization: {
        status: "complete",
        discovered: {},
        materialized: {},
        reference_only: {},
        failed: {},
        items: [],
      },
      resources: [],
    });

    expect(() => parseLarkCaptureReport({
      ...report,
      resource_materialization: {
        ...report.resource_materialization,
        discovered: { image: 1 },
      },
    })).toThrow(/does not match resources|does not match items/u);
  });

  test("accepts reordered count maps without mutating or accepting corrupt reports", () => {
    const resources = ["image", "embed", "cite"].map((kind) => ({
      kind, locator: `lark:${kind}:example`, status: "reference-only",
      required: false, asset_paths: [], attributes: {},
    }));
    const report = {
      schema_version: "context.lark-capture-report.v1",
      fidelity: { status: "complete", evidence_status: "complete",
        projection_status: "complete", discovered: {}, converted: {}, skipped: [], issues: [] },
      resource_materialization: { status: "complete",
        discovered: { image: 1, cite: 1, embed: 1 }, materialized: {},
        reference_only: { embed: 1, image: 1, cite: 1 }, failed: {} },
      resources,
    };
    const before = JSON.stringify(report);
    expect(parseLarkCaptureReport(report).resources).toHaveLength(3);
    expect(JSON.stringify(report)).toBe(before);
    for (const key of ["discovered", "reference_only", "materialized", "failed"]) {
      expect(() => parseLarkCaptureReport({ ...report, resource_materialization: {
        ...report.resource_materialization, [key]: { image: 2, embed: 1, cite: 1 },
      } })).toThrow(/does not match items/u);
    }
    expect(() => parseLarkCaptureReport({ ...report, resource_materialization: {
      ...report.resource_materialization, reference_only: { image: "1", embed: 1, cite: 1 },
    } })).toThrow();
    expect(() => parseLarkCaptureReport({ ...report,
      resources: [{ ...resources[0], status: "invalid" }, ...resources.slice(1)],
    })).toThrow();
  });

});
