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
});
