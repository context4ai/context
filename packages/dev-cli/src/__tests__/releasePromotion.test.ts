import { describe, expect, test } from "bun:test";
import {
  releaseEvidenceDigest,
  releasePublishPlan,
} from "../commands/releasePackages.js";
import {
  promoteReleaseDistTags,
  type NpmRegistryRunner,
} from "../commands/releasePromotion.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

function smokeReceipt(version: string, registry = "https://registry.example.test"): unknown {
  const plan = releasePublishPlan(version);
  const payload = {
    schema: "context.release-install-smoke/v1",
    state: "accepted",
    registry,
    version,
    channel: plan.channel,
    packages: plan.packages.map((pkg) => pkg.exact_spec),
    capability_manifest_digest: DIGEST,
    catalog_skills: [],
    forward: {
      installed: plan.packages.map((pkg) => ({ name: pkg.name, version })),
      graph: { input_digest: DIGEST, output_digest: DIGEST },
      parsers: plan.packages.filter((pkg) => pkg.name.startsWith("@c4a/extract-") &&
        !["@c4a/extract-ts", "@c4a/extract-go", "@c4a/extract-rush"].includes(pkg.name))
        .map((pkg) => ({
          package: pkg.name,
          disposition: "analyzed",
          result_digest: DIGEST,
        })),
    },
  };
  return { ...payload, receipt_digest: releaseEvidenceDigest(payload) };
}

function registrySnapshotReceipt(
  version: string,
  registry = "https://registry.example.test",
): unknown {
  const plan = releasePublishPlan(version);
  const payload = {
    schema: "context.release-registry-snapshot/v1",
    state: "accepted",
    registry,
    version,
    channel: plan.channel,
    publish_tag: plan.publish_tag,
    promotion_tag: plan.promotion_tag,
    captured_at: "2026-08-30T08:00:00.000Z",
    packages: plan.packages.map((pkg) => ({
      name: pkg.name,
      exact_spec: pkg.exact_spec,
      exact_version: null,
      dist_tags: { latest: "0.6.19" },
    })),
  };
  return { ...payload, receipt_digest: releaseEvidenceDigest(payload) };
}

describe("release dist-tag promotion", () => {
  test("does not mutate registry tags for preview or RC releases", async () => {
    const plan = releasePublishPlan("0.7.0-preview.2");
    const calls: string[][] = [];
    const receipt = await promoteReleaseDistTags({
      plan,
      installSmokeReceipt: smokeReceipt(plan.version),
      registrySnapshotReceipt: registrySnapshotReceipt(plan.version),
      registry: "https://registry.example.test",
      run: async (args) => {
        calls.push([...args]);
        return "{}";
      },
    });

    expect(receipt.state).toBe("not-required");
    expect(receipt.promotion_tag).toBeNull();
    expect(calls).toEqual([]);
  });

  test("promotes every exact final coordinate only after an accepted smoke receipt", async () => {
    const plan = releasePublishPlan("0.7.0");
    const tags = new Map(plan.packages.map((pkg) => [pkg.name, "0.6.19"]));
    const runner: NpmRegistryRunner = async (args) => {
      if (args[0] === "view") return JSON.stringify({ latest: tags.get(args[1]!) });
      if (args[0] === "dist-tag" && args[1] === "add") {
        const separator = args[2]!.lastIndexOf("@");
        tags.set(args[2]!.slice(0, separator), args[2]!.slice(separator + 1));
        return "";
      }
      throw new Error(`unexpected npm command: ${args.join(" ")}`);
    };

    const receipt = await promoteReleaseDistTags({
      plan,
      installSmokeReceipt: smokeReceipt(plan.version),
      registrySnapshotReceipt: registrySnapshotReceipt(plan.version),
      registry: "https://registry.example.test",
      run: runner,
    });

    expect(receipt.state).toBe("accepted");
    expect(receipt.promoted_packages).toEqual(plan.packages.map((pkg) => pkg.name));
    expect([...tags.values()].every((version) => version === "0.7.0")).toBe(true);
    expect(receipt.receipt_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  test("restores every already changed latest tag when promotion fails", async () => {
    const plan = releasePublishPlan("0.7.0");
    const tags = new Map(plan.packages.map((pkg) => [pkg.name, "0.6.19"]));
    const failedPackage = plan.packages[1]!.name;
    const runner: NpmRegistryRunner = async (args) => {
      if (args[0] === "view") return JSON.stringify({ latest: tags.get(args[1]!) });
      if (args[0] === "dist-tag" && args[1] === "add") {
        const separator = args[2]!.lastIndexOf("@");
        const packageName = args[2]!.slice(0, separator);
        const version = args[2]!.slice(separator + 1);
        if (packageName === failedPackage && version === plan.version) {
          throw new Error("simulated registry failure");
        }
        tags.set(packageName, version);
        return "";
      }
      throw new Error(`unexpected npm command: ${args.join(" ")}`);
    };

    await expect(promoteReleaseDistTags({
      plan,
      installSmokeReceipt: smokeReceipt(plan.version),
      registrySnapshotReceipt: registrySnapshotReceipt(plan.version),
      registry: "https://registry.example.test",
      run: runner,
    })).rejects.toThrow("simulated registry failure");
    expect([...tags.values()].every((version) => version === "0.6.19")).toBe(true);
  });

  test("rejects a tampered install receipt before querying npm", async () => {
    const plan = releasePublishPlan("0.7.0");
    const receipt = smokeReceipt(plan.version) as Record<string, unknown>;
    receipt.version = "0.7.1";
    let called = false;

    await expect(promoteReleaseDistTags({
      plan,
      installSmokeReceipt: receipt,
      registrySnapshotReceipt: registrySnapshotReceipt(plan.version),
      registry: "https://registry.example.test",
      run: async () => {
        called = true;
        return "{}";
      },
    })).rejects.toThrow(/does not match the publish plan/u);
    expect(called).toBe(false);
  });
});
