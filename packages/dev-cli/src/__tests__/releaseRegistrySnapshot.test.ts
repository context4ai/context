import { describe, expect, test } from "bun:test";
import {
  captureReleaseRegistryState,
  parseReleaseRegistrySnapshotReceipt,
} from "../commands/releaseRegistrySnapshot.js";
import { releasePublishPlan } from "../commands/releasePackages.js";

describe("release registry snapshot", () => {
  test("captures exact-coordinate presence and previous dist-tags before publication", async () => {
    const plan = releasePublishPlan("0.7.0-preview.2");
    const absentPackage = plan.packages[1]!;
    const receipt = await captureReleaseRegistryState({
      plan,
      registry: "https://registry.example.test",
      capturedAt: "2026-08-30T08:00:00.000Z",
      view: async (args) => {
        if (args[2] === "dist-tags") {
          return args[1] === absentPackage.name
            ? null
            : JSON.stringify({ latest: "0.6.19", preview: "0.7.0-preview.1" });
        }
        return null;
      },
    });

    expect(receipt.packages).toHaveLength(plan.packages.length);
    expect(receipt.packages.find((pkg) => pkg.name === absentPackage.name)).toEqual({
      name: absentPackage.name,
      exact_spec: absentPackage.exact_spec,
      exact_version: null,
      dist_tags: {},
    });
    expect(receipt.packages[0]?.dist_tags).toEqual({
      latest: "0.6.19",
      preview: "0.7.0-preview.1",
    });
    expect(parseReleaseRegistrySnapshotReceipt(
      receipt,
      plan,
      "https://registry.example.test",
    )).toEqual(receipt);
  });

  test("rejects a tampered package snapshot or digest", async () => {
    const plan = releasePublishPlan("0.7.0");
    const receipt = await captureReleaseRegistryState({
      plan,
      registry: "https://registry.example.test",
      capturedAt: "2026-08-30T08:00:00.000Z",
      view: async (args) => args[2] === "dist-tags"
        ? JSON.stringify({ latest: "0.6.19" })
        : null,
    });
    receipt.packages[0]!.dist_tags.latest = "0.7.0";

    expect(() => parseReleaseRegistrySnapshotReceipt(
      receipt,
      plan,
      "https://registry.example.test",
    )).toThrow(/digest is invalid/u);
  });
});
