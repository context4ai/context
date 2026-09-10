import { afterAll, afterEach } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";

export const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
export const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;

// Register this fixture inside each suite so mutation tests own their files and cleanup.
export function indexerDistributionFixtures() {
  const temporaryRoots: string[] = [];
  let baselineRoot: string | undefined;
  let baseline: Promise<{
    assetsRoot: string;
    manifest: Awaited<ReturnType<typeof materializeBundledIndexerDistribution>>;
  }> | undefined;
  afterAll(async () => {
    if (baselineRoot !== undefined) await rm(baselineRoot, { recursive: true, force: true });
  });
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ));
  });

  async function createTemporaryRoot(prefix: string) {
    const root = await mkdtemp(join(tmpdir(), prefix));
    temporaryRoots.push(root);
    return root;
  }

  async function buildFixture() {
    // Build current sources once per suite, never reuse installed or stale dist.
    // Every caller receives private files and metadata, including mutation tests.
    baseline ??= (async () => {
      baselineRoot = await mkdtemp(join(tmpdir(), "context-cli-indexers-baseline-"));
      const assetsRoot = join(baselineRoot, "assets");
      const manifest = await materializeBundledIndexerDistribution({
        packageRoot: PACKAGE_ROOT,
        outputRoot: assetsRoot,
      });
      return { assetsRoot, manifest };
    })();
    const built = await baseline;
    const root = await createTemporaryRoot("context-cli-indexers-");
    const assetsRoot = join(root, "assets");
    await cp(built.assetsRoot, assetsRoot, { recursive: true });
    return { root, assetsRoot, manifest: structuredClone(built.manifest) };
  }

  return { createTemporaryRoot, buildFixture };
}
