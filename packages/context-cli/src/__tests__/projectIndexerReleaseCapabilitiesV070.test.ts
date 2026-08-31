import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  IndexerFeatureNotReadyError,
  assertIndexerReleaseCapabilityReady,
  buildIndexerReleaseCapabilityManifest,
  validateIndexerReleaseCapabilityManifest,
} from "../project/indexerReleaseCapabilities.js";
import {
  listCliBundledIndexers,
  resolveCliBundledIndexerProvider,
} from "../project/indexerCliBundledProvider.js";
import { materializeBundledIndexerDistribution } from
  "../project/indexerDistributionBuild.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

function state(
  version: string,
  capability: string,
  evidence: Parameters<typeof buildIndexerReleaseCapabilityManifest>[1] = {},
): string | undefined {
  return buildIndexerReleaseCapabilityManifest(version, evidence).capabilities.find(
    (item) => item.id === capability,
  )?.state;
}

describe("Indexer release capability manifest", () => {
  test("exposes only the capability set assigned to each preview channel", () => {
    expect(state("0.7.0-preview.1", "provider-lifecycle")).toBe("ready");
    expect(state("0.7.0-preview.1", "code-indexer")).toBe("not-ready");
    expect(state("0.7.0-preview.2", "code-indexer")).toBe("ready");
    expect(state("0.7.0-preview.2", "markdown-indexer")).toBe("not-ready");
    expect(state("0.7.0-preview.3", "markdown-indexer")).toBe("ready");
    expect(state("0.7.0-rc.1", "resource-protocols")).toBe("not-ready");
    expect(state("0.7.0-rc.1", "phase-g-cutover")).toBe("not-ready");
    expect(state("0.7.0", "phase-g-cutover")).toBe("not-ready");
    expect(state("0.7.0", "phase-g-cutover", { phaseGCutover: true })).toBe("ready");
    expect(state("0.7.1", "resource-protocols")).toBe("ready");
    expect(buildIndexerReleaseCapabilityManifest("0.7.1").dist_tag).toBe("latest");
    expect(state("0.7.1-preview.1", "resource-protocols")).toBe("ready");
    expect(buildIndexerReleaseCapabilityManifest("0.7.1-preview.1").dist_tag).toBe(
      "preview",
    );
    expect(buildIndexerReleaseCapabilityManifest("0.7.1-rc.1").dist_tag).toBe("rc");
  });

  test("validates content identity and emits the exact feature-not-ready diagnostic", () => {
    const manifest = buildIndexerReleaseCapabilityManifest("0.7.0-preview.2");
    expect(validateIndexerReleaseCapabilityManifest(manifest, manifest.version)).toEqual(manifest);
    expect(() => validateIndexerReleaseCapabilityManifest({
      ...manifest,
      capabilities: manifest.capabilities.map((item) => (
        item.id === "markdown-indexer" ? { ...item, state: "ready" } : item
      )),
    })).toThrow(/digest is invalid/);
    try {
      assertIndexerReleaseCapabilityReady(manifest, "markdown-indexer");
      throw new Error("expected feature-not-ready");
    } catch (error) {
      expect(error).toBeInstanceOf(IndexerFeatureNotReadyError);
      expect((error as IndexerFeatureNotReadyError).code).toBe("indexer-feature-not-ready");
      expect((error as IndexerFeatureNotReadyError).requiredMilestone).toBe(
        "0.7.0-preview.3",
      );
    }
  });

  test("filters unavailable bundled Providers and blocks direct resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-release-capabilities-"));
    temporaryRoots.push(root);
    const assetsRoot = join(root, "assets");
    const release = await materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      outputRoot: assetsRoot,
    });
    expect(JSON.parse(await readFile(
      join(assetsRoot, "capability-manifest.json"),
      "utf8",
    )).capabilities).toContainEqual(expect.objectContaining({
      id: "phase-g-cutover",
      state: "ready",
    }));
    const previewVersion = "0.7.0-preview.1";
    await writeFile(
      join(assetsRoot, "release-manifest.json"),
      `${JSON.stringify({ ...release, version: previewVersion }, null, 2)}\n`,
    );
    await writeFile(
      join(assetsRoot, "capability-manifest.json"),
      `${JSON.stringify(buildIndexerReleaseCapabilityManifest(previewVersion), null, 2)}\n`,
    );

    expect((await listCliBundledIndexers({ assetsRoot })).bundles).toEqual([]);
    const code = release.bundles.find((bundle) => bundle.skill === "context-code-indexer")!;
    await expect(resolveCliBundledIndexerProvider({
      assetsRoot,
      expectedPackageVersion: previewVersion,
      expected: {
        indexerId: "community-code",
        providerId: "community-code",
        skill: code.skill,
        version: code.version,
        integrity: code.integrity,
        distribution: code.distribution,
      },
      transportRoot: join(root, "transport"),
    })).rejects.toMatchObject({ code: "indexer-feature-not-ready" });
    expect(await readFile(join(assetsRoot, "capability-manifest.json"), "utf8"))
      .toContain("context.indexer.release-capability-manifest/v1");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);
});
