import { expect, test } from "bun:test";
import { parseDocumentResourceMaterialization } from "../documentCaptureFidelity.js";
import { createDocumentSnapshotManifest, parseDocumentSnapshotManifest } from "../documentEvidence.js";

for (const status of ["materialized", "reference-only", "failed"] as const) {
  test(`count key order is irrelevant for ${status}, including nested snapshots`, () => {
    const key = status === "reference-only" ? "reference_only" : status;
    const report = {
      status: status === "failed" ? "warning" : "complete",
      discovered: { image: 1, cite: 1, embed: 1 },
      materialized: {}, reference_only: {}, failed: {},
      [key]: { embed: 1, image: 1, cite: 1 },
      items: ["image", "embed", "cite"].map(kind => ({
        kind, locator: `resource:${kind}`, status, required: false, asset_paths: [],
      })),
    };
    const original = JSON.stringify(report);
    expect(parseDocumentResourceMaterialization(report, "report")?.items).toHaveLength(3);
    const manifest = createDocumentSnapshotManifest({ sourceType: "file", sourceName: "manual",
      capturedAt: "2026-09-17T00:00:00.000Z", files: [{ path: "index.md", title: "Manual", bytes: "# Manual\n" }] });
    expect(parseDocumentSnapshotManifest({ ...manifest, metadata: { capture: {
      resourceMaterialization: report,
    } } }).metadata?.capture?.resourceMaterialization?.items).toHaveLength(3);
    expect(JSON.stringify(report)).toBe(original);
    for (const invalid of [{ image: 2, embed: 1, cite: 1 }, { image: 1, embed: 1 },
      { image: 1, embed: 1, cite: 1, extra: 0 }, { image: "1", embed: 1, cite: 1 }]) {
      expect(() => parseDocumentResourceMaterialization({ ...report, [key]: invalid }, "report")).toThrow();
    }
    expect(() => parseDocumentResourceMaterialization({ ...report, items: report.items.slice(1) }, "report")).toThrow();
  });
}
