import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadIndexerProviderManifest } from "@c4a/context";
import { BUNDLED_INDEXER_METRIC_IDS } from "../project/indexerBaseContracts.js";
import { validateBundledIndexerMetricGuidance } from
  "../project/indexerDistributionMetricGuidanceValidation.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const SOURCE = resolve(
  PACKAGE_ROOT,
  "../..",
  "plugins/context/skills/context-code-indexer",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-metric-guidance-"));
  temporaryRoots.push(root);
  await cp(SOURCE, root, { recursive: true });
  return root;
}

describe("Code Indexer metric revision guidance", () => {
  test("covers the exact CLI metric catalog without copying thresholds", async () => {
    const manifest = await loadIndexerProviderManifest(SOURCE);
    await expect(validateBundledIndexerMetricGuidance({
      source: SOURCE,
      manifest,
      expectedMetricIds: BUNDLED_INDEXER_METRIC_IDS,
    })).resolves.toBeUndefined();
  });

  test("rejects a missing metric section and numeric threshold drift", async () => {
    const missingRoot = await fixture();
    const manifest = await loadIndexerProviderManifest(missingRoot);
    await writeFile(
      join(missingRoot, "references/metrics.md"),
      "# Profile metric revision guide\n\n## inventory-disposition-coverage\n",
      "utf8",
    );
    await expect(validateBundledIndexerMetricGuidance({
      source: missingRoot,
      manifest,
      expectedMetricIds: BUNDLED_INDEXER_METRIC_IDS,
    })).rejects.toThrow(/cover every CLI metric/);

    const thresholdRoot = await fixture();
    const thresholdManifest = await loadIndexerProviderManifest(thresholdRoot);
    await writeFile(
      join(thresholdRoot, "references/metrics.md"),
      "# Profile metric revision guide\n\nHard threshold: 5%\n",
      "utf8",
    );
    await expect(validateBundledIndexerMetricGuidance({
      source: thresholdRoot,
      manifest: thresholdManifest,
      expectedMetricIds: BUNDLED_INDEXER_METRIC_IDS,
    })).rejects.toThrow(/must not copy numeric thresholds/);
  });
});
