import { afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";

export const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
export const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;

// Register this fixture inside each suite so mutation tests own their files and cleanup.
export function indexerDistributionFixtures() {
  const temporaryRoots: string[] = [];
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
    const root = await createTemporaryRoot("context-cli-indexers-");
    const assetsRoot = join(root, "assets");
    const manifest = await materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      outputRoot: assetsRoot,
    });
    return { root, assetsRoot, manifest };
  }

  return { createTemporaryRoot, buildFixture };
}
