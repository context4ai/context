import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadIndexerProviderManifest } from "@c4a/context";
import { materializeBundledIndexerDistribution } from
  "../project/indexerDistributionBuild.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { validateBundledIndexerCommunityScenarioFixtures } from
  "../project/indexerDistributionCommunityScenarioValidation.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

async function isolatedSource() {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-community-scenarios-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "skills");
  await cp(join(REPOSITORY_ROOT, "plugins", "context", "skills"), sourceRoot, {
    recursive: true,
  });
  return { root, sourceRoot };
}

describe("community Indexer scenario fixtures", () => {
  test("ships the complete anonymous positive and negative scenario matrix", async () => {
    const { root, sourceRoot } = await isolatedSource();
    const manifest = await materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "output"),
    });
    const fixture = JSON.parse(await readFile(
      join(root, "output", "bundles", "context-code-indexer", "tests", "fixtures", "scenarios.json"),
      "utf8",
    )) as {
      anonymized: boolean;
      positive_cases: Array<{ scenario_id: string }>;
      negative_cases: Array<{ scenario_id: string }>;
    };
    expect(fixture.anonymized).toBe(true);
    expect(fixture.positive_cases.map((item) => item.scenario_id)).toEqual([
      "rpc-query-catalog",
      "http-handler-flow",
      "gateway-handoff",
      "event-flow",
      "function-runtime",
      "scheduled-worker",
      "reconciliation-flow",
      "stateful-service",
      "repository-boundary",
      "library-capability",
    ]);
    expect(fixture.negative_cases.map((item) => item.scenario_id)).toEqual([
      "complete-page-stale-source",
      "one-method-one-page-inflation",
      "unresolved-authoring-placeholder",
      "missing-runtime-platform-fact",
    ]);
    expect(manifest.bundles.find((bundle) => bundle.skill === "context-code-indexer")
      ?.files.some((file) => file.path === "tests/fixtures/scenarios.json")).toBe(true);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects missing, reordered, relabelled, or de-anonymized scenarios", async () => {
    const operatorContract = bundledIndexerOperatorContract();
    const profileContract = bundledIndexerProfileContract(operatorContract);
    for (const mutation of ["missing", "reordered", "relabelled", "de-anonymized"] as const) {
      const { sourceRoot } = await isolatedSource();
      const source = join(sourceRoot, "context-code-indexer");
      const path = join(
        source,
        "tests",
        "fixtures",
        "scenarios.json",
      );
      const fixture = JSON.parse(await readFile(path, "utf8")) as {
        anonymized: boolean;
        positive_cases: Array<Record<string, unknown>>;
      };
      if (mutation === "missing") fixture.positive_cases.pop();
      if (mutation === "reordered") fixture.positive_cases.reverse();
      if (mutation === "relabelled") {
        fixture.positive_cases[0]!.expected_projection_disposition = "detailed";
      }
      if (mutation === "de-anonymized") fixture.anonymized = false;
      await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
      const manifest = await loadIndexerProviderManifest(source);
      await expect(validateBundledIndexerCommunityScenarioFixtures({
        source,
        manifest,
        profileContract,
        operatorContract,
      })).rejects.toThrow(/scenario fixture|scenario rpc-query-catalog/);
    }
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);
});
